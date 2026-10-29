'use client';

import React from 'react';
import { formatINR } from '@/lib/utils';
import { amountInWords } from '@/lib/quotation';
import { calculateDeductions, DEDUCTION_BASE_OPTIONS, DeductionRules, deductionPercentError } from '@/lib/deductions';

export interface DeductionValues {
  tdsEnabled: boolean;
  tdsPercent: string;
  retentionEnabled: boolean;
  retentionPercent: string;
  retentionDueDate: string; // yyyy-mm-dd; when the withheld retention is to be paid
}

interface DeductionFieldsProps {
  values: DeductionValues;
  onChange: (values: DeductionValues) => void;
  netValue: number; // before GST
  gstValue: number;
  rules: DeductionRules;
}

const baseLabel = (b: string) => DEDUCTION_BASE_OPTIONS.find((o) => o.value === b)?.label.toLowerCase() || '';

/** Problems with the TDS / retention entered, or null when they can be saved. */
export function deductionValuesError(v: DeductionValues, totals: { expectedPayment: number }): string | null {
  return (
    deductionPercentError('TDS', v.tdsEnabled, v.tdsPercent) ||
    deductionPercentError('Retention', v.retentionEnabled, v.retentionPercent) ||
    (v.retentionEnabled && !v.retentionDueDate ? 'Select the date the retention amount is to be received' : null) ||
    (totals.expectedPayment <= 0 ? 'TDS and retention together cannot be the whole order value or more' : null)
  );
}

/**
 * Apply TDS / Apply Retention toggles with their percentages, and the payment expected after them,
 * recalculated as the user types.
 */
export default function DeductionFields({ values, onChange, netValue, gstValue, rules }: DeductionFieldsProps) {
  const totals = calculateDeductions({
    netValue,
    gstValue,
    tdsEnabled: values.tdsEnabled,
    tdsPercent: parseFloat(values.tdsPercent) || 0,
    retentionEnabled: values.retentionEnabled,
    retentionPercent: parseFloat(values.retentionPercent) || 0,
    rules,
  });
  const set = (patch: Partial<DeductionValues>) => onChange({ ...values, ...patch });
  const percentInput = (value: string, field: 'tdsPercent' | 'retentionPercent') => (
    <div className="flex items-stretch">
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => set({ [field]: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) } as Partial<DeductionValues>)}
        className="w-16 border border-slate-300 rounded-l-lg px-2 py-1 text-right"
        autoFocus
      />
      <span className="px-2 py-1 rounded-r-lg bg-slate-100 border border-l-0 border-slate-300 font-semibold text-slate-600">%</span>
    </div>
  );

  const row = (label: string, value: string, className = 'text-slate-700') => (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${className}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-slate-200 bg-white space-y-2">
          <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={values.tdsEnabled}
              onChange={(e) => set({ tdsEnabled: e.target.checked })}
              className="h-4 w-4 accent-sky-600"
            />
            Apply TDS
          </label>
          {values.tdsEnabled && (
            <div className="flex items-center gap-2">
              {percentInput(values.tdsPercent, 'tdsPercent')}
              <span className="text-[11px] text-slate-500">on {baseLabel(rules.tdsBase)}</span>
            </div>
          )}
        </div>
        <div className="p-3 rounded-lg border border-slate-200 bg-white space-y-2">
          <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={values.retentionEnabled}
              onChange={(e) => set({ retentionEnabled: e.target.checked })}
              className="h-4 w-4 accent-sky-600"
            />
            Apply Retention
          </label>
          {values.retentionEnabled && (
            <>
              <div className="flex items-center gap-2">
                {percentInput(values.retentionPercent, 'retentionPercent')}
                <span className="text-[11px] text-slate-500">on {baseLabel(rules.retentionBase)}</span>
              </div>
              <label className="block">
                <span className="block font-semibold text-slate-700 mb-1">Retention due on *</span>
                <input
                  type="date"
                  value={values.retentionDueDate}
                  onChange={(e) => set({ retentionDueDate: e.target.value })}
                  className="border border-slate-300 rounded-lg px-2 py-1"
                  required
                />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
        {totals.gstValue > 0 && row('Order value (before GST)', formatINR(totals.netValue))}
        {totals.gstValue > 0 && row('GST', formatINR(totals.gstValue))}
        {row('Order total', formatINR(totals.total), 'text-slate-900')}
        {row(
          `TDS deduction${values.tdsEnabled ? ` (${totals.tdsPercent}%)` : ''}`,
          `− ${formatINR(totals.tdsAmount)}`,
          'text-rose-700'
        )}
        {row(
          `Retention${values.retentionEnabled ? ` (${totals.retentionPercent}%)` : ''}`,
          `− ${formatINR(totals.retentionAmount)}`,
          'text-amber-700'
        )}
        <div className="pt-1.5 mt-1 border-t border-slate-200">
          {row('Expected payment', formatINR(totals.expectedPayment), 'text-emerald-700 text-sm')}
          <p className="text-right text-[11px] text-slate-500 italic">{amountInWords(Math.max(totals.expectedPayment, 0))}</p>
        </div>
      </div>
    </div>
  );
}
