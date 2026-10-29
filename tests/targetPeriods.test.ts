import { describe, expect, it } from 'vitest';
import { currentPeriodKey, customPeriodKey, periodLabel, periodOptions, periodRange } from '@/lib/targetPeriods';

describe('target periods in an Indian financial year', () => {
  it('covers a month, quarter, six months and the whole year', () => {
    expect(periodRange('FY 2026-27', 'MONTHLY', 'M02')).toEqual({ start: new Date('2027-02-01T00:00:00Z'), end: new Date('2027-02-28T23:59:59Z') });
    expect(periodRange('FY 2026-27', 'QUARTERLY', 'Q3')).toEqual({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-12-31T23:59:59Z') });
    expect(periodRange('FY 2026-27', 'HALF_YEARLY', 'H2')).toEqual({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-03-31T23:59:59Z') });
    expect(periodRange('FY 2026-27', 'YEARLY', 'FY')).toEqual({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2027-03-31T23:59:59Z') });
  });

  it('rejects a key from another period type', () => {
    expect(periodRange('FY 2026-27', 'MONTHLY', 'Q1')).toBeNull();
    expect(periodRange('FY 2026-27', 'HALF_YEARLY', 'H3')).toBeNull();
  });

  it('labels and lists periods in financial-year order', () => {
    expect(periodLabel('FY 2026-27', 'HALF_YEARLY', 'H1')).toBe('H1 (Apr–Sep)');
    expect(periodOptions('FY 2026-27', 'MONTHLY').map((o) => o.label).slice(8)).toEqual(['Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027']);
    expect(currentPeriodKey('HALF_YEARLY', new Date('2027-01-15T00:00:00Z'))).toBe('H2');
    expect(currentPeriodKey('QUARTERLY', new Date('2027-01-15T00:00:00Z'))).toBe('Q4');
  });
});

describe('custom target periods', () => {
  it('runs from the start of the first day to the end of the last', () => {
    const key = customPeriodKey('2026-04-15', '2026-10-14');
    expect(key).toBe('C20260415-20261014');
    expect(periodRange('', 'CUSTOM', key!)).toEqual({ start: new Date('2026-04-15T00:00:00Z'), end: new Date('2026-10-14T23:59:59Z') });
    expect(periodLabel('FY 2026-27', 'CUSTOM', key!)).toBe('15 Apr 2026 – 14 Oct 2026');
  });

  it('rejects reversed or impossible dates', () => {
    expect(customPeriodKey('2026-10-01', '2026-09-30')).toBeNull();
    expect(customPeriodKey('2026-02-31', '2026-03-31')).toBeNull();
  });
});
