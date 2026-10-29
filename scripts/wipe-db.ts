/**
 * Empties every table in the CRM database (users included), after writing a full JSON backup of all
 * rows to backups/db-backup-<timestamp>.json. Stops without deleting anything if the backup fails.
 * --keep lists tables to leave as they are, e.g. logins and settings.
 * Usage: npx tsx scripts/wipe-db.ts [--keep User,AppSetting,IncentiveRate]   (uses DATABASE_URL)
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations' order by tablename`
  );
  if (tables.length === 0) throw new Error('No tables found');
  const keepArg = process.argv.indexOf('--keep');
  const keep = keepArg >= 0 ? (process.argv[keepArg + 1] || '').split(',').map((t) => t.trim()).filter(Boolean) : [];
  const unknown = keep.filter((k) => !tables.some((t) => t.tablename === k));
  if (unknown.length) throw new Error(`Unknown table(s) to keep: ${unknown.join(', ')}; nothing deleted`);
  const toWipe = tables.filter((t) => !keep.includes(t.tablename));

  // 1. Backup
  const backup: Record<string, unknown[]> = {};
  let rows = 0;
  for (const { tablename } of tables) {
    const data = await prisma.$queryRawUnsafe<unknown[]>(`select * from "${tablename}"`);
    backup[tablename] = data;
    rows += data.length;
  }
  const dir = path.join(__dirname, '..', 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `db-backup-${stamp}.json`);
  writeFileSync(file, JSON.stringify(backup, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  if (statSync(file).size < 10) throw new Error('Backup file looks empty; nothing deleted');
  console.log(`Backup: ${rows} rows from ${tables.length} tables -> ${file}`);
  for (const { tablename } of tables) console.log(`  ${tablename}: ${backup[tablename].length}`);

  // 2. Wipe. Without cascade, so a kept table that depends on a wiped one stops it instead of being emptied
  const list = toWipe.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`truncate table ${list} restart identity`);

  // 3. Verify
  let left = 0;
  for (const { tablename } of toWipe) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint as n from "${tablename}"`);
    left += Number(n);
  }
  console.log(left === 0 ? `Wiped: ${toWipe.length} tables are now empty.` : `WARNING: ${left} rows remain.`);
  for (const k of keep) console.log(`  kept ${k}: ${backup[k].length} rows`);
}

main()
  .catch((e) => {
    console.error('STOPPED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
