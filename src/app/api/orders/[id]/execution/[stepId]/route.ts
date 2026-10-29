import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { ExecutionStepStatus } from '@prisma/client';
import { syncOrderStatus, syncPaymentDues } from '@/lib/orderExecution';
import { isAddedStage } from '@/lib/executionSteps';

// Mark one execution step of an order as done on a date, not needed, or back to pending.
// Payment stages raised by the step become due (or not due again).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id, stepId } = await params;
    await assertOrderAccess(user, id);

    const step = await prisma.orderExecutionStep.findFirst({
      where: { id: stepId, orderId: id },
      include: { order: { select: { orderNumber: true, orderStatus: true } } },
    });
    if (!step) {
      return NextResponse.json({ error: 'Step not found on this order' }, { status: 404 });
    }
    if (step.order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const { status, completedDate } = await readJson(request);
    if (!(status in ExecutionStepStatus)) {
      return NextResponse.json({ error: 'Choose done, not needed or pending' }, { status: 400 });
    }

    let date: Date | null = null;
    if (status === ExecutionStepStatus.DONE) {
      date = completedDate ? new Date(completedDate) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: `Enter the date for "${step.name}"` }, { status: 400 });
      }
      // Compare by day so today is allowed in any timezone
      if (date.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'The date cannot be in the future' }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.orderExecutionStep.update({
        where: { id: stepId },
        data: {
          status: status as ExecutionStepStatus,
          completedDate: date,
          updatedById: status === ExecutionStepStatus.PENDING ? null : user.id,
        },
        include: { updatedBy: { select: { id: true, name: true } } },
      });
      await syncOrderStatus(tx, id);
      // Payment stages whose steps are now complete become due
      await syncPaymentDues(tx, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: step.order.orderNumber,
            executionStep: step.name,
            status,
            ...(date ? { completedDate: date.toISOString().slice(0, 10) } : {}),
          },
        },
      });
      return result;
    });

    return NextResponse.json({ success: true, step: updated });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}

// Remove a stage added to the order's Execution. The rows that raise payments follow the payment terms and stay.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, stepId } = await params;
    await assertOrderAccess(user, id);

    const step = await prisma.orderExecutionStep.findFirst({
      where: { id: stepId, orderId: id },
      include: { order: { select: { orderNumber: true, orderStatus: true, invoiceStepId: true, payments: true } } },
    });
    if (!step) return NextResponse.json({ error: 'Step not found on this order' }, { status: 404 });
    if (!isAddedStage(step.name, step.order.payments)) {
      return NextResponse.json({ error: 'Only stages you added can be removed; payment rows follow the payment terms' }, { status: 400 });
    }
    if (step.order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.orderExecutionStep.delete({ where: { id: stepId } });
      await syncOrderStatus(tx, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: { orderNumber: step.order.orderNumber, executionStageRemoved: step.name },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
