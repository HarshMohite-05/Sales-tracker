'use client';

import { Search, X } from 'lucide-react';
import { EMPTY_FILTERS, FilterField, RecordFilters, presetFilters } from '@/lib/recordFilters';

type Props = {
  filters: RecordFilters;
  onChange: (filters: RecordFilters) => void;
  fields?: FilterField[];
  total?: number;
  count?: number;
  label?: string;
};

/** One plain-language search across every searchable business field. */
export default function RecordSearch({ filters, onChange, fields = [], total, count, label = 'Search records' }: Props) {
  const search = filters.rules.find((rule) => rule.field === '__all')?.value || '';
  const presets = filters.rules.filter((rule) => rule.field !== '__all');
  return (
    <section aria-label={label} className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:max-w-md">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input type="search" aria-label={label} placeholder="Search by name, company, or any detail…" value={search}
          onChange={(event) => onChange(presetFilters('__all', 'text', 'contains', event.target.value))}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
      </div>
      {presets.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {presets.map((rule) => <span key={rule.id} className="rounded-md bg-slate-100 px-2 py-1">{fields.find((field) => field.key === rule.field)?.label || rule.field}: {rule.value.replace(/_/g, ' ')}</span>)}
        <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100"><X className="h-3 w-3" />Clear view</button>
      </div>}
      {search.trim() && count !== undefined && <span aria-live="polite" className="text-xs text-slate-500 sm:ml-auto">{count === 0 ? 'No matches found. Try another search.' : `${count} matching ${count === 1 ? 'result' : 'results'}`}</span>}
    </section>
  );
}
