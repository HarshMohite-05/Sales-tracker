import { Prisma } from '@prisma/client';

/** Serialize competing writes to the same business record across app processes. */
export async function lockRecord(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
}
