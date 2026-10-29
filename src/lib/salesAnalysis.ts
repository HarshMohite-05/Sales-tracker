import { formatInTimeZone } from 'date-fns-tz';

const DAY = 86400000;
export function analysisPeriod(params: URLSearchParams, now = new Date()) {
  const period = params.get('period') || 'week';
  const today = formatInTimeZone(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  let start = today;
  let end = today;
  if (period === 'week') {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    start = date.toISOString().slice(0, 10);
  } else if (period === 'month') start = `${today.slice(0, 7)}-01`;
  else if (period === 'custom') {
    start = params.get('start') || '';
    end = params.get('end') || '';
  } else if (period !== 'today') throw new Error('Choose a valid analysis period.');
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Choose a valid start and end date.');
  const from = new Date(`${start}T00:00:00+05:30`);
  const until = new Date(new Date(`${end}T00:00:00+05:30`).getTime() + DAY);
  if (until.getTime() - from.getTime() > 366 * DAY) throw new Error('Choose a range of up to one year.');
  return { period, start, end, from, until };
}
export const emptySalesMetrics = () => ({ enquiries: 0, activities: 0, followUps: 0, quotations: 0, orders: 0, orderValue: 0, received: 0 });
export type SalesMetrics = ReturnType<typeof emptySalesMetrics>;
