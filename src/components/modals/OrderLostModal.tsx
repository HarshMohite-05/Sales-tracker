'use client';

import React, { useState } from 'react';
import { X, XCircle } from 'lucide-react';

interface OrderLostModalProps {
  enquiry: { id: string; enquiryNumber?: string; title: string };
  clientName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

// The client did not place the order: closes the requirement as Lost with the reason
export default function OrderLostModal({ enquiry, clientName, onClose, onSuccess }: OrderLostModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('Please give a reason why the order was lost');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/enquiries/${enquiry.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStage: 'LOST', reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not mark the order as lost');
      onSuccess();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Order Lost</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              {[clientName, enquiry.enquiryNumber, enquiry.title].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <p className="text-slate-600">
            The requirement will be closed as <strong className="text-rose-700">Lost</strong> and no order can be confirmed on it.
          </p>
          <div>
            <label htmlFor="modals-OrderLostModal-field-1" className="block font-semibold text-slate-700 mb-1">Why was the order lost? *</label>
            <textarea id="modals-OrderLostModal-field-1"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client went with another vendor on price"
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-rose-500"
            />
          </div>
          {error && <p className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">{error}</p>}
          <div className="flex justify-end space-x-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-700">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-3.5 py-1.5 rounded-lg flex items-center space-x-1 disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>{loading ? 'Saving...' : 'Mark Order Lost'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
