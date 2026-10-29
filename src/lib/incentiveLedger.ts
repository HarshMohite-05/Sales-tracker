import { EnquiryCategory, IncentiveEntryKind, IncentiveEntryStatus, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getIndianFYQuarter } from '@/lib/utils';
import { allocateReceipts } from '@/lib/deductions';

/**
 * Payment-based incentives. Each payment received on an order earns, per business type of the order:
 *   incentive = eligible amount (the type's share of the payment, excluding GST) × the rate.
 * The rate comes from the salesperson's order booking target when the order was booked in its period (the
 * target's % for the type, see bookingBands and bandRate). An order booked outside any target earns 0.
 * The financial year of the receipt is the year the incentive is recorded in. Each payment and type has one
 * ledger entry, so a payment is never counted twice; a reversed payment cancels its unpaid entry, or adds a
 * clawback when the incentive was already paid.
 */

type Db = typeof prisma | Prisma.TransactionClient;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Start of a date (YYYY-MM-DD) in India, as stored for a rate's effective-from. */
export const indiaDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

type StageForEligibility = { id: string; expectedAmount: unknown; gstAmount?: unknown; dueDate?: unknown };
type ReceiptForEligibility = { id: string; paymentStageId: string; amount: unknown; isReversed: boolean; receivedDate: Date; createdAt: Date };

/**
 * The part of each payment that is order value, excluding GST. Payments are matched to stages the way the
 * order's Payments tab matches them (a payment first clears earlier stages still short, then its own). A
 * stage asks for its amount (after TDS and retention) plus any invoice GST, and money placed on it carries
 * those in the same proportion; a stage earns up to its amount only, oldest payment first, so money paid
 * above what was asked earns nothing. Reversed payments are not eligible.
 */
export function eligibleByReceipt(stages: StageForEligibility[], receipts: ReceiptForEligibility[]): Map<string, number> {
  const { splits } = allocateReceipts(stages, receipts);
  const used = new Map<string, number>();
  const eligible = new Map<string, number>();
  const ordered = receipts
    .filter((r) => !r.isReversed)
    .sort((a, b) => a.receivedDate.getTime() - b.receivedDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of ordered) {
    let total = 0;
    for (const part of splits.get(r.id) || []) {
      const stage = stages.find((st) => st.id === part.stageId);
      if (!stage) continue;
      const expected = Number(stage.expectedAmount) || 0;
      const gst = Number(stage.gstAmount ?? 0) || 0;
      const valueShare = expected + gst > 0 ? expected / (expected + gst) : 1;
      const already = used.get(stage.id) || 0;
      const amount = r2(Math.max(0, Math.min(part.amount * valueShare, expected - already)));
      used.set(stage.id, r2(already + amount));
      total += amount;
    }
    eligible.set(r.id, r2(total));
  }
  return eligible;
}

type OrderForShares = {
  netValue: unknown;
  enquiry: { category: EnquiryCategory; categories: EnquiryCategory[] } | null;
  incentiveSplits: { businessType: EnquiryCategory; amount: unknown }[];
};

/**
 * How an order's value divides across business types: the director's split when set, else the whole
 * order to its requirement's first type (an order without a requirement counts as Other).
 * `splitMissing`: the requirement has several types but no split has been set yet.
 */
export function orderShares(order: OrderForShares) {
  const types: EnquiryCategory[] = order.enquiry ? (order.enquiry.categories.length ? order.enquiry.categories : [order.enquiry.category]) : [EnquiryCategory.OTHER];
  const splits = order.incentiveSplits.filter((s) => Number(s.amount) > 0);
  const splitTotal = splits.reduce((t, s) => t + Number(s.amount), 0);
  if (splits.length && splitTotal > 0) {
    return { types, splitMissing: false, shares: splits.map((s) => ({ businessType: s.businessType, share: Number(s.amount) / splitTotal })) };
  }
  return { types, splitMissing: types.length > 1, shares: [{ businessType: types[0], share: 1 }] };
}

export type TypeRates = Record<string, { incentive: number }>;
type BookingLevel = { level: number; targetValue: unknown; typeRates: unknown };
type Booking = { orderId: string; orderDate: Date; createdAt: Date; amount: number };
export type BookingRate = { percent: number; beyondShare: number; beyondPercent: number };

/**
 * Where each order's value falls against an order booking target and the next targets set after it in the
 * same period. Orders fill the targets oldest first, counting their whole value; an order that crosses a
 * line is split. Returns, per order, the share of it in each band: band 0 is up to target 1, band 1 from
 * target 1 up to target 2, …, and the last band is past the newest target.
 */
export function bookingBands(levels: BookingLevel[], bookings: Booking[]): Map<string, number[]> {
  const lines = [...levels].sort((a, b) => a.level - b.level).map((t) => Number(t.targetValue) || 0);
  const out = new Map<string, number[]>();
  const ordered = [...bookings].sort((a, b) => a.orderDate.getTime() - b.orderDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.orderId.localeCompare(b.orderId));
  let sofar = 0;
  for (const b of ordered) {
    if (b.amount <= 0) continue;
    const lo = sofar;
    const hi = (sofar += b.amount);
    out.set(
      b.orderId,
      [...lines, Infinity].map((to, i) => Math.max(0, Math.min(hi, to) - Math.max(lo, i ? lines[i - 1] : 0)) / b.amount)
    );
  }
  return out;
}

/**
 * The incentive % for one business type of an order, from its bands: up to target 1 at target 1's incentive
 * % for the type, from target 1 up to target 2 at target 2's, and so on; past the last target still at the
 * last target's %. A type missing from a target's table earns 0. `beyondShare` and `beyondPercent` are the
 * part past target 1 (shown separately on the incentive).
 */
export function bandRate(levels: BookingLevel[], bands: number[], businessType: string): BookingRate {
  const chain = [...levels].sort((a, b) => a.level - b.level);
  const ratesOf = (t: BookingLevel) => ((t.typeRates as TypeRates | null) || {})[businessType];
  let percent = 0;
  let beyondPercent = 0;
  bands.forEach((share, i) => {
    const rate = Number(ratesOf(chain[Math.min(i, chain.length - 1)])?.incentive) || 0;
    percent += share * rate;
    if (i > 0) beyondPercent += share * rate;
  });
  return { percent, beyondShare: bands.slice(1).reduce((t, x) => t + x, 0), beyondPercent };
}

/**
 * Bring the incentive ledger in line with the payments. New payments get entries; entries not yet
 * approved follow later corrections (a rate set after the payment, a split set on a mixed order); approved
 * and paid entries never change. A payment reversed or removed cancels its unapproved or approved entry;
 * if that incentive was already paid, a clawback entry is added once.
 */
export async function syncIncentiveEntries(db: Db = prisma) {
  const [orders, existing, bookingTargets] = await Promise.all([
    db.order.findMany({
      select: {
        id: true,
        orderNumber: true,
        netValue: true,
        grossValue: true,
        orderDate: true,
        orderStatus: true,
        createdAt: true,
        assignedSalespersonId: true,
        client: { select: { id: true, name: true } },
        enquiry: { select: { category: true, categories: true } },
        incentiveSplits: { select: { businessType: true, amount: true } },
        payments: { select: { id: true, expectedAmount: true, gstAmount: true, dueDate: true }, orderBy: { sequence: 'asc' } },
        receipts: { select: { id: true, paymentStageId: true, amount: true, isReversed: true, receivedDate: true, createdAt: true } },
      },
    }),
    db.incentiveEntry.findMany(),
    db.target.findMany({
      where: { targetType: 'ORDERS_BOOKED' },
      select: { salespersonId: true, financialYear: true, periodKey: true, level: true, periodStart: true, periodEnd: true, targetValue: true, monetaryBasis: true, typeRates: true },
    }),
  ]);

  // Order booking targets with a rates table: each chain (a target and the next ones after it) places every
  // order of its salesperson booked in its period into bands, which give each business type of it a rate
  const chains = new Map<string, (typeof bookingTargets)[number][]>();
  for (const t of bookingTargets) {
    const key = `${t.salespersonId}|${t.financialYear}|${t.periodKey}`;
    chains.set(key, [...(chains.get(key) || []), t]);
  }
  const bandsOf = new Map<string, { levels: (typeof bookingTargets)[number][]; bands: number[] }>(); // by order id
  const byStart = [...chains.values()].map((c) => c.sort((a, b) => a.level - b.level)).sort((a, b) => a[0].periodStart.getTime() - b[0].periodStart.getTime());
  for (const chain of byStart) {
    const first = chain[0];
    if (!first.typeRates) continue;
    const bookings: Booking[] = orders
      .filter((o) => o.assignedSalespersonId === first.salespersonId && o.orderStatus !== 'CANCELLED' && o.orderDate >= first.periodStart && o.orderDate <= first.periodEnd)
      .map((o) => ({ orderId: o.id, orderDate: o.orderDate, createdAt: o.createdAt, amount: Number(first.monetaryBasis === 'GROSS' ? o.grossValue : o.netValue) }));
    // A salesperson's periods should not overlap; if they do, the earliest-starting target wins
    for (const [orderId, bands] of bookingBands(chain, bookings)) {
      if (!bandsOf.has(orderId)) bandsOf.set(orderId, { levels: chain, bands });
    }
  }

  // Each live payment's value excluding GST
  const eligibleOf = new Map<string, number>();
  for (const o of orders) {
    const eligible = eligibleByReceipt(o.payments, o.receipts);
    for (const rc of o.receipts) if (!rc.isReversed) eligibleOf.set(rc.id, eligible.get(rc.id) || 0);
  }

  // What every live payment should earn now
  const wanted = new Map<string, Prisma.IncentiveEntryUncheckedCreateInput>();
  for (const o of orders) {
    const { shares } = orderShares(o);
    for (const rc of o.receipts) {
      const amount = rc.isReversed ? 0 : eligibleOf.get(rc.id);
      if (!amount) continue;
      const placed = bandsOf.get(o.id);
      for (const { businessType, share } of shares) {
        const eligibleAmount = r2(amount * share);
        if (eligibleAmount <= 0) continue;
        // Under an order booking target: the rate up to target 1 plus the part beyond it; none outside
        const booked = placed ? bandRate(placed.levels, placed.bands, businessType) : { percent: 0, beyondShare: 0, beyondPercent: 0 };
        // Amounts from the exact %; the stored rate is rounded to 2 decimals and only shown
        const beyondAmount = r2((eligibleAmount * booked.beyondPercent) / 100);
        const baseRate = Math.round((booked.percent - booked.beyondPercent) * 100) / 100;
        const incentiveAmount = r2((eligibleAmount * booked.percent) / 100);
        wanted.set(`${rc.id}|${businessType}`, {
          kind: IncentiveEntryKind.EARNING,
          receiptId: rc.id,
          orderId: o.id,
          orderNumber: o.orderNumber,
          clientId: o.client.id,
          clientName: o.client.name,
          salespersonId: o.assignedSalespersonId,
          businessType,
          receivedDate: rc.receivedDate,
          financialYear: getIndianFYQuarter(rc.receivedDate).financialYear,
          receiptAmount: Number(rc.amount),
          eligibleAmount,
          ratePercent: baseRate,
          bonusEligible: r2(eligibleAmount * booked.beyondShare),
          bonusAmount: beyondAmount,
          incentiveAmount,
        });
      }
    }
  }

  const byKey = new Map(existing.map((e) => [`${e.receiptId}|${e.businessType}|${e.kind}`, e]));
  const creates: Prisma.IncentiveEntryUncheckedCreateInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];

  for (const [key, entry] of wanted) {
    const have = byKey.get(`${key}|${IncentiveEntryKind.EARNING}`);
    if (!have) {
      creates.push(entry);
    } else if (have.status === IncentiveEntryStatus.EARNED || have.status === IncentiveEntryStatus.REVERSED) {
      // Not approved yet (or brought back): follow the payment as it is now
      const changed =
        have.status === IncentiveEntryStatus.REVERSED ||
        Number(have.eligibleAmount) !== entry.eligibleAmount ||
        Number(have.ratePercent) !== entry.ratePercent ||
        Number(have.incentiveAmount) !== entry.incentiveAmount ||
        Number(have.bonusAmount) !== entry.bonusAmount ||
        Number(have.bonusEligible) !== entry.bonusEligible ||
        have.salespersonId !== entry.salespersonId ||
        have.receivedDate.getTime() !== (entry.receivedDate as Date).getTime();
      if (changed) {
        const { kind: _kind, receiptId: _receipt, businessType: _type, ...fields } = entry;
        updates.push(db.incentiveEntry.update({ where: { id: have.id }, data: { ...fields, status: IncentiveEntryStatus.EARNED } }));
      }
    }
  }

  // Earnings whose payment no longer earns (reversed, removed, or its type split changed)
  for (const e of existing) {
    if (e.kind !== IncentiveEntryKind.EARNING || wanted.has(`${e.receiptId}|${e.businessType}`)) continue;
    if (e.status === IncentiveEntryStatus.EARNED || e.status === IncentiveEntryStatus.APPROVED) {
      updates.push(db.incentiveEntry.update({ where: { id: e.id }, data: { status: IncentiveEntryStatus.REVERSED, approvedById: null, approvedAt: null } }));
    } else if (e.status === IncentiveEntryStatus.PAID && !byKey.has(`${e.receiptId}|${e.businessType}|${IncentiveEntryKind.CLAWBACK}`)) {
      creates.push({
        kind: IncentiveEntryKind.CLAWBACK,
        receiptId: e.receiptId,
        orderId: e.orderId,
        orderNumber: e.orderNumber,
        clientId: e.clientId,
        clientName: e.clientName,
        salespersonId: e.salespersonId,
        businessType: e.businessType,
        receivedDate: new Date(),
        financialYear: getIndianFYQuarter(new Date()).financialYear,
        receiptAmount: -Number(e.receiptAmount),
        eligibleAmount: -Number(e.eligibleAmount),
        ratePercent: Number(e.ratePercent),
        bonusEligible: -Number(e.bonusEligible),
        bonusAmount: -Number(e.bonusAmount),
        incentiveAmount: -Number(e.incentiveAmount),
      });
    }
  }

  if (creates.length) await db.incentiveEntry.createMany({ data: creates, skipDuplicates: true });
  if (updates.length) await Promise.all(updates);
  return { created: creates.length, updated: updates.length };
}
