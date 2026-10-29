import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth, requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { errorResponse } from '@/lib/apiErrors';
import { getDeductionRules, parseDeductionRules, saveDeductionRules } from '@/lib/paymentSettings';

// How TDS and retention are calculated: anyone can read it (the order form needs it), directors change it
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ rules: await getDeductionRules() });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const director = await requireDirector();
    const rules = parseDeductionRules(await readJson(request));
    if ('error' in rules) return NextResponse.json({ error: rules.error }, { status: 400 });

    const before = await getDeductionRules();
    await prisma.$transaction(async (tx) => {
      await saveDeductionRules(tx, rules, director.id);
      await tx.auditEvent.create({
        data: {
          entityType: 'SETTINGS',
          entityId: 'deductionRules',
          action: 'UPDATE',
          actorId: director.id,
          details: { before, after: rules } as any,
        },
      });
    });

    return NextResponse.json({ success: true, rules });
  } catch (error: any) {
    return errorResponse(error);
  }
}
