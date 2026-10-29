import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';

// Set or revise an order's targeted completion date. Changing a date already set needs a reason; every
// change is kept, so the date first promised stays visible next to the current one.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await prisma.order.findUnique({ where: { id }, select: { orderNumber: true, orderStatus: true, deliveryDate: true } });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const { deliveryDate, reason } = await readJson(request);
    const newDate = deliveryDate ? new Date(deliveryDate) : null;
    if (!newDate || Number.isNaN(newDate.getTime())) {
      return NextResponse.json({ error: 'Enter the targeted completion date' }, { status: 400 });
    }
    const why = String(reason ?? '').trim();
    if (order.deliveryDate && !why) {
      return NextResponse.json({ error: 'Enter why the targeted completion date is changing' }, { status: 400 });
    }
    if (why.length > 300) return NextResponse.json({ error: 'Keep the reason under 300 characters' }, { status: 400 });
    if (order.deliveryDate?.getTime() === newDate.getTime()) {
      return NextResponse.json({ error: 'That is already the targeted completion date' }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.orderDeliveryRevision.create({
        data: { orderId: id, previousDate: order.deliveryDate, newDate, reason: why || 'Target date set', revisedById: user.id },
      });
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: { orderNumber: order.orderNumber, targetDeliveryFrom: order.deliveryDate, targetDeliveryTo: newDate, reason: why },
        },
      });
      return tx.order.update({ where: { id }, data: { deliveryDate: newDate } });
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error: any) {
    return errorResponse(error);
  }
}
