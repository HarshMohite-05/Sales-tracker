'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);
  useEffect(() => { setPasswordChanged(new URLSearchParams(window.location.search).get('passwordChanged') === '1'); }, []);

  async function handleLogin() {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      try { localStorage.setItem('crm-session-changed', crypto.randomUUID()); } catch {}
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto mb-5 w-64 max-w-[75vw]">
          {/* Supplied brand reference recreated as a scalable vector. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/company-logo-dark.svg" alt="Nirmaan Watertech Solutions" width="1000" height="525" className="h-auto w-full" />
        </div>
        <h2 className="text-2xl font-black text-white tracking-wide">Sales Tracker</h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-slate-100">
          {passwordChanged && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">Password changed. Sign in with your new password.</p>}
          {error && (
            <div role="alert" className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="login-page-field-1" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Email
              </label>
              <input id="login-page-field-1"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder="name@nirmaanwater.com"
                required
              />
            </div>

            <div>
              <label htmlFor="login-page-field-2" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <input id="login-page-field-2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="text-right"><Link href="/forgot-password" className="text-xs font-semibold text-sky-700 hover:text-sky-900">Forgot password?</Link></div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-md transition flex items-center justify-center space-x-2"
            >
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          &copy; {new Date().getFullYear()} Nirmaan WaterTech Solutions
        </p>
      </div>
    </div>
  );
}
