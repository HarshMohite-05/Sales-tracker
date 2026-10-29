import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Set a requirement's value from its quotation: the latest price once quoted (before any GST
 * on older quotations), otherwise the approximate value entered when it was added.
 * Call after anything that creates, revises, edits, deletes or restores its quotation.
 */
export async function syncRequirementValue(db: Db, enquiryId: string) {
  const enquiry = await db.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      approxValue: true,
      quotations: {
        select: { originalValue: true, discountAmount: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!enquiry) return;

  const quote = enquiry.quotations[0];
  const value = quote ? Number(quote.originalValue) - Number(quote.discountAmount) : Number(enquiry.approxValue);
  await db.enquiry.update({ where: { id: enquiryId }, data: { estimatedValue: value } });
}
