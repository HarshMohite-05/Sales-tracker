// Order payment maths: TDS and retention deductions, how they spread over payment stages,
// and reconciling money received against what is expected. Pure functions, shared by the
// forms and the API, so the rules live in one place.
//
// Assumptions (documented, and configurable where the business may differ):
// - Order total = order value including GST (equal to the value when no GST is charged).
//   This is what the client is billed and pays against.
// - TDS and retention are each worked out on a base a director picks in Settings:
//     NET   = order value before GST
//     GROSS = order total including GST
//   Defaults: TDS on NET (CBDT Circular 23/2017: TDS excludes GST shown separately),
//   retention on GROSS (withheld from the billed amount). Percentages are never assumed:
//   they are entered on each order.
// - Payment stages are shares of the order value BEFORE GST (e.g. 30% advance = 30% of the price).
//   Deductions are spread over the stages by the same percentages.
// - TDS deducted by the client and retention withheld are not cash. They are shown separately
//   and never counted as received or as outstanding.
// - GST (18% on the quotation by default) is charged once, on the invoice, raised at one execution
//   step. It is asked for in full with the payment stage raised at or after that step, on top of
//   that stage's amount, with no TDS or retention on it. A quotation without GST gets the GST % entered
//   when the invoice is raised, on the order value before GST.
// - Anything received above what a stage asks for is an overpayment on that stage. It never covers
//   a shortfall on another stage.

export type DeductionBase = 'NET' | 'GROSS';

export const DEDUCTION_BASE_OPTIONS: { value: DeductionBase; label: string }[] = [
  { value: 'NET', label: 'Order value before GST' },
  { value: 'GROSS', label: 'Order total including GST' },
];

export interface DeductionRules {
  tdsBase: DeductionBase;
  retentionBase: DeductionBase;
}

export const DEFAULT_DEDUCTION_RULES: DeductionRules = { tdsBase: 'NET', retentionBase: 'GROSS' };

export interface DeductionInput {
  netValue: number; // before GST
  gstValue: number;
  tdsEnabled: boolean;
  tdsPercent: number;
  retentionEnabled: boolean;
  retentionPercent: number;
  rules: DeductionRules;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Check a deduction percentage typed into a form. Disabled deductions are always zero.
 */
export function deductionPercentError(label: string, enabled: boolean, percent: unknown): string | null {
  if (!enabled) return null;
  const p = Number(percent);
  if (percent === '' || percent === null || percent === undefined || Number.isNaN(p)) return `Enter the ${label} percentage`;
  if (p <= 0 || p >= 100) return `${label} percentage must be more than 0 and less than 100`;
  return null;
}

/**
 * Check the retention due date: required when retention is applied. Returns the date or an error.
 */
export function parseRetentionDueDate(enabled: boolean, value: unknown): { date: Date | null } | { error: string } {
  if (!enabled) return { date: null };
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return { error: 'Select the date the retention amount is to be received' };
  return { date };
}

/**
 * Order total, TDS, retention and the payment expected after them.
 */
export function calculateDeductions(input: DeductionInput) {
  const net = round2(input.netValue);
  const gst = round2(input.gstValue);
  const total = round2(net + gst);
  const baseOf = (b: DeductionBase) => (b === 'GROSS' ? total : net);

  const tdsPercent = input.tdsEnabled ? input.tdsPercent : 0;
  const retentionPercent = input.retentionEnabled ? input.retentionPercent : 0;
  const tdsAmount = round2((baseOf(input.rules.tdsBase) * tdsPercent) / 100);
  const retentionAmount = round2((baseOf(input.rules.retentionBase) * retentionPercent) / 100);

  return {
    netValue: net,
    gstValue: gst,
    total,
    tdsPercent,
    tdsAmount,
    retentionPercent,
    retentionAmount,
    expectedPayment: round2(total - tdsAmount - retentionAmount),
  };
}

/**
 * Split an order's total and deductions over its payment stages by percentage.
 * The last stage takes any rounding, so every column adds up to the order exactly.
 */
export function splitOverStages(
  stages: { percent: number; description: string }[],
  // total = what the percentages are taken of: the order value before GST
  totals: { total: number; tdsAmount: number; retentionAmount: number }
) {
  const list = stages.length > 0 ? stages : [{ percent: 100, description: 'Full payment' }];
  const used = { amount: 0, tds: 0, retention: 0 };

  return list.map((s, i) => {
    const last = i === list.length - 1;
    const share = (whole: number, key: keyof typeof used) => {
      const value = last ? round2(whole - used[key]) : round2((whole * s.percent) / 100);
      used[key] = round2(used[key] + value);
      return value;
    };
    const amount = share(totals.total, 'amount');
    const tdsAmount = share(totals.tdsAmount, 'tds');
    const retentionAmount = share(totals.retentionAmount, 'retention');
    return {
      sequence: i + 1,
      percent: s.percent,
      description: s.description || `Payment ${i + 1}`,
      amount,
      tdsAmount,
      retentionAmount,
      expectedAmount: round2(amount - tdsAmount - retentionAmount),
    };
  });
}

// NOT_RAISED: nothing asked for yet, e.g. fixed terms waiting out their 30 or 45 days
export type PaymentStatus = 'NOT_RAISED' | 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID' | 'OVERPAID';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NOT_RAISED: 'Due not raised yet',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially Paid',
  FULLY_PAID: 'Fully Paid',
  OVERPAID: 'Overpaid',
};

/**
 * Compare money received with what was expected.
 * Outstanding = MAX(expected − received, 0); Excess = MAX(received − expected, 0).
 */
export function reconcile(expected: number, received: number) {
  const exp = round2(expected);
  const rec = round2(received);
  const outstanding = round2(Math.max(exp - rec, 0));
  const excess = round2(Math.max(rec - exp, 0));
  const status: PaymentStatus =
    rec <= 0 ? 'UNPAID' : excess > 0 ? 'OVERPAID' : outstanding > 0 ? 'PARTIALLY_PAID' : 'FULLY_PAID';
  return { expected: exp, received: rec, outstanding, excess, status };
}

/**
 * GST charged on the invoice: the percentage of the order value before GST, or nothing when the
 * order value already includes GST.
 */
export function invoiceGstAmount(order: { netValue: unknown; taxValue: unknown }, gstPercent: number) {
  // GST quoted on the order is asked for in full with the invoice
  if (Number(order.taxValue) > 0) return round2(Number(order.taxValue));
  return round2((Number(order.netValue) * gstPercent) / 100);
}

/**
 * Sum of receipts that count: reversed receipts stay in the history but not in the totals.
 */
export function receivedTotal(receipts: { amount: unknown; isReversed?: boolean }[]): number {
  return round2(receipts.filter((r) => !r.isReversed).reduce((sum, r) => sum + Number(r.amount), 0));
}

/**
 * Money received above what was expected, read as GST paid on top of the quoted price.
 * The rate is that GST as a percentage of the value it was paid on (the order or stage value before GST).
 */
export function excessAsGst(excess: number, valueBeforeGst: number) {
  const gstAmount = round2(Math.max(excess, 0));
  const gstPercent = valueBeforeGst > 0 ? round2((gstAmount / valueBeforeGst) * 100) : 0;
  return { gstAmount, gstPercent };
}

/**
 * A payment stage is raised once its due date has arrived. A due date still ahead (e.g. fixed terms,
 * 30 or 45 days after Delivery & Invoice Raised) is not raised yet: it is not outstanding until that day.
 */
export function isRaised(dueDate: unknown, now = Date.now()): boolean {
  return !!dueDate && new Date(dueDate as any).getTime() <= now;
}

type StageForAllocation = { id: string; expectedAmount: unknown; gstAmount?: unknown; dueDate?: unknown };
type ReceiptForAllocation = {
  id?: string;
  paymentStageId: string;
  amount: unknown;
  isReversed?: boolean;
  receivedDate?: unknown;
  createdAt?: unknown;
};

/**
 * Spread an order's receipts over its stages (given in stage order). A receipt first clears what is
 * still owed on earlier stages already raised as due, then goes to the stage it was recorded for;
 * anything above that stays on its own stage as an overpayment. Receipts are taken oldest first, so a
 * later receipt never moves money an earlier one placed. Reversed receipts don't count.
 */
export function allocateReceipts(stages: StageForAllocation[], receipts: ReceiptForAllocation[]) {
  const asked = new Map(stages.map((st) => [st.id, round2(Number(st.expectedAmount) + Number(st.gstAmount ?? 0))]));
  const byStage = new Map<string, number>(stages.map((st) => [st.id, 0]));
  const splits = new Map<string, { stageId: string; amount: number }[]>();
  const time = (v: unknown) => (v ? new Date(v as any).getTime() : 0);
  const ordered = receipts
    .filter((r) => !r.isReversed)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => time(a.r.receivedDate) - time(b.r.receivedDate) || time(a.r.createdAt) - time(b.r.createdAt) || a.i - b.i)
    .map(({ r }) => r);

  for (const rec of ordered) {
    const own = stages.findIndex((st) => st.id === rec.paymentStageId);
    let left = round2(Number(rec.amount));
    const parts: { stageId: string; amount: number }[] = [];
    const put = (stageId: string, amount: number) => {
      if (amount <= 0) return;
      byStage.set(stageId, round2((byStage.get(stageId) ?? 0) + amount));
      left = round2(left - amount);
      const part = parts.find((p) => p.stageId === stageId);
      if (part) part.amount = round2(part.amount + amount);
      else parts.push({ stageId, amount });
    };
    for (let i = 0; i < own && left > 0; i++) {
      const st = stages[i];
      if (!isRaised(st.dueDate)) continue;
      put(st.id, Math.min(left, round2((asked.get(st.id) ?? 0) - (byStage.get(st.id) ?? 0))));
    }
    put(rec.paymentStageId, left);
    if (rec.id) splits.set(rec.id, parts);
  }
  return { byStage, splits };
}

/**
 * What a payment recorded against a stage would be asked to bring in: the shortfall on earlier stages
 * raised as due (cleared first) plus what the stage itself still expects.
 */
export function owedThroughStage(stages: StageForAllocation[], receipts: ReceiptForAllocation[], stageId: string) {
  const { byStage } = allocateReceipts(stages, receipts);
  const own = stages.findIndex((st) => st.id === stageId);
  const short = (st: StageForAllocation) =>
    Math.max(round2(Number(st.expectedAmount) + Number(st.gstAmount ?? 0) - (byStage.get(st.id) ?? 0)), 0);
  const earlier = round2(stages.slice(0, Math.max(own, 0)).reduce((sum, st) => sum + (isRaised(st.dueDate) ? short(st) : 0), 0));
  const stage = own >= 0 ? short(stages[own]) : 0;
  return { earlier, stage, total: round2(earlier + stage) };
}

/**
 * Reconcile an order stage by stage, after receipts have cleared earlier due stages first
 * (allocateReceipts). A stage paid above its expected amount (GST on top) does not cover another
 * stage that is still short. Outstanding = amount raised as due − amount received on it, summed over
 * the stages raised as due (raised ₹2,000, received ₹1,500 → outstanding ₹500). Stages not raised yet
 * are not outstanding; their balance is notYetDue. GST is the sum of each stage's extra.
 */
export function reconcileOrder(
  stages: { id: string; amount: unknown; expectedAmount: unknown; gstAmount?: unknown; dueDate?: unknown }[],
  receipts: ReceiptForAllocation[],
  // Kept for callers; stage amounts already hold the value before GST
  _order?: { netValue: unknown; grossValue: unknown }
) {
  const { byStage, splits } = allocateReceipts(stages, receipts);
  const rows = stages.map((st) => {
    // Invoice GST asked with this stage is expected on top of its amount
    const invoiceGst = round2(Number(st.gstAmount ?? 0));
    const r = reconcile(Number(st.expectedAmount) + invoiceGst, byStage.get(st.id) ?? 0);
    // Stage amounts are shares of the order value before GST
    const valueBeforeGst = round2(Number(st.amount));
    return { stageId: st.id, ...r, invoiceGst, isDue: isRaised(st.dueDate), valueBeforeGst, gst: excessAsGst(r.excess, valueBeforeGst) };
  });

  const sum = (pick: (r: (typeof rows)[number]) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  const expected = sum((r) => r.expected);
  const received = sum((r) => r.received);
  // Only stages raised as due are outstanding
  const outstanding = sum((r) => (r.isDue ? r.outstanding : 0));
  // Kept for callers: what is due now is the outstanding
  const dueNow = outstanding;
  // Still to be asked for on stages not raised as due yet
  const notYetDue = sum((r) => (r.isDue ? 0 : r.outstanding));
  const excess = sum((r) => r.excess);
  // Nothing raised and nothing received: not unpaid, just not asked for yet
  const status: PaymentStatus =
    received <= 0
      ? outstanding > 0 ? 'UNPAID' : 'NOT_RAISED'
      : outstanding + notYetDue > 0 ? 'PARTIALLY_PAID' : excess > 0 ? 'OVERPAID' : 'FULLY_PAID';

  return {
    rows,
    // How each receipt was spread over the stages, by receipt id
    splits,
    expected,
    received,
    outstanding,
    dueNow,
    notYetDue,
    excess,
    status,
    // GST rate over the stages it was paid on
    gst: excessAsGst(excess, sum((r) => (r.excess > 0 ? r.valueBeforeGst : 0))),
  };
}
