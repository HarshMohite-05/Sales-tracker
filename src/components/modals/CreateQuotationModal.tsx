'use client';

import React, { useEffect, useState } from 'react';
import { formatINR } from '@/lib/utils';
import { X, FileText, Plus, Trash2 } from 'lucide-react';
import {
  TRANSPORTATION_OPTIONS,
  amountInWords,
  cleanAmountInput,
  formatAmountInput,
  PAYMENT_STAGE_OPTIONS,
  fixedPaymentText,
  isFixedPayment,
  formatPaymentStages,
  formatQuotationNumber,
  quotationPrefix,
  DEFAULT_GST_PERCENT,
  gstPercentOf,
} from '@/lib/quotation';

interface CreateQuotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clientId: string;
  clientName: string;
  // Requirements of this client; ones that already have a quotation are left out of the picker
  enquiries: Array<{ id: string; enquiryNumber: string; title: string; quotations?: any[] }>;
  defaultEnquiryId?: string;
  // When given, the form creates the next revision of this quotation, prefilled from its latest version
  existingQuotation?: any;
  // With existingQuotation: edit this version in place instead of making a new revision
  editVersionNumber?: number;
}

// Numbers made by this form, e.g. NWTS/26_27/045; the original's number can be corrected when editing
const EDITABLE_NUMBER = /^(NWTS\/\d{2}_\d{2}\/)(\d+)$/;

// A saved payment stage: percentage and what it is for, e.g. 50 / Before Dispatch
type StageRow = { percent: string | number; description: string; creditDays?: number };

// A payment stage being edited: percentage, the option picked, and the text typed for Other
type StageInput = { percent: string; choice: string; other: string };

const EMPTY_STAGE: StageInput = { percent: '', choice: '', other: '' };

// Saved descriptions that match an option select it; anything else shows as Other with its text
function toStageInput(percent: string, description: string): StageInput {
  const option = PAYMENT_STAGE_OPTIONS.find((o) => o.toLowerCase() === description.trim().toLowerCase());
  return option ? { percent, choice: option, other: '' } : { percent, choice: 'OTHER', other: description };
}

// What the stage is for, as saved
function stageText(st: StageInput): string {
  return st.choice === 'OTHER' ? st.other.trim() : st.choice;
}

// Form values of one version (the latest by default), also for older multi-line quotations
function versionFormTerms(quote: any, versionNumber?: number) {
  const versions: any[] = quote.versions || [];
  const latest =
    (versionNumber !== undefined
      ? versions.find((v) => v.versionNumber === versionNumber)
      : [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0]) || quote;
  const items: any[] = Array.isArray(latest.lineItems) ? latest.lineItems : [];
  return {
    product: latest.product || quote.product || items.map((i) => i.item).filter(Boolean).join(', '),
    price: Number(latest.originalValue ?? quote.originalValue) - Number(latest.discountAmount ?? quote.discountAmount ?? 0),
    gstPercent: gstPercentOf(latest.taxAmount !== undefined ? latest : quote),
    paymentTerms: latest.paymentTerms ?? quote.paymentTerms ?? '',
    paymentStages: (Array.isArray(latest.paymentStages) ? latest.paymentStages : null) as StageRow[] | null,
    transportation: latest.transportation ?? quote.transportation ?? '',
    remarks: latest.remarks ?? quote.remarks ?? '',
  };
}

export default function CreateQuotationModal({
  isOpen,
  onClose,
  onSuccess,
  clientId,
  clientName,
  enquiries,
  defaultEnquiryId,
  existingQuotation,
  editVersionNumber,
}: CreateQuotationModalProps) {
  const hasExisting = !!existingQuotation;
  const isEdit = hasExisting && editVersionNumber !== undefined;
  const openEnquiries = enquiries.filter((e) => !e.quotations || e.quotations.length === 0);
  const prefill = hasExisting ? versionFormTerms(existingQuotation, editVersionNumber) : null;
  // Only the original's number is editable, and only for numbers in the current format
  const numberMatch = isEdit && editVersionNumber === 0 ? existingQuotation.quotationNumber.match(EDITABLE_NUMBER) : null;

  const [enquiryId, setEnquiryId] = useState(
    openEnquiries.find((e) => e.id === defaultEnquiryId)?.id || openEnquiries[0]?.id || ''
  );
  const [prefix, setPrefix] = useState(quotationPrefix());
  const [quotationNo, setQuotationNo] = useState<string>(numberMatch ? numberMatch[2] : '');
  const [product, setProduct] = useState(prefill?.product || '');
  // Plain digits (and up to two decimals); shown with Indian commas in the field
  const [price, setPrice] = useState(prefill && prefill.price > 0 ? cleanAmountInput(String(prefill.price)) : '');
  // GST on top of the price: 18% for a new quotation, as saved for a revision
  const [gstPercent, setGstPercent] = useState(String(prefill ? prefill.gstPercent : DEFAULT_GST_PERCENT));
  // Payment terms are either stages adding up to 100%, or the full amount a fixed number of days later
  const prefillFixed = isFixedPayment(prefill?.paymentStages) ? prefill!.paymentStages![0] : null;
  const [paymentMode, setPaymentMode] = useState<'STAGES' | 'FIXED'>(prefillFixed ? 'FIXED' : 'STAGES');
  const [creditDays, setCreditDays] = useState(prefillFixed ? String(prefillFixed.creditDays) : '30');
  const [stages, setStages] = useState<StageInput[]>(() => {
    if (prefill?.paymentStages?.length && !prefillFixed) {
      return prefill.paymentStages.map((st) => toStageInput(String(st.percent), st.description));
    }
    // Older quotations have free-text terms: keep the text and let the salesperson add percentages
    if (prefill?.paymentTerms) return [toStageInput('', prefill.paymentTerms)];
    return [{ ...EMPTY_STAGE }];
  });
  const [transportation, setTransportation] = useState(prefill?.transportation || '');
  const [remarks, setRemarks] = useState(prefill?.remarks || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest the next free number for this financial year; the salesperson can change it
  useEffect(() => {
    if (hasExisting) return;
    fetch('/api/quotations/next-number')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPrefix(data.prefix);
        setQuotationNo((current) => current || data.suggestedNo);
      })
      .catch(() => {});
  }, [hasExisting]);

  if (!isOpen) return null;

  const priceValue = parseFloat(price) || 0;
  const gstValue = gstPercent === '' ? 0 : parseFloat(gstPercent);
  const gstAmount = Math.round(priceValue * (gstValue || 0)) / 100;
  const totalWithGst = Math.round((priceValue + gstAmount) * 100) / 100;
  // Fully empty rows are ignored, so payment terms stay optional
  const filledStages = stages.filter((st) => st.percent !== '' || st.choice);
  const stagesTotal = filledStages.reduce((sum, st) => sum + (parseFloat(st.percent) || 0), 0);
  const creditDaysValue = parseInt(creditDays, 10);
  // Payment terms as they will be saved and shown
  const paymentTermsText =
    paymentMode === 'FIXED'
      ? creditDaysValue > 0
        ? fixedPaymentText(creditDaysValue)
        : ''
      : formatPaymentStages(filledStages.map((st) => ({ percent: parseFloat(st.percent) || 0, description: stageText(st) })));

  function updateStage(index: number, field: keyof StageInput, value: string) {
    setStages(stages.map((st, i) => (i === index ? { ...st, [field]: value } : st)));
  }
  const displayNumber = isEdit
    ? formatQuotationNumber(numberMatch ? `${numberMatch[1]}${quotationNo || 'NO'}` : existingQuotation.quotationNumber, editVersionNumber)
    : hasExisting
    ? formatQuotationNumber(existingQuotation.quotationNumber, existingQuotation.currentVersionNumber + 1)
    : `${prefix}${quotationNo || 'NO'}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!hasExisting && !enquiryId) throw new Error('Pick the requirement this quotation is for');
      if ((!hasExisting || numberMatch) && !/^\d{1,6}$/.test(quotationNo.trim())) {
        throw new Error('Quotation number must be digits only, e.g. 045');
      }
      if (!product.trim()) throw new Error('Enter the product');
      if (!(priceValue > 0)) throw new Error('Enter a price greater than zero');
      if (Number.isNaN(gstValue) || gstValue < 0 || gstValue > 28) throw new Error('GST must be between 0% and 28%');
      if (!transportation) throw new Error('Choose transportation');
      if (paymentMode === 'FIXED' && !(Number.isInteger(creditDaysValue) && creditDaysValue > 0 && creditDaysValue <= 365)) {
        throw new Error('Fixed payment: enter the number of days (1 to 365)');
      }
      if (paymentMode === 'STAGES') filledStages.forEach((st, i) => {
        if (!(parseFloat(st.percent) > 0)) throw new Error(`Payment stage ${i + 1}: enter the percentage`);
        if (!st.choice) throw new Error(`Payment stage ${i + 1}: choose what the ${st.percent}% is for`);
        if (!stageText(st)) throw new Error(`Payment stage ${i + 1}: type what the "Other" payment is for`);
      });
      if (paymentMode === 'STAGES' && filledStages.length > 0 && Math.abs(stagesTotal - 100) > 0.001) {
        throw new Error(`Payment stages add up to ${stagesTotal}%. They must add up to 100%.`);
      }

      const url = isEdit
        ? `/api/quotations/${existingQuotation.id}/versions/${editVersionNumber}`
        : hasExisting
        ? `/api/quotations/${existingQuotation.id}/version`
        : '/api/quotations';
      const payload = {
        clientId,
        enquiryId,
        quotationNo: quotationNo.trim(),
        product,
        price: priceValue,
        gstPercent: gstValue || 0,
        paymentStages:
          paymentMode === 'FIXED'
            ? [{ percent: 100, description: paymentTermsText, creditDays: creditDaysValue }]
            : filledStages.map((st) => ({ percent: parseFloat(st.percent), description: stageText(st) })),
        transportation,
        remarks,
      };

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save quotation');

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const requirement = hasExisting ? existingQuotation.enquiry : null;

  // In a revision, fields changed from the previous version are bold, as they appear once saved
  const edited: Record<string, boolean> = prefill
    ? {
        product: product.trim() !== prefill.product.trim(),
        price: Math.abs(priceValue - prefill.price) >= 0.005,
        gst: Math.abs((gstValue || 0) - prefill.gstPercent) >= 0.005,
        paymentTerms: paymentTermsText !== prefill.paymentTerms.trim(),
        transportation: transportation !== prefill.transportation,
        remarks: remarks.trim() !== prefill.remarks.trim(),
      }
    : {};
  // A stage row is bold when it differs from the same row in the previous version
  const stageEdited = (index: number) => {
    if (!prefill) return false;
    const before = prefillFixed ? undefined : prefill.paymentStages?.[index];
    const now = stages[index];
    return !before || String(before.percent) !== now.percent || before.description.trim() !== stageText(now);
  };
  const editedClass = (key: string) => (edited[key] ? 'font-bold text-slate-900' : 'font-normal');

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">{isEdit ? 'Edit Quotation' : hasExisting ? 'Revise Quotation' : 'New Quotation'}</h3>
            <p className="text-xs text-slate-300 mt-0.5">{clientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>
        )}

        {!hasExisting && openEnquiries.length === 0 ? (
          <div className="p-5 space-y-3 text-xs text-slate-600">
            <p>
              Every requirement of this client already has a quotation. To change a price, use <strong>Revise</strong> on
              that quotation. For something new, add a new requirement first.
            </p>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-3.5 py-1.5 font-semibold text-slate-600 hover:text-slate-800">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Requirement */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Requirement *</label>
              {hasExisting ? (
                <p className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                  {requirement ? `${requirement.enquiryNumber} - ${requirement.title}` : '—'}
                </p>
              ) : (
                <select
                  value={enquiryId}
                  onChange={(e) => setEnquiryId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                  required
                >
                  {openEnquiries.map((enq) => (
                    <option key={enq.id} value={enq.id}>
                      {enq.enquiryNumber} - {enq.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Quotation number */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Quotation No *</label>
              {hasExisting && !numberMatch ? (
                <div>
                  <p className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-bold text-slate-900">
                    {displayNumber}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isEdit
                      ? 'Editing this version in place; no new revision is made.'
                      : `Revision of ${formatQuotationNumber(existingQuotation.quotationNumber, existingQuotation.currentVersionNumber)}.`}{' '}
                    Fields you change show in bold.
                  </p>
                </div>
              ) : (
                <div>
                <div className="flex items-stretch">
                  <span className="px-2.5 py-1.5 rounded-l-lg bg-slate-100 border border-r-0 border-slate-300 font-semibold text-slate-600">
                    {numberMatch ? numberMatch[1] : prefix}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="045"
                    value={quotationNo}
                    onChange={(e) => setQuotationNo(e.target.value.replace(/\D/g, ''))}
                    maxLength={6}
                    className="w-28 border border-slate-300 rounded-r-lg px-2.5 py-1.5 font-bold"
                    required
                  />
                </div>
                {isEdit && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Editing the original in place; no new revision is made. Changing the number renames all its revisions.
                    Fields you change show in bold.
                  </p>
                )}
                </div>
              )}
            </div>

            {/* Product */}
            <div>
              <label htmlFor="modals-CreateQuotationModal-field-1" className="block font-semibold text-slate-700 mb-1">Product *</label>
              <textarea id="modals-CreateQuotationModal-field-1"
                rows={2}
                placeholder="e.g. 5 m³/hr RO plant with pre-treatment"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className={`w-full border border-slate-300 rounded-lg px-2.5 py-1.5 ${editedClass('product')}`}
                required
              />
            </div>

            {/* Price */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Price *</label>
              <div className="flex items-stretch">
                <span className="px-2.5 py-1.5 rounded-l-lg bg-slate-100 border border-r-0 border-slate-300 font-semibold text-slate-600">
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={formatAmountInput(price)}
                  onChange={(e) => setPrice(cleanAmountInput(e.target.value))}
                  className={`w-48 border border-slate-300 rounded-r-lg px-2.5 py-1.5 ${editedClass('price')}`}
                  required
                />
              </div>
              {priceValue > 0 && <p className="text-[11px] text-slate-600 mt-1 italic">{amountInWords(priceValue)}</p>}
            </div>

            {/* GST: 18% by default, editable */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GST</label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-stretch">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={gstPercent}
                    onChange={(e) => setGstPercent(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
                    className={`w-16 border border-slate-300 rounded-l-lg px-2.5 py-1.5 text-right ${editedClass('gst')}`}
                  />
                  <span className="px-2.5 py-1.5 rounded-r-lg bg-slate-100 border border-l-0 border-slate-300 font-semibold text-slate-600">%</span>
                </div>
                {priceValue > 0 && (
                  <span className="text-slate-600">
                    {formatINR(priceValue)} + GST {formatINR(gstAmount)} = <strong className="text-slate-900">{formatINR(totalWithGst)}</strong>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Payment stages are % of the price before GST. The GST is asked for in full with the stage where the invoice is raised.
              </p>
            </div>

            {/* Payment terms: stages adding up to 100%, or fixed days after invoice/delivery/dispatch */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Terms</label>
              <div className="mb-2 flex flex-wrap gap-4" role="radiogroup" aria-label="Payment terms type">
                {([
                  ['STAGES', 'Stages'],
                  ['FIXED', 'Fixed'],
                ] as const).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMode"
                      checked={paymentMode === value}
                      onChange={() => setPaymentMode(value)}
                      className="accent-sky-600"
                    />
                    <span className={paymentMode === value ? 'font-semibold text-slate-900' : 'text-slate-600'}>{label}</span>
                  </label>
                ))}
              </div>
              {paymentMode === 'FIXED' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">Full payment</span>
                  <span className="text-slate-600">after</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={creditDays}
                    onChange={(e) => setCreditDays(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    className={`w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-right ${editedClass('paymentTerms')}`}
                    aria-label="Days"
                  />
                  <span className="text-slate-600">days</span>
                  <span className="basis-full text-[11px] text-slate-500">
                    Due this many days after Delivery &amp; Invoice Raised is saved in the order&apos;s Execution
                  </span>
                </div>
              ) : (
              <>
              <div className="space-y-1.5">
                {stages.map((st, i) => (
                  <div key={i} className="flex items-stretch gap-2">
                    <div className="flex items-stretch shrink-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="50"
                        value={st.percent}
                        onChange={(e) => updateStage(i, 'percent', cleanAmountInput(e.target.value).slice(0, 6))}
                        className={`w-14 border border-slate-300 rounded-l-lg px-2 py-1.5 text-right ${
                          stageEdited(i) ? 'font-bold text-slate-900' : 'font-normal'
                        }`}
                      />
                      <span className="px-2 py-1.5 rounded-r-lg bg-slate-100 border border-l-0 border-slate-300 font-semibold text-slate-600">
                        %
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col sm:flex-row gap-1.5">
                      <select
                        value={st.choice}
                        onChange={(e) => updateStage(i, 'choice', e.target.value)}
                        className={`flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 bg-white ${
                          stageEdited(i) ? 'font-bold text-slate-900' : 'font-normal'
                        }`}
                      >
                        <option value="">Select...</option>
                        {PAYMENT_STAGE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                        <option value="OTHER">Other</option>
                      </select>
                      {st.choice === 'OTHER' && (
                        <input
                          type="text"
                          placeholder="What this payment is for"
                          value={st.other}
                          onChange={(e) => updateStage(i, 'other', e.target.value)}
                          className={`flex-1 min-w-0 border border-slate-300 rounded-lg px-2.5 py-1.5 ${
                            stageEdited(i) ? 'font-bold text-slate-900' : 'font-normal'
                          }`}
                          autoFocus
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setStages(stages.length > 1 ? stages.filter((_, j) => j !== i) : [{ ...EMPTY_STAGE }])}
                      className="text-slate-500 hover:text-rose-500 p-1"
                      aria-label={`Remove payment stage ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStages([...stages, { ...EMPTY_STAGE }])}
                  className="text-sky-700 hover:text-sky-900 font-semibold flex items-center space-x-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add stage</span>
                </button>
                {filledStages.length > 0 && (
                  <span
                    className={`text-[11px] font-semibold ${
                      Math.abs(stagesTotal - 100) <= 0.001 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    Total {stagesTotal}%{Math.abs(stagesTotal - 100) <= 0.001 ? '' : ' (must be 100%)'}
                  </span>
                )}
              </div>
              </>
              )}
            </div>

            {/* Transportation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="modals-CreateQuotationModal-field-2" className="block font-semibold text-slate-700 mb-1">Transportation *</label>
                <select id="modals-CreateQuotationModal-field-2"
                  value={transportation}
                  onChange={(e) => setTransportation(e.target.value)}
                  className={`w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white ${editedClass('transportation')}`}
                  required
                >
                  <option value="">Select...</option>
                  {TRANSPORTATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Remark */}
            <div>
              <label htmlFor="modals-CreateQuotationModal-field-3" className="block font-semibold text-slate-700 mb-1">Remark</label>
              <textarea id="modals-CreateQuotationModal-field-3"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className={`w-full border border-slate-300 rounded-lg px-2.5 py-1.5 ${editedClass('remarks')}`}
              />
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-4 py-2 rounded-xl shadow-sm flex items-center space-x-1.5 disabled:opacity-60"
              >
                <FileText className="h-4 w-4" />
                <span>{loading ? 'Saving...' : isEdit ? 'Save changes' : hasExisting ? `Save ${displayNumber}` : 'Create Quotation'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
