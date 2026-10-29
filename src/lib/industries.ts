export const DEFAULT_INDUSTRY_SEGMENTS = [
  'Pharmaceutical',
  'Chemical',
  'Textiles',
  'Food & Beverage',
  'Automobile',
  'Commercial & Municipal',
  'Power & Utilities',
];

// Defaults first, then custom segments alphabetically; "Other" is always rendered last by the UI
export function mergeIndustrySegments(custom: string[]): string[] {
  const seen = new Set(DEFAULT_INDUSTRY_SEGMENTS.map((s) => s.toLowerCase()));
  const extra: string[] = [];
  for (const raw of custom) {
    const name = raw.trim();
    if (!name || name.toLowerCase() === 'other' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    extra.push(name);
  }
  return [...DEFAULT_INDUSTRY_SEGMENTS, ...extra.sort((a, b) => a.localeCompare(b))];
}
