import prisma from '@/lib/prisma';
import { ExecutionStepStatus, OrderStatus, Prisma } from '@prisma/client';
import { invoiceGstStageId, paymentStageDueDate, paymentStepName, PO_RECEIVED_STEP, raisingStep } from '@/lib/executionSteps';

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Create the Execution rows for an order that has none yet, from its payment stages (create those
 * first): one row per stage, e.g. "10% Advance", or the single Delivery & Invoice Raised row for fixed terms.
 */
export async function createExecutionSteps(db: Db, orderId: string) {
  const stages = await db.orderPaymentStage.findMany({ where: { orderId }, orderBy: { sequence: 'asc' } });
  // Two stages with the same percentage and description share one row
  const names = [...new Set(stages.map(paymentStepName))];
  await db.orderExecutionStep.createMany({
    data: names.map((name, i) => ({ orderId, sequence: i + 1, name })),
  });
}

/**
 * Order status from its Execution rows: Completed once every row is done or not needed,
 * Dispatched once a dispatch row is done, In Execution once any row (other than an older order's
 * Receipt of PO) is done. Cancelled orders stay cancelled.
 */
export async function syncOrderStatus(db: Db, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { orderStatus: true, executionSteps: { select: { name: true, status: true } } },
  });
  if (!order || order.orderStatus === OrderStatus.CANCELLED) return;

  const steps = order.executionSteps;
  const isDone = (s: { status: string }) => s.status === ExecutionStepStatus.DONE;
  const workDone = steps.some((s) => s.name !== PO_RECEIVED_STEP && isDone(s));
  const status =
    steps.length > 0 && steps.every((s) => s.status !== ExecutionStepStatus.PENDING) && steps.some(isDone)
      ? OrderStatus.COMPLETED
      : steps.some((s) => isDone(s) && /dispatch/i.test(s.name))
      ? OrderStatus.DISPATCHED
      : workDone
      ? OrderStatus.IN_EXECUTION
      : OrderStatus.CONFIRMED;

  if (status !== order.orderStatus) {
    await db.order.update({ where: { id: orderId }, data: { orderStatus: status } });
  }
}

/**
 * Raise payment stages as due from Execution: a stage is due from the date saved on its own row (plus
 * the credit days for fixed terms), and goes back to not due if the row is reopened. Older orders
 * follow their standard steps; stages no row raises keep the due date set by hand.
 */
export async function syncPaymentDues(db: Db, orderId: string) {
  const [stages, steps] = await Promise.all([
    db.orderPaymentStage.findMany({ where: { orderId } }),
    db.orderExecutionStep.findMany({ where: { orderId } }),
  ]);
  const names = steps.map((s) => s.name);
  for (const stage of stages) {
    if (!raisingStep(stage, names)) continue;
    const due = paymentStageDueDate(stage, steps);
    if (due?.getTime() !== stage.dueDate?.getTime()) {
      await db.orderPaymentStage.update({ where: { id: stage.id }, data: { dueDate: due } });
    }
  }
}

/**
 * Put the order's invoice GST on the stage it is asked with, and clear it from the others.
 */
export async function applyInvoiceGst(db: Db, orderId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { invoiceStepId: true, invoiceGstAmount: true, payments: true, executionSteps: true },
  });
  const step = order.executionSteps.find((s) => s.id === order.invoiceStepId);
  const target = step ? invoiceGstStageId(order.payments, step.name) : null;
  for (const stage of order.payments) {
    const gst = stage.id === target ? Number(order.invoiceGstAmount) : 0;
    if (Number(stage.gstAmount) !== gst) {
      await db.orderPaymentStage.update({ where: { id: stage.id }, data: { gstAmount: gst } });
    }
  }
}
