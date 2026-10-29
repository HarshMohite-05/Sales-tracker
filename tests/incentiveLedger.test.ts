import { describe, expect, it } from 'vitest';
import { bandRate, bookingBands, eligibleByReceipt, indiaDayStart, orderShares } from '@/lib/incentiveLedger';

const day = (d: string) => new Date(`${d}T10:00:00+05:30`);
const receipt = (id: string, stage: string, amount: number, date: string, isReversed = false) => ({
  id, paymentStageId: stage, amount, isReversed, receivedDate: day(date), createdAt: day(date),
});

describe('payment-based incentive', () => {
  // ₹1,00,000 order: 80% advance (no GST), 20% at invoice with the full 18% GST
  const stages = [
    { id: 's1', expectedAmount: 80000, gstAmount: 0, dueDate: day('2026-05-01') },
    { id: 's2', expectedAmount: 20000, gstAmount: 18000, dueDate: day('2027-04-10') },
  ];

  it('counts each payment excluding GST, in the financial year it was received', () => {
    const e = eligibleByReceipt(stages, [receipt('r1', 's1', 80000, '2026-05-02'), receipt('r2', 's2', 38000, '2027-04-12')]);
    expect(e.get('r1')).toBe(80000); // FY 2026-27
    expect(e.get('r2')).toBe(20000); // FY 2027-28: ₹38,000 received, ₹18,000 of it GST
  });

  it('never makes more than the order value eligible, and skips reversed payments', () => {
    const e = eligibleByReceipt(stages, [receipt('a', 's1', 80000, '2026-05-02'), receipt('b', 's1', 5000, '2026-05-03'), receipt('c', 's1', 9000, '2026-05-04', true)]);
    expect(e.get('a')).toBe(80000);
    expect(e.get('b')).toBe(0);
    expect(e.has('c')).toBe(false);
  });

  it('shares a mixed order by the director split, else uses the first type', () => {
    const enquiry = { category: 'PLANT' as const, categories: ['PLANT', 'BASIC_CHEMICALS'] as any };
    const unsplit = orderShares({ netValue: 100000, enquiry, incentiveSplits: [] });
    expect(unsplit.splitMissing).toBe(true);
    expect(unsplit.shares).toEqual([{ businessType: 'PLANT', share: 1 }]);
    const split = orderShares({ netValue: 100000, enquiry, incentiveSplits: [{ businessType: 'PLANT', amount: 80000 }, { businessType: 'BASIC_CHEMICALS', amount: 20000 } as any] });
    expect(split.splitMissing).toBe(false);
    expect(split.shares).toEqual([{ businessType: 'PLANT', share: 0.8 }, { businessType: 'BASIC_CHEMICALS', share: 0.2 }]);
  });

});

describe('incentive from order booking targets', () => {
  const booking = (orderId: string, date: string, amount: number) => ({ orderId, orderDate: day(date), createdAt: day(date), amount });
  // Target 1 ₹10L: Plant 2%, Spares 3%. Target 2 ₹20L: Plant 4%
  const t1 = { level: 1, targetValue: 1000000, typeRates: { PLANT: { incentive: 2 }, SPARES: { incentive: 3 } } };
  const t2 = { level: 2, targetValue: 2000000, typeRates: { PLANT: { incentive: 4 } } };

  it("pays each type's Target 1 % up to it and Target 2 % from there, splitting the crossing order", () => {
    const bands = bookingBands([t1, t2], [booking('a', '2026-04-10', 800000), booking('b', '2026-05-10', 400000)]);
    expect(bands.get('a')).toEqual([1, 0, 0]);
    expect(bands.get('b')).toEqual([0.5, 0.5, 0]); // ₹2L fills Target 1, ₹2L goes toward Target 2
    expect(bandRate([t1, t2], bands.get('b')!, 'PLANT')).toEqual({ percent: 3, beyondShare: 0.5, beyondPercent: 2 });
    expect(bandRate([t1, t2], bands.get('b')!, 'SPARES').percent).toBe(1.5); // not in Target 2's table: 0% there
    expect(bandRate([t1, t2], bands.get('b')!, 'AMC').percent).toBe(0);
  });

  it("keeps the last target's % past it", () => {
    const bands = bookingBands([t1], [booking('a', '2026-04-10', 1000000), booking('b', '2026-05-10', 500000)]);
    expect(bands.get('b')).toEqual([0, 1]);
    expect(bandRate([t1], bands.get('b')!, 'PLANT').percent).toBe(2);
  });

  it('fills the targets in booking order', () => {
    const bands = bookingBands([t1], [booking('late', '2026-06-01', 600000), booking('early', '2026-04-01', 600000)]);
    expect(bands.get('early')).toEqual([1, 0]);
    expect(bands.get('late')![1]).toBeCloseTo(2 / 6);
  });
});
