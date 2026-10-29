import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { moveOrderToBin } from '@/lib/recycleBin';

// Delete an accessible order; it goes to the recycle bin with its stages, steps, receipts and invoices
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        orderNumber: true,
        _count: { select: { receipts: { where: { isReversed: false } } } },
        invoices: { select: { invoiceNumber: true, _count: { select: { allocations: true } } } },
      },
    });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    // Money received must not disappear with the order
    if (order._count.receipts > 0) {
      return NextResponse.json(
        { error: `${order.orderNumber} has payments recorded. Reverse them on the Payments tab first, then delete the order.` },
        { status: 400 }
      );
    }
    const paidInvoice = order.invoices.find((inv) => inv._count.allocations > 0);
    if (paidInvoice) {
      return NextResponse.json(
        { error: `Invoice ${paidInvoice.invoiceNumber} on this order has receipts allocated to it, so the order cannot be deleted.` },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const binItem = await moveOrderToBin(tx, user, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'DELETE',
          actorId: user.id,
          details: { orderNumber: order.orderNumber, recycleBinItemId: binItem.id },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
