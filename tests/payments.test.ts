import { describe, expect, it } from 'vitest';
import {
  calculateDeductions,
  deductionPercentError,
  receivedTotal,
  reconcile,
  splitOverStages,
  DEFAULT_DEDUCTION_RULES,
  excessAsGst,
  reconcileOrder,
  owedThroughStage,
  invoiceGstAmount,
} from '@/lib/deductions';
import { EXECUTION_STEPS, invoiceGstStageId, stageDueDate, stageTriggerStep } from '@/lib/executionSteps';

const base = {
  netValue: 100000,
  gstValue: 0,
  tdsEnabled: false,
  tdsPercent: 0,
  retentionEnabled: false,
  retentionPercent: 0,
  rules: DEFAULT_DEDUCTION_RULES,
};

describe('TDS and retention deductions', () => {
  it('are zero when disabled, whatever percentage was typed', () => {
    const d = calculateDeductions({ ...base, tdsPercent: 2, retentionPercent: 5 });
    expect(d.tdsAmount).toBe(0);
    expect(d.retentionAmount).toBe(0);
    expect(d.expectedPayment).toBe(100000);
  });

  it('Expected Payment = total − TDS − retention', () => {
    const d = calculateDeductions({ ...base, tdsEnabled: true, tdsPercent: 2, retentionEnabled: true, retentionPercent: 10 });
    expect(d.tdsAmount).toBe(2000);
    expect(d.retentionAmount).toBe(10000);
    expect(d.expectedPayment).toBe(88000);
  });

  it('use the configured base: before GST or including GST', () => {
    const withGst = { ...base, gstValue: 18000, tdsEnabled: true, tdsPercent: 2, retentionEnabled: true, retentionPercent: 5 };
    const d = calculateDeductions({ ...withGst, rules: { tdsBase: 'NET', retentionBase: 'GROSS' } });
    expect(d.total).toBe(118000);
    expect(d.tdsAmount).toBe(2000); // 2% of 1,00,000
    expect(d.retentionAmount).toBe(5900); // 5% of 1,18,000
    const g = calculateDeductions({ ...withGst, rules: { tdsBase: 'GROSS', retentionBase: 'NET' } });
    expect(g.tdsAmount).toBe(2360);
    expect(g.retentionAmount).toBe(5000);
  });

  it('reject missing or out-of-range percentages only when enabled', () => {
    expect(deductionPercentError('TDS', false, '')).toBeNull();
    expect(deductionPercentError('TDS', true, '')).toMatch(/Enter the TDS/);
    expect(deductionPercentError('TDS', true, -1)).toMatch(/more than 0/);
    expect(deductionPercentError('TDS', true, 100)).toMatch(/less than 100/);
    expect(deductionPercentError('TDS', true, 'abc')).toMatch(/Enter the TDS/);
    expect(deductionPercentError('TDS', true, 2)).toBeNull();
  });
});

describe('Spreading over payment stages', () => {
  it('splits amounts and deductions by stage percentage, adding up exactly', () => {
    const totals = calculateDeductions({ ...base, netValue: 100001, tdsEnabled: true, tdsPercent: 2, retentionEnabled: true, retentionPercent: 5 });
    const rows = splitOverStages(
      [
        { percent: 33.33, description: 'Advance' },
        { percent: 33.33, description: 'Before Dispatch' },
        { percent: 33.34, description: 'On Commissioning' },
      ],
      totals
    );
    const sum = (k: 'amount' | 'tdsAmount' | 'retentionAmount' | 'expectedAmount') =>
      Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
    expect(sum('amount')).toBe(totals.total);
    expect(sum('tdsAmount')).toBe(totals.tdsAmount);
    expect(sum('retentionAmount')).toBe(totals.retentionAmount);
    expect(sum('expectedAmount')).toBe(totals.expectedPayment);
  });

  it('gives an order quoted without stages one full payment', () => {
    const rows = splitOverStages([], { total: 50000, tdsAmount: 0, retentionAmount: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ percent: 100, description: 'Full payment', expectedAmount: 50000 });
  });
});

describe('Payment reconciliation', () => {
  it('Example 1: underpayment leaves ₹5,000 outstanding, partially paid', () => {
    expect(reconcile(40000, receivedTotal([{ amount: 35000 }]))).toEqual({
      expected: 40000,
      received: 35000,
      outstanding: 5000,
      excess: 0,
      status: 'PARTIALLY_PAID',
    });
  });

  it('Example 2: excess receipt of ₹2,000 is flagged as overpaid', () => {
    const r = reconcile(40000, receivedTotal([{ amount: 42000 }]));
    expect(r.excess).toBe(2000);
    expect(r.outstanding).toBe(0);
    expect(r.status).toBe('OVERPAID');
  });

  it('Example 3: three receipts add up to fully paid', () => {
    const r = reconcile(40000, receivedTotal([{ amount: 20000 }, { amount: 15000 }, { amount: 5000 }]));
    expect(r).toMatchObject({ received: 40000, outstanding: 0, excess: 0, status: 'FULLY_PAID' });
  });

  it('reads money received above the expected payment as GST, with its rate on the value before GST', () => {
    // ₹1,00,000 order, 2% TDS and 10% retention: ₹88,000 expected; client paid ₹1,06,000
    const r = reconcile(88000, 106000);
    expect(r.excess).toBe(18000);
    expect(excessAsGst(r.excess, 100000)).toEqual({ gstAmount: 18000, gstPercent: 18 });
    expect(excessAsGst(0, 100000)).toEqual({ gstAmount: 0, gstPercent: 0 });
  });

  it('nothing received is unpaid; reversed receipts do not count', () => {
    expect(reconcile(40000, 0).status).toBe('UNPAID');
    const r = reconcile(40000, receivedTotal([{ amount: 40000, isReversed: true }, { amount: 10000 }]));
    expect(r).toMatchObject({ received: 10000, outstanding: 30000, status: 'PARTIALLY_PAID' });
  });

  it('handles paise without floating-point drift', () => {
    expect(reconcile(0.3, receivedTotal([{ amount: 0.1 }, { amount: 0.2 }])).status).toBe('FULLY_PAID');
  });
});

describe('Order reconciliation stage by stage', () => {
  const order = { netValue: 100000, grossValue: 100000 };
  const stages = [
    { id: 'a', amount: 50000, expectedAmount: 50000 },
    { id: 'b', amount: 50000, expectedAmount: 50000 },
  ];

  it('does not use GST paid on one stage to cover a shortfall on another', () => {
    // Stage A paid with 18% GST on top, stage B paid ₹5,000 short
    const r = reconcileOrder(stages, [
      { paymentStageId: 'a', amount: 59000 },
      { paymentStageId: 'b', amount: 45000 },
    ], order);
    // Neither stage is raised as due, so the ₹5,000 short is not outstanding yet
    expect(r.outstanding).toBe(0);
    expect(r.notYetDue).toBe(5000);
    expect(r.excess).toBe(9000);
    expect(r.gst).toEqual({ gstAmount: 9000, gstPercent: 18 }); // 18% of stage A's ₹50,000
    expect(r.status).toBe('PARTIALLY_PAID');
  });

  it('becomes Overpaid once the shortfall is received later', () => {
    const r = reconcileOrder(stages, [
      { paymentStageId: 'a', amount: 59000 },
      { paymentStageId: 'b', amount: 45000 },
      { paymentStageId: 'b', amount: 5000 },
    ], order);
    expect(r.outstanding).toBe(0);
    expect(r.status).toBe('OVERPAID');
  });
});

describe('Receipts clear earlier due stages first', () => {
  const stages = [
    { id: 'a', amount: 100000, expectedAmount: 100000, dueDate: '2026-10-01' },
    { id: 'b', amount: 100000, expectedAmount: 100000, dueDate: '2026-10-10' },
    { id: 'c', amount: 100000, expectedAmount: 100000 },
  ];

  it('fills the shortfall on an earlier stage before the stage it was recorded for', () => {
    const r = reconcileOrder(stages, [
      { id: 'r1', paymentStageId: 'a', amount: 80000, receivedDate: '2026-10-02' },
      { id: 'r2', paymentStageId: 'b', amount: 50000, receivedDate: '2026-10-12' },
    ]);
    expect(r.rows.map((x) => x.received)).toEqual([100000, 30000, 0]);
    expect(r.splits.get('r2')).toEqual([
      { stageId: 'a', amount: 20000 },
      { stageId: 'b', amount: 30000 },
    ]);
    // Outstanding counts only the stages raised as due; 'c' is not raised yet
    expect(r.outstanding).toBe(70000);
    expect(r.notYetDue).toBe(100000);
  });

  it('a due date still ahead (fixed terms) is not raised yet, so not outstanding until that day', () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const r = reconcileOrder([{ id: 'a', amount: 2000, expectedAmount: 2000, dueDate: future }], []);
    expect(r.rows[0].isDue).toBe(false);
    expect(r.outstanding).toBe(0);
    expect(r.notYetDue).toBe(2000);
    // Nothing raised and nothing received: shown as due not raised yet, not unpaid
    expect(r.status).toBe('NOT_RAISED');
  });

  it('is unpaid once a raised payment has received nothing', () => {
    const r = reconcileOrder([{ id: 'a', amount: 2000, expectedAmount: 2000, dueDate: '2026-10-01' }], []);
    expect(r.status).toBe('UNPAID');
  });

  it('outstanding is the amount raised as due minus the amount received on it', () => {
    const due = [{ id: 'a', amount: 2000, expectedAmount: 2000, dueDate: '2026-10-01' }];
    expect(reconcileOrder(due, []).outstanding).toBe(2000);
    const r = reconcileOrder(due, [{ paymentStageId: 'a', amount: 1500 }]);
    expect(r.outstanding).toBe(500);
    expect(r.status).toBe('PARTIALLY_PAID');
  });

  it('leaves stages not yet due alone, and keeps a receipt that is too small on the earlier stage', () => {
    const r = reconcileOrder(stages, [
      { id: 'r1', paymentStageId: 'a', amount: 80000, receivedDate: '2026-10-02' },
      { id: 'r2', paymentStageId: 'c', amount: 10000, receivedDate: '2026-10-12' },
    ]);
    // 'b' is due and empty, so it takes nothing ahead of 'a'; the ₹10,000 all goes to 'a'
    expect(r.rows.map((x) => x.received)).toEqual([90000, 0, 0]);
  });

  it('stops clearing once a reversed receipt no longer counts', () => {
    const r = reconcileOrder(stages, [
      { id: 'r1', paymentStageId: 'a', amount: 80000, receivedDate: '2026-10-02', isReversed: true },
      { id: 'r2', paymentStageId: 'b', amount: 50000, receivedDate: '2026-10-12' },
    ]);
    expect(r.rows.map((x) => x.received)).toEqual([50000, 0, 0]);
  });

  it('asks a new payment for the earlier shortfall plus the stage', () => {
    const owed = owedThroughStage(stages, [{ paymentStageId: 'a', amount: 80000 }], 'b');
    expect(owed).toEqual({ earlier: 20000, stage: 100000, total: 120000 });
  });
});

describe('Payment stages raised by execution steps', () => {
  const steps = (states: Record<string, [string, string?]>) =>
    EXECUTION_STEPS.map((name) => ({ name, status: states[name]?.[0] ?? 'PENDING', completedDate: states[name]?.[1] ?? null }));

  it('maps quoted stages to the step that raises them', () => {
    expect(stageTriggerStep('Advance')).toBe('Issue PO to Vendor');
    expect(stageTriggerStep('Before Dispatch')).toBe('Dispatch');
    expect(stageTriggerStep('On Commissioning')).toBe('Commissioning');
    expect(stageTriggerStep('Against site handover')).toBeNull();
  });

  it('raises Advance only once PO received, vendor negotiated and vendor PO issued', () => {
    const partly = steps({ 'Receipt of PO': ['DONE', '2026-10-01'], 'Negotiate with Vendor': ['DONE', '2026-10-05'] });
    expect(stageDueDate('Issue PO to Vendor', partly)).toBeNull();
    const all = steps({
      'Receipt of PO': ['DONE', '2026-10-01'],
      'Negotiate with Vendor': ['DONE', '2026-10-05'],
      'Issue PO to Vendor': ['DONE', '2026-10-08'],
    });
    expect(stageDueDate('Issue PO to Vendor', all)?.toISOString().slice(0, 10)).toBe('2026-10-08');
  });

  it('treats not-needed steps as passed', () => {
    const s = steps({
      'Receipt of PO': ['DONE', '2026-10-01'],
      'Negotiate with Vendor': ['DONE', '2026-10-05'],
      'Issue PO to Vendor': ['DONE', '2026-10-08'],
      Dispatch: ['DONE', '2026-10-20'],
      Delivery: ['NOT_APPLICABLE'],
      Erection: ['NOT_APPLICABLE'],
    });
    expect(stageDueDate('Erection', s)?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(stageDueDate('Installation', s)).toBeNull();
  });
});

describe('Invoice GST', () => {
  const stages = [
    { id: 'adv', sequence: 1, description: 'Advance' },
    { id: 'dis', sequence: 2, description: 'Before Dispatch' },
    { id: 'com', sequence: 3, description: 'On Commissioning' },
  ];

  it('is asked with the stage raised at or after the invoice step', () => {
    expect(invoiceGstStageId(stages, 'Dispatch')).toBe('dis');
    expect(invoiceGstStageId(stages, 'Delivery')).toBe('com');
    expect(invoiceGstStageId(stages, 'Receipt of PO')).toBe('adv');
    expect(invoiceGstStageId(stages.slice(0, 2), 'Commissioning')).toBe('dis'); // nothing after: the last stage
  });

  it('is the GST % of the value before GST, or the GST quoted on the order in full', () => {
    expect(invoiceGstAmount({ netValue: 100000, taxValue: 0 }, 18)).toBe(18000);
    expect(invoiceGstAmount({ netValue: 100000, taxValue: 18000 }, 18)).toBe(18000);
    expect(invoiceGstAmount({ netValue: 100000, taxValue: 12000 }, 18)).toBe(12000); // quoted rate wins
  });

  it('matches stages typed differently to their step', () => {
    expect(stageTriggerStep('On delivery')).toBe('Delivery');
    expect(stageTriggerStep('Installation')).toBe('Installation');
    expect(stageTriggerStep('commissioning')).toBe('Commissioning');
    expect(stageTriggerStep('Against site handover')).toBeNull();
  });

  it('is expected on top of the stage, and only due stages count as due now', () => {
    const r = reconcileOrder(
      [
        { id: 'a', amount: 50000, expectedAmount: 50000, dueDate: '2026-10-08' },
        { id: 'b', amount: 50000, expectedAmount: 50000, gstAmount: 18000, dueDate: '2026-10-20' },
        { id: 'c', amount: 0, expectedAmount: 0 },
      ],
      [{ paymentStageId: 'a', amount: 50000 }, { paymentStageId: 'b', amount: 50000 }],
      { netValue: 100000, grossValue: 100000 }
    );
    expect(r.rows[1]).toMatchObject({ expected: 68000, outstanding: 18000, invoiceGst: 18000 });
    expect(r.dueNow).toBe(18000);
    expect(r.status).toBe('PARTIALLY_PAID');
  });
});

describe("Nirmaan worked example: ₹10,000 + 18% GST, 2% TDS, 1% retention", () => {
  const totals = calculateDeductions({
    netValue: 10000,
    gstValue: 1800,
    tdsEnabled: true,
    tdsPercent: 2,
    retentionEnabled: true,
    retentionPercent: 1,
    rules: { tdsBase: 'NET', retentionBase: 'GROSS' },
  });
  const rows = splitOverStages(
    [
      { percent: 30, description: 'Advance' },
      { percent: 20, description: 'Before Dispatch' },
      { percent: 30, description: 'Upon Delivery' },
      { percent: 10, description: 'On Installation' },
      { percent: 10, description: 'On Commissioning' },
    ],
    { ...totals, total: totals.netValue }
  );

  it('splits the price before GST over the stages', () => {
    expect(rows.map((r) => r.amount)).toEqual([3000, 2000, 3000, 1000, 1000]);
    expect(totals.tdsAmount).toBe(200); // 2% of ₹10,000
    expect(totals.retentionAmount).toBe(118); // 1% of ₹11,800
  });

  it('asks for the stage plus the full GST at the invoice stage, and keeps a short payment as underpayment', () => {
    const stages = rows.map((r, i) => ({
      id: String(i),
      amount: r.amount,
      expectedAmount: r.expectedAmount,
      gstAmount: i === 2 ? 1800 : 0, // invoice raised at Delivery
      dueDate: i <= 2 ? '2026-10-20' : null,
    }));
    const r = reconcileOrder(stages, [{ paymentStageId: '0', amount: 2500 }]);
    expect(r.rows[2].expected).toBe(rows[2].expectedAmount + 1800);
    expect(r.rows[0].outstanding).toBe(404.60);
    expect(r.dueNow).toBe(r.rows[0].outstanding + r.rows[1].outstanding + r.rows[2].outstanding);
    expect(r.expected).toBe(totals.expectedPayment);
  });
});
