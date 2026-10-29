'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm" onSubmit={async e => {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('New passwords do not match'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: current, newPassword: password }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setCurrent(''); setPassword(''); setConfirm('');
      localStorage.setItem('crm-session-changed', crypto.randomUUID());
      router.replace('/login?passwordChanged=1');
    } catch (err: any) { setError(err.message || 'Could not change password'); } finally { setBusy(false); }
  }}>
    <h2 className="font-bold text-slate-900">Change password</h2>
    <p className="text-xs text-slate-500">Use at least 8 characters. Changing your password signs out all your sessions.</p>
    <label className="block text-slate-700">Current password<input autoComplete="current-password" type="password" required value={current} onChange={e=>setCurrent(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>
    <label className="block text-slate-700">New password<input autoComplete="new-password" type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>
    <label className="block text-slate-700">Confirm new password<input autoComplete="new-password" type="password" required minLength={8} value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <button disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy?'Saving…':'Change password'}</button>
  </form>;
}
