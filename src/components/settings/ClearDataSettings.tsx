'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';

// Splits "OrderPaymentStage" into "Order payment stage"
function tableLabel(table: string) {
  const words = table.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Director only: empties all business data so the app can be tested from a clean start.
 * Users, offices and settings stay, so everyone can still sign in.
 */
export default function ClearDataSettings() {
  const [counts, setCounts] = useState<{ table: string; rows: number }[] | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState('DELETE EVERYTHING');
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch('/api/settings/clear-data');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: data.error || 'Could not load the record counts' });
      return;
    }
    setCounts(data.counts || []);
    setKept(data.kept || []);
    if (data.confirmation) setConfirmation(data.confirmation);
  }

  useEffect(() => {
    load();
  }, []);

  async function clearAll(e: React.FormEvent) {
    e.preventDefault();
    if (typed !== confirmation) return;
    setLoading(true);
    setMsg(null);
    const res = await fetch('/api/settings/clear-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: typed }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.error || 'Could not clear the data' });
      return;
    }
    setTyped('');
    setMsg({ ok: true, text: `Cleared ${data.cleared} records. The app now starts fresh.` });
    load();
  }

  const total = (counts || []).reduce((s, c) => s + c.rows, 0);
  const nonEmpty = (counts || []).filter((c) => c.rows > 0);

  return (
    <section className="space-y-4 rounded-2xl border border-rose-200 bg-white p-6 text-xs shadow-xs">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <AlertTriangle className="h-4 w-4 text-rose-600" /> Clear all data
      </h2>
      <p className="text-slate-600">
        Permanently deletes every client, contact, site, requirement, conversation, follow-up, quotation, order,
        invoice, receipt, target, incentive entry, notification and log, so you can test from a clean start.{' '}
        <strong>Kept:</strong> {kept.map(tableLabel).join(', ') || 'users, offices and settings'}. Everyone can still sign
        in. To remove a single client instead, open it and use <em>Delete client</em>.
      </p>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        {counts === null ? (
          <p className="text-slate-500">Counting records…</p>
        ) : total === 0 ? (
          <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle className="h-3.5 w-3.5" /> No business data. The app is fresh.
          </p>
        ) : (
          <>
            <p className="mb-2 font-semibold text-slate-800">{total} records would be deleted</p>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {nonEmpty.map((c) => (
                <li key={c.table} className="flex justify-between gap-2 text-slate-600">
                  <span>{tableLabel(c.table)}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{c.rows}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <form onSubmit={clearAll} className="space-y-2">
        <label htmlFor="clear-data-confirm" className="block font-semibold text-slate-700">
          Type <span className="font-mono text-rose-700">{confirmation}</span> to confirm. This cannot be undone.
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="clear-data-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono sm:max-w-xs"
          />
          <button
            type="submit"
            disabled={typed !== confirmation || loading || total === 0}
            className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 px-3.5 py-1.5 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {loading ? 'Clearing…' : 'Clear all data'}
          </button>
        </div>
      </form>
      {msg && (
        <p role="status" className={`rounded-lg border p-2.5 ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
