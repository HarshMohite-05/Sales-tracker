'use client';

// A register opened from a dashboard card or chart: searchable, sortable, paginated, optionally
// grouped with subtotals, with rows that open the record. Each column header filters by its values,
// the way Excel's AutoFilter does, and the rows shown can be downloaded as an Excel file. Styled for the
// dark dashboard.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Filter, FilterX, Search } from 'lucide-react';

export type RegisterColumn = {
  key: string;
  label: string;
  right?: boolean;
  cell: (row: any) => React.ReactNode;
  sort?: (row: any) => string | number | null; // makes the column sortable
  search?: (row: any) => string | null | undefined; // text the search box matches
  filterValue?: (row: any) => string | null | undefined; // value listed in the header filter; defaults to the search text
  number?: (row: any) => number | null | undefined; // filters by a condition (e.g. less than 45); defaults to a numeric sort
  // The value in the Excel download; defaults to the filter value, then the number, search text or sort value
  excel?: (row: any) => string | number | null | undefined;
  unit?: string; // shown after numbers in the condition filter, e.g. "days"
  presets?: number[]; // quick "less than" buttons in the condition filter, e.g. [10, 30, 45]
  // Kinds of row the condition filter picks first, e.g. Left / Overdue / Due today on a days column;
  // a kind with noValue needs no condition (every Due today row is 0 days)
  kinds?: {
    key: string;
    label: string;
    match: (row: any) => boolean;
    noValue?: boolean;
  }[];
};

export type NumberCondition = {
  op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'between';
  a: number;
  b?: number;
  kind?: string;
};

const NUMBER_OPS: { op: NumberCondition['op']; label: string; sign: string }[] = [
  { op: 'lt', label: 'Less than', sign: '<' },
  { op: 'lte', label: 'Less than or equal to', sign: '≤' },
  { op: 'gt', label: 'Greater than', sign: '>' },
  { op: 'gte', label: 'Greater than or equal to', sign: '≥' },
  { op: 'eq', label: 'Equal to', sign: '=' },
  { op: 'between', label: 'Between', sign: '–' },
];

// A column's number for its condition filter: its own, else a numeric sort value of a column with no text (amounts, days)
const numberOf = (c: RegisterColumn, row: any): number | null => {
  const v = c.number ? c.number(row) : !(c.filterValue ?? c.search) && c.sort ? c.sort(row) : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const isNumeric = (c: RegisterColumn) => !!c.number || (!(c.filterValue ?? c.search) && !!c.sort);

function meets(n: number | null, f: NumberCondition): boolean {
  if (n === null) return false;
  switch (f.op) {
    case 'lt': return n < f.a;
    case 'lte': return n <= f.a;
    case 'gt': return n > f.a;
    case 'gte': return n >= f.a;
    case 'eq': return n === f.a;
    case 'between': return n >= Math.min(f.a, f.b ?? f.a) && n <= Math.max(f.a, f.b ?? f.a);
  }
}

// Whether a row passes a column's condition filter: of the kind picked, if any, then within the condition
function passes(c: RegisterColumn, row: any, f: NumberCondition): boolean {
  const kind = f.kind ? c.kinds?.find((k) => k.key === f.kind) : undefined;
  if (kind && !kind.match(row)) return false;
  return kind?.noValue ? true : meets(numberOf(c, row), f);
}

// e.g. "< 45 days", "10 – 30 days", "Left < 3 days", "Due today"
export function describeCondition(f: NumberCondition, unit?: string, kinds?: RegisterColumn['kinds']): string {
  const kind = f.kind ? kinds?.find((k) => k.key === f.kind) : undefined;
  if (kind?.noValue) return kind.label;
  const u = unit ? ` ${unit}` : '';
  const text = f.op === 'between' ? `${f.a} – ${f.b ?? f.a}${u}` : `${NUMBER_OPS.find((o) => o.op === f.op)!.sign} ${f.a}${u}`;
  return kind ? `${kind.label} ${text}` : text;
}

// The value a column's header filter lists for a row; columns with no text value (amounts) have no filter
const valueOf = (c: RegisterColumn, row: any): string | null => {
  const read = c.filterValue ?? c.search;
  if (!read) return null;
  const v = read(row);
  return v === null || v === undefined || String(v).trim() === '' ? '(Blanks)' : String(v);
};
const filterable = (c: RegisterColumn) => !!(c.filterValue ?? c.search);

// A cell as plain text or a number for Excel: dates and labels as shown, amounts and counts as numbers
function excelValue(c: RegisterColumn, row: any): string | number {
  const v = c.excel ? c.excel(row) : (c.filterValue?.(row) ?? c.number?.(row) ?? c.search?.(row) ?? c.sort?.(row));
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  return v;
}

/** Download rows as an Excel file: Sr. No., every column, and the total underneath. */
async function downloadExcel(config: RegisterConfig, rows: any[], total: string) {
  const XLSX = await import('xlsx');
  const header = ['Sr. No.', ...config.columns.map((c) => c.label)];
  const body = rows.map((row, i) => [i + 1, ...config.columns.map((c) => excelValue(c, row))]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body, [], [`Total: ${total}`]]);
  // Each column wide enough for its longest value
  sheet['!cols'] = header.map((h, i) => ({ wch: Math.min(60, Math.max(h.length, ...body.map((r) => String(r[i]).length)) + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, config.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  XLSX.writeFile(book, `${config.title.replace(/[\\/:*?"<>|]/g, ' ').trim()} ${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export type RegisterConfig = {
  id: string;
  title: string;
  hint: string;
  rows: any[];
  columns: RegisterColumn[];
  href: (row: any) => string;
  empty: string;
  // Summary of a set of rows, e.g. "8 leads · ₹ 1,92,00,000"; used for subtotals and the grand total
  summarize: (rows: any[]) => string;
  groupBy?: { key: string; label: string; value: (row: any) => string }[];
  dateFilter?: { label: string; value: (row: any) => string | Date | null | undefined };
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  preset?: string; // what a chart click narrowed the rows to, shown as a chip
};

export type RegisterState = {
  search: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  page: number;
  group: string;
  // Header filters: the values ticked for each column; a column not listed shows every value
  columnFilters: Record<string, string[]>;
  // Header condition filters on number columns, e.g. days outstanding < 45
  numberFilters?: Record<string, NumberCondition>;
  from: string;
  to: string;
};

export const EMPTY_REGISTER_STATE: RegisterState = { search: '', sort: null, page: 0, group: '', columnFilters: {}, numberFilters: {}, from: '', to: '' };

const PAGE_SIZE = 25;

const input =
  'rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#5598e7]/50';

export default function RegisterTable({
  config,
  state,
  onState,
  onOpen,
  heading,
  actions,
}: {
  config: RegisterConfig;
  state: RegisterState;
  onState: (next: RegisterState) => void;
  onOpen: (href: string) => void;
  heading: React.ReactNode; // title block, left of the grand total
  actions?: React.ReactNode; // buttons after Clear all filters, e.g. back to the recent view
}) {
  const set = (patch: Partial<RegisterState>) => onState({ ...state, page: 0, ...patch });
  const sort = state.sort || config.defaultSort || null;
  const group = config.groupBy?.find((g) => g.key === state.group);
  const columnFilters = state.columnFilters || {};
  const numberFilters = state.numberFilters || {};
  // The header button's edges, so the filter box opens below it, or above it when there is no room below
  const [openFilter, setOpenFilter] = useState<{ key: string; left: number; top: number; bottom: number } | null>(null);

  // Rows kept by the search, the date range and every header filter except `skip` (a header filter lists
  // the values left by the other filters, like Excel)
  const matching = useMemo(() => {
    const q = state.search.trim().toLowerCase();
    const from = state.from ? new Date(`${state.from}T00:00:00`).getTime() : null;
    const to = state.to ? new Date(`${state.to}T23:59:59`).getTime() : null;
    return (skip?: string) =>
      config.rows.filter((row) => {
        if (q && !config.columns.some((c) => String((c.search ? c.search(row) : c.sort?.(row)) ?? '').toLowerCase().includes(q))) return false;
        for (const c of config.columns) {
          const want = columnFilters[c.key];
          if (c.key !== skip && want && !want.includes(valueOf(c, row) ?? '')) return false;
          const cond = numberFilters[c.key];
          if (c.key !== skip && cond && !passes(c, row, cond)) return false;
        }
        if (config.dateFilter && (from || to)) {
          const v = config.dateFilter.value(row);
          const t = v ? new Date(v).getTime() : null;
          if (t === null || (from && t < from) || (to && t > to)) return false;
        }
        return true;
      });
  }, [config, state.search, columnFilters, numberFilters, state.from, state.to]);

  const rows = useMemo(() => {
    let list = matching();
    const col = sort && config.columns.find((c) => c.key === sort.key);
    if (col?.sort) {
      const dir = sort!.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = col.sort!(a);
        const y = col.sort!(b);
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * dir;
      });
    }
    // Grouped: keep each group together (groups A→Z), sorted as chosen inside it
    if (group) list = [...list].sort((a, b) => group.value(a).localeCompare(group.value(b), 'en-IN'));
    return list;
  }, [matching, config.columns, sort, group]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.page, pages - 1);
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  // Subtotals come from all rows of a group, not just this page
  const groupRows = useMemo(() => {
    if (!group) return new Map<string, any[]>();
    const m = new Map<string, any[]>();
    for (const r of rows) m.set(group.value(r), [...(m.get(group.value(r)) || []), r]);
    return m;
  }, [rows, group]);

  const cols = config.columns;
  const filterCol = openFilter ? cols.find((c) => c.key === openFilter.key) : undefined;
  const anyColumnFilter = Object.keys(columnFilters).length > 0 || Object.keys(numberFilters).length > 0;
  const anyFilter = !!(state.search || state.from || state.to || anyColumnFilter || state.group);
  // e.g. "9 leads · ₹ 1,93,27,157" shown as separate figures
  const totals = config.summarize(rows).split(' · ');

  return (
    <div>
      {/* Title, the grand total of the rows shown, and the actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 pt-4">
        <div className="min-w-0">{heading}</div>
        {config.rows.length > 0 && (
          <div className="flex flex-1 justify-center" aria-live="polite">
            <div className="inline-flex items-center gap-3 whitespace-nowrap rounded-xl border border-[var(--border)] bg-white/[0.04] px-3.5 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {anyFilter ? 'Filtered total' : 'Grand total'}
              </span>
              {totals.map((t, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="h-4 w-px bg-[var(--border)]" aria-hidden="true" />}
                  <span
                    className={`text-sm tabular-nums ${i === totals.length - 1 ? 'font-bold text-[var(--text-primary)]' : 'font-semibold text-[var(--text-secondary)]'}`}
                  >
                    {t}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onState({ ...EMPTY_REGISTER_STATE, sort: state.sort })}
            disabled={!anyFilter}
            className="flex items-center gap-1 rounded-lg border border-[#5598e7]/50 bg-[#2a78d6]/15 px-2 py-1 text-[11px] font-semibold text-[#9ec5f4] transition hover:bg-[#2a78d6]/30 hover:text-white disabled:border-[var(--border)] disabled:bg-transparent disabled:text-[var(--text-muted)] disabled:opacity-60"
          >
            <FilterX className="h-3 w-3" /> Clear all filters
          </button>
          <button
            type="button"
            onClick={() => downloadExcel(config, rows, config.summarize(rows))}
            disabled={rows.length === 0}
            title={anyFilter ? 'Download the filtered rows as an Excel file' : 'Download every row as an Excel file'}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/30 hover:text-white disabled:border-[var(--border)] disabled:bg-transparent disabled:text-[var(--text-muted)] disabled:opacity-60"
          >
            <Download className="h-3 w-3" /> Download Excel
          </button>
          {actions}
        </div>
      </div>

      {/* Toolbar: search, date range, grouping */}
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="search"
            value={state.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search records"
            aria-label={`Search ${config.title}`}
            className={`${input} w-56 pl-8`}
          />
        </label>
        {config.dateFilter && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            {config.dateFilter.label}
            <input type="date" value={state.from} onChange={(e) => set({ from: e.target.value })} className={input} aria-label="From date" />
            to
            <input type="date" value={state.to} onChange={(e) => set({ to: e.target.value })} className={input} aria-label="To date" />
          </span>
        )}
        {config.groupBy && (
          <select value={state.group} onChange={(e) => set({ group: e.target.value })} className={input} aria-label="Group by">
            <option value="">No grouping</option>
            {config.groupBy.map((g) => (
              <option key={g.key} value={g.key}>
                Group by {g.label}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">
          {rows.length === config.rows.length ? `${rows.length} record${rows.length === 1 ? '' : 's'}` : `${rows.length} of ${config.rows.length} records`}
        </span>
      </div>

      {config.rows.length === 0 ? (
        <p className="px-5 pb-5 text-xs text-[var(--text-muted)]">{config.empty}</p>
      ) : (
        <div className="max-h-[620px] overflow-auto" onScroll={() => setOpenFilter(null)}>
          <table className="w-full min-w-[900px] whitespace-nowrap text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--surface-1)]">
              <tr className="text-left">
                <th className="py-2.5 pl-5 pr-2.5 font-semibold">Sr. No.</th>
                {cols.map((c, i) => {
                  const active = sort?.key === c.key;
                  const filtered = !!columnFilters[c.key] || !!numberFilters[c.key];
                  return (
                    <th
                      key={c.key}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`px-2.5 py-2.5 font-semibold ${c.right ? 'text-right' : ''} ${i === cols.length - 1 ? 'pr-5' : ''}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${c.right ? 'flex-row-reverse' : ''}`}>
                        {c.sort ? (
                          <button
                            type="button"
                            onClick={() =>
                              onState({
                                ...state,
                                sort: { key: c.key, dir: active && sort!.dir === 'desc' ? 'asc' : 'desc' },
                              })
                            }
                            className={`inline-flex items-center gap-1 hover:text-white ${active ? 'text-[var(--text-primary)]' : ''} ${c.right ? 'flex-row-reverse' : ''}`}
                          >
                            {c.label}
                            {/* Only the sorted column shows an arrow; the filter button beside each header also sorts */}
                            {active && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                          </button>
                        ) : (
                          c.label
                        )}
                        {(filterable(c) || isNumeric(c)) && (
                          <button
                            type="button"
                            title={numberFilters[c.key] ? `Showing ${describeCondition(numberFilters[c.key], c.unit, c.kinds)}` : undefined}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setOpenFilter(
                                openFilter?.key === c.key
                                  ? null
                                  : {
                                      key: c.key,
                                      left: Math.min(r.left, window.innerWidth - 264),
                                      top: r.top,
                                      bottom: r.bottom,
                                    }
                              );
                            }}
                            aria-label={`Filter ${c.label}`}
                            aria-expanded={openFilter?.key === c.key}
                            className={`rounded p-0.5 transition hover:bg-white/10 hover:text-white ${filtered ? 'bg-[#5598e7]/25 text-[#86b6ef]' : 'text-[var(--text-muted)] opacity-60'}`}
                          >
                            <Filter className="h-3 w-3" fill={filtered ? 'currentColor' : 'none'} />
                          </button>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Headers stay, so a filter that matches nothing can be changed from its column */}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="px-5 py-6 text-center text-[var(--text-muted)]">
                    No records match these filters.
                  </td>
                </tr>
              )}
              {shown.map((row, i) => {
                const n = page * PAGE_SIZE + i;
                const g = group?.value(row);
                const startsGroup = group && (i === 0 || group.value(shown[i - 1]) !== g);
                const href = config.href(row);
                return (
                  <React.Fragment key={`${row.id ?? ''}-${n}`}>
                    {startsGroup && (
                      // Group heading with its subtotal, above the group's rows
                      <tr className="bg-white/[0.04]">
                        <td colSpan={cols.length + 1} className="py-2 pl-5 pr-5 text-[11px]">
                          <span className="font-bold text-[var(--text-primary)]">
                            {group!.label}: {g}
                          </span>
                          <span className="ml-2 text-[var(--text-secondary)]">Subtotal · {config.summarize(groupRows.get(g!) || [])}</span>
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => onOpen(href)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onOpen(href);
                      }}
                      tabIndex={0}
                      role="link"
                      className="cursor-pointer text-[var(--text-secondary)] focus:outline-none focus-visible:bg-white/5"
                    >
                      <td className="py-2.5 pl-5 pr-2.5 tabular-nums text-[var(--text-muted)]">{n + 1}</td>
                      {cols.map((c, ci) => (
                        <td key={c.key} className={`px-2.5 py-2.5 ${c.right ? 'text-right tabular-nums' : ''} ${ci === cols.length - 1 ? 'pr-5' : ''}`}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openFilter && filterCol && isNumeric(filterCol) && (
        <NumberFilter
          column={filterCol}
          position={openFilter}
          condition={numberFilters[filterCol.key]}
          onApply={(cond) => {
            const next = { ...numberFilters };
            if (cond) next[filterCol.key] = cond;
            else delete next[filterCol.key];
            set({ numberFilters: next });
            setOpenFilter(null);
          }}
          onSort={
            filterCol.sort
              ? (dir) => {
                  onState({ ...state, sort: { key: filterCol.key, dir } });
                  setOpenFilter(null);
                }
              : undefined
          }
          onClose={() => setOpenFilter(null)}
        />
      )}
      {openFilter && filterCol && !isNumeric(filterCol) && (
        <ColumnFilter
          column={filterCol}
          position={openFilter}
          rows={matching(filterCol.key)}
          selected={columnFilters[filterCol.key]}
          onApply={(values) => {
            const next = { ...columnFilters };
            if (values) next[filterCol.key] = values;
            else delete next[filterCol.key];
            set({ columnFilters: next });
            setOpenFilter(null);
          }}
          onSort={
            filterCol.sort
              ? (dir) => {
                  onState({ ...state, sort: { key: filterCol.key, dir } });
                  setOpenFilter(null);
                }
              : undefined
          }
          onClose={() => setOpenFilter(null)}
        />
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-5 py-3 text-xs text-[var(--text-secondary)]">
          <span>
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => onState({ ...state, page: page - 1 })}
            className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => onState({ ...state, page: page + 1 })}
            className="rounded-lg border border-[var(--border)] p-1.5 disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A column's header filter, like Excel's: sort, then tick the values to show (with a search over them).
 * Lists the values left by the other filters, each with how many rows have it. OK applies; ticking
 * every value removes the filter.
 */
function ColumnFilter({
  column,
  position,
  rows,
  selected,
  onApply,
  onSort,
  onClose,
}: {
  column: RegisterColumn;
  position: { left: number; top: number; bottom: number };
  rows: any[];
  selected?: string[];
  onApply: (values: string[] | null) => void;
  onSort?: (dir: 'asc' | 'desc') => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    // Each value with its row count and one of its rows, to order the list the way the column sorts
    const m = new Map<string, { n: number; row?: any }>();
    for (const r of rows) {
      const v = valueOf(column, r) ?? '(Blanks)';
      const seen = m.get(v);
      m.set(v, { n: (seen?.n || 0) + 1, row: seen?.row ?? r });
    }
    // A value ticked before but no longer present still shows, so it can be unticked
    for (const v of selected || []) if (!m.has(v)) m.set(v, { n: 0 });
    const key = (v: string, row?: any) => (column.sort && row ? column.sort(row) : v);
    return [...m.entries()]
      .sort(([a, x], [b, y]) => {
        if (a === '(Blanks)' || b === '(Blanks)') return a === '(Blanks)' ? 1 : -1;
        const ka = key(a, x.row);
        const kb = key(b, y.row);
        if (ka === null || ka === undefined || kb === null || kb === undefined) return ka === kb ? 0 : ka === null || ka === undefined ? 1 : -1;
        return typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'en-IN', { numeric: true });
      })
      .map(([v, { n }]) => [v, n] as const);
  }, [rows, column, selected]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(selected ?? counts.map(([v]) => v)));
  const visible = counts.filter(([v]) => v.toLowerCase().includes(query.trim().toLowerCase()));
  const allVisibleTicked = visible.length > 0 && visible.every(([v]) => ticked.has(v));

  const toggle = (v: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  function apply() {
    const values = counts.map(([v]) => v).filter((v) => ticked.has(v));
    onApply(values.length === counts.length ? null : values);
  }

  return (
    <FilterPopup column={column} position={position} onSort={onSort} onClose={onClose}>
      <label className="relative mb-1.5 block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label={`Search ${column.label} values`}
          autoFocus
          className={`${input} w-full pl-7`}
        />
      </label>
      <div className="max-h-56 overflow-auto rounded-md border border-[var(--border)] py-1">
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1 font-semibold text-[var(--text-primary)] hover:bg-white/5">
          <input
            type="checkbox"
            checked={allVisibleTicked}
            onChange={() =>
              setTicked((t) => {
                const next = new Set(t);
                for (const [v] of visible) {
                  if (allVisibleTicked) next.delete(v);
                  else next.add(v);
                }
                return next;
              })
            }
            className="accent-[#5598e7]"
          />
          (Select all)
        </label>
        {visible.map(([v, n]) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-white/5">
            <input type="checkbox" checked={ticked.has(v)} onChange={() => toggle(v)} className="accent-[#5598e7]" />
            <span className="min-w-0 flex-1 truncate">{v}</span>
            <span className="tabular-nums text-[var(--text-muted)]">{n}</span>
          </label>
        ))}
        {visible.length === 0 && <p className="px-2 py-1.5 text-[var(--text-muted)]">No matches</p>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => onApply(null)} disabled={!selected} className="font-semibold text-[#86b6ef] hover:text-white disabled:opacity-40">
          Clear filter
        </button>
        <span className="flex gap-1.5">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1 font-semibold hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={ticked.size === 0}
            className="rounded-lg bg-[#2a78d6] px-3 py-1 font-semibold text-white hover:bg-[#3b88e6] disabled:opacity-40"
          >
            OK
          </button>
        </span>
      </div>
    </FilterPopup>
  );
}

/** The header filter's floating box: sorting at the top, closed by a click outside it or Escape. */
function FilterPopup({
  column,
  position,
  onSort,
  onClose,
  children,
}: {
  column: RegisterColumn;
  position: { left: number; top: number; bottom: number };
  onSort?: (dir: 'asc' | 'desc') => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  // Opens below the header button; when the box would run past the bottom of the screen it opens above
  // the button instead, and when it is taller than the screen it fits the screen and scrolls inside
  const GAP = 4;
  const EDGE = 8;
  const [placed, setPlaced] = useState<{ top: number; maxHeight?: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      if (!el) return;
      const h = el.scrollHeight;
      const room = window.innerHeight;
      const below = room - position.bottom - GAP - EDGE;
      const above = position.top - GAP - EDGE;
      if (h <= below) setPlaced({ top: position.bottom + GAP });
      else if (h <= above) setPlaced({ top: position.top - GAP - h });
      else if (below >= above) setPlaced({ top: position.bottom + GAP, maxHeight: below });
      else setPlaced({ top: EDGE, maxHeight: above });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [position]);
  const numeric = isNumeric(column);
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Filter ${column.label}`}
      style={{
        left: position.left,
        top: placed?.top ?? position.bottom + GAP,
        maxHeight: placed?.maxHeight,
        visibility: placed ? 'visible' : 'hidden',
      }}
      className="fixed z-50 w-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 text-xs text-[var(--text-secondary)] shadow-2xl"
    >
      {onSort && (
        <div className="mb-2 space-y-0.5 border-b border-[var(--border)] pb-2">
          <button
            type="button"
            onClick={() => onSort('asc')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 hover:text-white"
          >
            <ArrowUp className="h-3.5 w-3.5" /> {numeric ? 'Sort smallest to largest' : 'Sort A to Z'}
          </button>
          <button
            type="button"
            onClick={() => onSort('desc')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 hover:text-white"
          >
            <ArrowDown className="h-3.5 w-3.5" /> {numeric ? 'Sort largest to smallest' : 'Sort Z to A'}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A number column's header filter, like Excel's Number Filters: quick "less than" buttons where the
 * column has them (e.g. days outstanding < 45), or a condition with its value(s), first picking the kind
 * of row where the column has kinds (e.g. Left, less than 3 days).
 */
function NumberFilter({
  column,
  position,
  condition,
  onApply,
  onSort,
  onClose,
}: {
  column: RegisterColumn;
  position: { left: number; top: number; bottom: number };
  condition?: NumberCondition;
  onApply: (condition: NumberCondition | null) => void;
  onSort?: (dir: 'asc' | 'desc') => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(condition?.kind ?? column.kinds?.[0]?.key ?? '');
  const [op, setOp] = useState<NumberCondition['op']>(condition?.op ?? 'lt');
  const [a, setA] = useState(condition ? String(condition.a) : '');
  const [b, setB] = useState(condition?.b !== undefined ? String(condition.b) : '');
  const noValue = !!column.kinds?.find((k) => k.key === kind)?.noValue;
  const valid = noValue || (a.trim() !== '' && Number.isFinite(Number(a)) && (op !== 'between' || (b.trim() !== '' && Number.isFinite(Number(b)))));
  const unit = column.unit ? ` ${column.unit}` : '';
  return (
    <FilterPopup column={column} position={position} onSort={onSort} onClose={onClose}>
      {column.presets && (
        <div className="mb-2 border-b border-[var(--border)] pb-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Quick filters</p>
          <div className="flex flex-wrap gap-1.5">
            {column.presets.map((n) => {
              const on = condition?.op === 'lt' && condition.a === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onApply({ op: 'lt', a: n })}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 font-semibold transition ${on ? 'border-[#5598e7] bg-[#2a78d6] text-white' : 'border-[var(--border)] hover:border-[#5598e7] hover:text-white'}`}
                >
                  &lt; {n}
                  {unit}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const k = kind ? { kind } : {};
          onApply(noValue ? { op: 'eq', a: 0, ...k } : { op, a: Number(a), ...(op === 'between' ? { b: Number(b) } : {}), ...k });
        }}
        className="space-y-1.5"
      >
        <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Show rows where {column.label} is</p>
        {column.kinds && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Which rows" className={`${input} w-full`}>
            {column.kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        )}
        {!noValue && (
          <>
            <select value={op} onChange={(e) => setOp(e.target.value as NumberCondition['op'])} aria-label="Condition" className={`${input} w-full`}>
              {NUMBER_OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <input type="number" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder="Value" aria-label="Value" autoFocus className={`${input} w-full min-w-0`} />
              {op === 'between' && (
                <>
                  <span>and</span>
                  <input type="number" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="Value" aria-label="Second value" className={`${input} w-full min-w-0`} />
                </>
              )}
              {column.unit && <span className="shrink-0 text-[var(--text-muted)]">{column.unit}</span>}
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" onClick={() => onApply(null)} disabled={!condition} className="font-semibold text-[#86b6ef] hover:text-white disabled:opacity-40">
            Clear filter
          </button>
          <span className="flex gap-1.5">
            <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1 font-semibold hover:text-white">
              Cancel
            </button>
            <button type="submit" disabled={!valid} className="rounded-lg bg-[#2a78d6] px-3 py-1 font-semibold text-white hover:bg-[#3b88e6] disabled:opacity-40">
              OK
            </button>
          </span>
        </div>
      </form>
    </FilterPopup>
  );
}
