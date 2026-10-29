/**
 * One-off, after switching to "stages on the price before GST, GST with the invoice":
 * recalculates every order's payment stages on its value before GST, asks for the quoted GST in full
 * with the invoice stage, and re-raises stages from the execution steps (keyword stage names).
 * Receipts stay attached to their stages. Safe to run more than once.
 * Usage: npx tsx scripts/recalc-gst-at-invoice.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { recalculateOrderPayments } from '../src/lib/orderPayments';
import { applyInvoiceGst, syncPaymentDues } from '../src/lib/orderExecution';

async function main() {
  const orders = await prisma.order.findMany({ select: { id: true, orderNumber: true, taxValue: true, invoiceStepId: true, invoiceGstAmount: true } });
  let gstFixed = 0;
  for (const o of orders) {
    await prisma.$transaction(async (tx) => {
      await recalculateOrderPayments(tx, o.id);
      // An invoice already raised on an order quoted with GST now asks for that GST
      if (o.invoiceStepId && Number(o.taxValue) > 0 && Number(o.invoiceGstAmount) !== Number(o.taxValue)) {
        await tx.order.update({ where: { id: o.id }, data: { invoiceGstAmount: o.taxValue } });
        gstFixed++;
      }
      await applyInvoiceGst(tx, o.id);
      await syncPaymentDues(tx, o.id);
    });
  }
  console.log(`Recalculated ${orders.length} order(s); invoice GST updated on ${gstFixed}.`);
}

main().finally(() => prisma.$disconnect());
