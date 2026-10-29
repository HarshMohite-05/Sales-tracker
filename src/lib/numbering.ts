import prisma from '@/lib/prisma';
import { Prisma, TaskType } from '@prisma/client';
import { quotationPrefix } from '@/lib/quotation';

type Db = typeof prisma | Prisma.TransactionClient;

const SERIES = {
  enquiry: { prefix: 'ENQ', field: 'enquiryNumber' },
  task: { prefix: 'TSK', field: 'taskNumber' },
  quotation: { prefix: 'QT', field: 'quotationNumber' },
  order: { prefix: 'ORD', field: 'orderNumber' },
  invoice: { prefix: 'INV', field: 'invoiceNumber' },
  receipt: { prefix: 'REC', field: 'receiptNumber' },
} as const;

/**
 * Next document number for the current year, e.g. ENQ-2026-009.
 * Continues from the highest existing number rather than the row count,
 * so deleted or imported records can't cause a duplicate number.
 */
export async function nextDocNumber(db: Db, model: keyof typeof SERIES): Promise<string> {
  const { prefix, field } = SERIES[model];
  const start = `${prefix}-${new Date().getFullYear()}-`;

  const rows: Record<string, string>[] = await (db as any)[model].findMany({
    where: { [field]: { startsWith: start } },
    select: { [field]: true },
  });

  const max = rows.reduce((highest, row) => {
    const n = parseInt(row[field].slice(start.length), 10);
    return Number.isNaN(n) ? highest : Math.max(highest, n);
  }, 0);

  return `${start}${(max + 1).toString().padStart(3, '0')}`;
}

/**
 * Follow-up task type for an activity type. WhatsApp and Email have no
 * matching task type, so their follow-ups become calls.
 */
export function toTaskType(activityType: string | null | undefined): TaskType {
  return activityType && activityType in TaskType ? (activityType as TaskType) : TaskType.CALL;
}

/**
 * Next requirement number for a client: its code plus a per-client sequence,
 * e.g. NGPL/001, NGPL/002. Clients without a code fall back to the yearly ENQ series.
 */
export async function nextRequirementNumber(db: Db, clientId: string): Promise<string> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { code: true } });
  if (!client?.code) return nextDocNumber(db, 'enquiry');

  // Codes are unique, so every number with this prefix belongs to this client
  const start = `${client.code}/`;
  const rows = await db.enquiry.findMany({
    where: { enquiryNumber: { startsWith: start } },
    select: { enquiryNumber: true },
  });
  const max = rows.reduce((highest, row) => {
    const n = parseInt(row.enquiryNumber.slice(start.length), 10);
    return Number.isNaN(n) ? highest : Math.max(highest, n);
  }, 0);

  return `${start}${(max + 1).toString().padStart(3, '0')}`;
}

/**
 * Suggested number for the next quotation this financial year, e.g. 046 when NWTS/26_27/045 exists.
 * Salespeople can type a different one; this only fills the field.
 */
export async function suggestQuotationNo(db: Db, date: Date = new Date()): Promise<string> {
  const start = quotationPrefix(date);
  const rows = await db.quotation.findMany({
    where: { quotationNumber: { startsWith: start } },
    select: { quotationNumber: true },
  });
  const max = rows.reduce((highest, row) => {
    const n = parseInt(row.quotationNumber.slice(start.length), 10);
    return Number.isNaN(n) ? highest : Math.max(highest, n);
  }, 0);
  return (max + 1).toString().padStart(3, '0');
}

/** Codes already taken that start with `base`, for suggesting a free variant. */
export async function takenCodesLike(db: Db, base: string): Promise<Set<string>> {
  const rows = await db.client.findMany({
    where: { code: { startsWith: base } },
    select: { code: true },
  });
  return new Set(rows.map((r) => r.code as string));
}
