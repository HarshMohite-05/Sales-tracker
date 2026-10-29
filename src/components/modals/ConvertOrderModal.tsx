'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';
import { amountInWords, formatQuotationNumber, transportationLabel, versionTerms } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import { formatINR } from '@/lib/utils';
import { calculateDeductions, DEFAULT_DEDUCTION_RULES, DeductionRules } from '@/lib/deductions';
import DeductionFields, { DeductionValues, deductionValuesError } from '@/components/orders/DeductionFields';

interface ConvertOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // The quotation to confirm, with its versions; its requirement is taken from `enquiry` or quotation.enquiry
  quotation: any;
  enquiry?: any;
  clientName?: string;
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * Confirm an order from a requirement's quotation: first a yes/no check, then the order form
 * with everything as quoted and the client's PO number and dates to fill in.
 */
export default function ConvertOrderModal({ isOpen, onClose, onSuccess, quotation, enquiry, clientName }: ConvertOrderModalProps) {
  const [step, setStep] = useState<'confirm' | 'details'>('confirm');
  const [clientPoNumber, setClientPoNumber] = useState('');
  const [poDate, setPoDate] = useState(today());
  const [deliveryDate, setDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [remarks, setRemarks] = useState('');
  // Usual terms: 2% TDS and 1% retention, held for a year from the PO; all editable on the order
  const [deductions, setDeductions] = useState<DeductionValues>(() => {
    const due = new Date();
    due.setFullYear(due.getFullYear() + 1);
    return {
      tdsEnabled: true,
      tdsPercent: '2',
      retentionEnabled: true,
      retentionPercent: '1',
      retentionDueDate: due.toISOString().split('T')[0],
    };
  });
  // Company rules for what TDS and retention are calculated on
  const [rules, setRules] = useState<DeductionRules>(DEFAULT_DEDUCTION_RULES);

  useEffect(() => {
    fetch('/api/settings/payment-rules')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.rules && setRules(data.rules))
      .catch(() => {});
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const requirement = enquiry || quotation.enquiry || {};
  const versions: any[] = quotation.versions || [];
  const current = versions.find((v) => v.versionNumber === quotation.currentVersionNumber) || quotation;
  const terms = versionTerms(current);
  const price = Number(current.originalValue) - Number(current.discountAmount || 0);
  const gst = Number(current.taxAmount || 0);
  const quoteNumber = formatQuotationNumber(quotation.quotationNumber, quotation.currentVersionNumber);
  const client = clientName || quotation.client?.name || '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientPoNumber.trim()) return setError('Enter the client PO number');
    if (!poDate) return setError('Enter the PO date');
    if (!deliveryDate) return setError('Enter the targeted completion date');
    const deductionError = deductionValuesError(
      deductions,
      calculateDeductions({
        netValue: price,
        gstValue: gst,
        tdsEnabled: deductions.tdsEnabled,
        tdsPercent: parseFloat(deductions.tdsPercent) || 0,
        retentionEnabled: deductions.retentionEnabled,
        retentionPercent: parseFloat(deductions.retentionPercent) || 0,
        rules,
      })
    );
    if (deductionError) return setError(deductionError);
    setLoading(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotationId: quotation.id,
          clientPoNumber,
          // The order is dated by the client's PO
          poDate,
          orderDate: poDate,
          deliveryDate: deliveryDate || undefined,
          tdsEnabled: deductions.tdsEnabled,
          tdsPercent: deductions.tdsEnabled ? parseFloat(deductions.tdsPercent) : undefined,
          retentionEnabled: deductions.retentionEnabled,
          retentionPercent: deductions.retentionEnabled ? parseFloat(deductions.retentionPercent) : undefined,
          retentionDueDate: deductions.retentionEnabled ? deductions.retentionDueDate : undefined,
          // Only used when the quotation has no payment terms of its own
          paymentTerms: terms.paymentTerms ? undefined : paymentTerms,
          remarks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not confirm the order');
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  const detail = (label: string, content: React.ReactNode) => (
    <div className="flex gap-2 min-w-0">
      <dt className="text-slate-500 shrink-0 w-28">{label}</dt>
      <dd className="text-slate-800 min-w-0 break-words">{content}</dd>
    </div>
  );

  const input = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Confirm Order</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              {client}
              {client && ' · '}
              {quoteNumber}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'confirm' ? (
          <div className="p-5 space-y-4 text-xs">
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <p className="font-bold text-slate-900 text-sm">
                {requirement.enquiryNumber} - {requirement.title}
              </p>
              <p className="text-slate-500 mt-0.5">
                {quoteNumber} · <strong className="text-slate-800">{formatINR(price)}</strong>
              </p>
            </div>
            <p className="font-bold text-slate-800 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Has the client confirmed this order?
            </p>
            <p className="text-slate-600">
              Confirming marks the requirement as <strong>Won</strong> and counts it towards the salesperson&apos;s target. The
              quotation can no longer be revised after this.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button onClick={onClose} className="px-3.5 py-1.5 font-semibold text-slate-600 hover:text-slate-800">
                No
              </button>
              <button
                onClick={() => setStep('details')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-xl shadow-sm"
              >
                Yes, confirm order
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
            {error && <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">{error}</div>}

            {/* Everything as quoted */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Order details (as quoted)</h4>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {detail('Client', client || '—')}
                {detail('Requirement', `${requirement.enquiryNumber || ''} - ${requirement.title || ''}`)}
                {detail('Type', requirementTypeLabel(requirement) || '—')}
                {Number(requirement.approxValue) > 0 && detail('Approx. Value', formatINR(requirement.approxValue))}
                {detail('Quotation', quoteNumber)}
                {detail('Product', terms.product || '—')}
                {detail('Payment Terms', terms.paymentTerms || '—')}
                {detail('Transportation', transportationLabel(terms.transportation) || '—')}
                {terms.remarks && detail('Remark', terms.remarks)}
              </dl>
              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-500">Order Value </span>
                <strong className="text-emerald-700 text-sm">{formatINR(price)}</strong>
                {gst > 0 && (
                  <span className="text-slate-600">
                    {' '}+ GST {formatINR(gst)} = <strong className="text-slate-900">{formatINR(price + gst)}</strong>
                  </span>
                )}
                <p className="text-slate-500 italic">{amountInWords(price)}</p>
                {gst > 0 && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Payment stages are worked out on {formatINR(price)}; the GST is asked for with the stage where the invoice is raised.
                  </p>
                )}
              </div>
            </div>

            {/* Client's PO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="modals-ConvertOrderModal-field-1" className="block font-semibold text-slate-700 mb-1">PO No *</label>
                <input id="modals-ConvertOrderModal-field-1"
                  type="text"
                  placeholder="e.g. PO/2026/092"
                  value={clientPoNumber}
                  onChange={(e) => setClientPoNumber(e.target.value)}
                  className={input}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="modals-ConvertOrderModal-field-2" className="block font-semibold text-slate-700 mb-1">PO / Order Date *</label>
                <input id="modals-ConvertOrderModal-field-2" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={input} required />
              </div>
              <div>
                <label htmlFor="modals-ConvertOrderModal-field-3" className="block font-semibold text-slate-700 mb-1">Targeted Completion Date *</label>
                <input id="modals-ConvertOrderModal-field-3" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={input} required />
              </div>
            </div>

            {/* Deductions the client will make from payments */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">TDS & Retention</h4>
              <DeductionFields values={deductions} onChange={setDeductions} netValue={price} gstValue={gst} rules={rules} />
            </div>

            {!terms.paymentTerms && (
              <div>
                <label htmlFor="modals-ConvertOrderModal-field-4" className="block font-semibold text-slate-700 mb-1">Payment Terms</label>
                <input id="modals-ConvertOrderModal-field-4"
                  type="text"
                  placeholder="The quotation has none; e.g. 50% advance, 50% before dispatch"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={input}
                />
              </div>
            )}

            <div>
              <label htmlFor="modals-ConvertOrderModal-field-5" className="block font-semibold text-slate-700 mb-1">Remarks</label>
              <textarea id="modals-ConvertOrderModal-field-5" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep('confirm')}
                className="px-3.5 py-1.5 font-semibold text-slate-600 hover:text-slate-800"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-xl shadow-sm flex items-center gap-1 disabled:opacity-60"
              >
                <CheckCircle className="h-4 w-4" />
                <span>{loading ? 'Confirming...' : 'Confirm Order & Mark Won'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
