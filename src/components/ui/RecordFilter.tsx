'use client';

import { useId, useMemo, useState } from 'react';
import { Filter, Plus, X } from 'lucide-react';
import { EMPTY_FILTERS, FILTER_OPERATORS, FilterField, FilterRule, RecordFilters, filterRecord, inferFilterFields, isActiveRule, matchesFilters } from '@/lib/recordFilters';

export function useRecordFilters<T>(records: T[], project: (record: T) => unknown = filterRecord) {
  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const prepared = useMemo(() => records.map(project), [records, project]);
  const fields = useMemo(() => inferFilterFields(prepared), [prepared]);
  const rows = useMemo(() => records.filter((_, i) => matchesFilters(prepared[i], filters)), [records, prepared, filters]);
  return { filters, onChange: setFilters, fields, rows, total: records.length, count: rows.length };
}

export default function RecordFilter({ filters, onChange, fields, total, count, label = 'Custom filters' }: {
  filters: RecordFilters;
  onChange: (filters: RecordFilters) => void;
  fields: FilterField[];
  total?: number;
  count?: number;
  label?: string;
}) {
  const instance = useId();
  const [expanded, setExpanded] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const fieldTerms = fieldSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingFields = fields.filter((field) => fieldTerms.every((term) => `${field.label} ${field.key}`.toLowerCase().includes(term)));
  const active = filters.rules.filter(isActiveRule).length;
  const inputClass = 'min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500';
  function update(id: string, change: Partial<FilterRule>) {
    onChange({ ...filters, rules: filters.rules.map((rule) => rule.id === id ? { ...rule, ...change } : rule) });
  }
  function addRule() {
    if (filters.rules.length >= 20) return;
    onChange({ ...filters, rules: [...filters.rules, { id: crypto.randomUUID(), field: '__all', kind: 'text', operator: 'contains', value: '', to: '' }] });
    setExpanded(true);
  }
  return (
    <section aria-label={label} className="rounded-2xl border border-slate-200 bg-white text-xs shadow-xs">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" aria-expanded={expanded} aria-controls={`${instance}-filters`} onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 rounded-lg font-semibold text-slate-700 focus-visible:outline-sky-500">
          <Filter aria-hidden="true" className="h-4 w-4 text-sky-600" />{label}{active > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{active}</span>}
        </button>
        <button type="button" onClick={addRule} disabled={filters.rules.length >= 20} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-sky-500 disabled:opacity-40"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add filter</button>
        {filters.rules.length > 0 && <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-sky-500">Clear filters</button>}
        {total !== undefined && count !== undefined && <span aria-live="polite" className="ml-auto text-slate-500">{count} of {total} records</span>}
      </div>
      <div id={`${instance}-filters`} hidden={!expanded} className="space-y-3 border-t border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-slate-500">
          <span>Show records matching</span>
          <select aria-label="Match conditions" value={filters.mode} onChange={(e) => onChange({ ...filters, mode: e.target.value as 'all' | 'any' })} className={inputClass}><option value="all">all conditions</option><option value="any">any condition</option></select>
          <input type="search" aria-label="Find a filter field" placeholder="Find a filter field…" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} className={`${inputClass} sm:ml-auto`} />
        </div>
        {!filters.rules.length && <p className="text-slate-500">Add a filter for any available field. Combine text, numbers, dates, and status conditions.</p>}
        {fieldSearch && matchingFields.length === 0 && <p role="status" className="text-slate-500">No fields match that name. Try a shorter search.</p>}
        {filters.rules.map((rule, index) => {
          const field = fields.find((f) => f.key === rule.field);
          const noValue = rule.operator === 'empty' || rule.operator === 'not_empty';
          const invalidRange = rule.operator === 'between' && rule.value && rule.to && (rule.kind === 'number' ? Number(rule.value) > Number(rule.to) : rule.value > rule.to);
          return (
            <div key={rule.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Filter ${index + 1} field`} value={rule.field} onChange={(e) => {
                  const chosen = fields.find((f) => f.key === e.target.value)!;
                  update(rule.id, { field: chosen.key, kind: chosen.kind, operator: FILTER_OPERATORS[chosen.kind][0].value, value: '', to: '' });
                }} className={`${inputClass} w-full sm:w-56`}>
                  {!field && <option value={rule.field}>{rule.field}</option>}
                  {field && !matchingFields.some((f) => f.key === field.key) && <option value={field.key}>{field.label}</option>}
                  {matchingFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select aria-label={`Filter ${index + 1} condition`} value={rule.operator} onChange={(e) => update(rule.id, { operator: e.target.value as FilterRule['operator'] })} className={inputClass}>{FILTER_OPERATORS[rule.kind].map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select>
                {!noValue && (rule.kind === 'boolean' ? (
                  <select aria-label={`Filter ${index + 1} value`} value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} className={inputClass}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>
                ) : <input aria-label={`Filter ${index + 1} value`} type={rule.kind === 'date' ? 'date' : rule.kind === 'number' ? 'number' : 'text'} step="any" list={rule.kind === 'text' ? `${instance}-${rule.id}-values` : undefined} value={rule.value} onChange={(e) => update(rule.id, { value: e.target.value })} placeholder={rule.kind === 'number' ? 'Amount or number' : 'Type a value…'} className={`${inputClass} flex-1 basis-40`} />)}
                {rule.kind === 'text' && <datalist id={`${instance}-${rule.id}-values`}>{field?.options?.map((option) => <option key={option} value={option} />)}</datalist>}
                {!noValue && rule.operator === 'between' && <><span className="text-slate-500">and</span><input aria-label={`Filter ${index + 1} end value`} type={rule.kind === 'date' ? 'date' : 'number'} step="any" value={rule.to} onChange={(e) => update(rule.id, { to: e.target.value })} className={`${inputClass} flex-1 basis-40`} /></>}
                <button type="button" aria-label={`Remove filter ${index + 1}`} onClick={() => onChange({ ...filters, rules: filters.rules.filter((r) => r.id !== rule.id) })} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-sky-500"><X className="h-4 w-4" /></button>
              </div>
              {invalidRange && <p role="alert" className="text-rose-600">The start must be before or equal to the end.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
