import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { DEFAULT_DEDUCTION_RULES, DeductionBase, DeductionRules } from '@/lib/deductions';

type Db = typeof prisma | Prisma.TransactionClient;

const KEY = 'deductionRules';
const isBase = (v: unknown): v is DeductionBase => v === 'NET' || v === 'GROSS';

/**
 * How TDS and retention are calculated company-wide; the defaults until a director changes them.
 */
export async function getDeductionRules(db: Db = prisma): Promise<DeductionRules> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as any;
  return {
    tdsBase: isBase(v.tdsBase) ? v.tdsBase : DEFAULT_DEDUCTION_RULES.tdsBase,
    retentionBase: isBase(v.retentionBase) ? v.retentionBase : DEFAULT_DEDUCTION_RULES.retentionBase,
  };
}

export async function saveDeductionRules(db: Db, rules: DeductionRules, userId: string) {
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: rules as any, updatedById: userId },
    update: { value: rules as any, updatedById: userId },
  });
}

export function parseDeductionRules(body: any): DeductionRules | { error: string } {
  if (!isBase(body?.tdsBase) || !isBase(body?.retentionBase)) {
    return { error: 'Choose what TDS and retention are calculated on' };
  }
  return { tdsBase: body.tdsBase, retentionBase: body.retentionBase };
}
