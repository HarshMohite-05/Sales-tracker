'use client';

import React, { useEffect, useState } from 'react';
import { DEDUCTION_BASE_OPTIONS, DEFAULT_DEDUCTION_RULES, DeductionRules } from '@/lib/deductions';

/**
 * What TDS and retention are calculated on, company-wide. Directors can change it; new orders
 * take the rule in force when they are confirmed, and keep it.
 */
export default function PaymentRulesSettings() {
  const [rules, setRules] = useState<DeductionRules>(DEFAULT_DEDUCTION_RULES);
  const [isDirector, setIsDirector] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch('/api/settings/payment-rules'), fetch('/api/auth/me')])
      .then(async ([r, me]) => {
        if (r.ok) setRules((await r.json()).rules);
        if (me.ok) setIsDirector((await me.json()).user?.role === 'DIRECTOR');
      })
      .catch(() => {});
  }, []);

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/payment-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      setMessage('Saved. Orders confirmed from now on use these rules; existing orders keep theirs.');
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  const picker = (label: string, field: keyof DeductionRules, hint: string) => (
    <div className="space-y-1">
      <label className="block font-semibold text-slate-700">{label}</label>
      <select
        value={rules[field]}
        disabled={!isDirector}
        onChange={(e) => setRules({ ...rules, [field]: e.target.value as DeductionRules[typeof field] })}
        className="w-full sm:w-72 border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white disabled:bg-slate-50"
      >
        {DEDUCTION_BASE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 text-xs">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-900">TDS & Retention</h2>
        <p className="text-slate-500 mt-0.5">
          What the TDS and retention percentages are applied to. The percentages themselves are entered on each order
          when it is confirmed.
        </p>
      </div>

      {picker('TDS is calculated on', 'tdsBase', 'Usually the value before GST, when GST is shown separately on the invoice (CBDT Circular 23/2017).')}
      {picker('Retention is calculated on', 'retentionBase', 'As per your contracts: often the full billed amount including GST.')}

      {error && <p className="font-semibold text-rose-700">{error}</p>}
      {message && <p className="font-semibold text-emerald-700">{message}</p>}
      {isDirector ? (
        <button
          onClick={save}
          disabled={saving}
          className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-4 py-1.5 rounded-lg disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      ) : (
        <p className="text-slate-500">Only a director can change these.</p>
      )}
    </div>
  );
}
