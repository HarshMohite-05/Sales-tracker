import { ValidationError } from './apiErrors';

/** Strict numeric parsing: never silently truncate junk or store non-finite currency. */
export function moneyInput(value: unknown, label: string, allowZero = true): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new ValidationError(`${label} must be a number`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0) || amount > 999999999999.99) {
    throw new ValidationError(`${label} must be ${allowZero ? 'zero or ' : ''}a positive amount within the supported range`);
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001) {
    throw new ValidationError(`${label} can have at most two decimals`);
  }
  return Math.round(amount * 100) / 100;
}

/** Reject impossible calendar dates as well as invalid timestamps. */
export function validDateInput(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string' || !value.trim()) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && Number.isFinite(new Date(value).getTime());
}

/** All JSON API endpoints take an object, never null, arrays, or scalar JSON. */
export async function readJson(request: Request): Promise<Record<string, any>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new ValidationError('Send a valid JSON object'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Send a JSON object');
  return value as Record<string, any>;
}
