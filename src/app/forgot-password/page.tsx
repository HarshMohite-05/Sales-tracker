'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  return <main className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-4 py-12">
    <img src="/company-logo-dark.svg" alt="Nirmaan Watertech Solutions" width="1000" height="525" className="mb-5 h-auto w-64 max-w-[75vw]" />
    <h1 className="mb-8 text-2xl font-black text-white">Sales Tracker</h1>
    <section className="w-full max-w-md space-y-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl sm:p-8">
      <div><h2 className="text-xl font-bold text-slate-900">Forgot password?</h2><p className="mt-2 text-sm text-slate-600">Enter your work email to request help from a company director. Your director will verify your identity before setting a new password.</p></div>
      {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : <form className="space-y-4" onSubmit={async e=>{
        e.preventDefault();setError('');setBusy(true);
        try {const r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const data=await r.json();if(!r.ok)throw new Error(data.error);setMessage(data.message);}catch(err:any){setError(err.message||'Could not submit the request. Please try again.');}finally{setBusy(false);}
      }}>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Email<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Your account email" /></label>
        {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">{busy?'Sending request…':'Request password reset'}</button>
      </form>}
      <Link href="/login" className="block text-center text-sm font-semibold text-sky-700 hover:text-sky-900">Back to Sign In</Link>
    </section>
  </main>;
}
