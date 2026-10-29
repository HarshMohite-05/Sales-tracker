/**
 * One-off: create execution steps for orders confirmed before execution tracking existed.
 * Usage: npx tsx scripts/backfill-execution-steps.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { createExecutionSteps } from '../src/lib/orderExecution';

async function main() {
  const orders = await prisma.order.findMany({ where: { executionSteps: { none: {} } }, select: { id: true } });
  for (const { id } of orders) await createExecutionSteps(prisma, id);
  console.log(`Created execution steps for ${orders.length} order(s).`);
}

main().finally(() => prisma.$disconnect());
