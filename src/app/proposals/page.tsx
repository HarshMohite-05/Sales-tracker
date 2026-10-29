'use client';

import React, { Suspense, useState, useEffect } from 'react';
import LoadError from '@/components/ui/LoadError';
import AppShell from '@/components/layout/AppShell';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FileSpreadsheet,
  CheckCircle,
  Clock,
  AlertTriangle,
  ShoppingCart,
  Plus,
  XCircle,
} from 'lucide-react';
import { formatDate, humanize } from '@/lib/utils';
import DirectorQuoteApproveModal from '@/components/modals/DirectorQuoteApproveModal';
import ConvertOrderModal from '@/components/modals/ConvertOrderModal';
import OrderLostModal from '@/components/modals/OrderLostModal';
import CreateQuotationModal from '@/components/modals/CreateQuotationModal';
import { formatQuotationNumber } from '@/lib/quotation';
import QuotationTerms from '@/components/quotations/QuotationTerms';
import QuotationActions from '@/components/quotations/QuotationActions';
import QuotationRevisions from '@/components/quotations/QuotationRevisions';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';
import { presetFilters } from '@/lib/recordFilters';

export default function ProposalsPage() {
  return <Suspense fallback={<AppShell><p className="p-6 text-xs text-slate-500">Loading quotations…</p></AppShell>}><ProposalsContent /></Suspense>;
}

function ProposalsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStatus = searchParams.get('status') || '';
  const initialStatus = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACCEPTED', 'REJECTED'].includes(requestedStatus) ? requestedStatus : '';
  const [quotations, setQuotations] = useState<any[]>([]);
  const quotationFilter = useRecordFilters(quotations);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { quotationFilter.onChange(presetFilters('approvalStatus', 'text', 'equals', initialStatus)); }, [initialStatus]);
  const [userRole, setUserRole] = useState<'DIRECTOR' | 'SALESPERSON'>('SALESPERSON');

  const [selectedQuoteForApproval, setSelectedQuoteForApproval] = useState<any>(null);
  const [selectedQuoteForOrder, setSelectedQuoteForOrder] = useState<any>(null);
  const [selectedQuoteForLost, setSelectedQuoteForLost] = useState<any>(null);
  const [selectedQuoteForRevision, setSelectedQuoteForRevision] = useState<any>(null);
  // Set together with selectedQuoteForRevision to edit that version in place instead of revising
  const [editVersionNumber, setEditVersionNumber] = useState<number | undefined>(undefined);

  function openRevise(quote: any) {
    setEditVersionNumber(undefined);
    setSelectedQuoteForRevision(quote);
  }

  function openEdit(quote: any, versionNumber: number) {
    setEditVersionNumber(versionNumber);
    setSelectedQuoteForRevision(quote);
  }

  async function loadQuotations() {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/quotations');
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) {
        const data = await res.json();
        setQuotations(data.quotations || []);
      }

      const me = await fetch('/api/auth/me');
      if (me.ok) {
        const meData = await me.json();
        setUserRole(meData.user.role);
      }
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  useEffect(() => {
    loadQuotations();
  }, []);

  return (
    <AppShell>
      <div className="space-y-5">
        <LoadError message={loadError} onRetry={loadQuotations} />
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Quotations</h1>
          </div>

        </div>

        {/* Quotations List */}
        <RecordSearch {...quotationFilter} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden divide-y divide-slate-100">
          {loadError ? null : loading ? (
            <div className="p-12 text-center text-xs text-slate-500">Loading...</div>
          ) : quotationFilter.rows.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">{quotations.length ? 'No quotations match these filters.' : 'No quotations.'}</div>
          ) : (
            quotationFilter.rows.map((quote) => {
              const isPending = quote.approvalStatus === 'PENDING_APPROVAL';
              const isApproved = quote.approvalStatus === 'APPROVED';
              const isAccepted = quote.approvalStatus === 'ACCEPTED';
              const isLost = quote.enquiry?.stage === 'LOST';

              return (
                <div key={quote.id} className="p-5 flex flex-col md:flex-row md:items-start justify-between gap-4 text-xs">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-navy-950">{quote.client.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isApproved
                            ? 'bg-emerald-100 text-emerald-800'
                            : isAccepted
                            ? 'bg-sky-100 text-sky-800'
                            : isPending
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {humanize(quote.approvalStatus)}
                      </span>
                      {isLost && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Order lost</span>
                      )}
                    </div>

                    <p className="text-slate-600 font-medium">
                      {quote.enquiry?.enquiryNumber} · {quote.enquiry?.title}
                    </p>
                    <QuotationTerms quotation={quote} />

                    <div className="flex flex-wrap items-center gap-3 text-slate-500 pt-1 text-[11px]">
                      {Number(quote.discountPercent) > 0 && <span>{Number(quote.discountPercent)}% off</span>}
                      <span>{formatDate(quote.proposalDate)}</span>
                      <span className="font-semibold text-slate-700">{formatQuotationNumber(quote.quotationNumber, quote.currentVersionNumber)}</span>
                      <span>{quote.salesperson.name}</span>
                    </div>
                    <div className="pt-1">
                      <QuotationActions quotation={quote} onEdit={openEdit} onRevise={openRevise} onChanged={loadQuotations} />
                    </div>
                    <QuotationRevisions quotation={quote} onEdit={openEdit} onChanged={loadQuotations} />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Director Review Button */}
                    {isPending && userRole === 'DIRECTOR' && (
                      <button
                        onClick={() => setSelectedQuoteForApproval(quote)}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 rounded-xl font-semibold shadow-xs"
                      >
                        Approve
                      </button>
                    )}

                    {/* Convert to Confirmed Order */}
                    {!isAccepted && !isPending && !isLost && quote.approvalStatus !== 'REJECTED' && (
                      <button
                        onClick={() => setSelectedQuoteForOrder(quote)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl font-semibold shadow-xs flex items-center space-x-1"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        <span>Confirm Order</span>
                      </button>
                    )}

                    {/* The client did not place the order */}
                    {!isAccepted && !isLost && quote.enquiry && (
                      <button
                        onClick={() => setSelectedQuoteForLost(quote)}
                        className="border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 px-3.5 py-1.5 rounded-xl font-semibold shadow-xs flex items-center space-x-1"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Order Lost</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedQuoteForApproval && (
        <DirectorQuoteApproveModal
          isOpen={!!selectedQuoteForApproval}
          onClose={() => setSelectedQuoteForApproval(null)}
          onSuccess={() => {
            setSelectedQuoteForApproval(null);
            loadQuotations();
          }}
          quotation={selectedQuoteForApproval}
        />
      )}

      {selectedQuoteForOrder && (
        <ConvertOrderModal
          isOpen={!!selectedQuoteForOrder}
          onClose={() => setSelectedQuoteForOrder(null)}
          onSuccess={() => {
            // Next step after confirming: track the payments on the client's page
            router.push(`/clients/${selectedQuoteForOrder.clientId}?tab=payments`);
          }}
          quotation={selectedQuoteForOrder}
        />
      )}

      {selectedQuoteForLost && (
        <OrderLostModal
          enquiry={selectedQuoteForLost.enquiry}
          clientName={selectedQuoteForLost.client.name}
          onClose={() => setSelectedQuoteForLost(null)}
          onSuccess={() => {
            setSelectedQuoteForLost(null);
            loadQuotations();
          }}
        />
      )}

      {selectedQuoteForRevision && (
        <CreateQuotationModal
          isOpen={!!selectedQuoteForRevision}
          onClose={() => setSelectedQuoteForRevision(null)}
          onSuccess={() => {
            setSelectedQuoteForRevision(null);
            loadQuotations();
          }}
          clientId={selectedQuoteForRevision.clientId}
          clientName={selectedQuoteForRevision.client.name}
          enquiries={[selectedQuoteForRevision.enquiry]}
          existingQuotation={selectedQuoteForRevision}
          editVersionNumber={editVersionNumber}
        />
      )}
    </AppShell>
  );
}
