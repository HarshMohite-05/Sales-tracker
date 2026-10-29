'use client';

import React, { useState } from 'react';
import { CalendarClock, CheckCircle2, ChevronDown, Circle, MinusCircle, Plus } from 'lucide-react';
import { formatDate, formatINR, humanize } from '@/lib/utils';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import { fixedPaymentTerms, FULL_PAYMENT_STEP, invoiceGstStageId, isAddedStage, paymentStepName, raisingStep } from '@/lib/executionSteps';
import { allocateReceipts, invoiceGstAmount, isRaised } from '@/lib/deductions';
import { DELIVERY_BUCKETS, deliveryStatus } from '@/lib/deliveryTracking';

interface OrderExecutionProps {
  order: any; // with executionSteps, payments, receipts and enquiry included
  onChanged: () => void;
  defaultExpanded?: boolean;
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * An order's Execution, following its payment terms: one row per payment stage (e.g. "10% Advance"),
 * or a single Delivery & Invoice Raised row for fixed terms. Saving a row's date raises its payment as due (fixed
 * terms: the date + the credit days), and the invoice (with GST) is raised at one row of the order.
 * Older orders keep their standard steps, from receiving the client's PO to commissioning.
 */
export default function OrderExecution({ order, onChanged, defaultExpanded = false }: OrderExecutionProps) {
  const steps: any[] = order.executionSteps || [];
  const settled = steps.filter((s) => s.status !== 'PENDING').length;
  const canAdd = order.orderStatus !== 'CANCELLED';
  const completed = order.orderStatus === 'COMPLETED';
  const Container = completed ? 'details' : 'div';
  const Header = completed ? 'summary' : 'div';
  const delivery = deliveryStatus({ ...order, executionSteps: steps });
  const late = delivery.bucket === 'OVERDUE' || delivery.bucket === 'LATE';

  return (
    <Container {...(completed && defaultExpanded ? { open: true } : {})} className="group/order-execution bg-slate-50 rounded-xl border border-slate-200 text-xs">
      <Header className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 ${completed ? 'cursor-pointer list-none rounded-xl hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden' : ''}`}>
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
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-slate-500">{settled}/{steps.length} steps settled</span>
          <div className="md:text-right">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                completed ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
              }`}
            >
              {humanize(order.orderStatus)}
            </span>
            {order.deliveryDate && (
              <p className={`mt-1 ${late ? 'text-rose-700 font-semibold' : delivery.atRisk ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                {delivery.bucket === 'OVERDUE'
                  ? `Overdue by ${-delivery.daysLeft!} days · targeted completion `
                  : delivery.deliveredDate
                    ? `${DELIVERY_BUCKETS[delivery.bucket].label} · targeted completion `
                    : delivery.atRisk
                      ? 'At risk · targeted completion '
                      : 'Targeted completion '}
                {formatDate(order.deliveryDate)}
              </p>
            )}
          </div>
          {completed && (
            <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-slate-500 transition-transform group-open/order-execution:rotate-180" />
          )}
        </div>
      </Header>

      <div className="px-4 pb-4 space-y-3">
        {canAdd && <DeliveryTarget order={order} delivered={!!delivery.deliveredDate} onChanged={onChanged} />}

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-sky-500" style={{ width: `${steps.length ? (settled / steps.length) * 100 : 0}%` }} />
        </div>

        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
          <div className="flex px-3 py-2 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span className="flex-1">Step</span>
            {!steps.some((s) => s.name === FULL_PAYMENT_STEP) && <span className="w-16 text-center">Invoice</span>}
          </div>
          <div className="divide-y divide-slate-200">
            {/* A stage can be added at any position: before the first row or after any row */}
            {canAdd && <AddStage order={order} after={null} onChanged={onChanged} />}
            {steps.map((s) => (
              <div key={s.id}>
                <StepRow order={order} step={s} onChanged={onChanged} />
                {canAdd && <AddStage order={order} after={s} onChanged={onChanged} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}

// The order's targeted completion date with its revision history; set or revised with a reason
function DeliveryTarget({ order, delivered, onChanged }: { order: any; delivered: boolean; onChanged: () => void }) {
  const revisions: any[] = order.deliveryRevisions || [];
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDate(order.deliveryDate ? new Date(order.deliveryDate).toISOString().split('T')[0] : '');
    setReason('');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setError(null);
    if (!date) return setError('Enter the targeted completion date');
    if (order.deliveryDate && !reason.trim()) return setError('Enter why the date is changing');
    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/delivery-date`, 'PATCH', { deliveryDate: date, reason: reason.trim() });
      setEditing(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-slate-600">
          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold text-slate-700">Targeted completion date:</span>
          {order.deliveryDate ? formatDate(order.deliveryDate) : 'Not set'}
        </span>
        {!editing && !delivered && (
          <button onClick={open} className="text-[11px] font-semibold text-sky-700 hover:text-sky-900">
            {order.deliveryDate ? 'Revise date' : 'Set date'}
          </button>
        )}
      </div>

      {revisions.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
          {revisions.map((r) => (
            <li key={r.id}>
              {r.previousDate ? `${formatDate(r.previousDate)} → ` : 'Set to '}
              {formatDate(r.newDate)} · {r.reason}
              {r.revisedBy?.name && ` · ${r.revisedBy.name}`}, {formatDate(r.createdAt)}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
          <input
            type="date"
            aria-label="Targeted completion date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
          {order.deliveryDate && (
            <input
              type="text"
              aria-label="Reason for the change"
              placeholder="Why is it changing? e.g. Client site not ready"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-2 py-1"
            />
          )}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="rounded bg-sky-600 px-3 py-1 font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded px-2 py-1 font-semibold text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-rose-700">{error}</p>}
    </div>
  );
}

// Add a stage to the order's Execution at this position: after the given row, or first
function AddStage({ order, after, onChanged }: { order: any; after: any | null; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!name.trim()) {
      setError('Enter the stage name');
      return;
    }
    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/execution`, 'POST', { afterId: after?.id ?? null, name: name.trim() });
      setName('');
      setAdding(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  if (!adding) {
    return (
      <div className="px-3 pb-1.5 -mt-1 first:mt-0 first:pt-1.5">
        <button
          onClick={() => setAdding(true)}
          className="text-[11px] font-semibold text-slate-500 hover:text-sky-700 flex items-center gap-1"
        >
          <Plus className="h-3 w-3" />
          <span>{after ? 'Add stage here' : 'Add stage at the top'}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="px-3 py-2 space-y-1 bg-sky-50/60">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') setAdding(false);
          }}
          placeholder={after ? `New stage after ${after.name}, e.g. Issue PO to Vendor` : 'New first stage, e.g. Site survey'}
          maxLength={100}
          className="flex-1 min-w-48 border border-slate-300 rounded-lg px-2 py-1 bg-white"
          autoFocus
        />
        <button
          onClick={add}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-3 py-1 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Adding...' : 'Add'}
        </button>
        <button
          onClick={() => {
            setAdding(false);
            setName('');
            setError(null);
          }}
          className="text-slate-500 hover:text-slate-800 font-semibold"
        >
          Cancel
        </button>
      </div>
      {error && <p className="font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

async function send(url: string, method: string, body?: any) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save');
  return data;
}

// Received on a payment stage, after receipts have cleared earlier due stages first
function stageReceived(order: any, stage: any) {
  return allocateReceipts(order.payments || [], order.receipts || []).byStage.get(stage.id) ?? 0;
}

// Still to receive on a stage: its amount after deductions, plus the invoice GST asked with it
// (leave the GST out to show the stage on its own, e.g. before the invoice is raised)
function stageLeft(order: any, stage: any, withGst = true) {
  const asked = Number(stage.expectedAmount) + (withGst ? Number(stage.gstAmount || 0) : 0);
  return Math.max(Math.round((asked - stageReceived(order, stage)) * 100) / 100, 0);
}

function StepRow({ order, step, onChanged }: { order: any; step: any; onChanged: () => void }) {
  const orderId = order.id;
  const hasInvoice = order.invoiceStepId === step.id;
  // A stage added by hand only tracks work: it raises no payment and holds no invoice, and can be removed
  const isAdded = isAddedStage(step.name, order.payments || []);
  // Payment stages this row raises as due
  const stepNames = (order.executionSteps || []).map((s: any) => s.name);
  const raises: any[] = isAdded ? [] : (order.payments || []).filter((p: any) => raisingStep(p, stepNames) === step.name);
  // A payment's own row (not an older order's standard step): a payment can't be "not needed"
  const isPaymentRow = raises.some((p) => paymentStepName(p) === step.name);
  // Fixed payment terms: the date saved here + the credit days is when the payment is due (no invoice or GST)
  const isFullPayment = step.name === FULL_PAYMENT_STEP;
  const creditDays = raises.map((p) => fixedPaymentTerms(p.description)?.days).find(Boolean) ?? 0;
  const invoiceElsewhere = !!order.invoiceStepId && !hasInvoice;
  const [invoicing, setInvoicing] = useState(false);
  const [removingInvoice, setRemovingInvoice] = useState(false);
  // Editing: ticking a pending step, or changing the date of a done one
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(step.completedDate ? step.completedDate.slice(0, 10) : today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: 'DONE' | 'NOT_APPLICABLE' | 'PENDING') {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/execution/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, completedDate: status === 'DONE' ? date : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setEditing(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function remove() {
    setError(null);
    setSaving(true);
    try {
      await send(`/api/orders/${orderId}/execution/${step.id}`, 'DELETE');
      onChanged();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  const done = step.status === 'DONE';
  const notNeeded = step.status === 'NOT_APPLICABLE';

  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={done || editing}
            disabled={saving || notNeeded}
            onChange={(e) => {
              if (e.target.checked) {
                setDate(today());
                setEditing(true);
              } else if (done) {
                save('PENDING');
              } else {
                setEditing(false);
              }
            }}
            className="h-4 w-4 accent-sky-600"
          />
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : notNeeded ? (
            <MinusCircle className="h-4 w-4 text-slate-300 shrink-0" />
          ) : (
            <Circle className="h-4 w-4 text-slate-300 shrink-0" />
          )}
          <span className={notNeeded ? 'text-slate-500 line-through' : 'font-semibold text-slate-800'}>{step.name}</span>
        </label>

        <div className="pl-12 sm:pl-0 flex items-center gap-3 sm:justify-end">
          {done && !editing && (
            <span className="text-emerald-700">
              {isFullPayment ? 'Delivered & invoiced on' : 'Done on'} <strong>{formatDate(step.completedDate)}</strong>
              <button onClick={() => setEditing(true)} className="ml-2 text-sky-700 hover:text-sky-900 font-semibold">
                Change date
              </button>
            </span>
          )}
          {notNeeded && (
            <button onClick={() => save('PENDING')} disabled={saving} className="text-sky-700 hover:text-sky-900 font-semibold">
              Needed after all
            </button>
          )}
          {step.status === 'PENDING' && !editing && !isPaymentRow && (
            <button onClick={() => save('NOT_APPLICABLE')} disabled={saving} className="text-slate-500 hover:text-slate-700 font-semibold">
              Not needed
            </button>
          )}
          {isAdded && !editing && (
            <button onClick={remove} disabled={saving} className="text-slate-500 hover:text-rose-600 font-semibold">
              Remove
            </button>
          )}
        </div>
        {/* Added stages and fixed-terms orders hold no invoice */}
        {isAdded || isFullPayment ? (
          <span className="hidden sm:block sm:w-16" />
        ) : (
        <label
          className={`pl-12 sm:pl-0 sm:w-16 flex items-center sm:justify-center gap-1.5 ${invoiceElsewhere ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          title={invoiceElsewhere ? 'The invoice is already raised at another step' : 'Raise the invoice at this step'}
        >
          <input
            type="checkbox"
            checked={(hasInvoice && !removingInvoice) || invoicing}
            disabled={invoiceElsewhere || saving}
            onChange={(e) => {
              // Unticking a raised invoice asks before removing it
              if (hasInvoice) setRemovingInvoice(!e.target.checked);
              else setInvoicing(e.target.checked);
            }}
            className="h-4 w-4 accent-violet-600 disabled:opacity-40"
          />
          <span className="sm:hidden text-slate-600 font-semibold">Invoice</span>
        </label>
        )}
      </div>

      {/* Payments this step raises */}
      {raises.map((p) => (
        <p key={p.id} className="pl-12 text-[11px]">
          {fixedPaymentTerms(p.description) ? (
            // Fixed terms: the payment falls due the credit days after the date saved here
            p.dueDate ? (
              <span className={isRaised(p.dueDate) ? 'text-emerald-700 font-semibold' : 'text-sky-700 font-semibold'}>
                {p.description}: {formatINR(p.expectedAmount)}{' '}
                {isRaised(p.dueDate) ? `due since ${formatDate(p.dueDate)}` : `not raised yet · due on ${formatDate(p.dueDate)}`}
                {stageLeft(order, p) > 0 ? ` · ${formatINR(stageLeft(order, p))} to receive` : ' · received'}
              </span>
            ) : (
              <span className="text-slate-500">Save the delivery &amp; invoice date: the payment is due {creditDays} days after it</span>
            )
          ) : p.dueDate ? (
            <span className="text-emerald-700 font-semibold">
              {isPaymentRow ? `${formatINR(p.expectedAmount)} payment` : `${Number(p.percent)}% ${p.description} payment`} due since{' '}
              {formatDate(p.dueDate)}
              {stageLeft(order, p) > 0 ? ` · ${formatINR(stageLeft(order, p))} to receive` : ' · received'}
            </span>
          ) : isPaymentRow ? (
            <span className="text-slate-500">Save the date: {formatINR(p.expectedAmount)} becomes due from it</span>
          ) : (
            <span className="text-slate-500">When done: {Number(p.percent)}% {p.description} payment becomes due</span>
          )}
        </p>
      ))}

      {hasInvoice && !invoicing && (
        <InvoiceSummary
          order={order}
          step={step}
          removing={removingInvoice}
          setRemoving={setRemovingInvoice}
          onEdit={() => setInvoicing(true)}
          onChanged={onChanged}
        />
      )}
      {invoicing && <InvoiceForm order={order} step={step} onDone={() => setInvoicing(false)} onChanged={onChanged} />}

      {editing && (
        <div className="pl-12 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-700">{isFullPayment ? 'Delivered & invoiced on' : 'Done on'}</span>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1"
          />
          {isFullPayment && date && creditDays > 0 && (
            <span className="text-sky-700">
              + {creditDays} days = due on <strong>{formatDate(new Date(new Date(date).getTime() + creditDays * 86400000))}</strong>
            </span>
          )}
          <button
            onClick={() => save('DONE')}
            disabled={saving || !date}
            className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-3 py-1 rounded-lg disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="text-slate-500 hover:text-slate-800 font-semibold">
            Cancel
          </button>
        </div>
      )}

      {step.updatedBy?.name && !editing && step.status !== 'PENDING' && (
        <p className="pl-12 text-[11px] text-slate-500">marked by {step.updatedBy.name}</p>
      )}
      {error && <p className="pl-12 font-semibold text-rose-700">{error}</p>}
    </div>
  );
}

// The invoice raised at a step: the GST and what to ask the client for
function InvoiceSummary({
  order,
  step,
  removing,
  setRemoving,
  onEdit,
  onChanged,
}: {
  order: any;
  step: any;
  removing: boolean;
  setRemoving: (v: boolean) => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const stage = (order.payments || []).find((p: any) => Number(p.gstAmount) > 0) ||
    (order.payments || []).find((p: any) => p.id === invoiceGstStageId(order.payments || [], step.name));
  const gst = Number(order.invoiceGstAmount);
  const asked = stage ? Math.round((Number(stage.expectedAmount) + gst) * 100) / 100 : 0;
  const got = stage ? stageReceived(order, stage) : 0;
  const left = stage ? stageLeft(order, stage) : 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/invoice`, 'DELETE');
      setRemoving(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="ml-12 p-2.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-900 space-y-1">
      <p>
        <strong>Invoice raised</strong> on {formatDate(order.invoiceDate)} · GST {Number(order.invoiceGstPercent)}%{' '}
        {gst > 0 ? <strong>{formatINR(gst)}</strong> : '(no GST)'}
      </p>
      {stage && (
        <p>
          Asked with {Number(stage.percent)}% {stage.description}: {formatINR(stage.expectedAmount)} + GST {formatINR(gst)} ={' '}
          <strong>{formatINR(asked)}</strong>
          {got > 0 && <> · received {formatINR(got)}</>}
          {' · '}
          {left > 0 ? (
            <strong className="text-rose-700">{formatINR(left)} still to receive</strong>
          ) : (
            <strong className="text-emerald-700">fully received</strong>
          )}
        </p>
      )}
      {error && <p className="font-semibold text-rose-700">{error}</p>}
      {removing ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="font-semibold">Remove this invoice? Its GST will no longer be asked for.</span>
          <button onClick={() => setRemoving(false)} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700">
            Keep it
          </button>
          <button
            onClick={remove}
            disabled={saving}
            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
          >
            {saving ? 'Removing...' : 'Yes, remove'}
          </button>
        </div>
      ) : (
        <div className="flex gap-3 pt-0.5">
          <button onClick={onEdit} className="text-sky-700 hover:text-sky-900 font-semibold">Change</button>
          <button onClick={() => setRemoving(true)} className="text-slate-500 hover:text-rose-600 font-semibold">Remove invoice</button>
        </div>
      )}
    </div>
  );
}

// Raise (or change) the invoice at a step: GST % and date, with what to ask the client for
function InvoiceForm({ order, step, onDone, onChanged }: { order: any; step: any; onDone: () => void; onChanged: () => void }) {
  const gstIncluded = Number(order.taxValue) > 0;
  // GST quoted on the order fixes the rate; otherwise 18% unless changed here
  const quotedPercent = gstIncluded && Number(order.netValue) > 0 ? Math.round((Number(order.taxValue) / Number(order.netValue)) * 10000) / 100 : 0;
  const [percent, setPercent] = useState(
    gstIncluded ? String(quotedPercent) : order.invoiceGstPercent ? String(Number(order.invoiceGstPercent)) : '18'
  );
  const [date, setDate] = useState(
    order.invoiceDate ? order.invoiceDate.slice(0, 10) : step.completedDate ? step.completedDate.slice(0, 10) : today()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stage = (order.payments || []).find((p: any) => p.id === invoiceGstStageId(order.payments || [], step.name));
  const gst = invoiceGstAmount(order, parseFloat(percent) || 0);
  const left = stage ? stageLeft(order, stage, false) : 0;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await send(`/api/orders/${order.id}/invoice`, 'PUT', { stepId: step.id, gstPercent: percent, invoiceDate: date });
      onDone();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="ml-12 p-3 rounded-lg border border-violet-200 bg-violet-50/60 space-y-2">
      <p className="font-bold text-slate-800">Raise invoice at {step.name}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block font-semibold text-slate-700 mb-1">GST</span>
          {gstIncluded ? (
            <span className="text-slate-600">{quotedPercent}% as quoted</span>
          ) : (
            <span className="flex items-stretch">
              <input
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
                className="w-16 border border-slate-300 rounded-l-lg px-2 py-1 text-right bg-white"
                autoFocus
              />
              <span className="px-2 py-1 rounded-r-lg bg-slate-100 border border-l-0 border-slate-300 font-semibold text-slate-600">%</span>
            </span>
          )}
        </label>
        <label className="block">
          <span className="block font-semibold text-slate-700 mb-1">Invoice date</span>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
          />
        </label>
      </div>
      <div className="p-2 rounded bg-white border border-slate-200 space-y-0.5">
        <p className="text-slate-600">
          GST {parseFloat(percent) || 0}% on {formatINR(order.netValue)} = <strong>{formatINR(gst)}</strong>
        </p>
        {stage && (
          <p className="text-slate-800">
            Ask the client for {formatINR(left)} due ({Number(stage.percent)}% {stage.description}) + GST {formatINR(gst)} ={' '}
            <strong className="text-violet-800">{formatINR(left + gst)}</strong>
          </p>
        )}
        <p className="text-[11px] text-slate-500">Only one step can have the invoice; the other Invoice boxes are blocked once it is raised.</p>
      </div>
      {error && <p className="font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1 font-semibold text-slate-600 hover:text-slate-800">Cancel</button>
        <button
          onClick={save}
          disabled={saving || !date}
          className="bg-violet-600 hover:bg-violet-700 text-white font-semibold px-3 py-1 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Raise invoice'}
        </button>
      </div>
    </div>
  );
}
