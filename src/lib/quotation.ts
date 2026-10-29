import { getIndianFYQuarter } from './utils';

// Shared by the quotation form and the API, so keep this free of server-only imports

export const QUOTATION_PREFIX = 'NWTS';

export const TRANSPORTATION_OPTIONS = [
  { value: 'EXTRA_AT_ACTUAL', label: 'Extra at actual' },
  { value: 'INCLUDED', label: 'Included' },
] as const;

export function transportationLabel(value: string | null | undefined): string {
  return TRANSPORTATION_OPTIONS.find((o) => o.value === value)?.label || '';
}

/**
 * Financial year part of a quotation number, e.g. 26_27 for any date from April 2026 to March 2027.
 */
export function quotationFy(date: Date = new Date()): string {
  const [start, end] = getIndianFYQuarter(date).financialYear.replace(/^FY\s*/, '').split('-');
  return `${start.slice(-2)}_${end}`;
}

/**
 * Fixed part of a quotation number, e.g. NWTS/26_27/. The salesperson types the number after it.
 */
export function quotationPrefix(date: Date = new Date()): string {
  return `${QUOTATION_PREFIX}/${quotationFy(date)}/`;
}

/**
 * Quotation number as shown and printed: the original stays as is,
 * revisions add -Rev01, -Rev02 and so on.
 */
export function formatQuotationNumber(quotationNumber: string, versionNumber: number = 0): string {
  return versionNumber > 0 ? `${quotationNumber}-Rev${versionNumber.toString().padStart(2, '0')}` : quotationNumber;
}

// GST on a quotation: 18% unless the salesperson changes it
export const DEFAULT_GST_PERCENT = 18;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GST % on a saved quotation version, from its tax and its price before GST (0 when none).
 */
export function gstPercentOf(version: { originalValue?: unknown; discountAmount?: unknown; taxAmount?: unknown }): number {
  const base = Number(version.originalValue || 0) - Number(version.discountAmount || 0);
  const tax = Number(version.taxAmount || 0);
  return base > 0 && tax > 0 ? round2((tax / base) * 100) : 0;
}

/**
 * Totals for a single-product quotation: the quoted price, GST on it (18% by default) and the total.
 * Payment stages are worked out on the price before GST; the GST is asked for with the invoice.
 */
export function quotationValues(product: string, price: number, gstPercent: number = DEFAULT_GST_PERCENT) {
  const amount = round2(price);
  const taxAmount = round2((amount * gstPercent) / 100);
  return {
    // Orders and the PDF read line items, so the product is kept as one line
    lineItems: [{ item: product, qty: 1, unit: 'Lot', unitRate: amount, total: amount }],
    originalValue: amount,
    discountAmount: 0,
    discountPercent: 0,
    taxAmount,
    finalValue: round2(amount + taxAmount),
  };
}

// Indian grouping: last three digits, then pairs, e.g. 1250000 -> 12,50,000
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  return digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + digits.slice(-3);
}

/**
 * Keep what the user types in an amount field to digits and up to two decimals,
 * e.g. "12,50,000.5" -> "1250000.5". The result is what gets saved.
 */
export function cleanAmountInput(text: string): string {
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  const intPart = whole.replace(/^0+(?=\d)/, '');
  return rest.length > 0 ? `${intPart || '0'}.${rest.join('').slice(0, 2)}` : intPart;
}

/**
 * Show a cleaned amount with Indian commas while typing, e.g. "1250000.5" -> "12,50,000.5".
 */
export function formatAmountInput(raw: string): string {
  if (!raw) return '';
  const [intPart, decPart] = raw.split('.');
  return groupIndian(intPart) + (decPart !== undefined ? `.${decPart}` : '');
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

// Whole number in the Indian system: crore, lakh, thousand
function integerInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  const lakh = Math.floor((n % 10000000) / 100000);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor((n % 100000) / 1000);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  const rest = n % 1000;
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/**
 * Amount in words, e.g. 1250000 -> "Rupees Twelve Lakh Fifty Thousand Only".
 */
export function amountInWords(amount: number | string | null | undefined): string {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  return `Rupees ${integerInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
}

export type QuotationTermKey = 'product' | 'amount' | 'paymentTerms' | 'transportation' | 'remarks';

/**
 * The fields a salesperson fills in, read from a quotation version.
 * Older multi-line versions have no product field, so their line items stand in.
 */
export function versionTerms(version: any) {
  const items: any[] = Array.isArray(version?.lineItems) ? version.lineItems : [];
  return {
    product: version?.product || items.map((i) => i.item).filter(Boolean).join(', '),
    amount: Number(version?.finalValue) || 0,
    paymentTerms: version?.paymentTerms || '',
    transportation: version?.transportation || '',
    remarks: version?.remarks || '',
  };
}

/**
 * Fields that differ between a version and the one before it; empty for the original quotation.
 */
export function changedTerms(version: any, previous: any | null | undefined): Set<QuotationTermKey> {
  const changed = new Set<QuotationTermKey>();
  if (!previous) return changed;
  const now = versionTerms(version);
  const before = versionTerms(previous);
  (Object.keys(now) as QuotationTermKey[]).forEach((key) => {
    if (key === 'amount' ? Math.abs(now.amount - before.amount) >= 0.005 : now[key].trim() !== before[key].trim()) {
      changed.add(key);
    }
  });
  return changed;
}

// What a payment stage is for, picked from a list; anything else is typed in as Other
export const PAYMENT_STAGE_OPTIONS = [
  'Advance',
  'Before Dispatch',
  'Upon Delivery',
  'On Erection',
  'On Installation',
  'On Commissioning',
] as const;

export interface PaymentStage {
  percent: number;
  description: string;
  // Fixed payment terms: the full amount, due this many days after Delivery & Invoice Raised in Execution
  creditDays?: number;
}

/**
 * Fixed payment terms as text, e.g. "Full payment after 30 days".
 */
export function fixedPaymentText(days: number): string {
  return `Full payment after ${days} days`;
}

/**
 * Fixed payment terms are saved as one 100% stage carrying its credit days.
 */
export function isFixedPayment(stages: unknown): boolean {
  return Array.isArray(stages) && stages.length === 1 && Number(stages[0]?.creditDays) > 0;
}

/**
 * Payment stages as one line of text, e.g. "50% Advance with PO, 50% Before dispatch",
 * or fixed terms as "Full payment after 30 days".
 */
export function formatPaymentStages(stages: PaymentStage[]): string {
  return stages.map((s) => (s.creditDays ? s.description : `${s.percent}% ${s.description}`.trim())).join(', ');
}

/**
 * Check payment stages sent by the form. Returns the cleaned stages, or an error message.
 * Stages are optional, but when given every one needs a percentage and a description, adding up to 100%.
 */
export function parsePaymentStages(input: unknown): { stages: PaymentStage[] } | { error: string } {
  if (input === undefined || input === null) return { stages: [] };
  if (!Array.isArray(input)) return { error: 'Payment stages are not in the right format' };

  // Fixed terms: the full amount, a number of days after Delivery & Invoice Raised
  if (input.length === 1 && input[0]?.creditDays !== undefined && input[0]?.creditDays !== null) {
    const days = Number(input[0].creditDays);
    if (!(Number.isInteger(days) && days > 0 && days <= 365)) return { error: 'Fixed payment: enter the number of days (1 to 365)' };
    return { stages: [{ percent: 100, description: fixedPaymentText(days), creditDays: days }] };
  }

  const stages: PaymentStage[] = [];
  for (const [i, raw] of input.entries()) {
    const percent = Number(raw?.percent);
    const description = String(raw?.description ?? '').trim();
    if (!(percent > 0 && percent <= 100)) return { error: `Payment stage ${i + 1}: enter a percentage between 1 and 100` };
    if (!description) return { error: `Payment stage ${i + 1}: enter what the ${percent}% is for` };
    stages.push({ percent: Math.round(percent * 100) / 100, description });
  }

  const total = stages.reduce((sum, s) => sum + s.percent, 0);
  if (stages.length > 0 && Math.abs(total - 100) > 0.001) {
    return { error: `Payment stages add up to ${total}%. They must add up to 100%.` };
  }
  return { stages };
}
