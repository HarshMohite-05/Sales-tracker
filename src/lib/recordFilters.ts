import { reconcileOrder } from './deductions';

export type FilterKind = 'text' | 'number' | 'date' | 'boolean';
export type FilterOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'empty' | 'not_empty';
export interface FilterRule { id: string; field: string; kind: FilterKind; operator: FilterOperator; value: string; to: string }
export interface RecordFilters { mode: 'all' | 'any'; rules: FilterRule[] }
export interface FilterField { key: string; label: string; kind: FilterKind; options?: string[] }
export const EMPTY_FILTERS: RecordFilters = { mode: 'all', rules: [] };
export function presetFilters(field: string, kind: FilterKind, operator: FilterOperator, value: string): RecordFilters {
  return value ? { mode: 'all', rules: [{ id: `preset-${field}`, field, kind, operator, value, to: '' }] } : EMPTY_FILTERS;
}
export const FILTER_OPERATORS: Record<FilterKind, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'does not contain' },
    { value: 'equals', label: 'is' }, { value: 'not_equals', label: 'is not' },
    { value: 'starts_with', label: 'starts with' }, { value: 'ends_with', label: 'ends with' },
    { value: 'empty', label: 'is empty' }, { value: 'not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'equals', label: '=' }, { value: 'not_equals', label: '≠' },
    { value: 'gt', label: 'greater than' }, { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' }, { value: 'lte', label: 'at most' },
    { value: 'between', label: 'between' }, { value: 'empty', label: 'is empty' }, { value: 'not_empty', label: 'is not empty' },
  ],
  date: [
    { value: 'equals', label: 'on' }, { value: 'not_equals', label: 'not on' },
    { value: 'gt', label: 'after' }, { value: 'gte', label: 'on or after' },
    { value: 'lt', label: 'before' }, { value: 'lte', label: 'on or before' },
    { value: 'between', label: 'between' }, { value: 'empty', label: 'is empty' }, { value: 'not_empty', label: 'is not empty' },
  ],
  boolean: [{ value: 'equals', label: 'is' }, { value: 'not_equals', label: 'is not' }, { value: 'empty', label: 'is empty' }, { value: 'not_empty', label: 'is not empty' }],
};

const hiddenKey = (key: string) => /(^id$|Id$|Ids$|^__|^isCompleted$)/.test(key) || /(password|secret|token|snapshot|payload|probability)/i.test(key);
const LABELS: Record<string, string> = {
  __all: 'Any field', _count: 'Counts', assignedTo: 'Requirement salesperson', assignedSalesperson: 'Assigned salesperson',
  enquiry: 'Requirement', enquiries: 'Requirements', enquiryNumber: 'Requirement number', estimatedValue: 'Requirement value', approxValue: 'Approximate value',
  netValue: 'Value before GST', grossValue: 'Value including GST', tds: 'TDS', gst: 'GST',
  gstNumber: 'GSTIN', clientPoNumber: 'Client PO number', poDate: 'PO date', dueNow: 'Due now',
  recordType: 'Record type', paymentStatus: 'Payment status', outstanding: 'Outstanding payment',
  createdAt: 'Created on', updatedAt: 'Updated on', isException: 'Exception', isReversed: 'Reversed',
  followUpTiming: 'Follow-up timing',
};

export function filterFieldLabel(key: string): string {
  return LABELS[key] || key.split('.').map((part) => LABELS[part] || part.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase()).replace(/\b(Gst|Tds|Po)\b/g, (word) => word.toUpperCase())).join(' · ');
}

/** Only scalar business fields are available; internal identifiers and credentials are excluded. */
export function flattenFilterRecord(record: unknown): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = Object.create(null);
  function visit(value: unknown, path: string, depth: number) {
    if (depth > 4) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, path, depth); return; }
    if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
      if (path) (result[path] ||= []).push(value.toNumber());
      return;
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      for (const [key, child] of Object.entries(value)) {
        if (!hiddenKey(key)) visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
      return;
    }
    if (path) (result[path] ||= []).push(value);
  }
  visit(record, '', 0);
  return result;
}

/** Adds common business labels and receipt-based balances without altering stored records. */
export function filterRecord(record: any): any {
  const result = {
    ...record,
    ...(record.client?.name ? { clientName: record.client.name } : {}),
    ...((record.assignedSalesperson?.name || record.assignedTo?.name || record.salesperson?.name) ? { salesperson: record.assignedSalesperson?.name || record.assignedTo?.name || record.salesperson.name } : {}),
  };
  if (Array.isArray(record.payments) && Array.isArray(record.receipts)) {
    const payment = reconcileOrder(record.payments, record.receipts);
    Object.assign(result, { received: payment.received, outstanding: payment.outstanding, dueNow: payment.dueNow, paymentStatus: payment.status });
  }
  if (record.taskNumber && record.dueDateTime) {
    const due = new Date(record.dueDateTime).getTime();
    result.followUpTiming = record.status !== 'PENDING' ? record.status : due < Date.now() ? 'OVERDUE' : dateValue(record.dueDateTime) === dateValue(new Date()) ? 'TODAY' : 'UPCOMING';
  }
  return result;
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(String(value).replace(/[₹,%\s]/g, ''));
}

function dateValue(value: unknown): string {
  const text = String(value ?? '');
  // Reports display dates as DD/MM/YYYY; date-only input values already use YYYY-MM-DD.
  const reportDate = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (reportDate) return `${reportDate[3]}-${reportDate[2]}-${reportDate[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = value instanceof Date ? value : new Date(text);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

const normalized = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

export function isActiveRule(rule: FilterRule): boolean {
  if (rule.operator === 'empty' || rule.operator === 'not_empty') return true;
  if (!rule.value.trim() || (rule.operator === 'between' && !rule.to.trim())) return false;
  if (rule.kind === 'number') return Number.isFinite(numberValue(rule.value)) && (rule.operator !== 'between' || Number.isFinite(numberValue(rule.to)));
  if (rule.kind === 'date') return !!dateValue(rule.value) && (rule.operator !== 'between' || !!dateValue(rule.to));
  return true;
}

export function matchesFilters(record: unknown, filters: RecordFilters): boolean {
  const rules = filters.rules.filter(isActiveRule);
  if (!rules.length) return true;
  const flat = flattenFilterRecord(record);
  const matches = (rule: FilterRule) => {
    const values = (rule.field === '__all' ? Object.values(flat).flat() : flat[rule.field] || []).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (rule.operator === 'empty') return values.length === 0;
    if (rule.operator === 'not_empty') return values.length > 0;
    // Missing values do not satisfy negative comparisons; use "is empty" explicitly.
    if (!values.length) return false;
    const negative = rule.operator === 'not_equals' || rule.operator === 'not_contains';
    const test = (value: unknown) => {
      const a = rule.kind === 'number' ? numberValue(value) : rule.kind === 'date' ? dateValue(value) : normalized(value);
      const b = rule.kind === 'number' ? numberValue(rule.value) : rule.kind === 'date' ? dateValue(rule.value) : normalized(rule.value);
      const end = rule.kind === 'number' ? numberValue(rule.to) : rule.kind === 'date' ? dateValue(rule.to) : normalized(rule.to);
      if ((rule.kind === 'number' && !Number.isFinite(a)) || (rule.kind === 'date' && !a)) return false;
      switch (rule.operator) {
        case 'contains': case 'not_contains': return String(a).includes(String(b));
        case 'equals': case 'not_equals': return a === b;
        case 'starts_with': return String(a).startsWith(String(b));
        case 'ends_with': return String(a).endsWith(String(b));
        case 'gt': return a > b;
        case 'gte': return a >= b;
        case 'lt': return a < b;
        case 'lte': return a <= b;
        case 'between': return a >= b && a <= end;
        default: return false;
      }
    };
    return negative ? values.every((v) => !test(v)) : values.some(test);
  };
  return filters.mode === 'any' ? rules.some(matches) : rules.every(matches);
}

export function inferFilterFields(records: unknown[]): FilterField[] {
  const all: Record<string, unknown[]> = Object.create(null);
  for (const record of records) for (const [key, values] of Object.entries(flattenFilterRecord(record))) (all[key] ||= []).push(...values);
  return [{ key: '__all', label: 'Any field', kind: 'text' }, ...Object.entries(all).map(([key, values]): FilterField => {
    const present = values.filter((v) => v !== null && v !== undefined && v !== '');
    const isDate = /(?:date|At$)/i.test(key) && present.length > 0 && present.every((v) => dateValue(v));
    const isNumber = present.length > 0 && !/(?:phone|mobile|code|number|reference|postal|email|gstNumber)/i.test(key)
      && present.every((v) => typeof v !== 'boolean' && Number.isFinite(numberValue(v)));
    const kind: FilterKind = isDate ? 'date' : present.length > 0 && present.every((v) => typeof v === 'boolean') ? 'boolean' : isNumber ? 'number' : 'text';
    return { key, label: filterFieldLabel(key), kind, options: kind === 'text' ? [...new Set(present.map(String))].sort().slice(0, 100) : undefined };
  }).sort((a, b) => a.label.localeCompare(b.label))];
}

/** Untrusted URL filters are data only, never database field paths or executable predicates. */
export function parseRecordFilters(raw: string | null): RecordFilters {
  if (!raw) return EMPTY_FILTERS;
  if (raw.length > 20000) throw new Error('Too many filters. Remove a few conditions and try again.');
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('The filter settings are invalid. Clear the filters and try again.'); }
  if (!value || !['all', 'any'].includes(value.mode) || !Array.isArray(value.rules) || value.rules.length > 20) throw new Error('Use up to 20 filter conditions.');
  for (const rule of value.rules) {
    if (!rule || typeof rule.field !== 'string' || rule.field.length > 200 || typeof rule.id !== 'string'
      || !Object.hasOwn(FILTER_OPERATORS, rule.kind) || !FILTER_OPERATORS[rule.kind as FilterKind].some((op) => op.value === rule.operator)
      || typeof rule.value !== 'string' || typeof rule.to !== 'string' || rule.value.length > 1000 || rule.to.length > 1000) throw new Error('The filter settings are invalid. Clear the filters and try again.');
  }
  return value;
}
