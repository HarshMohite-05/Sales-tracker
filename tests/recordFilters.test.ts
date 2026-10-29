import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { EMPTY_FILTERS, FilterRule, RecordFilters, filterRecord, inferFilterFields, matchesFilters, parseRecordFilters, presetFilters } from '@/lib/recordFilters';

function rule(change: Partial<FilterRule> = {}): FilterRule {
  return { id: 'filter-1', field: '__all', kind: 'text', operator: 'contains', value: 'water', to: '', ...change };
}
const filters = (...rules: FilterRule[]): RecordFilters => ({ mode: 'all', rules });

describe('CRM record filtering', () => {
  it('matches Neer across any business detail with one search and clears back to all records', () => {
    const search = presetFilters('__all', 'text', 'contains', 'Neer');
    for (const record of [{ name: 'NEER GREEN' }, { contact: { name: 'Neeraj' } }, { notes: 'Discuss with Neer tomorrow' }]) {
      expect(matchesFilters(record, search)).toBe(true);
    }
    expect(matchesFilters({ name: 'Other company' }, search)).toBe(false);
    expect(matchesFilters({ name: 'Other company' }, presetFilters('__all', 'text', 'contains', ''))).toBe(true);
  });
  it('searches nested fields and arrays without exposing internal identifiers or credentials', () => {
    const record = { name: 'Water Systems', contacts: [{ name: 'Amit' }], id: 'private-id', passwordHash: 'private-password' };
    expect(matchesFilters(record, filters(rule({ value: 'AMIT' })))).toBe(true);
    expect(matchesFilters(record, filters(rule({ value: 'private' })))).toBe(false);
    expect(inferFilterFields([record]).map((field) => field.key)).toContain('contacts.name');
  });

  it('combines all conditions or any condition', () => {
    const record = { clientName: 'Water Systems', city: 'Pune' };
    const conditions = [rule({ field: 'clientName' }), rule({ id: 'filter-2', field: 'city', value: 'Mumbai' })];
    expect(matchesFilters(record, { mode: 'all', rules: conditions })).toBe(false);
    expect(matchesFilters(record, { mode: 'any', rules: conditions })).toBe(true);
  });

  it('ignores unfinished conditions in both matching modes', () => {
    const conditions = [rule({ value: '' }), rule({ field: 'amount', kind: 'number', operator: 'between', value: '10', to: '' })];
    expect(matchesFilters({}, filters(...conditions))).toBe(true);
    expect(matchesFilters({}, { mode: 'any', rules: conditions })).toBe(true);
    expect(matchesFilters({}, EMPTY_FILTERS)).toBe(true);
  });

  it.each([
    ['equals', '1000', '', true], ['not_equals', '1000', '', false],
    ['gt', '1000', '', false], ['gte', '1000', '', true],
    ['lt', '1001', '', true], ['lte', '1000', '', true],
    ['between', '999', '1000', true], ['between', '1001', '2000', false],
  ] as const)('compares money with %s and inclusive range endpoints', (operator, value, to, expected) => {
    expect(matchesFilters({ amount: '₹ 1,000' }, filters(rule({ field: 'amount', kind: 'number', operator, value, to })))).toBe(expected);
  });

  it('handles zero and false as present values', () => {
    expect(matchesFilters({ amount: 0 }, filters(rule({ field: 'amount', kind: 'number', operator: 'equals', value: '0' })))).toBe(true);
    expect(matchesFilters({ isActive: false }, filters(rule({ field: 'isActive', kind: 'boolean', operator: 'equals', value: 'false' })))).toBe(true);
    expect(matchesFilters({ amount: 0 }, filters(rule({ field: 'amount', operator: 'empty' })))).toBe(false);
  });

  it('matches whole calendar dates in India, including report dates', () => {
    const condition = filters(rule({ field: 'date', kind: 'date', operator: 'equals', value: '2026-10-23' }));
    expect(matchesFilters({ date: '2026-10-22T19:00:00.000Z' }, condition)).toBe(true);
    expect(matchesFilters({ date: '23/10/2026' }, condition)).toBe(true);
    expect(matchesFilters({ date: '2026-10-22T18:00:00.000Z' }, condition)).toBe(false);
    expect(matchesFilters({ date: '2026-10-23T18:29:59.000Z' }, filters(rule({ field: 'date', kind: 'date', operator: 'between', value: '2026-10-23', to: '2026-10-23' })))).toBe(true);
  });

  it('requires every member to satisfy a negative array condition', () => {
    const record = { enquiries: [{ stage: 'WON' }, { stage: 'NEW' }] };
    expect(matchesFilters(record, filters(rule({ field: 'enquiries.stage', operator: 'not_equals', value: 'won' })))).toBe(false);
    expect(matchesFilters(record, filters(rule({ field: 'enquiries.stage', operator: 'not_equals', value: 'lost' })))).toBe(true);
  });

  it('keeps missing values separate from negative comparisons', () => {
    expect(matchesFilters({}, filters(rule({ field: 'city', operator: 'not_equals', value: 'Mumbai' })))).toBe(false);
    expect(matchesFilters({}, filters(rule({ field: 'city', operator: 'empty' })))).toBe(true);
    expect(matchesFilters({ city: null }, filters(rule({ field: 'city', operator: 'not_empty' })))).toBe(false);
  });

  it('infers business field types and handles Prisma money without numeric internals', () => {
    const fields = inferFilterFields([{ grossValue: new Prisma.Decimal('1250.50'), mobile: '9372946315', clientPoNumber: '001', createdAt: '2026-10-23T00:00:00Z', isPaid: true, probability: 30 }]);
    expect(fields.find((field) => field.key === 'grossValue')?.kind).toBe('number');
    expect(fields.find((field) => field.key === 'mobile')?.kind).toBe('text');
    expect(fields.find((field) => field.key === 'clientPoNumber')?.kind).toBe('text');
    expect(fields.find((field) => field.key === 'createdAt')?.kind).toBe('date');
    expect(fields.find((field) => field.key === 'isPaid')?.kind).toBe('boolean');
    expect(fields.some((field) => field.key === 'probability')).toBe(false);
    expect(matchesFilters({ grossValue: new Prisma.Decimal('1250.50') }, filters(rule({ field: 'grossValue', kind: 'number', operator: 'equals', value: '1250.50' })))).toBe(true);
  });

  it('filters orders using actual receipts, GST, and deductions, ignoring reversed receipts', () => {
    const record = filterRecord({
      payments: [{ id: 'stage-1', amount: 1000, expectedAmount: 970, gstAmount: 180, dueDate: '2026-10-23' }],
      receipts: [{ paymentStageId: 'stage-1', amount: 500 }, { paymentStageId: 'stage-1', amount: 650, isReversed: true }],
    });
    expect(record).toMatchObject({ received: 500, outstanding: 650, dueNow: 650, paymentStatus: 'PARTIALLY_PAID' });
    expect(matchesFilters(record, filters(rule({ field: 'paymentStatus', operator: 'equals', value: 'partially paid' })))).toBe(true);
  });

  it('rejects malformed URL filters and unsupported operators', () => {
    expect(parseRecordFilters(JSON.stringify(filters(rule())))).toEqual(filters(rule()));
    expect(() => parseRecordFilters('{broken')).toThrow();
    expect(() => parseRecordFilters(JSON.stringify(filters(rule({ operator: 'execute' as any }))))).toThrow();
    expect(() => parseRecordFilters(JSON.stringify({ mode: 'all', rules: Array(21).fill(rule()) }))).toThrow();
    expect(() => parseRecordFilters(JSON.stringify(filters({ ...rule(), kind: '__proto__' as any })))).toThrow();
  });
});
