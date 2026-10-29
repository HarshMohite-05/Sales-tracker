'use client';

import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle } from 'lucide-react';

const FIELDS = [
  { key: 'address', label: 'Address', placeholder: 'e.g. 204, Sai Plaza, Andheri (E), Mumbai 400069' },
  { key: 'phone', label: 'Phone', placeholder: 'e.g. +91 22 2845 9900' },
  { key: 'email', label: 'Email', placeholder: 'e.g. mumbai@nirmaanwater.com' },
  { key: 'gstin', label: 'GSTIN', placeholder: 'e.g. 27ABCDE1234F1Z5' },
] as const;

/**
 * The offices (Mumbai, Ahmedabad) and their details. Each salesperson's quotations print their office's
 * address, phone, email and GSTIN in the letterhead.
 */
export default function OfficeSettings() {
  const [offices, setOffices] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch('/api/settings/offices');
    if (!res.ok) return;
    const data = await res.json();
    setOffices(data.offices || []);
    setDrafts(Object.fromEntries((data.offices || []).map((o: any) => [o.id, Object.fromEntries(FIELDS.map((f) => [f.key, o[f.key] || '']))])));
  }

  useEffect(() => {
    load();
  }, []);

  async function save(id: string) {
    setMsg(null);
    const res = await fetch('/api/settings/offices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...drafts[id] }) });
    const out = await res.json().catch(() => ({}));
    setMsg({ id, ok: res.ok, text: res.ok ? 'Saved. New quotation PDFs print these details.' : out.error || 'Could not save' });
    if (res.ok) load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {offices.map((o) => (
        <section key={o.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xs">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Building2 className="h-4 w-4 text-sky-600" /> {o.name} office
            <span className="font-normal text-slate-500">
              · {o.code} · {o._count.users} active {o._count.users === 1 ? 'person' : 'people'}
            </span>
          </h2>
          <p className="text-slate-500">Printed in the letterhead of quotations made by people in this office. Blank fields use the company email and phone.</p>
          {FIELDS.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="font-semibold text-slate-700">{f.label}</span>
              <input
                value={drafts[o.id]?.[f.key] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [o.id]: { ...d[o.id], [f.key]: e.target.value } }))}
                placeholder={f.placeholder}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </label>
          ))}
          <div className="flex items-center gap-3">
            <button onClick={() => save(o.id)} className="rounded-lg bg-sky-600 px-4 py-1.5 font-semibold text-white hover:bg-sky-700">
              Save
            </button>
            {msg && msg.id === o.id && (
              <span className={`flex items-center gap-1 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {msg.ok && <CheckCircle className="h-3.5 w-3.5" />}
                {msg.text}
              </span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
