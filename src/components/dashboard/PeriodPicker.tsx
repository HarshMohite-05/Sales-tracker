'use client';

import React from 'react';
import { CalendarDays } from 'lucide-react';
import { PeriodChoice, periodDates, PRESETS, todayInIndia } from '@/lib/dashboardPeriod';

export type { PeriodChoice };
export { periodDates };

const show = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/**
 * The dashboard's period: leads, orders booked and payments received are counted in it and compared with
 * the period before; follow-ups and money owed are always as of today.
 */
export default function PeriodPicker({ value, onChange }: { value: PeriodChoice; onChange: (next: PeriodChoice) => void }) {
  const dates = periodDates(value);
  const input = 'rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-primary)] [color-scheme:dark]';
  return (
    <span className="inline-flex flex-wrap items-center gap-2" title="Leads, orders booked and payments received in this period. Follow-ups and money owed are as of today.">
      <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[var(--text-primary)]">
        <CalendarDays className="h-4 w-4 text-[var(--text-secondary)]" />
        <select
          aria-label="Dashboard period"
          value={value.preset}
          onChange={(e) => onChange({ preset: e.target.value, from: value.from || dates?.from, to: value.to || dates?.to || todayInIndia() })}
          className="bg-transparent font-semibold focus:outline-none [color-scheme:dark]"
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {dates && value.preset !== 'custom' && (
          <span className="text-[var(--text-secondary)]">
            {show(dates.from)} – {show(dates.to)}
          </span>
        )}
      </span>
      {value.preset === 'custom' && (
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
          <input type="date" aria-label="Period from" value={value.from || ''} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} className={input} />
          to
          <input type="date" aria-label="Period to" value={value.to || ''} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} className={input} />
        </span>
      )}
    </span>
  );
}
