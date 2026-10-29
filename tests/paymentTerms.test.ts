import { describe, expect, it } from 'vitest';
import { formatPaymentStages, isFixedPayment, parsePaymentStages } from '@/lib/quotation';
import {
  FULL_PAYMENT_STEP,
  hasFixedPayment,
  invoiceGstStageId,
  paymentStageDueDate,
  paymentStepName,
  raisingStep,
  stageTriggerStep,
} from '@/lib/executionSteps';

describe('Payment terms: stages or fixed', () => {
  it('keeps stages that add up to 100%', () => {
    const r = parsePaymentStages([
      { percent: 10, description: 'Advance' },
      { percent: 90, description: 'Before Dispatch' },
    ]);
    expect('stages' in r && formatPaymentStages(r.stages)).toBe('10% Advance, 90% Before Dispatch');
  });

  it('saves fixed terms as one full payment after the credit days', () => {
    const r = parsePaymentStages([{ percent: 100, description: '', creditDays: 30 }]);
    if (!('stages' in r)) throw new Error(r.error);
    expect(r.stages).toEqual([{ percent: 100, description: 'Full payment after 30 days', creditDays: 30 }]);
    expect(formatPaymentStages(r.stages)).toBe('Full payment after 30 days');
    expect(isFixedPayment(r.stages)).toBe(true);
    expect(hasFixedPayment(r.stages)).toBe(true);
  });

  it('rejects fixed terms without valid days', () => {
    expect(parsePaymentStages([{ creditDays: 0 }])).toHaveProperty('error');
    expect(parsePaymentStages([{ creditDays: 400 }])).toHaveProperty('error');
  });
});

describe('Execution raises payments by their terms', () => {
  const step = (name: string, completedDate: string | null) => ({
    name,
    status: completedDate ? 'DONE' : 'PENDING',
    completedDate,
  });
  const upToDelivery = ['Receipt of PO', 'Negotiate with Vendor', 'Issue PO to Vendor', 'Dispatch', 'Delivery'].map((n) =>
    step(n, '2026-11-01')
  );
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  it('raises a stage on the day its step is done (older orders with standard steps)', () => {
    const delivery = { percent: 30, description: 'Upon Delivery' };
    expect(day(paymentStageDueDate(delivery, upToDelivery))).toBe('2026-11-01');
    expect(paymentStageDueDate(delivery, [step('Receipt of PO', '2026-11-01'), step('Delivery', null)])).toBeNull();
  });

  it('gives each payment stage its own Execution row that raises it from the saved date', () => {
    const advance = { percent: 10, description: 'Advance' };
    expect(paymentStepName(advance)).toBe('10% Advance');
    const rows = [step('10% Advance', '2026-10-26'), step('20% Before Dispatch', null)];
    expect(raisingStep(advance, rows.map((r) => r.name))).toBe('10% Advance');
    expect(day(paymentStageDueDate(advance, rows))).toBe('2026-10-26');
    expect(paymentStageDueDate({ percent: 20, description: 'Before Dispatch' }, rows)).toBeNull();
    // A custom stage gets a row too, so it is no longer raised by hand
    expect(raisingStep({ percent: 70, description: 'Against site handover' }, ['70% Against site handover'])).toBe(
      '70% Against site handover'
    );
  });

  it('raises fixed terms the credit days after Delivery & Invoice Raised', () => {
    const fixed = { percent: 100, description: 'Full payment after 30 days' };
    expect(paymentStepName(fixed)).toBe(FULL_PAYMENT_STEP);
    expect(stageTriggerStep(fixed.description)).toBe(FULL_PAYMENT_STEP);
    // Not due until the Delivery & Invoice Raised date is saved, whatever else is done
    expect(paymentStageDueDate(fixed, [...upToDelivery, step(FULL_PAYMENT_STEP, null)])).toBeNull();
    // 26 Oct 2026 + 30 days
    expect(day(paymentStageDueDate(fixed, [step(FULL_PAYMENT_STEP, '2026-10-26')]))).toBe('2026-11-25');
  });

  it('asks the invoice GST with the payment whose row has the invoice', () => {
    const stages = [
      { id: 'a', sequence: 1, percent: 10, description: 'Advance' },
      { id: 'b', sequence: 2, percent: 90, description: 'Before Dispatch' },
    ];
    expect(invoiceGstStageId(stages, '90% Before Dispatch')).toBe('b');
    expect(invoiceGstStageId(stages, '10% Advance')).toBe('a');
  });
});
