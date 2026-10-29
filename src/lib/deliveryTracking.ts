import { TIMEZONE } from '@/lib/utils';

/**
 * Targeted completion tracking: an order's targeted completion date against its Execution. The order
 * counts as delivered once the last stage of its Execution (e.g. Commissioning or Installation, whatever
 * comes last) is marked done, on the date saved there. Safe to use in the browser.
 */

// Open orders due within this many days are Due soon
export const DUE_SOON_DAYS = 15;
// Due soon orders not dispatched yet are At risk when this close, or when nothing past the first row is done
const AT_RISK_DAYS = 7;

export type DeliveryBucket = 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_TARGET' | 'ON_TIME' | 'LATE';

export const DELIVERY_BUCKETS: Record<DeliveryBucket, { label: string; open: boolean }> = {
  OVERDUE: { label: 'Overdue', open: true },
  DUE_SOON: { label: `Due in ${DUE_SOON_DAYS} days`, open: true },
  ON_TRACK: { label: 'On track', open: true },
  NO_TARGET: { label: 'No target date', open: true },
  ON_TIME: { label: 'Delivered on time', open: false },
  LATE: { label: 'Delivered late', open: false },
};

type Step = { name: string; status: string; sequence?: number; completedDate: Date | string | null };
type Revision = { previousDate: Date | string | null; newDate: Date | string; createdAt?: Date | string };

// Whole days since 1970 of a stored date (saved as a UTC calendar day)
const dayOf = (d: Date | string) => Math.floor(new Date(d).getTime() / 86400000);

// Today's day number in India time, matching how dates are entered
function todayDay(now: Date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

const isDispatchRow = (name: string) => /dispatch/i.test(name) || /before\s+deliver/i.test(name);

/** The Execution row that marks delivery: the last stage, leaving out stages marked not needed. */
export function deliveryStep<T extends Step>(steps: T[]): T | null {
  const ordered = [...steps].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return ordered.filter((s) => s.status !== 'NOT_APPLICABLE').pop() ?? null;
}

/** When the order was delivered (its last stage done), or null while it is still to be delivered. */
export function deliveredOn(steps: Step[]): Date | null {
  const row = deliveryStep(steps);
  return row?.status === 'DONE' && row.completedDate ? new Date(row.completedDate) : null;
}

/** The target as first set: before the first revision, or the current one when never revised. */
export function originalTarget(current: Date | string | null, revisions: Revision[]): Date | null {
  const first = [...revisions].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())[0];
  const original = first ? first.previousDate ?? first.newDate : current;
  return original ? new Date(original) : null;
}

/**
 * Where an order stands against its targeted completion date. daysLeft is negative once late: for an open
 * order against today, for a delivered one against its delivery date.
 */
export function deliveryStatus(
  order: { deliveryDate: Date | string | null; orderStatus: string; executionSteps: Step[]; deliveryRevisions?: Revision[] },
  now: Date = new Date()
) {
  const steps = [...order.executionSteps].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const delivered = deliveredOn(steps);
  const target = order.deliveryDate ? new Date(order.deliveryDate) : null;
  const original = originalTarget(order.deliveryDate, order.deliveryRevisions ?? []);
  const pending = steps.find((s) => s.status === 'PENDING');
  const done = steps.filter((s) => s.status === 'DONE');

  let bucket: DeliveryBucket;
  let daysLeft: number | null = null;
  if (delivered) {
    daysLeft = target ? dayOf(target) - dayOf(delivered) : null;
    bucket = daysLeft !== null && daysLeft < 0 ? 'LATE' : 'ON_TIME';
  } else if (!target) {
    bucket = 'NO_TARGET';
  } else {
    daysLeft = dayOf(target) - todayDay(now);
    bucket = daysLeft < 0 ? 'OVERDUE' : daysLeft <= DUE_SOON_DAYS ? 'DUE_SOON' : 'ON_TRACK';
  }

  // Close to its date with the goods not on their way yet: not dispatched, and either due within a
  // week or nothing done past the first row (e.g. only the advance)
  const dispatched = order.orderStatus === 'DISPATCHED' || steps.some((s) => isDispatchRow(s.name) && s.status === 'DONE');
  const barelyStarted = done.every((s) => s === steps[0]);
  const atRisk = bucket === 'DUE_SOON' && !dispatched && (daysLeft! <= AT_RISK_DAYS || barelyStarted);

  return {
    bucket,
    atRisk,
    targetDate: target,
    originalDate: original,
    revisions: order.deliveryRevisions?.length ?? 0,
    deliveredDate: delivered,
    daysLeft,
    // Late against the date first promised, even when a revision made it on time
    daysLateVsOriginal: original ? Math.max(0, (delivered ? dayOf(delivered) : todayDay(now)) - dayOf(original)) : 0,
    // The Execution row being worked on now, e.g. "60% Before Dispatch"
    currentStep: delivered ? null : pending?.name ?? null,
    stepsDone: steps.filter((s) => s.status !== 'PENDING').length,
    stepsTotal: steps.length,
  };
}
