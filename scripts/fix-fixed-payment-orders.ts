/**
 * One-off, after fixed payment terms became "Full payment after N days" with only a Full Payment step:
 * orders (and their quotations) on fixed terms get the new wording, and orders whose execution has not
 * started get the Full Payment step in place of the standard steps. Orders with work done beyond the
 * automatic Receipt of PO, or with an invoice raised, are left alone and listed. Safe to run more than once.
 * Usage: npx tsx scripts/fix-fixed-payment-orders.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { ExecutionStepStatus } from '@prisma/client';
import { FULL_PAYMENT_STEP, PO_RECEIVED_STEP } from '../src/lib/executionSteps';
import { fixedPaymentText } from '../src/lib/quotation';
import { syncOrderStatus, syncPaymentDues } from '../src/lib/orderExecution';

// Fixed terms as saved by any version: one stage with credit days
function creditDaysOf(stages: unknown): number | null {
  if (!Array.isArray(stages) || stages.length !== 1) return null;
  const days = Number((stages[0] as any)?.creditDays);
  return days > 0 ? days : null;
}

async function main() {
  const versions = await prisma.quotationVersion.findMany({ select: { id: true, paymentStages: true, paymentTerms: true } });
  for (const v of versions) {
    const days = creditDaysOf(v.paymentStages);
    if (!days || v.paymentTerms === fixedPaymentText(days)) continue;
    await prisma.quotationVersion.update({
      where: { id: v.id },
      data: { paymentTerms: fixedPaymentText(days), paymentStages: [{ percent: 100, description: fixedPaymentText(days), creditDays: days }] },
    });
  }
  const quotations = await prisma.quotation.findMany({ select: { id: true, versions: { orderBy: { versionNumber: 'desc' }, take: 1 } } });
  for (const q of quotations) {
    const latest = q.versions[0];
    if (latest && creditDaysOf(latest.paymentStages)) {
      await prisma.quotation.update({ where: { id: q.id }, data: { paymentTerms: latest.paymentTerms } });
    }
  }

  const orders = await prisma.order.findMany({
    select: { id: true, orderNumber: true, paymentStages: true, paymentTerms: true, invoiceStepId: true, executionSteps: true, payments: true },
  });
  for (const o of orders) {
    const days = creditDaysOf(o.paymentStages);
    if (!days) continue;
    const text = fixedPaymentText(days);
    const onlyFullPayment = o.executionSteps.length === 1 && o.executionSteps[0].name === FULL_PAYMENT_STEP;
    const started = o.executionSteps.some(
      (s) => s.status !== ExecutionStepStatus.PENDING && s.name !== PO_RECEIVED_STEP && s.name !== FULL_PAYMENT_STEP
    );

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: o.id },
        data: { paymentTerms: text, paymentStages: [{ percent: 100, description: text, creditDays: days }] },
      });
      for (const p of o.payments) {
        if (p.description !== text) await tx.orderPaymentStage.update({ where: { id: p.id }, data: { description: text } });
      }
      if (!onlyFullPayment && !started && !o.invoiceStepId) {
        const fullPayment = o.executionSteps.find((s) => s.name === FULL_PAYMENT_STEP);
        await tx.orderExecutionStep.deleteMany({ where: { orderId: o.id, id: { not: fullPayment?.id ?? '' } } });
        if (fullPayment) {
          await tx.orderExecutionStep.update({ where: { id: fullPayment.id }, data: { sequence: 1 } });
        } else {
          await tx.orderExecutionStep.create({ data: { orderId: o.id, sequence: 1, name: FULL_PAYMENT_STEP } });
        }
      }
      await syncOrderStatus(tx, o.id);
      await syncPaymentDues(tx, o.id);
    });

    if (onlyFullPayment) console.log(`${o.orderNumber}: already has only Full Payment (${text})`);
    else if (started || o.invoiceStepId) console.log(`${o.orderNumber}: execution already started, steps left as they are (${text})`);
    else console.log(`${o.orderNumber}: now only Full Payment (${text})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
