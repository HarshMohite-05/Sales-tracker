import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { findDuplicateReference, parseReceiptInput } from '@/lib/receiptInput';

// Correct a receipt. The previous values go into the change log, so nothing is lost.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, receiptId } = await params;
    await assertOrderAccess(user, id);

    const receipt = await prisma.orderReceipt.findFirst({
      where: { id: receiptId, orderId: id },
      include: { order: { select: { orderNumber: true } } },
    });
    if (!receipt) return NextResponse.json({ error: 'Receipt not found on this order' }, { status: 404 });
    if (receipt.isReversed) {
      return NextResponse.json({ error: 'This receipt was reversed. Record a new receipt instead.' }, { status: 400 });
    }

    const input = parseReceiptInput(await readJson(request));
    if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });

    const stage = await prisma.orderPaymentStage.findFirst({ where: { id: input.paymentStageId, orderId: id } });
    if (!stage) return NextResponse.json({ error: 'That payment stage is not on this order' }, { status: 400 });

    const duplicate = await findDuplicateReference(prisma, input.reference, receiptId);
    if (duplicate) {
      return NextResponse.json(
        { error: `Reference ${input.reference} is already used on a receipt for ${duplicate.order.orderNumber}` },
        { status: 409 }
      );
    }

    const before = {
      paymentStageId: receipt.paymentStageId,
      amount: Number(receipt.amount),
      receivedDate: receipt.receivedDate.toISOString().slice(0, 10),
      paymentMode: receipt.paymentMode,
      reference: receipt.reference,
      notes: receipt.notes,
    };

    const updated = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `receipt:${receiptId}`);
      const current = await tx.orderReceipt.findUnique({ where: { id: receiptId } });
      if (!current || current.isReversed) throw new ConflictError('This receipt has already been reversed or removed. Refresh before changing it.');
      await lockRecord(tx, `receipt-reference:${input.reference?.toLowerCase() || ''}`);
      const repeated = await findDuplicateReference(tx, input.reference, receiptId);
      if (repeated) throw new ConflictError('That payment reference is already used on an active receipt.');
      const result = await tx.orderReceipt.update({ where: { id: receiptId }, data: input });
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: receipt.order.orderNumber,
            receiptId,
            receiptEdited: true,
            before,
            after: { ...input, receivedDate: input.receivedDate.toISOString().slice(0, 10) },
          },
        },
      });
      return result;
    });

    return NextResponse.json({ success: true, receipt: updated });
  } catch (error: any) {
    return errorResponse(error);
  }
}
