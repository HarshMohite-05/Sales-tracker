import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * Permanent deletes for directors testing the app: one client with everything under it, or all business data.
 * Nothing goes to the recycle bin and nothing can be restored.
 */

// Tables "clear all" leaves alone, so people can still sign in and settings stay as they are
export const KEPT_TABLES = ['User', 'Office', 'PushSubscription', 'AppSetting', 'IncentivePolicy', 'IncentiveRate', '_prisma_migrations'];

export const CLEAR_ALL_CONFIRMATION = 'DELETE EVERYTHING';

/** Business tables and how many rows each has, largest first. */
export async function businessDataCounts(): Promise<{ table: string; rows: number }[]> {
  const tables = await businessTables();
  const counts = [];
  for (const table of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from "${table}"`);
    counts.push({ table, rows: n });
  }
  return counts.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
}

/** Empties every business table in one statement. Returns the row counts from just before. */
export async function clearAllBusinessData(actorId: string) {
  const before = await businessDataCounts();
  const tables = before.map((c) => c.table);
  if (tables.length === 0) return before;
  // No cascade: if a kept table ever depends on a business table, this fails instead of emptying the kept one
  await prisma.$executeRawUnsafe(`truncate table ${tables.map((t) => `"${t}"`).join(', ')} restart identity`);
  await prisma.auditEvent.create({
    data: {
      entityType: 'SYSTEM',
      entityId: 'all-business-data',
      action: 'PURGE',
      actorId,
      details: { cleared: Object.fromEntries(before.map((c) => [c.table, c.rows])) },
    },
  });
  return before;
}

/**
 * Deletes a client and everything recorded under it. Contacts, sites, requirements, conversations, follow-ups,
 * quotations, orders, invoices and receipts (and their children) go through the database's cascades. The
 * records that point at the client only by id, such as incentive entries, bin items and director comments, are
 * removed here.
 */
export async function deleteClientCompletely(tx: Prisma.TransactionClient, clientId: string, actorId: string) {
  const client = await tx.client.findUniqueOrThrow({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      code: true,
      contacts: { select: { id: true } },
      sites: { select: { id: true } },
      enquiries: { select: { id: true } },
      activities: { select: { id: true } },
      tasks: { select: { id: true } },
      quotations: { select: { id: true } },
      orders: { select: { id: true } },
      invoices: { select: { id: true } },
      receipts: { select: { id: true } },
    },
  });

  const relatedIds = [
    client.id,
    ...client.contacts,
    ...client.sites,
    ...client.enquiries,
    ...client.activities,
    ...client.tasks,
    ...client.quotations,
    ...client.orders,
    ...client.invoices,
    ...client.receipts,
  ].map((r) => (typeof r === 'string' ? r : r.id));

  await tx.incentiveEntry.deleteMany({ where: { OR: [{ clientId }, { orderId: { in: client.orders.map((o) => o.id) } }] } });
  await tx.recycleBinItem.deleteMany({ where: { clientId } });
  await tx.directorComment.deleteMany({ where: { entityId: { in: relatedIds } } });
  await tx.documentAttachment.deleteMany({ where: { entityId: { in: relatedIds } } });
  await tx.notification.deleteMany({ where: { link: { startsWith: `/clients/${clientId}` } } });
  await tx.client.delete({ where: { id: clientId } });

  const removed = {
    contacts: client.contacts.length,
    sites: client.sites.length,
    requirements: client.enquiries.length,
    conversations: client.activities.length,
    followUps: client.tasks.length,
    quotations: client.quotations.length,
    orders: client.orders.length,
    invoices: client.invoices.length,
    receipts: client.receipts.length,
  };
  await tx.auditEvent.create({
    data: {
      entityType: 'CLIENT',
      entityId: clientId,
      action: 'PURGE',
      actorId,
      details: { name: client.name, code: client.code, removed },
    },
  });
  return { name: client.name, removed };
}

async function businessTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  );
  return rows.map((r) => r.tablename).filter((t) => !KEPT_TABLES.includes(t));
}
