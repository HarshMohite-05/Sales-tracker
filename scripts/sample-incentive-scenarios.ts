/**
 * Three sample salespeople with targets, orders and payments, to check order booking targets and incentives
 * end to end. Each has their own client, so no real data is touched; run again to rebuild them, or with
 * --remove to delete them.
 *
 *   npx tsx scripts/sample-incentive-scenarios.ts            create (or rebuild) the samples and check them
 *   npx tsx scripts/sample-incentive-scenarios.ts --remove   delete them
 *
 * Amounts are order values excluding GST, and each order is paid against one stage without GST, so every
 * rupee received counts toward incentive.
 *   A  Target 1 not reached: ₹8L booked of ₹10L, one order half paid → incentive on what was received
 *   B  Target 1 crossed into Target 2 (custom dates), with a Plant + Basic Chemicals order split by value
 *   C  Past the last target: one order paid partly in FY 2025-26 and partly in FY 2026-27, one cancelled
 * Sample salespeople can sign in with password Sample@2026 to see the salesperson's view.
 */
import bcrypt from 'bcryptjs';
import { EnquiryCategory, OrderStatus, PaymentMode, Role, TargetPeriod, TargetType } from '@prisma/client';
import prisma from '../src/lib/prisma';
import { nextDocNumber } from '../src/lib/numbering';
import { syncIncentiveEntries } from '../src/lib/incentiveLedger';
import { achievedFor } from '../src/lib/targets';
import { customPeriodKey, periodRange } from '../src/lib/targetPeriods';
import { getIndianFYQuarter } from '../src/lib/utils';

const EMAIL_DOMAIN = '@example.test';
const day = (d: string) => new Date(`${d}T11:00:00+05:30`);
const L = 100000; // one lakh

type OrderSpec = { ref: string; date: string; parts: [EnquiryCategory, number][]; cancelled?: boolean; payments: [string, number][] };
type Sample = {
  key: string;
  name: string;
  story: string;
  period: { type: Exclude<TargetPeriod, 'CUSTOM'>; financialYear: string; key: string } | { type: 'CUSTOM'; start: string; end: string };
  targets: { value: number; rates: Partial<Record<EnquiryCategory, number>> }[];
  orders: OrderSpec[];
  expected: Record<string, number>; // incentive by financial year
  expectedCurrent: { level: number; achieved: number };
};

const SAMPLES: Sample[] = [
  {
    key: 'a',
    name: 'Sample A - Target not reached',
    story: 'Target 1 ₹10L (Plant 2%, Spares 3%). Books ₹8L. Plant ₹5L fully paid, Spares ₹3L half paid.',
    period: { type: TargetPeriod.QUARTERLY, financialYear: 'FY 2026-27', key: 'Q3' },
    targets: [{ value: 10 * L, rates: { PLANT: 2, SPARES: 3 } }],
    orders: [
      { ref: 'A1', date: '2026-10-05', parts: [['PLANT', 5 * L]], payments: [['2026-10-10', 5 * L]] },
      { ref: 'A2', date: '2026-10-20', parts: [['SPARES', 3 * L]], payments: [['2026-10-25', 1.5 * L]] },
    ],
    // 2% × ₹5L + 3% × ₹1.5L received
    expected: { 'FY 2026-27': 10000 + 4500 },
    expectedCurrent: { level: 1, achieved: 8 * L },
  },
  {
    key: 'b',
    name: 'Sample B - Target 2 activated',
    story: 'Custom 01 Sep–31 Dec 2026. Target 1 ₹10L (Plant 1%, Basic Chem 2%), Target 2 ₹20L (Plant 2%, Basic Chem 3%). Books ₹18L, all paid.',
    period: { type: 'CUSTOM', start: '2026-09-01', end: '2026-12-31' },
    targets: [
      { value: 10 * L, rates: { PLANT: 1, BASIC_CHEMICALS: 2 } },
      { value: 20 * L, rates: { PLANT: 2, BASIC_CHEMICALS: 3 } },
    ],
    orders: [
      // ₹0–8L: all in Target 1 at Plant 1%
      { ref: 'B1', date: '2026-09-10', parts: [['PLANT', 8 * L]], payments: [['2026-09-20', 8 * L]] },
      // ₹8–14L: ₹2L fills Target 1, ₹4L in Target 2; each part shared Plant 2/3, Basic Chem 1/3
      { ref: 'B2', date: '2026-10-01', parts: [['PLANT', 4 * L], ['BASIC_CHEMICALS', 2 * L]], payments: [['2026-10-15', 6 * L]] },
      // ₹14–18L: all in Target 2 at Basic Chem 3%
      { ref: 'B3', date: '2026-10-15', parts: [['BASIC_CHEMICALS', 4 * L]], payments: [['2026-10-28', 4 * L]] },
    ],
    // B1 1% × 8L = 8,000; B2 = (1.333L×1% + 0.667L×2%) + (2.667L×2% + 1.333L×3%) = 12,000; B3 3% × 4L = 12,000
    expected: { 'FY 2026-27': 8000 + 12000 + 12000 },
    expectedCurrent: { level: 2, achieved: 18 * L },
  },
  {
    key: 'c',
    name: 'Sample C - Beyond last target',
    story: 'FY 2025-26. Target 1 ₹5L (Spares 2%, O&M 2%), Target 2 ₹10L (Spares 3%, O&M 4%). Books ₹12L (+ ₹4L cancelled). Last order paid across two FYs.',
    period: { type: TargetPeriod.YEARLY, financialYear: 'FY 2025-26', key: 'FY' },
    targets: [
      { value: 5 * L, rates: { SPARES: 2, AMC: 2 } },
      { value: 10 * L, rates: { SPARES: 3, AMC: 4 } },
    ],
    orders: [
      // ₹0–6L: ₹5L at Target 1's O&M 2%, ₹1L at Target 2's 4%
      { ref: 'C1', date: '2025-06-10', parts: [['AMC', 6 * L]], payments: [['2025-07-15', 6 * L]] },
      // Cancelled: does not count toward the target and earns nothing
      { ref: 'C2', date: '2026-01-10', parts: [['PLANT', 4 * L]], cancelled: true, payments: [] },
      // ₹6–12L: ₹4L up to Target 2 and ₹2L beyond it, all at Target 2's Spares 3%; half paid in each FY
      { ref: 'C3', date: '2026-02-05', parts: [['SPARES', 6 * L]], payments: [['2026-03-15', 3 * L], ['2026-04-20', 3 * L]] },
    ],
    // FY 25-26: 10,000 + 4,000 (C1) + 9,000 (C3 first half); FY 26-27: 9,000 (C3 second half)
    expected: { 'FY 2025-26': 23000, 'FY 2026-27': 9000 },
    expectedCurrent: { level: 2, achieved: 12 * L },
  },
];

async function remove() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'sample.', endsWith: EMAIL_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return 0;
  await prisma.incentiveEntry.deleteMany({ where: { salespersonId: { in: ids } } });
  // Deleting the client deletes its requirements, orders, payment stages, payments and splits
  await prisma.client.deleteMany({ where: { assignedToId: { in: ids } } });
  await prisma.target.deleteMany({ where: { salespersonId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function create(director: { id: string }, s: Sample, passwordHash: string) {
  const sp = await prisma.user.create({
    data: { email: `sample.${s.key}${EMAIL_DOMAIN}`, name: s.name, role: Role.SALESPERSON, passwordHash, designation: 'Sample salesperson (test data)' },
  });
  const client = await prisma.client.create({
    data: {
      code: `SMP${s.key.toUpperCase()}`,
      name: `[SAMPLE] ${s.key.toUpperCase()} Water Industries`,
      industrySegment: 'Sample (test data)',
      city: 'Mumbai',
      assignedToId: sp.id,
      createdById: sp.id,
      contacts: { create: [{ name: 'Sample Contact', mobile: '+91 90000 00000', isPrimary: true }] },
    },
  });

  // Targets: Target 1, Target 2, … for the same period
  const p = s.period;
  const periodKey = p.type === 'CUSTOM' ? customPeriodKey(p.start, p.end)! : p.key;
  const range = periodRange(p.type === 'CUSTOM' ? '' : p.financialYear, p.type, periodKey)!;
  const financialYear = p.type === 'CUSTOM' ? getIndianFYQuarter(range.start).financialYear : p.financialYear;
  for (const [i, t] of s.targets.entries()) {
    await prisma.target.create({
      data: {
        salespersonId: sp.id,
        financialYear,
        periodType: p.type,
        periodKey,
        periodStart: range.start,
        periodEnd: range.end,
        level: i + 1,
        targetType: TargetType.ORDERS_BOOKED,
        targetValue: t.value,
        typeRates: Object.fromEntries(Object.entries(t.rates).map(([type, incentive]) => [type, { incentive }])),
        setById: director.id,
      },
    });
  }

  for (const o of s.orders) {
    const net = o.parts.reduce((t, [, v]) => t + v, 0);
    const types = o.parts.map(([type]) => type);
    const enquiry = await prisma.enquiry.create({
      data: {
        enquiryNumber: `${client.code}/${o.ref}`,
        clientId: client.id,
        assignedToId: sp.id,
        createdById: sp.id,
        title: `Sample requirement ${o.ref}`,
        category: types[0],
        categories: types,
        requirementSummary: 'Sample data for testing targets and incentives',
        estimatedValue: net,
        stage: o.cancelled ? 'LOST' : 'WON',
        createdAt: day(o.date),
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: await nextDocNumber(prisma, 'order'),
        clientPoNumber: `SAMPLE-${o.ref}`,
        clientId: client.id,
        enquiryId: enquiry.id,
        assignedSalespersonId: sp.id,
        orderDate: day(o.date),
        items: [],
        netValue: net,
        taxValue: 0,
        grossValue: net,
        orderStatus: o.cancelled ? OrderStatus.CANCELLED : OrderStatus.CONFIRMED,
        isDirectOrder: true,
        directOrderReason: 'Sample data for testing targets and incentives',
        createdAt: day(o.date),
        // A mixed order's value by business type
        incentiveSplits: o.parts.length > 1 ? { create: o.parts.map(([businessType, amount]) => ({ businessType, amount, setById: director.id })) } : undefined,
        payments: { create: [{ sequence: 1, percent: 100, description: 'Full payment (sample)', amount: net, expectedAmount: net, dueDate: day(o.date) }] },
      },
      include: { payments: true },
    });
    for (const [i, [date, amount]] of o.payments.entries()) {
      await prisma.orderReceipt.create({
        data: { orderId: order.id, paymentStageId: order.payments[0].id, amount, receivedDate: day(date), paymentMode: PaymentMode.NEFT_RTGS, reference: `SAMPLE-${o.ref}-${i + 1}`, recordedById: sp.id, createdAt: day(date) },
      });
    }
  }
  return sp;
}

async function main() {
  const removed = await remove();
  if (removed) console.log(`Removed ${removed} earlier sample salespeople and their data.`);
  if (process.argv.includes('--remove')) return;

  const director = await prisma.user.findFirst({ where: { role: Role.DIRECTOR, isActive: true }, select: { id: true, name: true } });
  if (!director) throw new Error('No active director to set the targets');
  const passwordHash = await bcrypt.hash('Sample@2026', 10);
  const people = [];
  for (const s of SAMPLES) people.push(await create(director, s, passwordHash));
  await syncIncentiveEntries();

  // Check each sample against the worked-out figures
  let ok = true;
  for (const [i, s] of SAMPLES.entries()) {
    const sp = people[i];
    console.log(`\n${s.name}  (${sp.email})\n  ${s.story}`);
    const entries = await prisma.incentiveEntry.findMany({ where: { salespersonId: sp.id, status: { not: 'REVERSED' } } });
    const byFy = entries.reduce((m: Record<string, number>, e) => ((m[e.financialYear] = Math.round(((m[e.financialYear] || 0) + Number(e.incentiveAmount)) * 100) / 100), m), {});
    for (const fy of new Set([...Object.keys(s.expected), ...Object.keys(byFy)])) {
      const pass = Math.abs((byFy[fy] || 0) - (s.expected[fy] || 0)) < 0.05;
      ok &&= pass;
      console.log(`  ${pass ? 'OK  ' : 'FAIL'} incentive ${fy}: ₹${(byFy[fy] || 0).toLocaleString('en-IN')} (expected ₹${(s.expected[fy] || 0).toLocaleString('en-IN')})`);
    }
    const targets = await prisma.target.findMany({ where: { salespersonId: sp.id }, orderBy: { level: 'asc' } });
    const achieved = await achievedFor(targets[0]);
    const current = targets.find((t) => achieved < Number(t.targetValue)) ?? targets[targets.length - 1];
    const pass = current.level === s.expectedCurrent.level && Math.abs(achieved - s.expectedCurrent.achieved) < 0.05;
    ok &&= pass;
    console.log(
      `  ${pass ? 'OK  ' : 'FAIL'} booked ₹${achieved.toLocaleString('en-IN')} → working on Target ${current.level} (₹${Number(current.targetValue).toLocaleString('en-IN')}, ${Math.round((achieved / Number(current.targetValue)) * 100)}%)`
    );
  }
  console.log(ok ? '\nAll sample checks passed.' : '\nSome sample checks FAILED.');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
