'use client';

import React from 'react';
import { formatDate, formatINR, humanize } from '@/lib/utils';
import { amountInWords, formatQuotationNumber, transportationLabel } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import { PAYMENT_STATUS_LABELS, reconcileOrder } from '@/lib/deductions';
import { originalTarget } from '@/lib/deliveryTracking';

interface OrderDetailsProps {
  order: any; // with enquiry, quotation and quotationVersion included
  showClient?: boolean;
}

/**
 * Everything about a confirmed order: PO, dates, the requirement it won, and the terms as quoted.
 */
export default function OrderDetails({ order, showClient = false }: OrderDetailsProps) {
  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const product = order.product || items.map((i) => i.item).filter(Boolean).join(', ');
  const value = Number(order.netValue);
  const quoteNumber = order.quotation
    ? formatQuotationNumber(order.quotation.quotationNumber, order.quotationVersion?.versionNumber ?? 0)
    : null;

  const revisions: any[] = order.deliveryRevisions || [];
  const original = originalTarget(order.deliveryDate, revisions);
  const rows: [string, React.ReactNode][] = [
    ['PO No', <strong key="po">{order.clientPoNumber || '—'}</strong>],
    ['PO / Order Date', formatDate(order.poDate || order.orderDate)],
    [
      'Targeted Completion Date',
      order.deliveryDate
        ? `${formatDate(order.deliveryDate)}${revisions.length > 0 && original ? ` (originally ${formatDate(original)}, revised ${revisions.length}×)` : ''}`
        : '—',
    ],
    [
      'Requirement',
      order.enquiry ? `${order.enquiry.enquiryNumber} - ${order.enquiry.title} (${requirementTypeLabel(order.enquiry)})` : '—',
    ],
    ['Quotation', quoteNumber || (order.isDirectOrder ? 'Direct order (no quotation)' : '—')],
    ['Product', product || '—'],
    ['Payment Terms', order.paymentTerms || '—'],
    ['Transportation', transportationLabel(order.transportation) || '—'],
    ['Salesperson', order.assignedSalesperson?.name || '—'],
  ];
  if (order.remarks) rows.push(['Remarks', order.remarks]);
  const steps: any[] = order.executionSteps || [];
  if (steps.length > 0) {
    const settled = steps.filter((st) => st.status !== 'PENDING').length;
    const last = [...steps].reverse().find((st) => st.status === 'DONE');
    rows.push(['Execution', `${settled} of ${steps.length} steps${last ? ` · last: ${last.name}` : ''}`]);
  }
  if (order.receipts && order.payments) {
    const r = reconcileOrder(order.payments, order.receipts, order);
    rows.push([
      'Payments',
      <span
        key="pay"
        className={r.status === 'FULLY_PAID' ? 'text-emerald-700 font-semibold' : r.status === 'OVERPAID' ? 'text-amber-700 font-semibold' : ''}
      >
        {PAYMENT_STATUS_LABELS[r.status]} · {formatINR(r.received)} received
        {r.outstanding > 0 && <> · {formatINR(r.outstanding)} outstanding</>}
        {r.notYetDue > 0 && <> · {formatINR(r.notYetDue)} not raised yet</>}
      </span>,
    ]);
  }

  return (
    <div className="text-xs space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showClient && <span className="font-bold text-slate-900 text-sm">{order.client?.name}</span>}
        <span className="font-bold text-slate-900">{order.orderNumber}</span>
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
          {humanize(order.orderStatus)}
        </span>
      </div>

      <div>
        <strong className="text-emerald-700 text-sm">{formatINR(value)}</strong>
        <span className="text-slate-500 italic"> · {amountInWords(value)}</span>
        {Number(order.taxValue) > 0 && (
          <span className="text-slate-500"> (+ GST {formatINR(order.taxValue)} = {formatINR(order.grossValue)})</span>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {rows.map(([label, content]) => (
          <div key={label} className="flex gap-2 min-w-0">
            <dt className="text-slate-500 shrink-0 w-28">{label}</dt>
            <dd className="text-slate-700 min-w-0 break-words">{content}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
