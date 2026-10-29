import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { findDuplicateReference, parseReceiptInput } from '@/lib/receiptInput';

// Record money received against one of an order's payment stages. Each receipt is kept
// separately, so partial and multiple payments build up without overwriting earlier ones.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await prisma.order.findUnique({ where: { id }, select: { orderNumber: true, orderStatus: true } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const input = parseReceiptInput(await readJson(request));
    if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });

    const stage = await prisma.orderPaymentStage.findFirst({ where: { id: input.paymentStageId, orderId: id } });
    if (!stage) return NextResponse.json({ error: 'That payment stage is not on this order' }, { status: 400 });

    const duplicate = await findDuplicateReference(prisma, input.reference);
    if (duplicate) {
      return NextResponse.json(
        { error: `Reference ${input.reference} is already used on a receipt for ${duplicate.order.orderNumber}` },
        { status: 409 }
      );
    }

    const receipt = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `receipt-reference:${input.reference?.toLowerCase() || ''}`);
      const repeated = await findDuplicateReference(tx, input.reference);
      if (repeated) throw new ConflictError('That payment reference is already used on an active receipt.');
      const created = await tx.orderReceipt.create({ data: { ...input, orderId: id, recordedById: user.id } });
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'CREATE',
          actorId: user.id,
          details: {
            orderNumber: order.orderNumber,
            receiptId: created.id,
            paymentStage: `${Number(stage.percent)}% ${stage.description}`,
            amount: input.amount,
            receivedDate: input.receivedDate.toISOString().slice(0, 10),
            reference: input.reference,
          },
        },
      });
      return created;
    });

    return NextResponse.json({ success: true, receipt });
  } catch (error: any) {
    return errorResponse(error);
  }
}
