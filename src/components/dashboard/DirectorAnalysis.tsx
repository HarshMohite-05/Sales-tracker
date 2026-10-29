'use client';

import { useEffect, useState } from 'react';
import { formatINR, formatDate } from '@/lib/utils';
import { SalesMetrics } from '@/lib/salesAnalysis';

type Row = SalesMetrics & { id: string; name: string; isActive: boolean };
type Analysis = { start: string; end: string; people: { id: string; name: string; isActive: boolean }[]; rows: Row[]; totals: SalesMetrics; daily: (SalesMetrics & { date: string })[] };
const columns: { key: keyof SalesMetrics; label: string; money?: boolean }[] = [
  { key: 'enquiries', label: 'New requirements' }, { key: 'activities', label: 'Activities logged' },
  { key: 'followUps', label: 'Follow-ups completed' }, { key: 'quotations', label: 'Quotes sent' },
  { key: 'orders', label: 'Orders booked' }, { key: 'orderValue', label: 'Order value (net)', money: true }, { key: 'received', label: 'Payments received', money: true },
];

/**
 * Work done by the team in a period. On the team dashboard it shows everyone, with a picker for one
 * salesperson; on one salesperson's dashboard (`only`) it shows just that person.
 */
export default function DirectorAnalysis({ only }: { only?: { id: string; name: string } | null }) {
  const [period, setPeriod] = useState('week');
  const [picked, setPicked] = useState('');
  const person = only?.id ?? picked;
  // Switching between the team and one salesperson's dashboard starts the team view on everyone again
  useEffect(() => setPicked(''), [only?.id]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (period === 'custom' && (!start || !end)) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const params = new URLSearchParams({ period, salespersonId: person, start, end });
    fetch(`/api/dashboard/analysis?${params}`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load analysis.');
      setData(result);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, person, start, end]);
  const ready = !loading && !error && data && (period !== 'custom' || (start && end));
  const inputClass = 'rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#5598e7]/50';
  const cells = (row: SalesMetrics) => columns.map((column) => <td key={column.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">{column.money ? formatINR(row[column.key]) : row[column.key]}</td>);
  return (
    <section aria-label="Team activity" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div><h2 className="text-sm font-bold text-[var(--text-primary)]">{only ? `${only.name}'s activity` : 'Team activity'}</h2><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{only ? 'Work done' : 'Work done by each salesperson'} in the chosen period: requirements, calls and visits, follow-ups, quotes, orders and payments</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Analysis period" value={period} onChange={(event) => setPeriod(event.target.value)} className={inputClass}>
            <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom dates</option>
          </select>
          {!only && (
            <select aria-label="Analysis salesperson" value={picked} onChange={(event) => setPicked(event.target.value)} className={inputClass}>
              <option value="">All salespeople</option>{data?.people.map((user) => <option key={user.id} value={user.id}>{user.name}{user.isActive ? '' : ' (inactive)'}</option>)}
            </select>
          )}
          {period === 'custom' && <><input aria-label="Analysis start date" type="date" value={start} onChange={(event) => setStart(event.target.value)} className={inputClass} /><span className="text-xs text-[var(--text-muted)]">to</span><input aria-label="Analysis end date" type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} /></>}
        </div>
      </div>
      {loading && <p role="status" className="p-5 text-xs text-[var(--text-muted)]">Loading activity…</p>}
      {error && <p role="alert" className="p-5 text-xs text-[#ff9b9b]">{error}</p>}
      {period === 'custom' && (!start || !end) && <p className="p-5 text-xs text-[var(--text-muted)]">Choose both dates to see the activity.</p>}
      {ready && <>
        <p className="px-5 pt-3 text-[11px] text-[var(--text-muted)]">{formatDate(data.start)} – {formatDate(data.end)} · India time · Weeks begin Monday</p>
        <div className="overflow-x-auto p-2" tabIndex={0} role="region" aria-label="Salesperson comparison"><table className="w-full text-left text-xs">
          <thead className="text-[var(--text-secondary)]"><tr className="border-b border-[var(--border)]"><th className="px-4 py-3 font-semibold">Salesperson</th>{columns.map((column) => <th key={column.key} className="px-4 py-3 text-right font-semibold">{column.label}</th>)}</tr></thead>
          <tbody>{data.rows.map((row) => <tr key={row.id} className="border-b border-[var(--border)]"><td className="whitespace-nowrap px-4 py-3 font-semibold text-[var(--text-primary)]">{row.name}{!row.isActive && <span className="ml-1 font-normal text-[var(--text-muted)]">(inactive)</span>}</td>{cells(row)}</tr>)}
            {data.rows.length > 1 && <tr className="bg-[var(--surface-2)] font-bold [&_td]:text-[var(--text-primary)]"><td className="px-4 py-3">Total</td>{cells(data.totals)}</tr>}
          </tbody>
        </table></div>
        <details className="border-t border-[var(--border)]"><summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-[#86b6ef] hover:text-white">Daily breakdown</summary>
          <div className="max-h-96 overflow-auto p-2"><table className="w-full text-left text-xs"><thead className="text-[var(--text-secondary)]"><tr className="border-b border-[var(--border)]"><th className="px-4 py-3 font-semibold">Date</th>{columns.map((column) => <th key={column.key} className="px-4 py-3 text-right font-semibold">{column.label}</th>)}</tr></thead><tbody>{data.daily.map((day) => <tr key={day.date} className="border-b border-[var(--border)]"><td className="whitespace-nowrap px-4 py-3 text-[var(--text-primary)]">{formatDate(day.date)}</td>{cells(day)}</tr>)}</tbody></table></div>
        </details>
      </>}
      <p className="border-t border-[var(--border)] px-5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">Activities include calls, visits, meetings, email, and WhatsApp. Based on requirement creation, activity dates, follow-up completion, quote sent dates, order dates, and receipt dates. Payments are attributed to the order owner; cancelled orders and reversed receipts are excluded. This analysis is independent of the dashboard search.</p>
    </section>
  );
}
