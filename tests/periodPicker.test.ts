import { afterEach, describe, expect, it, vi } from 'vitest';
import { periodDates } from '@/lib/dashboardPeriod';

describe('dashboard period', () => {
  afterEach(() => vi.useRealTimers());

  it('works out each preset from today in India (29 Oct 2026)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T10:00:00+05:30'));
    expect(periodDates({ preset: 'all' })).toBeNull();
    expect(periodDates({ preset: 'thisMonth' })).toEqual({ from: '2026-10-01', to: '2026-10-29' });
    expect(periodDates({ preset: 'lastMonth' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodDates({ preset: 'thisQuarter' })).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodDates({ preset: 'thisHalf' })).toEqual({ from: '2026-10-01', to: '2027-03-31' });
    expect(periodDates({ preset: 'thisFY' })).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(periodDates({ preset: 'lastFY' })).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('uses custom dates only when both are set and in order', () => {
    expect(periodDates({ preset: 'custom', from: '2026-04-01', to: '2026-09-30' })).toEqual({ from: '2026-04-01', to: '2026-09-30' });
    expect(periodDates({ preset: 'custom', from: '2026-10-01' })).toBeNull();
    expect(periodDates({ preset: 'custom', from: '2026-10-01', to: '2026-09-01' })).toBeNull();
  });
});
