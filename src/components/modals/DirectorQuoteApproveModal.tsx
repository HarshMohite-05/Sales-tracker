'use client';

import React, { useState } from 'react';
import { X, CheckCircle, XCircle } from 'lucide-react';
import { formatINR } from '@/lib/utils';

interface DirectorQuoteApproveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  quotation: {
    id: string;
    quotationNumber: string;
    discountPercent: number;
    finalValue: number;
    originalValue: number;
    client: { name: string };
    salesperson: { name: string };
    approvals?: Array<{ reason: string }>;
  };
}

export default function DirectorQuoteApproveModal({
  isOpen,
  onClose,
  onSuccess,
  quotation,
}: DirectorQuoteApproveModalProps) {
  const [decisionNotes, setDecisionNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleDecision(decision: 'APPROVE' | 'REJECT') {
    setError(null);
    setLoading(true);

    try {
      if (decision === 'REJECT' && !rejectionReason.trim()) {
        throw new Error('Please enter a rejection reason for the salesperson');
      }

      const res = await fetch(`/api/quotations/${quotation.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          decisionNotes,
          rejectionReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process approval');

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Approve Quotation</h3>
            <p className="text-xs text-slate-300 mt-0.5">{quotation.client.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        <div className="p-5 space-y-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">Requested Discount:</span>
              <p className="font-bold text-amber-700 text-sm mt-0.5">{Number(quotation.discountPercent)}%</p>
            </div>
            <div>
              <span className="text-slate-500">Salesperson:</span>
              <p className="font-semibold text-slate-800 mt-0.5">{quotation.salesperson.name}</p>
            </div>
            <div>
              <span className="text-slate-500">Original Value:</span>
              <p className="font-medium text-slate-700 mt-0.5">{formatINR(quotation.originalValue)}</p>
            </div>
            <div>
              <span className="text-slate-500">Final Discounted Value:</span>
              <p className="font-bold text-sky-800 mt-0.5">{formatINR(quotation.finalValue)}</p>
            </div>
          </div>

          {quotation.approvals && quotation.approvals.length > 0 && (
            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-xs text-amber-900">
              <span className="font-semibold">Salesperson Justification:</span>
              <p className="mt-0.5">{quotation.approvals[0].reason}</p>
            </div>
          )}

          <div>
            <label htmlFor="modals-DirectorQuoteApproveModal-field-1" className="block text-xs font-semibold text-slate-700 mb-1">
              Director Instructions / Notes (Optional)
            </label>
            <input id="modals-DirectorQuoteApproveModal-field-1"
              type="text"
              placeholder="e.g. Approved. Ensure 30% advance is cleared before manufacturing starts."
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
            />
          </div>

          <div>
            <label htmlFor="modals-DirectorQuoteApproveModal-field-2" className="block text-xs font-semibold text-slate-700 mb-1">
              Rejection Reason (Required if rejecting)
            </label>
            <input id="modals-DirectorQuoteApproveModal-field-2"
              type="text"
              placeholder="e.g. Margin too thin. Offer maximum 3.5% or negotiate spares separately."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>

            <div className="flex space-x-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDecision('REJECT')}
                className="bg-rose-50 border border-rose-300 hover:bg-rose-100 text-rose-700 text-xs font-semibold px-3.5 py-1.5 rounded-lg flex items-center space-x-1"
              >
                <XCircle className="h-4 w-4" />
                <span>Reject</span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleDecision('APPROVE')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm flex items-center space-x-1"
              >
                <CheckCircle className="h-4 w-4" />
                <span>Approve</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
