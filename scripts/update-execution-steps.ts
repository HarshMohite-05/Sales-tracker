/**
 * One-off: move orders onto the current execution steps (Receipt of PO ... Commissioning).
 * Steps already ticked or marked not needed keep their status and date; Receipt of PO is done
 * on the order's PO date. Orders already on the current steps are left alone.
 * Usage: npx tsx scripts/update-execution-steps.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { EXECUTION_STEPS, PO_RECEIVED_STEP } from '../src/lib/executionSteps';
import { syncOrderStatus } from '../src/lib/orderExecution';

// Earlier step names that became current ones
const RENAMED: Record<string, string> = { Dispatched: 'Dispatch', Delivered: 'Delivery' };

async function main() {
  const orders = await prisma.order.findMany({
    select: { id: true, poDate: true, orderDate: true, executionSteps: true },
  });
  let updated = 0;
  for (const order of orders) {
    const names = [...order.executionSteps].sort((a, b) => a.sequence - b.sequence).map((s) => s.name);
    if (names.join('|') === EXECUTION_STEPS.join('|')) continue;

    const previous = new Map(order.executionSteps.map((s) => [RENAMED[s.name] ?? s.name, s]));
    await prisma.$transaction(async (tx) => {
      await tx.orderExecutionStep.deleteMany({ where: { orderId: order.id } });
      await tx.orderExecutionStep.createMany({
        data: EXECUTION_STEPS.map((name, i) => {
          const old = previous.get(name);
          if (old) {
            return { orderId: order.id, sequence: i + 1, name, status: old.status, completedDate: old.completedDate, updatedById: old.updatedById };
          }
          if (name === PO_RECEIVED_STEP) {
            return { orderId: order.id, sequence: i + 1, name, status: 'DONE' as const, completedDate: order.poDate ?? order.orderDate };
          }
          return { orderId: order.id, sequence: i + 1, name };
        }),
      });
      await syncOrderStatus(tx, order.id);
    });
    updated++;
  }
  console.log(`Updated execution steps on ${updated} of ${orders.length} order(s).`);
}

main().finally(() => prisma.$disconnect());
