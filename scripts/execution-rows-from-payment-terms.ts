/**
 * One-off, after Execution started following the payment terms: orders that still have the standard
 * steps (Receipt of PO … Commissioning) get one row per payment stage instead (e.g. "10% Advance").
 * A stage already due becomes a done row on its due date, so no due date changes; an invoice moves to
 * the row of the payment its GST is asked with. Receipts stay attached to their stages.
 * Safe to run more than once: orders already on payment rows are skipped.
 * Usage: npx tsx scripts/execution-rows-from-payment-terms.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { ExecutionStepStatus } from '@prisma/client';
import { EXECUTION_STEPS, invoiceGstStageId, paymentStepName } from '../src/lib/executionSteps';
import { applyInvoiceGst, syncOrderStatus, syncPaymentDues } from '../src/lib/orderExecution';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

async function main() {
  const orders = await prisma.order.findMany({
    include: { executionSteps: true, payments: { orderBy: { sequence: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  for (const o of orders) {
    const standard = o.executionSteps.some((s) => EXECUTION_STEPS.includes(s.name));
    if (!standard || o.payments.length === 0) {
      console.log(`${o.orderNumber}: already follows its payment terms, skipped`);
      continue;
    }
    const invoiceStep = o.executionSteps.find((s) => s.id === o.invoiceStepId);
    const gstStageId = invoiceStep ? invoiceGstStageId(o.payments, invoiceStep.name) : null;
    const before = o.payments.map((p) => `${paymentStepName(p)} due ${day(p.dueDate)}`);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: o.id }, data: { invoiceStepId: null } });
      await tx.orderExecutionStep.deleteMany({ where: { orderId: o.id } });

      const seen = new Set<string>();
      let sequence = 0;
      for (const p of o.payments) {
        const name = paymentStepName(p);
        if (seen.has(name)) continue;
        seen.add(name);
        const row = await tx.orderExecutionStep.create({
          data: {
            orderId: o.id,
            sequence: ++sequence,
            name,
            ...(p.dueDate ? { status: ExecutionStepStatus.DONE, completedDate: p.dueDate } : {}),
          },
        });
        if (p.id === gstStageId) await tx.order.update({ where: { id: o.id }, data: { invoiceStepId: row.id } });
      }

      await syncOrderStatus(tx, o.id);
      await syncPaymentDues(tx, o.id);
      await applyInvoiceGst(tx, o.id);
    });

    const after = await prisma.orderPaymentStage.findMany({ where: { orderId: o.id }, orderBy: { sequence: 'asc' } });
    const changed = after.filter((p, i) => day(p.dueDate) !== day(o.payments[i].dueDate));
    console.log(`${o.orderNumber}: ${before.join(', ')}${invoiceStep ? ` · invoice moved from "${invoiceStep.name}"` : ''}`);
    if (changed.length) console.log(`  WARNING: due dates changed on ${changed.map(paymentStepName).join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
