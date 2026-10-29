import { moneyInput } from '@/lib/inputValidation';
import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { salespersonScope } from '@/lib/officeScope';
import { requireAuth, requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Role, TargetPeriod, TargetType, MonetaryBasis } from '@prisma/client';
import { getIndianFYQuarter } from '@/lib/utils';
import { customPeriodKey, periodLabel, periodRange } from '@/lib/targetPeriods';
import { achievedFor, chainKey, progress } from '@/lib/targets';
import { REQUIREMENT_TYPES } from '@/lib/requirementTypes';
import type { TypeRates } from '@/lib/incentiveLedger';

/** A % from 0 to 100 (blank is 0), or null when invalid. */
function percentInput(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** The rates table for every business type from the form, or an error message. */
function typeRatesInput(input: unknown): TypeRates | string {
  const given = (input && typeof input === 'object' ? input : {}) as Record<string, { incentive?: unknown }>;
  const rates: TypeRates = {};
  for (const { value, label } of REQUIREMENT_TYPES) {
    const incentive = percentInput(given[value]?.incentive);
    if (incentive === null) return `${label}: incentive must be between 0 and 100%`;
    rates[value] = { incentive };
  }
  return Object.values(rates).some((r) => r.incentive > 0) ? rates : 'Enter the incentive % for at least one business type';
}

// e.g. "Plant 1%, Spares 2%": the types with a rate, for the change history
const ratesLabel = (rates: TypeRates) =>
  REQUIREMENT_TYPES.filter((t) => rates[t.value]?.incentive)
    .map((t) => `${t.label} ${rates[t.value].incentive}%`)
    .join(', ');

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);

    const financialYear = searchParams.get('financialYear') || getIndianFYQuarter().financialYear;
    const periodKey = searchParams.get('periodKey');
    const salespersonId = searchParams.get('salespersonId');
    const allPeriods = searchParams.get('allPeriods') === '1';

    const whereClause: any = allPeriods ? {} : { financialYear, ...(periodKey ? { periodKey } : {}) };

    if (user.role === Role.SALESPERSON) {
      whereClause.salespersonId = user.id;
    } else {
      // One salesperson, everyone in an office, or the whole team
      const people = await salespersonScope(salespersonId, searchParams.get('officeId'));
      if (people) whereClause.salespersonId = people;
    }

    const targets = await prisma.target.findMany({
      where: whereClause,
      include: {
        salesperson: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ periodStart: 'desc' }, { targetType: 'asc' }, { level: 'asc' }],
    });

    // The next target of each (Target 2 after Target 1, …), set together or after it was achieved
    const byChainLevel = new Map(targets.map((t) => [`${chainKey(t)}|${t.level}`, t]));

    // Achievement counts every event in the target's whole period, so a next target starts from what is already done
    const withProgress = await Promise.all(
      targets.map(async (target) => {
        const next = byChainLevel.get(`${chainKey(target)}|${target.level + 1}`);
        return {
          ...target,
          ...progress(target.targetValue, await achievedFor(target)),
          periodLabel: periodLabel(target.financialYear, target.periodType, target.periodKey),
          raisedTo: next ? Number(next.targetValue) : null,
          chainSize: targets.filter((t) => chainKey(t) === chainKey(target)).length,
          bonusRatePercent: target.bonusRatePercent === null ? null : Number(target.bonusRatePercent),
        };
      })
    );
    // The target being worked toward in each chain: the first one not achieved yet, else the last
    const current = new Map<string, number>();
    for (const t of withProgress) {
      const key = chainKey(t);
      if (current.has(key)) continue;
      const levels = withProgress.filter((o) => chainKey(o) === key).sort((a, b) => a.level - b.level);
      current.set(key, (levels.find((o) => !o.isAchieved) ?? levels[levels.length - 1]).level);
    }
    const enhancedTargets = withProgress.map((t) => ({ ...t, isCurrent: current.get(chainKey(t)) === t.level }));

    return NextResponse.json({ financialYear, targets: enhancedTargets });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}

/**
 * Set order booking targets for a salesperson, for a month, quarter, six months, year or custom dates:
 * Target 1, Target 2, … (each higher than the one before), each with a rates table giving per business
 * type the incentive % on bookings up to it (from the previous target); past the last, its % continues. Setting targets again for the same period replaces them; with next: true, once the last target is
 * achieved, more targets are added after it for the same period and the achieved ones are kept.
 */
export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);

    const { salespersonId, periodType = TargetPeriod.QUARTERLY, monetaryBasis = MonetaryBasis.NET, next = false, startDate, endDate } = body;
    const targetType = TargetType.ORDERS_BOOKED;
    let { financialYear, periodKey } = body;

    if (body.targetType && body.targetType !== TargetType.ORDERS_BOOKED) {
      return NextResponse.json({ error: 'Targets are set on order booking only' }, { status: 400 });
    }
    if (!Object.values(TargetPeriod).includes(periodType)) {
      return NextResponse.json({ error: 'Period must be monthly, quarterly, 6 months, yearly or custom dates' }, { status: 400 });
    }
    // Custom dates: the period is named by its dates and belongs to the financial year it starts in
    if (periodType === TargetPeriod.CUSTOM && !next) {
      periodKey = typeof startDate === 'string' && typeof endDate === 'string' ? customPeriodKey(startDate, endDate) : null;
      if (!periodKey) return NextResponse.json({ error: 'Choose a valid start date and an end date on or after it' }, { status: 400 });
      financialYear = getIndianFYQuarter(periodRange('', TargetPeriod.CUSTOM, periodKey)!.start).financialYear;
    }
    if (!salespersonId || !financialYear || !periodKey || !Array.isArray(body.levels) || !body.levels.length) {
      return NextResponse.json({ error: 'Salesperson, period and at least one target are required' }, { status: 400 });
    }
    const range = periodRange(financialYear, periodType, periodKey);
    if (!range) {
      return NextResponse.json({ error: 'That period does not belong to the chosen period type' }, { status: 400 });
    }

    // Each target: its value (higher than the one before) and its rates table
    const levels: { value: number; typeRates: TypeRates }[] = [];
    for (const [i, input] of (body.levels as { targetValue?: unknown; typeRates?: unknown }[]).entries()) {
      const value = moneyInput(input?.targetValue, `Target ${i + 1}`);
      if (!Number.isFinite(value) || value <= 0) return NextResponse.json({ error: `Target ${i + 1} must be more than zero` }, { status: 400 });
      if (i && value <= levels[i - 1].value) return NextResponse.json({ error: `Target ${i + 1} must be higher than Target ${i}` }, { status: 400 });
      const typeRates = typeRatesInput(input?.typeRates);
      if (typeof typeRates === 'string') return NextResponse.json({ error: `Target ${i + 1}: ${typeRates}` }, { status: 400 });
      levels.push({ value, typeRates });
    }

    const chain = { salespersonId, financialYear, periodKey, targetType };
    const existing = await prisma.target.findMany({ where: chain, orderBy: { level: 'asc' } });
    const top = existing[existing.length - 1];
    const salesperson = await prisma.user.findUnique({ where: { id: salespersonId }, select: { name: true } });
    if (!salesperson) return NextResponse.json({ error: 'Salesperson not found' }, { status: 400 });
    const summary = levels.map((l, i) => `T${(next && top ? top.level : 0) + i + 1} ${l.value} (${ratesLabel(l.typeRates)})`).join('; ');

    if (next) {
      if (!top) {
        return NextResponse.json({ error: 'There is no target for this period yet' }, { status: 400 });
      }
      const { isAchieved } = progress(top.targetValue, await achievedFor(top));
      if (!isAchieved) {
        return NextResponse.json({ error: 'The current target is not achieved yet' }, { status: 400 });
      }
      if (levels[0].value <= Number(top.targetValue)) {
        return NextResponse.json({ error: 'The next target must be higher than the achieved one' }, { status: 400 });
      }
      const created = await prisma.$transaction(async (tx) => {
        const rows = [];
        for (const [i, l] of levels.entries()) {
          rows.push(
            await tx.target.create({
              data: { ...chain, periodType: top.periodType, periodStart: top.periodStart, periodEnd: top.periodEnd, level: top.level + i + 1, targetValue: l.value, monetaryBasis: top.monetaryBasis, typeRates: l.typeRates, setById: director.id },
            })
          );
        }
        await tx.auditEvent.create({
          data: {
            entityType: 'TARGET',
            entityId: rows[0].id,
            action: 'CREATE',
            actorId: director.id,
            details: { label: `Next targets for ${salesperson.name} (${financialYear} ${top.periodKey}) after ${Number(top.targetValue)} was achieved: ${summary}` },
          },
        });
        return rows;
      });
      return NextResponse.json({ success: true, targets: created });
    }

    // One salesperson's periods must not overlap, so each order earns under one chain of targets
    const overlapping = await prisma.target.findFirst({
      where: { salespersonId, targetType, periodStart: { lte: range.end }, periodEnd: { gte: range.start }, NOT: { financialYear, periodKey } },
    });
    if (overlapping) {
      return NextResponse.json(
        { error: `This overlaps the target for ${periodLabel(overlapping.financialYear, overlapping.periodType, overlapping.periodKey)} (${overlapping.financialYear}). Choose dates outside it or edit that target.` },
        { status: 400 }
      );
    }

    // Setting the period again replaces its targets
    const created = await prisma.$transaction(async (tx) => {
      if (existing.length) await tx.target.deleteMany({ where: { id: { in: existing.map((t) => t.id) } } });
      const rows = [];
      for (const [i, l] of levels.entries()) {
        rows.push(
          await tx.target.create({
            data: { ...chain, periodType, periodStart: range.start, periodEnd: range.end, level: i + 1, targetValue: l.value, monetaryBasis: monetaryBasis as MonetaryBasis, typeRates: l.typeRates, setById: director.id },
          })
        );
      }
      await tx.auditEvent.create({
        data: {
          entityType: 'TARGET',
          entityId: rows[0].id,
          action: existing.length ? 'UPDATE' : 'CREATE',
          actorId: director.id,
          details: {
            label: `Targets for ${salesperson.name} (${financialYear} ${periodLabel(financialYear, periodType, periodKey)}): ${summary}${existing.length ? `; replaced ${existing.map((t) => Number(t.targetValue)).join(', ')}` : ''}`,
          },
        },
      });
      return rows;
    });

    return NextResponse.json({ success: true, targets: created });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can set targets' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
