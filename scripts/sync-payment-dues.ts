/**
 * One-off: raise payment stages as due from the execution steps already done on each order.
 * Usage: npx tsx scripts/sync-payment-dues.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { syncPaymentDues } from '../src/lib/orderExecution';

async function main() {
  const orders = await prisma.order.findMany({ select: { id: true } });
  for (const { id } of orders) await syncPaymentDues(prisma, id);
  const due = await prisma.orderPaymentStage.count({ where: { dueDate: { not: null } } });
  console.log(`Synced ${orders.length} order(s); ${due} payment stage(s) due.`);
}

main().finally(() => prisma.$disconnect());
