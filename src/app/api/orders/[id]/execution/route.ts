import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { syncOrderStatus } from '@/lib/orderExecution';

// Add a stage to an order's Execution at any position: after the row given by afterId, or first when
// afterId is empty, e.g. "Issue PO to Vendor" between "10% Advance" and "20% Before Dispatch".
// Added stages are ticked off like any row; payments are still raised by their own rows.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await prisma.order.findUnique({
      where: { id },
      select: { orderNumber: true, orderStatus: true, executionSteps: { select: { id: true, name: true, sequence: true } } },
    });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const { afterId, name } = await readJson(request);
    const after = afterId ? order.executionSteps.find((s) => s.id === afterId) : null;
    if (afterId && !after) return NextResponse.json({ error: 'The row to add after is not on this order' }, { status: 400 });
    const label = String(name ?? '').trim();
    if (!label) return NextResponse.json({ error: 'Enter the stage name' }, { status: 400 });
    if (label.length > 100) return NextResponse.json({ error: 'Keep the stage name under 100 characters' }, { status: 400 });
    // Names identify the rows that raise payments, so they stay unique on the order
    if (order.executionSteps.some((s) => s.name.toLowerCase() === label.toLowerCase())) {
      return NextResponse.json({ error: `"${label}" is already in this order's Execution` }, { status: 400 });
    }

    const sequence = after ? after.sequence + 1 : 1;
    const step = await prisma.$transaction(async (tx) => {
      // Make room: move the rows from this position down by one (via a high offset, as sequences are unique)
      await tx.orderExecutionStep.updateMany({ where: { orderId: id, sequence: { gte: sequence } }, data: { sequence: { increment: 10000 } } });
      await tx.orderExecutionStep.updateMany({ where: { orderId: id, sequence: { gte: 10000 } }, data: { sequence: { decrement: 9999 } } });
      const created = await tx.orderExecutionStep.create({ data: { orderId: id, sequence, name: label } });
      // A new pending stage means the order is no longer complete
      await syncOrderStatus(tx, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: { orderNumber: order.orderNumber, executionStageAdded: label, after: after?.name ?? '(first)' },
        },
      });
      return created;
    });

    return NextResponse.json({ success: true, step });
  } catch (error: any) {
    return errorResponse(error);
  }
}
