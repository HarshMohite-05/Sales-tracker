'use client';

import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';

interface DeleteClientModalProps {
  client: any;
  onClose: () => void;
  onDeleted: () => void;
}

// Director only: permanently deletes the client and everything under it, after the name is typed
export default function DeleteClientModal({ client, onClose, onDeleted }: DeleteClientModalProps) {
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === String(client.name).trim().toLowerCase();

  const parts = [
    ['contact', client.contacts?.length],
    ['site', client.sites?.length],
    ['requirement', client.enquiries?.length],
    ['conversation', client.activities?.length],
    ['follow-up', client.tasks?.length],
    ['quotation', client.quotations?.length],
    ['order', client.orders?.length],
    ['invoice', client.invoices?.length],
    ['receipt', client.receipts?.length],
  ]
    .filter(([, n]) => Number(n) > 0)
    .map(([label, n]) => `${n} ${label}${n === 1 ? '' : 's'}`);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete the client');
      onDeleted();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-rose-700 text-white px-5 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="font-bold text-sm tracking-wide">Delete client permanently</h3>
            <p className="text-xs text-rose-100 mt-0.5 truncate">{client.name}</p>
          </div>
          <button onClick={onClose} className="text-rose-200 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <p className="text-slate-700">
            This removes <strong>{client.name}</strong>
            {parts.length > 0 ? <> and its {parts.join(', ')}</> : ''}, plus their payment stages, execution steps,
            incentive entries and comments.
          </p>
          <p className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
            It does not go to the recycle bin and cannot be undone.
          </p>
          <div>
            <label htmlFor="delete-client-confirm" className="block font-semibold text-slate-700 mb-1">
              Type the client name to confirm
            </label>
            <input
              id="delete-client-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={client.name}
              autoComplete="off"
              autoFocus
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
              disabled={!matches || loading}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold px-3.5 py-1.5 rounded-lg flex items-center space-x-1 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{loading ? 'Deleting...' : 'Delete client'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
