import { validDateInput } from './inputValidation';
import prisma from '@/lib/prisma';
import { PaymentMode, Prisma } from '@prisma/client';

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Check a receipt typed into the Payments tab (adding or editing one).
 */
export function parseReceiptInput(body: any):
  | { error: string }
  | { paymentStageId: string; amount: number; receivedDate: Date; paymentMode: PaymentMode | null; reference: string | null; notes: string | null } {
  const amount = Number(body?.amount);
  if (body?.amount === '' || body?.amount === undefined || !Number.isFinite(amount) || amount > 999999999999.99) return { error: 'Enter the amount received' };
  if (amount <= 0) return { error: 'The amount received must be more than zero' };
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return { error: 'The amount can have at most two decimals (paise)' };
  }
  if (!body?.paymentStageId) return { error: 'Choose the payment stage this receipt is for' };

  const receivedDate = body?.receivedDate ? new Date(body.receivedDate) : null;
  if (!receivedDate || !validDateInput(body.receivedDate)) return { error: 'Enter the date the payment was received' };
  // Compare by day so today is allowed in any timezone
  if (receivedDate.toISOString().slice(0, 10) > new Date().toISOString().slice(0, 10)) {
    return { error: 'The received date cannot be in the future' };
  }

  const mode = body?.paymentMode || null;
  if (mode && !(mode in PaymentMode)) return { error: 'Choose a valid payment mode' };

  return {
    paymentStageId: String(body.paymentStageId),
    amount: Math.round(amount * 100) / 100,
    receivedDate,
    paymentMode: mode as PaymentMode | null,
    reference: String(body?.reference ?? '').trim() || null,
    notes: String(body?.notes ?? '').trim() || null,
  };
}

/**
 * Another active receipt with the same payment reference (UTR / cheque no.), if any.
 * Reversed receipts don't count, so a reference can be re-entered after a mistake is reversed.
 */
export async function findDuplicateReference(db: Db, reference: string | null, exceptReceiptId?: string) {
  if (!reference) return null;
  return db.orderReceipt.findFirst({
    where: {
      reference: { equals: reference, mode: 'insensitive' },
      isReversed: false,
      ...(exceptReceiptId ? { id: { not: exceptReceiptId } } : {}),
    },
    include: { order: { select: { orderNumber: true } } },
  });
}
