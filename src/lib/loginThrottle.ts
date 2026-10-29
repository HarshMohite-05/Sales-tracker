// Limits repeated wrong passwords per email address.
// Kept in memory: this is enough for the single app container in docker-compose.
// Running several app instances would need a shared store instead.

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; firstAt: number }>();

function entryFor(email: string, now: number) {
  const entry = failures.get(email);
  if (entry && now - entry.firstAt >= LOGIN_WINDOW_MS) {
    failures.delete(email);
    return undefined;
  }
  return entry;
}

/** Seconds the email must wait before trying again, or 0 when sign-in is allowed. */
export function loginRetryAfterSeconds(email: string, now = Date.now()): number {
  const entry = entryFor(email, now);
  if (!entry || entry.count < LOGIN_MAX_FAILURES) return 0;
  return Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - now) / 1000);
}

export function recordLoginFailure(email: string, now = Date.now()) {
  const entry = entryFor(email, now);
  if (entry) entry.count += 1;
  else failures.set(email, { count: 1, firstAt: now });
}

export function clearLoginFailures(email: string) {
  failures.delete(email);
}
