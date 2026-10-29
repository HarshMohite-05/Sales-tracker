import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';

// Reverse a receipt entered by mistake or that bounced. It stays in the payment history,
// marked reversed, and stops counting towards the amount received.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, receiptId } = await params;
    await assertOrderAccess(user, id);

    const receipt = await prisma.orderReceipt.findFirst({
      where: { id: receiptId, orderId: id },
      include: { order: { select: { orderNumber: true } } },
    });
    if (!receipt) return NextResponse.json({ error: 'Receipt not found on this order' }, { status: 404 });
    if (receipt.isReversed) return NextResponse.json({ error: 'This receipt is already reversed' }, { status: 400 });

    const { reason } = await readJson(request);
    if (!String(reason ?? '').trim()) {
      return NextResponse.json({ error: 'Give a reason for reversing this receipt' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `receipt:${receiptId}`);
      const current = await tx.orderReceipt.findUnique({ where: { id: receiptId } });
      if (!current || current.isReversed) throw new ConflictError('This receipt has already been reversed or removed. Refresh before changing it.');
      await tx.orderReceipt.update({
        where: { id: receiptId },
        data: { isReversed: true, reversedAt: new Date(), reversalReason: String(reason).trim(), reversedById: user.id },
      });
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: receipt.order.orderNumber,
            receiptId,
            receiptReversed: true,
            amount: Number(receipt.amount),
            reference: receipt.reference,
            reason: String(reason).trim(),
          },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
