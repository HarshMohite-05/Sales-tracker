'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { Trash2, RotateCcw, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { formatDateTime, humanize } from '@/lib/utils';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';

const ENTITY_LABELS: Record<string, string> = {
  ENQUIRY: 'Requirement',
  QUOTATION: 'Quotation',
  QUOTATION_VERSION: 'Quotation revision',
  ORDER: 'Order',
  TARGET: 'Target',
};

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Deleting soon';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${Math.max(hours, 1)} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}

export default function RecycleBinPage() {
  const [items, setItems] = useState<any[]>([]);
  const itemFilter = useRecordFilters(items);
  const [retentionDays, setRetentionDays] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false);

  async function loadItems() {
    try {
      const res = await fetch('/api/recycle-bin');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the recycle bin');
      setItems(data.items || []);
      setCanPermanentlyDelete(data.canPermanentlyDelete === true);
      setRetentionDays(data.retentionDays || 5);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadItems();
  }, []);

  async function restore(item: any) {
    setError(null);
    setMessage(null);
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/recycle-bin/${item.id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not restore this item');
      setMessage(data.message || 'Restored.');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      window.dispatchEvent(new Event('crm:data-changed'));
    } catch (err: any) {
      setError(err.message);
    }
    setBusyId(null);
  }

  async function deleteForever(item: any) {
    setError(null);
    setMessage(null);
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/recycle-bin/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete this item');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setConfirmDeleteId(null);
    } catch (err: any) {
      setError(err.message);
    }
    setBusyId(null);
  }

  async function emptyBin() {
    setError(null);
    setMessage(null);
    setEmptying(true);
    try {
      const res = await fetch('/api/recycle-bin', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not empty the recycle bin');
      setMessage(`Permanently deleted ${data.deletedCount} item${data.deletedCount === 1 ? '' : 's'}.`);
      setItems([]);
      setConfirmEmpty(false);
    } catch (err: any) {
      setError(err.message);
    }
    setEmptying(false);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Recycle Bin</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Deleted items stay here for {retentionDays} days, then they are deleted permanently.
            </p>
          </div>

          {canPermanentlyDelete && <button
            onClick={() => setConfirmEmpty(true)}
            disabled={items.length === 0}
            className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed self-start md:self-auto"
          >
            <Trash2 className="h-4 w-4" />
            <span>Empty Bin</span>
          </button>}
        </div>

        {canPermanentlyDelete && confirmEmpty && (
          <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 space-y-2 text-xs">
            <p className="font-bold text-rose-800 flex items-center space-x-1.5">
              <AlertTriangle className="h-4 w-4" />
              <span>
                Permanently delete all {items.length} item{items.length === 1 ? '' : 's'}?
              </span>
            </p>
            <p className="text-rose-700">This can&apos;t be undone. Nothing in the bin can be restored afterwards.</p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setConfirmEmpty(false)}
                className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={emptyBin}
                disabled={emptying}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
              >
                {emptying ? 'Emptying...' : 'Yes, empty the bin'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700">{error}</div>
        )}
        {message && (
          <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700">
            {message}
          </div>
        )}

        {/* Items */}
        <RecordSearch {...itemFilter} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading...</div>
          ) : itemFilter.rows.length === 0 ? (
            <div className="p-10 text-center">
              <Trash2 className="h-8 w-8 text-slate-300 mx-auto" />
              <p className="mt-2 text-sm font-semibold text-slate-600">{items.length ? 'No items match these filters' : 'The recycle bin is empty'}</p>
              <p className="text-xs text-slate-500 mt-0.5">{items.length ? 'Try changing or clearing your filters.' : 'Deleted requirements and quotations will show up here.'}</p>
            </div>
          ) : (
            itemFilter.rows.map((item) => (
              <div key={item.id} className="p-4 text-xs">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {ENTITY_LABELS[item.entityType] || humanize(item.entityType)}
                    </span>
                    <h4 className="font-bold text-sm text-slate-900 truncate">{item.label}</h4>
                    <p className="text-slate-500 mt-0.5">
                      {item.clientName && (
                        <>
                          <Link href={`/clients/${item.clientId}`} className="text-sky-700 hover:underline inline-flex items-center gap-0.5">
                            {item.clientName}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                          {' · '}
                        </>
                      )}
                      {item.description && <>{item.description} · </>}
                      Deleted {formatDateTime(item.deletedAt)} by {item.deletedBy?.name || 'Unknown'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeLeft(item.expiresAt)}
                    </span>
                    <button
                      onClick={() => restore(item)}
                      disabled={busyId === item.id}
                      className="px-3 py-1 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold flex items-center gap-1 disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Restore</span>
                    </button>
                    {canPermanentlyDelete && <button
                      onClick={() => setConfirmDeleteId(item.id)}
                      disabled={busyId === item.id}
                      className="px-3 py-1 rounded-lg text-slate-500 hover:text-rose-600 font-semibold flex items-center gap-1 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete forever</span>
                    </button>}
                  </div>
                </div>

                {canPermanentlyDelete && confirmDeleteId === item.id && (
                  <div className="mt-2 p-3 rounded-lg border border-rose-200 bg-rose-50 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <p className="text-rose-700 font-semibold">Permanently delete this? It can&apos;t be restored afterwards.</p>
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => deleteForever(item)}
                        disabled={busyId === item.id}
                        className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
                      >
                        {busyId === item.id ? 'Deleting...' : 'Delete forever'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
