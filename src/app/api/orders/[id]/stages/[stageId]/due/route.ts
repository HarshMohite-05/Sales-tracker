import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { raisingStep } from '@/lib/executionSteps';

// Raise a payment stage as due on a date, or take it back to not due. Only for stages that no
// execution step raises (e.g. a custom "Other" stage); the rest follow their steps.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, stageId } = await params;
    await assertOrderAccess(user, id);

    const stage = await prisma.orderPaymentStage.findFirst({
      where: { id: stageId, orderId: id },
      include: { order: { select: { orderNumber: true, orderStatus: true, executionSteps: { select: { name: true } } } } },
    });
    if (!stage) return NextResponse.json({ error: 'Payment stage not found on this order' }, { status: 404 });
    if (stage.order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }
    const trigger = raisingStep(stage, stage.order.executionSteps.map((s) => s.name));
    if (trigger) {
      return NextResponse.json({ error: `This stage becomes due when "${trigger}" is done in Execution` }, { status: 400 });
    }

    const { dueDate } = await readJson(request);
    const date = dueDate ? new Date(dueDate) : null;
    if (dueDate && (!date || Number.isNaN(date.getTime()))) {
      return NextResponse.json({ error: 'Enter a valid due date' }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.orderPaymentStage.update({ where: { id: stageId }, data: { dueDate: date } });
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: stage.order.orderNumber,
            paymentStage: `${Number(stage.percent)}% ${stage.description}`,
            dueDate: date ? date.toISOString().slice(0, 10) : null,
            before: { dueDate: stage.dueDate ? stage.dueDate.toISOString().slice(0, 10) : null },
          },
        },
      });
      return result;
    });

    return NextResponse.json({ success: true, stage: updated });
  } catch (error: any) {
    return errorResponse(error);
  }
}
