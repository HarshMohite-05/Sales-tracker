import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse, ValidationError } from '@/lib/apiErrors';
import { deductionPercentError, parseRetentionDueDate } from '@/lib/deductions';
import { recalculateOrderPayments } from '@/lib/orderPayments';

// Change an order's TDS / retention after confirmation. Amounts are recalculated; receipts are
// untouched. The order keeps the calculation bases it was confirmed with.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const { tdsEnabled = false, tdsPercent, retentionEnabled = false, retentionPercent, retentionDueDate } = await readJson(request);
    for (const err of [
      deductionPercentError('TDS', !!tdsEnabled, tdsPercent),
      deductionPercentError('Retention', !!retentionEnabled, retentionPercent),
    ]) {
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    const retentionDue = parseRetentionDueDate(!!retentionEnabled, retentionDueDate);
    if ('error' in retentionDue) return NextResponse.json({ error: retentionDue.error }, { status: 400 });

    const before = {
      tds: order.tdsEnabled ? `${Number(order.tdsPercent)}% = ${Number(order.tdsAmount)}` : 'off',
      retention: order.retentionEnabled ? `${Number(order.retentionPercent)}% = ${Number(order.retentionAmount)}` : 'off',
      retentionDueDate: order.retentionDueDate?.toISOString().slice(0, 10) ?? null,
      expectedPayment: Number(order.expectedPayment),
    };

    const updated = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          tdsEnabled: !!tdsEnabled,
          tdsPercent: tdsEnabled ? Number(tdsPercent) : 0,
          retentionEnabled: !!retentionEnabled,
          retentionPercent: retentionEnabled ? Number(retentionPercent) : 0,
          retentionDueDate: retentionDue.date,
        },
      });
      await recalculateOrderPayments(tx, id);
      const result = await tx.order.findUniqueOrThrow({ where: { id } });
      if (Number(result.expectedPayment) <= 0) {
        throw new ValidationError('TDS and retention together cannot be the whole order value or more');
      }

      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: order.orderNumber,
            deductionsChanged: true,
            before,
            after: {
              tds: result.tdsEnabled ? `${Number(result.tdsPercent)}% = ${Number(result.tdsAmount)}` : 'off',
              retention: result.retentionEnabled
                ? `${Number(result.retentionPercent)}% = ${Number(result.retentionAmount)}`
                : 'off',
              retentionDueDate: result.retentionDueDate?.toISOString().slice(0, 10) ?? null,
              expectedPayment: Number(result.expectedPayment),
            },
          },
        },
      });
      return result;
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error: any) {
    return errorResponse(error);
  }
}
