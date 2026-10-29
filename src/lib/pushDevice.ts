/**
 * This browser's phone notifications belong to whoever is signed in on it. Safe to use in the browser only.
 */

async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Link this browser's notifications to the signed-in person (another person may have turned them on here). */
export async function claimThisDevice(): Promise<boolean> {
  try {
    await navigator.serviceWorker?.register('/sw.js');
    const sub = await currentSubscription();
    if (!sub) return false;
    const res = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Before signing out: stop sending this person's notifications to this browser. */
export async function releaseThisDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) await fetch('/api/notifications/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  } catch {}
}
