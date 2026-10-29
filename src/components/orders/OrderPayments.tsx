'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Pencil, Plus, Undo2 } from 'lucide-react';
import { formatDate, formatINR } from '@/lib/utils';
import { amountInWords, cleanAmountInput, formatAmountInput } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import {
  calculateDeductions,
  DEFAULT_DEDUCTION_RULES,
  DeductionRules,
  PAYMENT_STATUS_LABELS,
  isRaised,
  owedThroughStage,
  PaymentStatus,
  reconcileOrder,
} from '@/lib/deductions';
import { fixedPaymentTerms, raisingStep } from '@/lib/executionSteps';
import DeductionFields, { DeductionValues, deductionValuesError } from './DeductionFields';

interface OrderPaymentsProps {
  order: any; // with payments, receipts, enquiry and excessReviewedBy included
  onChanged: () => void;
  defaultExpanded?: boolean;
}

const today = () => new Date().toISOString().split('T')[0];

const PAYMENT_MODES = [
  { value: 'NEFT_RTGS', label: 'NEFT / RTGS' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
];
const modeLabel = (m: string | null) => PAYMENT_MODES.find((x) => x.value === m)?.label || '';

const STATUS_STYLE: Record<PaymentStatus, string> = {
  NOT_RAISED: 'bg-slate-100 text-slate-600',
  UNPAID: 'bg-rose-100 text-rose-800',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  FULLY_PAID: 'bg-emerald-100 text-emerald-800',
  OVERPAID: 'bg-violet-100 text-violet-800',
};

function StatusBadge({ status, notDue = false }: { status: PaymentStatus; notDue?: boolean }) {
  // Nothing received on a stage that isn't due yet is not a problem
  if (notDue && status === 'UNPAID') {
    return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE.NOT_RAISED}`}>{PAYMENT_STATUS_LABELS.NOT_RAISED}</span>;
  }
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLE[status]}`}>{PAYMENT_STATUS_LABELS[status]}</span>;
}

/**
 * Payments on one order: what each stage should bring in after TDS and retention, the money actually
 * received (any number of receipts per stage), and the reconciliation of the two. Stages become due as
 * the order's execution steps are done; the invoice GST is asked for with one stage.
 */
export default function OrderPayments({ order, onChanged, defaultExpanded = false }: OrderPaymentsProps) {
  const stages: any[] = order.payments || [];
  const receipts: any[] = order.receipts || [];
  // Stage by stage, each receipt clearing earlier due stages first; GST paid above what a stage asked
  // never covers a shortfall on another
  const summary = reconcileOrder(stages, receipts, order);
  const total = Number(order.grossValue);
  const gst = Number(order.taxValue);
  const net = Number(order.netValue);
  const locked = order.orderStatus === 'CANCELLED';
  // Stages where the client paid more than was asked
  const overpaidStages = summary.rows.filter((r) => r.excess > 0).length;
  // Stages raised as due and not fully received yet
  const owed = stages
    .map((st) => ({ st, r: summary.rows.find((x) => x.stageId === st.id)! }))
    .filter(({ r }) => r.outstanding > 0 && r.isDue);
  const notYetDue = summary.notYetDue;
  // Underpayment: stages raised as due where the client paid only part of what was asked
  const underpaid = owed.filter(({ r }) => r.received > 0);
  const underpaidTotal = Math.round(underpaid.reduce((sum, { r }) => sum + r.outstanding, 0) * 100) / 100;
  const allStagesRaised = stages.length > 0 && summary.rows.every((r) => r.isDue);
  const invoiceStep = (order.executionSteps || []).find((s: any) => s.id === order.invoiceStepId);
  const invoiceGst = Number(order.invoiceGstAmount || 0);
  const retentionOverdue =
    order.retentionEnabled && order.retentionDueDate && new Date(order.retentionDueDate).getTime() < Date.now();

  // Receipt form: new (optionally for one stage), or editing an existing receipt
  const [receiptForm, setReceiptForm] = useState<{ editing?: any; stageId?: string } | null>(null);
  const formFor = (stageId: string) => receiptForm && !receiptForm.editing && receiptForm.stageId === stageId;
  const [editingDeductions, setEditingDeductions] = useState(false);

  return (
    <details open={defaultExpanded} className="group/order-payments bg-slate-50 rounded-xl border border-slate-200 text-xs">
      {/* Header */}
      <summary className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 cursor-pointer list-none rounded-xl hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="font-bold text-slate-900 text-sm">
            {order.orderNumber}
            {/* The order number is the PO number, except on a direct order without one */}
            {order.clientPoNumber && order.clientPoNumber !== order.orderNumber && (
              <span className="font-normal text-slate-500"> · PO {order.clientPoNumber}</span>
            )}
          </p>
          {order.enquiry && (
            <p className="text-slate-500">
              {order.enquiry.enquiryNumber} - {order.enquiry.title} ({requirementTypeLabel(order.enquiry)})
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-slate-500">
            Received <strong className="text-emerald-700">{formatINR(summary.received)}</strong>
          </span>
          <span className="text-slate-500">
            Due now <strong className={summary.dueNow > 0 ? 'text-rose-700' : 'text-slate-700'}>{formatINR(summary.dueNow)}</strong>
          </span>
          <StatusBadge status={summary.status} />
          <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-slate-500 transition-transform group-open/order-payments:rotate-180" />
        </div>
      </summary>

      <div className="px-4 pb-4 space-y-4">
      {/* Deductions set at order confirmation */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          TDS:{' '}
          <strong>{order.tdsEnabled ? `${Number(order.tdsPercent)}% (${formatINR(order.tdsAmount)})` : 'Not applied'}</strong>
        </span>
        <span>
          Retention:{' '}
          <strong>
            {order.retentionEnabled ? `${Number(order.retentionPercent)}% (${formatINR(order.retentionAmount)})` : 'Not applied'}
          </strong>
          {order.retentionEnabled && order.retentionDueDate && (
            <span className={retentionOverdue ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
              {' '}
              · {retentionOverdue ? 'overdue since' : 'due on'} {formatDate(order.retentionDueDate)}
            </span>
          )}
        </span>
        {!locked && !editingDeductions && (
          <button onClick={() => setEditingDeductions(true)} className="text-sky-700 hover:text-sky-900 font-semibold">
            Change deductions
          </button>
        )}
      </div>
      {editingDeductions && (
        <EditDeductions order={order} onDone={() => setEditingDeductions(false)} onChanged={onChanged} />
      )}
      <p className="text-slate-600">
        Invoice:{' '}
        {invoiceStep ? (
          <strong className="text-violet-800">
            raised at {invoiceStep.name} on {formatDate(order.invoiceDate)} · GST {Number(order.invoiceGstPercent)}%
            {invoiceGst > 0 ? ` = ${formatINR(invoiceGst)}` : ''}
          </strong>
        ) : (
          <span className="text-slate-500">not raised yet (tick Invoice on a step in Execution)</span>
        )}
      </p>

      {/* Payment stages */}
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.4fr_repeat(5,1fr)_auto_auto] gap-2 px-3 py-2 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span>Payment stage</span>
          <span className="text-right">Amount</span>
          <span className="text-right">TDS</span>
          <span className="text-right">Retention</span>
          <span className="text-right">Expected</span>
          <span className="text-right">Received</span>
          <span className="w-28 text-right">Status</span>
          <span className="w-28" />
        </div>
        <div className="divide-y divide-slate-100">
          {stages.map((st) => {
            const r = summary.rows.find((x) => x.stageId === st.id)!;
            const cell = (label: string, value: string, className = '') => (
              <span className={`flex md:block justify-between md:text-right ${className}`}>
                <span className="md:hidden text-slate-500">{label}</span>
                {value}
              </span>
            );
            return (
              <React.Fragment key={st.id}>
              <div className="grid grid-cols-1 md:grid-cols-[1.4fr_repeat(5,1fr)_auto_auto] gap-1 md:gap-2 px-3 py-2.5 items-center">
                <span>
                  <span className="font-semibold text-slate-800">
                    {Number(st.percent)}% {st.description}
                  </span>
                  <StageDue order={order} stage={st} outstanding={r.outstanding} locked={locked} onChanged={onChanged} />
                </span>
                {cell('Amount', formatINR(st.amount))}
                {cell('TDS', `− ${formatINR(st.tdsAmount)}`, 'text-rose-700')}
                {cell('Retention', `− ${formatINR(st.retentionAmount)}`, 'text-amber-700')}
                <span className="flex md:block justify-between md:text-right font-semibold text-slate-900">
                  <span className="md:hidden text-slate-500 font-normal">Expected</span>
                  <span>
                    {formatINR(r.expected)}
                    {r.invoiceGst > 0 && (
                      <span className="block text-[10px] font-normal text-violet-700">incl. GST {formatINR(r.invoiceGst)}</span>
                    )}
                  </span>
                </span>
                {cell('Received', formatINR(r.received), 'font-semibold text-emerald-700')}
                <span className="md:w-28 md:text-right">
                  <StatusBadge status={r.status} notDue={!r.isDue} />
                  {r.outstanding > 0 && r.received > 0 && (
                    <span className="block text-[10px] font-semibold text-rose-700">
                      {r.isDue ? 'Underpaid' : 'Short'} {formatINR(r.outstanding)}
                    </span>
                  )}
                  {r.excess > 0 && (
                    <span className="block text-[10px] font-semibold text-violet-700">Overpaid {formatINR(r.excess)}</span>
                  )}
                </span>
                <span className="md:w-28 md:text-right">
                  {!locked && !formFor(st.id) && (
                    <button
                      onClick={() => setReceiptForm({ stageId: st.id })}
                      className="text-emerald-700 hover:text-emerald-900 font-semibold"
                    >
                      {/* A part-paid stage: receive what is still owed */}
                      {r.received > 0 && r.outstanding > 0 ? `Receive balance ${formatINR(r.outstanding)}` : 'Receive'}
                    </button>
                  )}
                </span>
              </div>
              {formFor(st.id) && (
                <div className="px-3 pb-3">
                  <ReceiptForm order={order} stageId={st.id} onDone={() => setReceiptForm(null)} onChanged={onChanged} />
                </div>
              )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Record a payment */}
      {!locked &&
        (receiptForm && (receiptForm.editing || !receiptForm.stageId) ? (
          <ReceiptForm
            order={order}
            editing={receiptForm.editing}
            onDone={() => setReceiptForm(null)}
            onChanged={onChanged}
          />
        ) : receiptForm ? null : (
          <button
            onClick={() => setReceiptForm({})}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3.5 py-1.5 rounded-xl shadow-xs flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Record payment received</span>
          </button>
        ))}

      {/* Payment history */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payment history</h4>
        {receipts.length === 0 && <p className="text-slate-500">No payments recorded yet.</p>}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
          {receipts.map((rec) => (
            <ReceiptRow
              key={rec.id}
              orderId={order.id}
              receipt={rec}
              stage={stages.find((s) => s.id === rec.paymentStageId)}
              stages={stages}
              split={summary.splits.get(rec.id)}
              locked={locked}
              onEdit={() => setReceiptForm({ editing: rec })}
              onChanged={onChanged}
            />
          ))}
        </div>
      </div>

      {/* Received above what was asked: an overpayment, kept on its own stage */}
      {summary.excess > 0 && (
        <div className="p-3 rounded-lg border border-violet-200 bg-violet-50 text-violet-900">
          Overpayment: received <strong>{formatINR(summary.excess)}</strong> more than asked on{' '}
          {overpaidStages === 1 ? 'a stage' : `${overpaidStages} stages`}. It is not used to cover amounts still owed on other
          stages; refund it or adjust it with the client, then correct the receipt if needed.
        </div>
      )}

      {/* Underpayment: part-paid stages to chase until cleared */}
      {underpaidTotal > 0 && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-900 space-y-1.5">
          <p className="font-bold">
            Underpayment {formatINR(underpaidTotal)}
            {allStagesRaised ? ' · all payment stages are raised, ask the client to clear it' : ''}
          </p>
          {underpaid.map(({ st, r }) => (
            <div key={st.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {Number(st.percent)}% {st.description}
                {r.invoiceGst > 0 && ' (incl. GST)'}: asked {formatINR(r.expected)}, received {formatINR(r.received)}, short{' '}
                <strong>{formatINR(r.outstanding)}</strong>
              </span>
              {!locked && (
                <button onClick={() => setReceiptForm({ stageId: st.id })} className="font-semibold text-emerald-700 hover:text-emerald-900">
                  Receive {formatINR(r.outstanding)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final payment summary */}
      <div className="rounded-lg border-2 border-slate-300 bg-white p-3.5 space-y-1.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Payment Summary</h4>
        <SummaryRow label="Total order amount" value={formatINR(total)} />
        <SummaryRow label="Expected payment after deductions" value={formatINR(summary.expected)} strong />
        <SummaryRow label="Total amount received" value={formatINR(summary.received)} className="text-emerald-700" strong />
        {/* Outstanding = raised as due − received on it */}
        <SummaryRow
          label="Outstanding (raised as due − received)"
          value={formatINR(summary.outstanding)}
          className={summary.outstanding > 0 ? 'text-rose-700' : 'text-slate-500'}
          strong={summary.outstanding > 0}
        />
        {underpaidTotal > 0 && (
          <SummaryRow label="· of which underpayment (part-paid stages)" value={formatINR(underpaidTotal)} className="text-rose-700" strong />
        )}
        {notYetDue > 0 && (
          <SummaryRow label="Not raised yet (waiting on execution or the credit days)" value={formatINR(notYetDue)} className="text-slate-500" />
        )}
        {/* Every stage due and still owed money, with a shortcut to receive it */}
        {owed.length > 0 && !locked && (
          <div className="pl-3 border-l-2 border-rose-200 space-y-1">
            {owed.map(({ st, r }) => (
              <div key={st.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-600">
                  {Number(st.percent)}% {st.description}
                  {r.invoiceGst > 0 && ' (incl. GST)'}: <strong className="text-rose-700">{formatINR(r.outstanding)}</strong>{' '}
                  {r.received > 0 ? 'underpaid, due since' : 'due since'}{' '}
                  {formatDate(st.dueDate)}
                </span>
                <button
                  onClick={() => setReceiptForm({ stageId: st.id })}
                  className="text-emerald-700 hover:text-emerald-900 font-semibold"
                >
                  Receive {formatINR(r.outstanding)}
                </button>
              </div>
            ))}
          </div>
        )}
        {summary.excess > 0 && (
          <SummaryRow
            label="Overpayment (received above asked)"
            value={formatINR(summary.excess)}
            className="text-violet-700"
            strong
          />
        )}
        <div className="pt-1.5 mt-1 border-t border-slate-100 space-y-1.5">
          <SummaryRow
            label="TDS deducted by client (not cash; claim via Form 16A)"
            value={formatINR(order.tdsAmount)}
            className="text-rose-700"
          />
          <SummaryRow
            label={`Retention withheld${order.retentionDueDate ? ` (due ${formatDate(order.retentionDueDate)})` : ''}`}
            value={formatINR(order.retentionAmount)}
            className={retentionOverdue ? 'text-rose-700' : 'text-amber-700'}
          />
          <SummaryRow
            label="GST"
            value={[
              invoiceGst > 0 ? `${formatINR(invoiceGst)} on invoice (${Number(order.invoiceGstPercent)}%)` : '',
              gst > 0 && invoiceGst === 0 ? `${formatINR(gst)} quoted, asked with the invoice` : '',
            ]
              .filter(Boolean)
              .join(' · ') || 'Not invoiced yet'}
            className="text-slate-700"
          />
        </div>
        <div className="pt-1.5 mt-1 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-700">Payment status</span>
          <StatusBadge status={summary.status} />
        </div>
        {summary.outstanding > 0 && <p className="text-[11px] text-slate-500 italic text-right">{amountInWords(summary.outstanding)} outstanding</p>}
      </div>
      </div>
    </details>
  );
}

/** When a stage is due: raised by its execution step, or by hand for stages no step raises. */
function StageDue({ order, stage, outstanding, locked, onChanged }: { order: any; stage: any; outstanding: number; locked: boolean; onChanged: () => void }) {
  const trigger = raisingStep(stage, (order.executionSteps || []).map((s: any) => s.name));
  const fixed = fixedPaymentTerms(stage.description);
  const [raising, setRaising] = useState(false);
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setDue(dueDate: string | null) {
    setError(null);
    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/stages/${stage.id}/due`, 'PATCH', { dueDate });
      setRaising(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  // Due date still ahead (fixed terms' credit days): not raised yet, so not outstanding until then
  if (stage.dueDate && !isRaised(stage.dueDate)) {
    return <span className="block text-[11px] text-slate-500">Not raised yet · due on {formatDate(stage.dueDate)}</span>;
  }
  if (stage.dueDate) {
    return (
      <span className={`block text-[11px] ${outstanding > 0 ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>
        Due since {formatDate(stage.dueDate)}
        {!trigger && !locked && outstanding > 0 && (
          <button onClick={() => setDue(null)} disabled={saving} className="ml-2 font-normal text-slate-500 hover:text-slate-700">
            Not due yet
          </button>
        )}
      </span>
    );
  }
  if (trigger) {
    return (
      <span className="block text-[11px] text-slate-500">
        {fixed ? `Due ${fixed.days} days after Delivery & Invoice Raised in Execution` : `Due when ${trigger} is done`}
      </span>
    );
  }
  return (
    <span className="block text-[11px] text-slate-500">
      Not due yet
      {!locked && !raising && (
        <button onClick={() => setRaising(true)} className="ml-2 font-semibold text-sky-700 hover:text-sky-900">
          Raise as due
        </button>
      )}
      {raising && (
        <span className="flex flex-wrap items-center gap-1.5 mt-1">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-300 rounded px-1.5 py-0.5 text-slate-700"
          />
          <button onClick={() => setDue(date)} disabled={saving || !date} className="font-semibold text-sky-700 hover:text-sky-900">
            Save
          </button>
          <button onClick={() => setRaising(false)} className="text-slate-500">
            Cancel
          </button>
        </span>
      )}
      {error && <span className="block font-semibold text-rose-700">{error}</span>}
    </span>
  );
}

function SummaryRow({ label, value, className = 'text-slate-800', strong = false }: { label: string; value: string; className?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`${className} ${strong ? 'font-bold' : 'font-semibold'} text-right`}>{value}</span>
    </div>
  );
}

async function send(url: string, method: string, body: any) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save');
  return data;
}

/** Add a receipt, or correct one already recorded. */
function ReceiptForm({
  order,
  editing,
  stageId: fixedStageId,
  onDone,
  onChanged,
}: {
  order: any;
  editing?: any;
  stageId?: string; // opened from a stage row: that stage, filled with what it still expects
  onDone: () => void;
  onChanged: () => void;
}) {
  const stages: any[] = order.payments || [];
  const receipts: any[] = order.receipts || [];
  const activeReceipts = receipts.filter((r) => !r.isReversed);
  // What a payment against a stage would clear (earlier due stages first, then the stage itself),
  // leaving out the receipt being edited
  const owedOn = (id: string) => owedThroughStage(stages, activeReceipts.filter((r) => r.id !== editing?.id), id);
  // Default to the first due stage still waiting for money, else the first one waiting
  const firstOpen =
    stages.find((st) => isRaised(st.dueDate) && owedOn(st.id).stage > 0) || stages.find((st) => owedOn(st.id).stage > 0) || stages[0];
  const initialStage = editing?.paymentStageId || fixedStageId || firstOpen?.id || '';
  const amountFor = (id: string) => (owedOn(id).total > 0 ? cleanAmountInput(String(owedOn(id).total)) : '');
  // Most recent mode used on this order, so repeat payments need fewer clicks
  const lastMode = [...activeReceipts].reverse().find((r) => r.paymentMode)?.paymentMode;

  const [stageId, setStageId] = useState(initialStage);
  const [amount, setAmount] = useState(editing ? cleanAmountInput(String(Number(editing.amount))) : amountFor(initialStage));
  const [amountTyped, setAmountTyped] = useState(!!editing);
  const [date, setDate] = useState(editing ? editing.receivedDate.slice(0, 10) : today());
  const [mode, setMode] = useState(editing?.paymentMode || lastMode || 'NEFT_RTGS');
  const [reference, setReference] = useState(editing?.reference || '');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stage = stages.find((s) => s.id === stageId);
  const owed = owedOn(stageId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(parseFloat(amount) > 0)) return setError('Enter the amount received');
    setSaving(true);
    try {
      const body = { paymentStageId: stageId, amount: parseFloat(amount), receivedDate: date, paymentMode: mode, reference, notes };
      if (editing) await send(`/api/orders/${order.id}/receipts/${editing.id}`, 'PATCH', body);
      else await send(`/api/orders/${order.id}/receipts`, 'POST', body);
      onDone();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  const input = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white';

  return (
    <form onSubmit={save} className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 space-y-3">
      <h4 className="font-bold text-slate-800">
        {editing ? 'Edit payment received' : 'Record payment received'}
        {!editing && <span className="font-normal text-slate-500"> · amount filled with what is still owed up to this stage; change it if different</span>}
      </h4>
      {error && <p className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Payment stage *</label>
          <select
            value={stageId}
            onChange={(e) => {
              setStageId(e.target.value);
              // Follow the stage until the user types their own amount
              if (!amountTyped) setAmount(amountFor(e.target.value));
            }}
            className={input}
            required
          >
            {stages.map((st) => (
              <option key={st.id} value={st.id}>
                {Number(st.percent)}% {st.description} · expected {formatINR(Number(st.expectedAmount) + Number(st.gstAmount || 0))}
                {isRaised(st.dueDate) ? '' : st.dueDate ? ` · not raised yet, due ${formatDate(st.dueDate)}` : ' · not due yet'}
              </option>
            ))}
          </select>
          {stage && (
            <p className="text-[11px] text-slate-500 mt-1">
              Still expected on this stage: {formatINR(owed.stage)}
              {owed.earlier > 0 && (
                <span className="block text-rose-700">
                  Plus {formatINR(owed.earlier)} still owed on earlier stages, cleared first from this payment
                </span>
              )}
            </p>
          )}
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Amount received (₹) *</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={formatAmountInput(amount)}
            onChange={(e) => {
              setAmount(cleanAmountInput(e.target.value));
              setAmountTyped(true);
            }}
            className={`${input} font-semibold`}
            required
            autoFocus
          />
          {parseFloat(amount) > 0 && <p className="text-[11px] text-slate-500 italic mt-1">{amountInWords(parseFloat(amount))}</p>}
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Date received *</label>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={input} required />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Payment mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={input}>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Reference (UTR / cheque no.)</label>
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className={input} />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Notes</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="px-3 py-1.5 font-semibold text-slate-600 hover:text-slate-800">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-1.5 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Saving...' : editing ? 'Save changes' : 'Save payment'}
        </button>
      </div>
    </form>
  );
}

/** One receipt in the history, with Edit and Reverse. Reversed receipts stay listed but don't count. */
function ReceiptRow({
  orderId,
  receipt,
  stage,
  stages,
  split,
  locked,
  onEdit,
  onChanged,
}: {
  orderId: string;
  receipt: any;
  stage: any;
  stages: any[];
  split?: { stageId: string; amount: number }[]; // how the receipt was spread over stages
  locked: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse() {
    setError(null);
    if (!reason.trim()) return setError('Give a reason for reversing this payment');
    setSaving(true);
    try {
      await send(`/api/orders/${orderId}/receipts/${receipt.id}/reverse`, 'POST', { reason });
      setReversing(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className={`p-3 space-y-1.5 ${receipt.isReversed ? 'bg-slate-50' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
        <div className={`flex-1 min-w-0 ${receipt.isReversed ? 'line-through text-slate-500' : ''}`}>
          <strong className={receipt.isReversed ? '' : 'text-emerald-700'}>{formatINR(receipt.amount)}</strong>
          <span className="text-slate-500">
            {' '}
            on {formatDate(receipt.receivedDate)}
            {stage && <> · {Number(stage.percent)}% {stage.description}</>}
            {receipt.paymentMode && <> · {modeLabel(receipt.paymentMode)}</>}
            {receipt.reference && <> · Ref {receipt.reference}</>}
          </span>
          {/* Part of it went to clear earlier stages */}
          {split && split.some((p) => p.stageId !== receipt.paymentStageId) && (
            <p className="text-[11px] text-sky-800">
              Split:{' '}
              {split
                .map((p) => {
                  const st = stages.find((s) => s.id === p.stageId);
                  return `${formatINR(p.amount)} → ${st ? `${Number(st.percent)}% ${st.description}` : 'stage'}`;
                })
                .join(', ')}
            </p>
          )}
          {receipt.notes && <p className="text-slate-500">{receipt.notes}</p>}
          <p className="text-[11px] text-slate-500">recorded by {receipt.recordedBy?.name}</p>
        </div>
        {!receipt.isReversed && !locked && !reversing && (
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={onEdit} className="text-slate-600 hover:text-sky-700 font-semibold flex items-center gap-1">
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit</span>
            </button>
            <button onClick={() => setReversing(true)} className="text-slate-500 hover:text-rose-600 font-semibold flex items-center gap-1">
              <Undo2 className="h-3.5 w-3.5" />
              <span>Reverse</span>
            </button>
          </div>
        )}
      </div>

      {receipt.isReversed && (
        <p className="text-[11px] text-rose-700">
          Reversed {receipt.reversedAt && `on ${formatDate(receipt.reversedAt)}`}
          {receipt.reversedBy?.name && ` by ${receipt.reversedBy.name}`}: {receipt.reversalReason}
        </p>
      )}

      {reversing && (
        <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 space-y-2">
          <p className="font-semibold text-rose-800">
            Reverse this {formatINR(receipt.amount)} payment? It stays in the history but no longer counts as received.
          </p>
          <input
            type="text"
            placeholder="Reason, e.g. cheque bounced, entered twice"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
            autoFocus
          />
          {error && <p className="font-semibold text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setReversing(false)} className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700">
              Keep it
            </button>
            <button
              onClick={reverse}
              disabled={saving}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
            >
              {saving ? 'Reversing...' : 'Yes, reverse'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Change TDS / retention on a confirmed order; receipts are kept as they are. */
function EditDeductions({ order, onDone, onChanged }: { order: any; onDone: () => void; onChanged: () => void }) {
  const [values, setValues] = useState<DeductionValues>({
    tdsEnabled: order.tdsEnabled,
    tdsPercent: order.tdsEnabled ? String(Number(order.tdsPercent)) : '',
    retentionEnabled: order.retentionEnabled,
    retentionPercent: order.retentionEnabled ? String(Number(order.retentionPercent)) : '',
    retentionDueDate: order.retentionDueDate ? order.retentionDueDate.slice(0, 10) : '',
  });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The order keeps the bases it was confirmed with
  const rules: DeductionRules = {
    tdsBase: order.tdsBase || DEFAULT_DEDUCTION_RULES.tdsBase,
    retentionBase: order.retentionBase || DEFAULT_DEDUCTION_RULES.retentionBase,
  };

  useEffect(() => setConfirming(false), [values]);

  async function save() {
    setError(null);
    const totals = calculateDeductions({
      netValue: Number(order.netValue),
      gstValue: Number(order.taxValue),
      tdsEnabled: values.tdsEnabled,
      tdsPercent: parseFloat(values.tdsPercent) || 0,
      retentionEnabled: values.retentionEnabled,
      retentionPercent: parseFloat(values.retentionPercent) || 0,
      rules,
    });
    const err = deductionValuesError(values, totals);
    if (err) return setError(err);
    if (!confirming) return setConfirming(true);

    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/deductions`, 'PATCH', {
        tdsEnabled: values.tdsEnabled,
        tdsPercent: values.tdsEnabled ? parseFloat(values.tdsPercent) : undefined,
        retentionEnabled: values.retentionEnabled,
        retentionPercent: values.retentionEnabled ? parseFloat(values.retentionPercent) : undefined,
        retentionDueDate: values.retentionEnabled ? values.retentionDueDate : undefined,
      });
      onDone();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="p-3 rounded-lg border border-sky-200 bg-sky-50/50 space-y-3">
      <h4 className="font-bold text-slate-800">Change TDS & retention</h4>
      <DeductionFields
        values={values}
        onChange={setValues}
        netValue={Number(order.netValue)}
        gstValue={Number(order.taxValue)}
        rules={rules}
      />
      {error && <p className="font-semibold text-rose-700">{error}</p>}
      {confirming && (
        <p className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-1.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Expected amounts on every stage will be recalculated. Payments already recorded stay as they are. Click Save again to confirm.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 font-semibold text-slate-600 hover:text-slate-800">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-4 py-1.5 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Saving...' : confirming ? 'Yes, save' : 'Save'}
        </button>
      </div>
    </div>
  );
}
