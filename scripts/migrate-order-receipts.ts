/**
 * One-off: move existing orders onto deductions and receipts.
 * - Recalculates every order's stage amounts from its total including GST (deductions start at none).
 * - Turns each payment stage ticked "completed" under the old tick-box into a receipt for that
 *   stage's expected amount on its completed date, so no recorded payment is lost.
 * Safe to run twice: stages that already have a receipt are skipped.
 * Usage: npx tsx scripts/migrate-order-receipts.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { createOrderPayments, recalculateOrderPayments } from '../src/lib/orderPayments';

async function main() {
  const orders = await prisma.order.findMany({ include: { payments: true } });
  let receipts = 0;

  for (const order of orders) {
    await prisma.$transaction(async (tx) => {
      if (order.payments.length === 0) await createOrderPayments(tx, order);
      await recalculateOrderPayments(tx, order.id);

      const ticked = await tx.orderPaymentStage.findMany({
        where: { orderId: order.id, isCompleted: true, receipts: { none: {} } },
      });
      for (const stage of ticked) {
        await tx.orderReceipt.create({
          data: {
            orderId: order.id,
            paymentStageId: stage.id,
            amount: stage.expectedAmount,
            receivedDate: stage.completedDate ?? stage.updatedAt,
            recordedById: stage.completedById ?? order.assignedSalespersonId,
            notes: 'Moved from the old "payment completed" tick; mode and reference were not recorded',
          },
        });
        receipts++;
      }
    });
  }
  console.log(`Recalculated ${orders.length} order(s); created ${receipts} receipt(s) from completed ticks.`);
}

main().finally(() => prisma.$disconnect());
