'use client';

import React, { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle, Smartphone, Sun } from 'lucide-react';
import { UPDATE_CATEGORIES } from '@/lib/notificationCategories';
import { claimThisDevice } from '@/lib/pushDevice';

// The push key as the browser wants it
function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Everyone's notification settings: phone notifications on this device, the morning summary and its time,
 * and for directors which kinds of update also buzz their phone.
 */
export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<{ morningSummaryEnabled: boolean; morningSummaryTime: string; pushCategories: string[] | null; devices: number } | null>(null);
  const [onHere, setOnHere] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch('/api/notifications/preferences');
    if (res.ok) setPrefs(await res.json());
  }

  useEffect(() => {
    load();
    if (!pushSupported()) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    // On for this device only when it is linked to the person signed in (another person may have turned it on here)
    claimThisDevice().then((linked) => {
      setOnHere(linked);
      if (linked) load();
    });
  }, []);

  async function save(patch: Record<string, unknown>, done: string) {
    setMsg(null);
    const res = await fetch('/api/notifications/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const out = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ ok: true, text: done });
      load();
    } else setMsg({ ok: false, text: out.error || 'Could not save' });
  }

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') throw new Error('Notifications were not allowed. Allow them for this site in your phone or browser settings, then try again.');
      const { publicKey } = await (await fetch('/api/notifications/push')).json();
      if (!publicKey) throw new Error('Phone notifications are not set up on the server yet (push keys missing).');
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not turn on notifications');
      setOnHere(true);
      setMsg({ ok: true, text: 'Phone notifications are on for this device. Send a test to check.' });
      load();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || 'Could not turn on notifications' });
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/notifications/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setOnHere(false);
    setMsg({ ok: true, text: 'Phone notifications are off for this device.' });
    setBusy(false);
    load();
  }

  async function test() {
    setMsg(null);
    const res = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
    const out = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: `Test sent to ${out.reached} device${out.reached === 1 ? '' : 's'}.` } : { ok: false, text: out.error || 'Could not send a test' });
  }

  // Show a notification straight from this device, without the server: tells a device that cannot display
  // notifications (blocked in the phone or computer settings) apart from one that does not receive them
  async function checkDevice() {
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Nirmaan CRM', { body: 'This device can show CRM notifications.', icon: '/icon-192.png', tag: `check-${Date.now()}` });
      setMsg({ ok: true, text: 'A notification was shown by this device. If you did not see it, notifications for this browser are turned off in your computer or phone settings (on Mac: System Settings → Notifications → Google Chrome).' });
    } catch (err: any) {
      setMsg({ ok: false, text: `This device could not show a notification: ${err.message || err}` });
    }
  }

  if (!prefs) return null;
  const card = 'bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4';
  const chosen = prefs.pushCategories || [];

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Bell className="h-4 w-4 text-sky-600" /> Notifications
      </h2>

      {/* Phone notifications on this device */}
      <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-xs">
        <p className="flex items-center gap-2 font-semibold text-slate-800">
          <Smartphone className="h-4 w-4" /> Phone notifications
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${onHere ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{onHere ? 'On for this device' : 'Off for this device'}</span>
          {prefs.devices > 0 && <span className="font-normal text-slate-500">· on for {prefs.devices} device{prefs.devices === 1 ? '' : 's'} in all</span>}
        </p>
        <p className="text-slate-500">Follow-up alerts, your morning summary{chosen.length ? ' and the updates you choose below' : ''} arrive on your phone even when the CRM is closed. Turn it on once on each phone or computer you use.</p>
        {permission === 'unsupported' || (isIos() && !isInstalled()) ? (
          <p className="rounded-lg bg-amber-50 p-2.5 text-amber-900">
            {isIos()
              ? 'On iPhone: tap the Share button in Safari, choose “Add to Home Screen”, open the CRM from your home screen, then come back here to turn notifications on.'
              : 'This browser cannot show notifications. Use Chrome or Edge, or on a phone add the CRM to the home screen first.'}
          </p>
        ) : permission === 'denied' ? (
          <p className="rounded-lg bg-rose-50 p-2.5 text-rose-800">Notifications are blocked for this site. Allow them in your browser or phone settings (site settings → Notifications), then reload this page.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onHere ? (
              <>
                <button onClick={test} className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700">
                  Send a test
                </button>
                <button onClick={checkDevice} className="rounded-lg border border-sky-300 px-3 py-1.5 font-semibold text-sky-700 hover:bg-sky-50">
                  Check this device
                </button>
                <button onClick={turnOff} disabled={busy} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  <BellOff className="h-3.5 w-3.5" /> Turn off on this device
                </button>
              </>
            ) : (
              <button onClick={turnOn} disabled={busy} className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
                {busy ? 'Turning on…' : 'Turn on phone notifications'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Morning summary */}
      <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-xs">
        <p className="flex items-center gap-2 font-semibold text-slate-800">
          <Sun className="h-4 w-4 text-amber-500" /> Morning summary
        </p>
        <p className="text-slate-500">
          Every day at the time you choose: today&apos;s follow-ups and the overdue ones{prefs.pushCategories ? ', the team’s follow-ups and what is waiting for your approval' : ''}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 font-semibold text-slate-700">
            <input type="checkbox" checked={prefs.morningSummaryEnabled} onChange={(e) => save({ morningSummaryEnabled: e.target.checked }, e.target.checked ? 'Morning summary is on.' : 'Morning summary is off.')} />
            Send me a morning summary
          </label>
          <label className="flex items-center gap-2 text-slate-700">
            at
            <input
              type="time"
              value={prefs.morningSummaryTime}
              disabled={!prefs.morningSummaryEnabled}
              onChange={(e) => setPrefs({ ...prefs, morningSummaryTime: e.target.value })}
              onBlur={(e) => e.target.value && save({ morningSummaryTime: e.target.value }, `Morning summary set for ${e.target.value}.`)}
              className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
            />
            <span className="text-slate-500">India time</span>
          </label>
        </div>
      </div>

      {/* Directors: which updates buzz the phone */}
      {prefs.pushCategories && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-xs">
          <p className="font-semibold text-slate-800">Updates from the team</p>
          <p className="text-slate-500">Every change anyone makes appears in your notifications (the bell). Tick the kinds that should also buzz your phone.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {UPDATE_CATEGORIES.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={chosen.includes(c.key)}
                  onChange={(e) => save({ pushCategories: e.target.checked ? [...chosen, c.key] : chosen.filter((k) => k !== c.key) }, 'Saved.')}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {msg && (
        <p role="status" className={`flex items-center gap-1.5 text-xs ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.ok && <CheckCircle className="h-3.5 w-3.5" />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
