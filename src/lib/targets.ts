import { ActivityType, MonetaryBasis, OrderStatus, Target, TargetType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { eligibleByReceipt } from '@/lib/incentiveLedger';

/** What a salesperson has achieved toward a target over its whole period (event dates inside it). */
export async function achievedFor(target: Pick<Target, 'salespersonId' | 'targetType' | 'monetaryBasis' | 'periodStart' | 'periodEnd'>): Promise<number> {
  const during = { gte: target.periodStart, lte: target.periodEnd };
  switch (target.targetType) {
    case TargetType.ORDERS_BOOKED: {
      // Every order booked in the period that was not cancelled, also once it moves into execution
      const orders = await prisma.order.findMany({
        where: { assignedSalespersonId: target.salespersonId, orderStatus: { not: OrderStatus.CANCELLED }, orderDate: during },
        select: { netValue: true, grossValue: true },
      });
      return orders.reduce((sum, o) => sum + Number(target.monetaryBasis === MonetaryBasis.NET ? o.netValue : o.grossValue), 0);
    }
    case TargetType.VERIFIED_COLLECTIONS: {
      // Payments received in the period on the salesperson's orders; net basis leaves out the GST part
      const orders = await prisma.order.findMany({
        where: { assignedSalespersonId: target.salespersonId, receipts: { some: { isReversed: false, receivedDate: during } } },
        select: {
          payments: { select: { id: true, expectedAmount: true, gstAmount: true, dueDate: true }, orderBy: { sequence: 'asc' } },
          receipts: { select: { id: true, paymentStageId: true, amount: true, isReversed: true, receivedDate: true, createdAt: true } },
        },
      });
      let total = 0;
      for (const o of orders) {
        const eligible = eligibleByReceipt(o.payments, o.receipts);
        for (const rc of o.receipts) {
          if (rc.isReversed || rc.receivedDate < target.periodStart || rc.receivedDate > target.periodEnd) continue;
          total += target.monetaryBasis === MonetaryBasis.NET ? eligible.get(rc.id) || 0 : Number(rc.amount);
        }
      }
      return total;
    }
    case TargetType.NEW_ENQUIRIES:
      return prisma.enquiry.count({ where: { assignedToId: target.salespersonId, createdAt: during } });
    case TargetType.MEETINGS:
      return prisma.activity.count({ where: { salespersonId: target.salespersonId, activityType: ActivityType.MEETING, activityDate: during } });
    case TargetType.QUOTATIONS_SENT:
      return prisma.quotation.count({ where: { salespersonId: target.salespersonId, proposalDate: during } });
  }
}

/** Progress toward a target: achieved, % done and what is left. */
export function progress(targetValue: unknown, achieved: number) {
  const value = Number(targetValue);
  return {
    achievedAmount: Math.round(achieved * 100) / 100,
    achievementPercent: value > 0 ? Math.round((achieved / value) * 100 * 100) / 100 : achieved > 0 ? 100 : 0,
    remainingAmount: Math.max(0, Math.round((value - achieved) * 100) / 100),
    isAchieved: achieved >= value,
  };
}

// Targets for the same salesperson, type and period share a chain: level 1, then each next target
export const chainKey = (t: Pick<Target, 'salespersonId' | 'financialYear' | 'periodKey' | 'targetType'>) =>
  `${t.salespersonId}|${t.financialYear}|${t.periodKey}|${t.targetType}`;

/**
 * The target being worked toward in each chain: the first one not achieved yet, else the last. Every target
 * of a chain shares its period, so achievement is counted once per chain.
 */
export async function currentOfEachChain<T extends Parameters<typeof achievedFor>[0] & Pick<Target, 'financialYear' | 'periodKey' | 'level' | 'targetValue'>>(targets: T[]): Promise<T[]> {
  const chains = new Map<string, T[]>();
  for (const t of targets) chains.set(chainKey(t), [...(chains.get(chainKey(t)) || []), t]);
  return Promise.all(
    [...chains.values()].map(async (chain) => {
      const levels = chain.sort((a, b) => a.level - b.level);
      const achieved = await achievedFor(levels[0]);
      return levels.find((t) => achieved < Number(t.targetValue)) ?? levels[levels.length - 1];
    })
  );
}
