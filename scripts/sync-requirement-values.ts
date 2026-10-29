/**
 * One-off: set every quoted requirement's value to its quotation's latest price.
 * Usage: npx tsx scripts/sync-requirement-values.ts   (uses DATABASE_URL)
 */
import prisma from '../src/lib/prisma';
import { syncRequirementValue } from '../src/lib/requirementValue';

async function main() {
  const quoted = await prisma.enquiry.findMany({ where: { quotations: { some: {} } }, select: { id: true } });
  for (const { id } of quoted) await syncRequirementValue(prisma, id);
  console.log(`Synced ${quoted.length} quoted requirement(s).`);
}

main().finally(() => prisma.$disconnect());
