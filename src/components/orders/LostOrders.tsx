'use client';

import React from 'react';
import Link from 'next/link';
import { XCircle } from 'lucide-react';
import { formatDate, formatINR } from '@/lib/utils';
import { formatQuotationNumber } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';

interface LostOrdersProps {
  // Requirements closed as Lost, with their quotations and stage history
  enquiries: any[];
  showClient?: boolean;
}

/**
 * Orders the client did not place: requirements marked Order Lost, with the quotation that was
 * offered, the reason, and when and by whom it was marked lost.
 */
export default function LostOrders({ enquiries, showClient = false }: LostOrdersProps) {
  if (enquiries.length === 0) return <p className="text-xs text-slate-500">No lost orders.</p>;

  return (
    <div className="space-y-2">
      {enquiries.map((enq) => {
        const quote = enq.quotations?.[0];
        const lost = (enq.stageHistory || []).find((h: any) => h.toStage === 'LOST');
        return (
          <div key={enq.id} id={`record-${enq.id}`} className="scroll-mt-24 p-4 bg-rose-50/40 rounded-xl border border-rose-100 text-xs space-y-1">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span className="text-[11px] font-bold tracking-wider text-sky-700">{enq.enquiryNumber}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Order lost</span>
                </p>
                <h4 className="font-bold text-sm text-slate-900 mt-0.5">{enq.title}</h4>
                <p className="text-slate-500">
                  {showClient && enq.client && (
                    <>
                      <Link href={`/clients/${enq.client.id}?tab=orders`} className="font-semibold text-slate-700 hover:text-sky-700">
                        {enq.client.name}
                      </Link>
                      {' · '}
                    </>
                  )}
                  {requirementTypeLabel(enq)}
                  {enq.assignedTo?.name && <> · {enq.assignedTo.name}</>}
                </p>
              </div>
              {quote && (
                <div className="md:text-right shrink-0">
                  <p className="font-semibold text-slate-800">
                    Quotation {formatQuotationNumber(quote.quotationNumber, quote.currentVersionNumber ?? 0)}
                  </p>
                  <p className="text-slate-500">
                    Quoted <strong className="text-slate-700">{formatINR(quote.finalValue)}</strong>
                  </p>
                </div>
              )}
            </div>
            <p className="text-rose-800">
              <span className="font-semibold">Reason:</span> {enq.lostReason || 'Not given'}
            </p>
            {lost && (
              <p className="text-[11px] text-slate-500">
                Marked lost on {formatDate(lost.createdAt)}
                {lost.changedBy?.name && <> by {lost.changedBy.name}</>}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
