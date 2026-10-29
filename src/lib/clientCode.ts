/**
 * Client codes prefix requirement numbers, e.g. NGPL -> NGPL/001.
 * Codes are unique per client (enforced by the database), so numbers never overlap.
 */

export const CLIENT_CODE_PATTERN = /^[A-Z0-9]{2,10}$/;

export function normalizeClientCode(code: string | null | undefined): string {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function clientCodeError(code: string): string | null {
  if (!code) return 'Client code is required';
  if (!CLIENT_CODE_PATTERN.test(code)) return 'Use 2 to 10 letters or numbers, e.g. NGPL';
  return null;
}

/**
 * Initials of each word: "Neer Green Pvt. Ltd" -> NGPL.
 * A single-word name uses its first 4 letters: "NAKSHATRA" -> NAKS.
 */
export function suggestClientCode(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const code = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('');
  return normalizeClientCode(code).slice(0, 10);
}

/** First free variant of a code: NGPL, then NGPL2, NGPL3, ... */
export function firstFreeCode(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
