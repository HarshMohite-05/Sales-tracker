import { format, parseISO, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export const TIMEZONE = 'Asia/Kolkata';

/**
 * Turn a system code into readable text
 * e.g., QUOTATION_FOLLOWUP -> Quotation follow-up
 */
const ACRONYMS = new Set(['NEFT', 'RTGS', 'UPI', 'AMC', 'GST', 'PO', 'OEM', 'EPC', 'RO']);

export function humanize(code: string | null | undefined): string {
  if (!code) return '';
  const text = code
    .split('_')
    .map((word) => (ACRONYMS.has(word) ? word : word.toLowerCase()))
    .join(' ')
    .replace(/followup/g, 'follow-up')
    .replace('whatsapp', 'WhatsApp')
    .replace('NEFT RTGS', 'NEFT/RTGS');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Enquiry stages offered in forms, in pipeline order.
 * QUALIFIED still exists in the database enum but is no longer offered.
 */
export const ENQUIRY_STAGES = ['NEW', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD'];

const STAGE_LABELS: Record<string, string> = {
  NEW: 'Enquiry',
  PROPOSAL: 'Quotation',
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return STAGE_LABELS[stage] || humanize(stage);
}

/**
 * Format currency into Indian Rupees (INR) with standard comma grouping
 * e.g., ₹ 12,50,000 (paise shown only when non-zero, e.g. ₹ 1,250.50)
 */
export function formatINR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '₹ 0';
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(num)) return '₹ 0';

  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const parts = absNum.toFixed(2).split('.');
  let integerPart = parts[0];
  const decimalPart = parts[1];

  // Indian Numbering System: last 3 digits, then groups of 2
  if (integerPart.length > 3) {
    const lastThree = integerPart.substring(integerPart.length - 3);
    const otherNumbers = integerPart.substring(0, integerPart.length - 3);
    const formattedOther = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    integerPart = formattedOther + ',' + lastThree;
  }

  return `${isNegative ? '-' : ''}₹ ${integerPart}${decimalPart === '00' ? '' : '.' + decimalPart}`;
}

/**
 * Format currency in Lakhs or Crores for compact dashboard cards
 */
export function formatINRCompact(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '₹ 0';
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(num)) return '₹ 0';

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 10000000) {
    return `${sign}₹ ${(abs / 10000000).toFixed(2)} Cr`;
  }
  if (abs >= 100000) {
    return `${sign}₹ ${(abs / 100000).toFixed(2)} L`;
  }
  return formatINR(num);
}

/**
 * Format Date to DD/MM/YYYY in Asia/Kolkata
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  try {
    const parsed = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(parsed)) return '-';
    const zoned = toZonedTime(parsed, TIMEZONE);
    return format(zoned, 'dd/MM/yyyy');
  } catch {
    return '-';
  }
}

/**
 * Format Date and Time to DD/MM/YYYY, hh:mm a in Asia/Kolkata
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  try {
    const parsed = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(parsed)) return '-';
    const zoned = toZonedTime(parsed, TIMEZONE);
    return format(zoned, 'dd/MM/yyyy, hh:mm a');
  } catch {
    return '-';
  }
}

/**
 * Get current Indian Financial Year (April - March) and Quarter for a given date
 * Q1: April - June
 * Q2: July - September
 * Q3: October - December
 * Q4: January - March
 */
export function getIndianFYQuarter(date: Date = new Date()): {
  financialYear: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  quarterLabel: string;
  startDate: Date;
  endDate: Date;
} {
  const zoned = toZonedTime(date, TIMEZONE);
  const month = zoned.getMonth(); // 0-indexed: 0 = Jan, 3 = Apr, 9 = Oct
  const year = zoned.getFullYear();

  let fyStartYear = year;
  let quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' = 'Q1';
  let startDate: Date;
  let endDate: Date;

  if (month >= 3 && month <= 5) {
    // April - June
    fyStartYear = year;
    quarter = 'Q1';
    startDate = new Date(Date.UTC(year, 3, 1, 0, 0, 0));
    endDate = new Date(Date.UTC(year, 5, 30, 23, 59, 59));
  } else if (month >= 6 && month <= 8) {
    // July - September
    fyStartYear = year;
    quarter = 'Q2';
    startDate = new Date(Date.UTC(year, 6, 1, 0, 0, 0));
    endDate = new Date(Date.UTC(year, 8, 30, 23, 59, 59));
  } else if (month >= 9 && month <= 11) {
    // October - December
    fyStartYear = year;
    quarter = 'Q3';
    startDate = new Date(Date.UTC(year, 9, 1, 0, 0, 0));
    endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  } else {
    // January - March (Belongs to previous calendar year's FY)
    fyStartYear = year - 1;
    quarter = 'Q4';
    startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    endDate = new Date(Date.UTC(year, 2, 31, 23, 59, 59));
  }

  // Quarter boundaries are midnight in India, stored as UTC instants.
  startDate = new Date(startDate.getTime() - 330 * 60 * 1000);
  endDate = new Date(endDate.getTime() - 330 * 60 * 1000 + 999);

  const shortNextYear = (fyStartYear + 1).toString().slice(-2);
  const financialYear = `FY ${fyStartYear}-${shortNextYear}`;

  return {
    financialYear,
    quarter,
    quarterLabel: `${financialYear} ${quarter}`,
    startDate,
    endDate,
  };
}

/**
 * Check if a task is overdue given its deadline and status
 */
export function isTaskOverdue(dueDateTime: Date | string, status: string): boolean {
  if (status !== 'PENDING') return false;
  const deadline = typeof dueDateTime === 'string' ? new Date(dueDateTime) : dueDateTime;
  return deadline.getTime() < Date.now();
}

/**
 * Calculate overdue days for an invoice or task
 */
export function calculateOverdueDays(dueDateTime: Date | string): number {
  const deadline = typeof dueDateTime === 'string' ? new Date(dueDateTime) : dueDateTime;
  const diffTime = Date.now() - deadline.getTime();
  if (diffTime <= 0) return 0;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}
