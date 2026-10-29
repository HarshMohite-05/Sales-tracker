import { describe, expect, it } from 'vitest';
import { deliveredOn, deliveryStatus, deliveryStep, originalTarget } from '@/lib/deliveryTracking';

// Noon India time on 1 Nov 2026
const NOW = new Date('2026-11-01T06:30:00Z');
const step = (sequence: number, name: string, status = 'PENDING', completedDate: string | null = null) => ({ sequence, name, status, completedDate });
const order = (deliveryDate: string | null, executionSteps: any[], extra: any = {}) => ({ deliveryDate, orderStatus: 'IN_EXECUTION', executionSteps, ...extra });

describe('target delivery against Execution', () => {
  it('takes the last stage of Execution as delivery, leaving out stages not needed', () => {
    const steps = [step(1, '10% Advance'), step(2, '60% Before Dispatch'), step(3, '30% On Commissioning')];
    expect(deliveryStep(steps)?.name).toBe('30% On Commissioning');
    expect(deliveryStep([step(1, 'Receipt of PO'), step(2, 'Delivery'), step(3, 'Installation'), step(4, 'Commissioning', 'NOT_APPLICABLE')])?.name).toBe('Installation');
  });

  it('is delivered only once the last stage is done, on the date saved there', () => {
    expect(deliveredOn([step(1, '10% Advance', 'DONE', '2026-10-01'), step(2, '90% Upon Delivery', 'DONE', '2026-10-20')])).toEqual(new Date('2026-10-20'));
    // Delivery done but installation still to come: not delivered yet
    expect(deliveredOn([step(1, 'Delivery', 'DONE', '2026-10-20'), step(2, 'Installation')])).toBeNull();
    expect(deliveredOn([step(1, 'Delivery', 'DONE', '2026-10-20'), step(2, 'Installation', 'DONE', '2026-10-28')])).toEqual(new Date('2026-10-28'));
    expect(deliveredOn([])).toBeNull();
  });

  it('buckets open orders by days to the target', () => {
    const steps = [step(1, '10% Advance', 'DONE', '2026-10-01'), step(2, '60% Before Dispatch', 'DONE', '2026-10-15'), step(3, '30% Upon Delivery')];
    expect(deliveryStatus(order('2026-10-30', steps), NOW)).toMatchObject({ bucket: 'OVERDUE', daysLeft: -2, currentStep: '30% Upon Delivery' });
    expect(deliveryStatus(order('2026-11-10', steps), NOW)).toMatchObject({ bucket: 'DUE_SOON', daysLeft: 9, atRisk: false });
    expect(deliveryStatus(order('2026-12-31', steps), NOW)).toMatchObject({ bucket: 'ON_TRACK' });
    expect(deliveryStatus(order(null, steps), NOW)).toMatchObject({ bucket: 'NO_TARGET', daysLeft: null });
  });

  it('flags due-soon orders not dispatched yet as at risk', () => {
    const onlyAdvance = [step(1, '10% Advance', 'DONE', '2026-10-01'), step(2, '60% Before Dispatch'), step(3, '30% Upon Delivery')];
    expect(deliveryStatus(order('2026-11-14', onlyAdvance), NOW).atRisk).toBe(true);
    const working = [step(1, '10% Advance', 'DONE', '2026-10-01'), step(2, 'Issue PO to Vendor', 'DONE', '2026-10-05'), step(3, '90% Before Dispatch')];
    expect(deliveryStatus(order('2026-11-14', working), NOW).atRisk).toBe(false);
    expect(deliveryStatus(order('2026-11-05', working), NOW).atRisk).toBe(true);
  });

  it('judges delivered orders against the current target and the original one', () => {
    const steps = [step(1, '10% Advance', 'DONE', '2026-10-01'), step(2, '90% Upon Delivery', 'DONE', '2026-10-24')];
    const revisions = [{ previousDate: '2026-10-10', newDate: '2026-10-25', createdAt: '2026-10-05' }];
    expect(originalTarget('2026-10-25', revisions)).toEqual(new Date('2026-10-10'));
    expect(deliveryStatus(order('2026-10-25', steps, { deliveryRevisions: revisions }), NOW)).toMatchObject({
      bucket: 'ON_TIME',
      daysLeft: 1,
      revisions: 1,
      daysLateVsOriginal: 14,
    });
    expect(deliveryStatus(order('2026-10-20', steps), NOW)).toMatchObject({ bucket: 'LATE', daysLeft: -4, daysLateVsOriginal: 4 });
  });
});
