import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Checks that records link up correctly (client -> requirement -> conversations -> follow-ups
 * -> quotations -> orders -> invoices -> payments). Prints every rule; exits 1 if any is broken.
 * Usage: npm run check:links   (uses DATABASE_URL)
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const sql = readFileSync(path.join(__dirname, 'check-links.sql'), 'utf8');
    const rows = await prisma.$queryRawUnsafe<{ rule: string; broken: bigint }[]>(sql.replace(/;\s*$/, ''));
    let failed = 0;
    for (const { rule, broken } of rows) {
      const n = Number(broken);
      if (n > 0) failed++;
      console.log(`${n === 0 ? 'OK  ' : 'FAIL'} ${rule}${n > 0 ? ` (${n} broken)` : ''}`);
    }
    console.log(failed === 0 ? `All ${rows.length} link checks passed.` : `${failed} of ${rows.length} link checks failed.`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
