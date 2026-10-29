// Execution step names, shared by the server and the order screens.
// Orders follow their payment terms in Execution: one row per payment stage (e.g. "10% Advance"), or a
// single Delivery & Invoice Raised row for fixed terms. Saving a row's date raises its payment as due. Orders made
// before that keep the standard steps below, which raise stages by keyword.

export const PO_RECEIVED_STEP = 'Receipt of PO';
export const DISPATCH_STEP = 'Dispatch';
export const DELIVERY_STEP = 'Delivery';
// The one Execution row of an order on fixed payment terms: its date starts the credit days
export const FULL_PAYMENT_STEP = 'Delivery & Invoice Raised';

// Standard steps of older orders, in order; ones that don't apply are marked Not needed on the order
export const EXECUTION_STEPS = [
  PO_RECEIVED_STEP,
  'Negotiate with Vendor',
  'Issue PO to Vendor',
  DISPATCH_STEP,
  DELIVERY_STEP,
  'Erection',
  'Installation',
  'Commissioning',
];

// The execution step that raises each quoted payment stage as due. A stage is due once every step up
// to and including its step is done or not needed, e.g. Advance once the PO is received, the vendor
// negotiated and the vendor PO issued. Stages with other descriptions are raised by hand.
const STAGE_TRIGGER_STEP: Record<string, string> = {
  advance: 'Issue PO to Vendor',
  'before dispatch': DISPATCH_STEP,
  'upon delivery': DELIVERY_STEP,
  'on erection': 'Erection',
  'on installation': 'Installation',
  'on commissioning': 'Commissioning',
};

// Words that identify a stage typed differently, e.g. "On delivery", "Installation", "30% commissioning"
const STAGE_TRIGGER_KEYWORDS: [RegExp, string][] = [
  [/advance/, 'Issue PO to Vendor'],
  [/dispatch/, DISPATCH_STEP],
  [/deliver/, DELIVERY_STEP],
  [/erect/, 'Erection'],
  [/install/, 'Installation'],
  [/commission/, 'Commissioning'],
];

/**
 * Fixed payment terms, e.g. "Full payment after 30 days": the credit days. Null for an ordinary stage.
 */
export function fixedPaymentTerms(description: string): { days: number } | null {
  const m = description.trim().match(/^full payment after (\d+) days$/i);
  return m ? { days: Number(m[1]) } : null;
}

/** Whether an order's payment stages are fixed terms, which need the Delivery & Invoice Raised row. */
export function hasFixedPayment(stages: unknown): boolean {
  return Array.isArray(stages) && stages.some((s: any) => fixedPaymentTerms(String(s?.description ?? '')));
}

/** The step that raises a payment stage, or null when the stage is raised by hand. */
export function stageTriggerStep(description: string): string | null {
  if (fixedPaymentTerms(description)) return FULL_PAYMENT_STEP;
  const text = description.trim().toLowerCase();
  if (STAGE_TRIGGER_STEP[text]) return STAGE_TRIGGER_STEP[text];
  return STAGE_TRIGGER_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

type StepState = { name: string; status: string; completedDate: Date | string | null };
type StageLike = { percent: unknown; description: string };

/** The Execution row that raises a payment stage: "10% Advance", or Delivery & Invoice Raised for fixed terms. */
export function paymentStepName(stage: StageLike): string {
  return fixedPaymentTerms(stage.description) ? FULL_PAYMENT_STEP : `${Number(stage.percent)}% ${stage.description.trim()}`;
}

/**
 * Whether an Execution row was added by hand (e.g. "Issue PO to Vendor" between two payment rows):
 * neither a payment's own row nor an older order's standard step. Such rows only track work.
 */
export function isAddedStage(name: string, stages: StageLike[]): boolean {
  return !EXECUTION_STEPS.includes(name) && !stages.some((st) => paymentStepName(st) === name);
}

/**
 * The Execution row that raises a stage on this order: its own payment row, or on older orders the
 * standard step its description names. Null when the stage is raised by hand.
 */
export function raisingStep(stage: StageLike, stepNames: string[]): string | null {
  const own = paymentStepName(stage);
  if (stepNames.includes(own)) return own;
  const trigger = stageTriggerStep(stage.description);
  return trigger && stepNames.includes(trigger) ? trigger : null;
}

/**
 * When a stage with a trigger step became due: the latest date among the done steps up to its step,
 * once all of them are done or not needed. Null while not yet due.
 */
export function stageDueDate(triggerStep: string, steps: StepState[]): Date | null {
  const upTo = EXECUTION_STEPS.indexOf(triggerStep);
  const relevant = steps.filter((s) => EXECUTION_STEPS.indexOf(s.name) <= upTo);
  if (relevant.length === 0 || relevant.some((s) => s.status === 'PENDING')) return null;
  const dates = relevant.filter((s) => s.status === 'DONE' && s.completedDate).map((s) => new Date(s.completedDate!).getTime());
  return dates.length > 0 ? new Date(Math.max(...dates)) : null;
}

const DAY_MS = 86400000;

/**
 * When a payment stage falls due, or null while not raised yet: the date saved on its own Execution
 * row, plus the credit days for fixed terms (e.g. 26 Oct + 30 days = 25 Nov). Older orders follow
 * their standard steps.
 */
export function paymentStageDueDate(stage: StageLike, steps: StepState[]): Date | null {
  const own = steps.find((s) => s.name === paymentStepName(stage));
  if (own) {
    if (own.status !== 'DONE' || !own.completedDate) return null;
    const days = fixedPaymentTerms(stage.description)?.days ?? 0;
    return new Date(new Date(own.completedDate).getTime() + days * DAY_MS);
  }
  const trigger = stageTriggerStep(stage.description);
  return trigger && trigger !== FULL_PAYMENT_STEP ? stageDueDate(trigger, steps) : null;
}

/**
 * The stage the invoice GST is asked with: the first stage raised at or after the invoice step,
 * else the last stage raised by a step, else the last stage.
 */
export function invoiceGstStageId(
  stages: { id: string; sequence: number; description: string; percent?: unknown }[],
  invoiceStep: string
) {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  // Invoice raised on a payment's own row: the GST is asked with that payment
  const own = ordered.find((s) => s.percent !== undefined && paymentStepName(s as StageLike) === invoiceStep);
  if (own) return own.id;
  const at = EXECUTION_STEPS.indexOf(invoiceStep);
  const triggered = ordered
    .map((s) => ({ s, i: EXECUTION_STEPS.indexOf(stageTriggerStep(s.description) ?? '') }))
    .filter((x) => x.i >= 0);
  const next = triggered.filter((x) => x.i >= at).sort((a, b) => a.i - b.i)[0];
  return (next ?? triggered[triggered.length - 1])?.s.id ?? ordered[ordered.length - 1]?.id ?? null;
}
