import { getIndianFYQuarter, TIMEZONE } from '@/lib/utils';
import { currentPeriodKey, periodRange } from '@/lib/targetPeriods';

/**
 * The dashboard's period choices (this month, this half-year, custom dates …) as India dates. Safe to use
 * in the browser.
 */

export type PeriodChoice = { preset: string; from?: string; to?: string };

// India's date today, e.g. 2026-10-29
export const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (d: Date) => d.toISOString().slice(0, 10); // period bounds are UTC days

export const PRESETS: { key: string; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'thisHalf', label: 'This half-year' },
  { key: 'thisFY', label: 'This financial year' },
  { key: 'lastFY', label: 'Last financial year' },
  { key: 'custom', label: 'Custom dates' },
];

/** The dates of a choice (YYYY-MM-DD, India), or null for all time or an unfinished custom range. */
export function periodDates(choice: PeriodChoice): { from: string; to: string } | null {
  const today = todayInIndia();
  const [y, m] = today.split('-').map(Number);
  const now = new Date(`${today}T12:00:00Z`);
  const fy = getIndianFYQuarter(now).financialYear;
  const ofPeriod = (financialYear: string, type: 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY', key: string) => {
    const r = periodRange(financialYear, type, key)!;
    return { from: day(r.start), to: day(r.end) };
  };
  switch (choice.preset) {
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const start = new Date(Date.UTC(y, m - 2, 1));
      return { from: day(start), to: day(new Date(Date.UTC(y, m - 1, 0))) };
    }
    case 'thisQuarter':
      return ofPeriod(fy, 'QUARTERLY', currentPeriodKey('QUARTERLY', now));
    case 'thisHalf':
      return ofPeriod(fy, 'HALF_YEARLY', currentPeriodKey('HALF_YEARLY', now));
    case 'thisFY':
      return ofPeriod(fy, 'YEARLY', 'FY');
    case 'lastFY': {
      const start = Number(fy.match(/\d{4}/)![0]) - 1;
      return ofPeriod(`FY ${start}-${String(start + 1).slice(-2)}`, 'YEARLY', 'FY');
    }
    case 'custom':
      return choice.from && choice.to && choice.from <= choice.to ? { from: choice.from, to: choice.to } : null;
    default:
      return null;
  }
}
