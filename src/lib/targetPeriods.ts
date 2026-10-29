/**
 * Target periods inside an Indian financial year (April to March): a month, a quarter, six months or the
 * whole year, or custom dates. A period is named by its key (M01–M12 calendar month, Q1–Q4, H1/H2, FY,
 * or C<start>-<end> for custom dates, e.g. C20260401-20260930). Dates are UTC day bounds, the same as
 * getIndianFYQuarter. Safe to use in the browser.
 */

export type TargetPeriodType = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY' | 'CUSTOM';

export const PERIOD_TYPE_LABELS: Record<TargetPeriodType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: '6 months',
  YEARLY: 'Yearly',
  CUSTOM: 'Custom dates',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Financial year months in order, as calendar month numbers: Apr … Dec, Jan … Mar
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

function fyStartYear(financialYear: string): number {
  const match = financialYear.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : new Date().getUTCFullYear();
}

// First and last financial-year month (index into FY_MONTHS) a period covers
function monthSpan(periodType: TargetPeriodType, periodKey: string): [number, number] | null {
  if (periodType === 'MONTHLY') {
    const i = FY_MONTHS.indexOf(Number(periodKey.slice(1)));
    return /^M\d{2}$/.test(periodKey) && i >= 0 ? [i, i] : null;
  }
  if (periodType === 'QUARTERLY') {
    const q = ['Q1', 'Q2', 'Q3', 'Q4'].indexOf(periodKey);
    return q >= 0 ? [q * 3, q * 3 + 2] : null;
  }
  if (periodType === 'HALF_YEARLY') {
    const h = ['H1', 'H2'].indexOf(periodKey);
    return h >= 0 ? [h * 6, h * 6 + 5] : null;
  }
  return periodKey === 'FY' ? [0, 11] : null;
}

// Calendar year and month (1–12) of a financial-year month index
function calendarMonth(financialYear: string, index: number) {
  const month = FY_MONTHS[index];
  return { year: fyStartYear(financialYear) + (month < 4 ? 1 : 0), month };
}

/** Key of a custom period from its first and last day (YYYY-MM-DD), or null when the dates are invalid or reversed. */
export function customPeriodKey(startDate: string, endDate: string): string | null {
  const key = `C${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}`;
  return customRange(key) ? key : null;
}

// Start and end of a custom period key, or null when it is not one
function customRange(periodKey: string): { start: Date; end: Date } | null {
  const m = periodKey.match(/^C(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y1, m1, d1, y2, m2, d2] = m.slice(1).map(Number);
  const start = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0));
  const end = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59));
  // Date.UTC rolls 31 Feb over into March, so a real date reads back the same
  if (start.getUTCDate() !== d1 || end.getUTCDate() !== d2 || end < start) return null;
  return { start, end };
}

/** Start and end of a period, or null when the key does not belong to the period type. */
export function periodRange(financialYear: string, periodType: TargetPeriodType, periodKey: string): { start: Date; end: Date } | null {
  if (periodType === 'CUSTOM') return customRange(periodKey);
  const span = monthSpan(periodType, periodKey);
  if (!span) return null;
  const first = calendarMonth(financialYear, span[0]);
  const last = calendarMonth(financialYear, span[1]);
  return {
    start: new Date(Date.UTC(first.year, first.month - 1, 1, 0, 0, 0)),
    // Day 0 of the next month is the last day of this one
    end: new Date(Date.UTC(last.year, last.month, 0, 23, 59, 59)),
  };
}

/** e.g. "Oct 2026", "Q3 (Oct–Dec)", "H2 (Oct–Mar)", "Full year (Apr–Mar)", "01 Apr 2026 – 30 Sep 2026" */
export function periodLabel(financialYear: string, periodType: TargetPeriodType, periodKey: string): string {
  if (periodType === 'CUSTOM') {
    const range = customRange(periodKey);
    if (!range) return periodKey;
    const day = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return `${day(range.start)} – ${day(range.end)}`;
  }
  const span = monthSpan(periodType, periodKey);
  if (!span) return periodKey;
  const first = calendarMonth(financialYear, span[0]);
  const last = calendarMonth(financialYear, span[1]);
  if (periodType === 'MONTHLY') return `${MONTHS[first.month - 1]} ${first.year}`;
  const months = `${MONTHS[first.month - 1]}–${MONTHS[last.month - 1]}`;
  return periodType === 'YEARLY' ? `Full year (${months})` : `${periodKey} (${months})`;
}

/** Every period of a type in a financial year, in order (none for custom dates). */
export function periodOptions(financialYear: string, periodType: TargetPeriodType): { key: string; label: string }[] {
  if (periodType === 'CUSTOM') return [];
  const keys =
    periodType === 'MONTHLY'
      ? FY_MONTHS.map((m) => `M${String(m).padStart(2, '0')}`)
      : periodType === 'QUARTERLY'
        ? ['Q1', 'Q2', 'Q3', 'Q4']
        : periodType === 'HALF_YEARLY'
          ? ['H1', 'H2']
          : ['FY'];
  return keys.map((key) => ({ key, label: periodLabel(financialYear, periodType, key) }));
}

/** The period of a type that contains a date (today by default), in that date's financial year. */
export function currentPeriodKey(periodType: TargetPeriodType, date: Date = new Date()): string {
  const month = date.getUTCMonth() + 1;
  const index = FY_MONTHS.indexOf(month);
  if (periodType === 'MONTHLY') return `M${String(month).padStart(2, '0')}`;
  if (periodType === 'QUARTERLY') return `Q${Math.floor(index / 3) + 1}`;
  if (periodType === 'HALF_YEARLY') return index < 6 ? 'H1' : 'H2';
  if (periodType === 'CUSTOM') return '';
  return 'FY';
}
