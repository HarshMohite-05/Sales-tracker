import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { listOffices, salespersonScope } from '@/lib/officeScope';
import { requireAuth, requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { EnquiryCategory, IncentiveEntryKind, IncentiveEntryStatus, OrderStatus, Role } from '@prisma/client';
import { getIndianFYQuarter } from '@/lib/utils';
import { periodRange } from '@/lib/targetPeriods';
import { reconcileOrder } from '@/lib/deductions';
import { LEGACY_REQUIREMENT_TYPES, REQUIREMENT_TYPES } from '@/lib/requirementTypes';
import { eligibleByReceipt, indiaDayStart, orderShares, syncIncentiveEntries } from '@/lib/incentiveLedger';

const r2 = (n: number) => Math.round(n * 100) / 100;
const TYPE_LABEL: Record<string, string> = Object.fromEntries([...REQUIREMENT_TYPES, ...LEGACY_REQUIREMENT_TYPES].map((t) => [t.value, t.label]));
const typeLabel = (t: string) => TYPE_LABEL[t] || t;
// Types offered on requirements (Other covers company-defined types)
const RATE_TYPES = REQUIREMENT_TYPES.map((t) => t.value as EnquiryCategory);

/**
 * Targets & incentives data for one financial year: the salesperson's own, or for a director the team's or
 * one salesperson's. Brings the incentive ledger up to date with the payments first.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const isDirector = user.role === Role.DIRECTOR;
    const financialYear = searchParams.get('financialYear') || getIndianFYQuarter().financialYear;
    const salespersonId = isDirector ? searchParams.get('salespersonId') || null : user.id;
    const officeId = isDirector ? searchParams.get('officeId') || null : null;
    // One salesperson, everyone in an office, or the whole team
    const people = isDirector ? await salespersonScope(salespersonId, officeId) : user.id;
    const fy = periodRange(financialYear, 'YEARLY', 'FY');
    if (!fy) return NextResponse.json({ error: 'Unknown financial year' }, { status: 400 });

    await syncIncentiveEntries();

    const scope = people ? { assignedSalespersonId: people } : {};
    const [orders, entries, salespeople] = await Promise.all([
      prisma.order.findMany({
        where: scope,
        select: {
          id: true,
          orderNumber: true,
          clientPoNumber: true,
          orderDate: true,
          orderStatus: true,
          netValue: true,
          grossValue: true,
          client: { select: { id: true, name: true } },
          assignedSalesperson: { select: { id: true, name: true } },
          enquiry: { select: { enquiryNumber: true, title: true, category: true, categories: true } },
          incentiveSplits: { select: { businessType: true, amount: true } },
          payments: { select: { id: true, amount: true, expectedAmount: true, gstAmount: true, dueDate: true, description: true, percent: true }, orderBy: { sequence: 'asc' } },
          receipts: {
            select: { id: true, paymentStageId: true, amount: true, isReversed: true, receivedDate: true, createdAt: true, paymentMode: true, reference: true },
            orderBy: { receivedDate: 'asc' },
          },
        },
        orderBy: { orderDate: 'desc' },
      }),
      prisma.incentiveEntry.findMany({
        where: people ? { salespersonId: people } : {},
        include: { salesperson: { select: { name: true } } },
        orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
      }),
      isDirector
        ? prisma.user.findMany({ where: { role: Role.SALESPERSON }, select: { id: true, name: true, isActive: true, officeId: true }, orderBy: { name: 'asc' } })
        : Promise.resolve([]),
    ]);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const inFy = (d: Date) => d >= fy.start && d <= fy.end;
    const live = (e: (typeof entries)[number]) => e.status !== IncentiveEntryStatus.REVERSED;

    // Business types: every type offered on requirements, plus any type found on orders or entries
    const byType = new Map<string, { businessType: string; label: string; bookings: number; collections: number; incentive: number }>();
    const typeRow = (t: string) => {
      if (!byType.has(t)) byType.set(t, { businessType: t, label: typeLabel(t), bookings: 0, collections: 0, incentive: 0 });
      return byType.get(t)!;
    };
    RATE_TYPES.forEach(typeRow);

    let bookings = 0;
    let outstanding = 0;
    let overdue = 0;
    let needsSplit = 0;
    const orderRows = orders.map((o) => {
      const { shares, splitMissing, types } = orderShares(o);
      if (splitMissing && o.orderStatus !== OrderStatus.CANCELLED) needsSplit += 1;
      const rec = reconcileOrder(o.payments, o.receipts);
      const cancelled = o.orderStatus === OrderStatus.CANCELLED;
      // Raised as due before today and still owed
      const overdueAmount = cancelled
        ? 0
        : r2(
            rec.rows
              .filter((row) => row.isDue && row.outstanding > 0)
              .filter((row) => {
                const due = o.payments.find((p) => p.id === row.stageId)?.dueDate;
                return due && new Date(due) < startOfToday;
              })
              .reduce((t, row) => t + row.outstanding, 0)
          );
      if (!cancelled) {
        outstanding += rec.outstanding;
        overdue += overdueAmount;
        if (inFy(o.orderDate)) {
          bookings += Number(o.netValue);
          for (const s of shares) typeRow(s.businessType).bookings += Number(o.netValue) * s.share;
        }
      }
      const eligible = eligibleByReceipt(o.payments, o.receipts);
      const own = entries.filter((e) => e.orderId === o.id);
      const sumBy = (status: IncentiveEntryStatus) => r2(own.filter((e) => e.status === status).reduce((t, e) => t + Number(e.incentiveAmount), 0));
      return {
        id: o.id,
        clientId: o.client.id,
        clientName: o.client.name,
        orderNumber: o.orderNumber,
        poNumber: o.clientPoNumber,
        orderDate: o.orderDate,
        orderStatus: o.orderStatus,
        salesperson: o.assignedSalesperson.name,
        enquiryNumber: o.enquiry?.enquiryNumber ?? null,
        requirement: o.enquiry?.title ?? null,
        types: types.map((t) => ({ businessType: t, label: typeLabel(t) })),
        shares: shares.map((s) => ({ businessType: s.businessType, label: typeLabel(s.businessType), share: s.share })),
        splits: o.incentiveSplits.map((s) => ({ businessType: s.businessType, amount: Number(s.amount) })),
        splitMissing,
        netValue: Number(o.netValue),
        grossValue: Number(o.grossValue),
        received: rec.received,
        outstanding: cancelled ? 0 : rec.outstanding,
        notYetDue: cancelled ? 0 : rec.notYetDue,
        overdue: overdueAmount,
        incentive: { earned: sumBy(IncentiveEntryStatus.EARNED), approved: sumBy(IncentiveEntryStatus.APPROVED), paid: sumBy(IncentiveEntryStatus.PAID) },
        payments: o.receipts.map((rc) => {
          const stage = o.payments.find((p) => p.id === rc.paymentStageId);
          return {
            id: rc.id,
            receivedDate: rc.receivedDate,
            financialYear: getIndianFYQuarter(rc.receivedDate).financialYear,
            stage: stage ? `${Number(stage.percent)}% ${stage.description}` : '',
            amount: Number(rc.amount),
            eligible: eligible.get(rc.id) ?? 0,
            paymentMode: rc.paymentMode,
            reference: rc.reference,
            isReversed: rc.isReversed,
            entries: own
              .filter((e) => e.receiptId === rc.id)
              .map((e) => ({
                id: e.id,
                kind: e.kind,
                businessType: e.businessType,
                label: typeLabel(e.businessType),
                eligibleAmount: Number(e.eligibleAmount),
                ratePercent: Number(e.ratePercent),
                bonusEligible: Number(e.bonusEligible),
                bonusAmount: Number(e.bonusAmount),
                incentiveAmount: Number(e.incentiveAmount),
                status: e.status,
              })),
          };
        }),
      };
    });

    // This year's incentive entries: the year a payment was received is the year its incentive belongs to
    const fyEntries = entries.filter((e) => e.financialYear === financialYear);
    for (const e of fyEntries.filter(live)) {
      const row = typeRow(e.businessType);
      if (e.kind === IncentiveEntryKind.EARNING) row.collections += Number(e.eligibleAmount);
      row.incentive += Number(e.incentiveAmount);
    }
    const total = (status: IncentiveEntryStatus) => r2(fyEntries.filter((e) => e.status === status).reduce((t, e) => t + Number(e.incentiveAmount), 0));

    // Every financial year with orders or payments, newest first, always including the current one
    const years = new Set<string>([getIndianFYQuarter().financialYear, financialYear]);
    orders.forEach((o) => years.add(getIndianFYQuarter(o.orderDate).financialYear));
    entries.forEach((e) => years.add(e.financialYear));

    const audit = isDirector
      ? await prisma.auditEvent.findMany({
          where: { entityType: { in: ['TARGET', 'INCENTIVE_RATE', 'ORDER_SPLIT', 'INCENTIVE_ENTRY'] } },
          include: { actor: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : [];

    return NextResponse.json({
      role: user.role,
      financialYear,
      financialYears: [...years].sort().reverse(),
      salespeople,
      salespersonId,
      officeId,
      offices: isDirector ? (await listOffices()).map((o) => ({ id: o.id, name: o.name })) : [],
      summary: {
        bookings: r2(bookings),
        collections: r2(fyEntries.filter((e) => live(e) && e.kind === IncentiveEntryKind.EARNING).reduce((t, e) => t + Number(e.eligibleAmount), 0)),
        outstanding: r2(outstanding),
        overdue: r2(overdue),
        earned: total(IncentiveEntryStatus.EARNED),
        approved: total(IncentiveEntryStatus.APPROVED),
        paid: total(IncentiveEntryStatus.PAID),
        needsSplit,
        // Unapproved payments that earn nothing (booked outside any target, or 0% for the type), by type
        unrated: [
          ...fyEntries
            .filter((e) => e.kind === IncentiveEntryKind.EARNING && e.status === IncentiveEntryStatus.EARNED && Number(e.incentiveAmount) === 0)
            .reduce((m, e) => {
              const row = m.get(e.businessType) || { businessType: e.businessType, label: typeLabel(e.businessType), count: 0, eligible: 0, earliest: e.receivedDate };
              row.count += 1;
              row.eligible = r2(row.eligible + Number(e.eligibleAmount));
              if (e.receivedDate < row.earliest) row.earliest = e.receivedDate;
              return m.set(e.businessType, row);
            }, new Map<string, { businessType: string; label: string; count: number; eligible: number; earliest: Date }>())
            .values(),
        ],
      },
      byType: [...byType.values()].map((t) => ({ ...t, bookings: r2(t.bookings), collections: r2(t.collections), incentive: r2(t.incentive) })),
      entries: fyEntries.map((e) => ({
        id: e.id,
        kind: e.kind,
        orderId: e.orderId,
        orderNumber: e.orderNumber,
        clientId: e.clientId,
        clientName: e.clientName,
        salesperson: e.salesperson.name,
        businessType: e.businessType,
        label: typeLabel(e.businessType),
        receivedDate: e.receivedDate,
        receiptAmount: Number(e.receiptAmount),
        eligibleAmount: Number(e.eligibleAmount),
        ratePercent: Number(e.ratePercent),
        bonusEligible: Number(e.bonusEligible),
        bonusAmount: Number(e.bonusAmount),
        incentiveAmount: Number(e.incentiveAmount),
        status: e.status,
        approvedAt: e.approvedAt,
        paidAt: e.paidAt,
        paymentRef: e.paymentRef,
      })),
      orders: orderRows,
      audit: audit.map((a) => ({ id: a.id, entityType: a.entityType, action: a.action, actor: a.actor.name, details: a.details, createdAt: a.createdAt })),
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return apiErrorResponse(error);
  }
}

/**
 * Director actions: SET_SPLIT (a mixed order's value by type), APPROVE and PAY (incentive entries). Each is
 * written to the audit trail.
 */
export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);
    const audit = (entityType: string, entityId: string, action: 'CREATE' | 'UPDATE' | 'APPROVE' | 'PAYOUT', details: Record<string, unknown>) =>
      prisma.auditEvent.create({ data: { entityType, entityId, action, actorId: director.id, details: details as any } });

    switch (body.action) {
      case 'SET_SPLIT': {
        const order = await prisma.order.findUnique({ where: { id: String(body.orderId) }, select: { id: true, orderNumber: true, netValue: true, enquiry: { select: { category: true, categories: true } } } });
        if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        const allowed = order.enquiry ? (order.enquiry.categories.length ? order.enquiry.categories : [order.enquiry.category]) : [];
        const splits: { businessType: EnquiryCategory; amount: number }[] = (Array.isArray(body.splits) ? body.splits : [])
          .map((s: any) => ({ businessType: s.businessType as EnquiryCategory, amount: r2(Number(s.amount)) }))
          .filter((s: any) => s.amount > 0);
        if (splits.some((s) => !allowed.includes(s.businessType) || !Number.isFinite(s.amount))) {
          return NextResponse.json({ error: "Split only across the order's business types, with valid amounts" }, { status: 400 });
        }
        const total = r2(splits.reduce((t, s) => t + s.amount, 0));
        if (Math.abs(total - Number(order.netValue)) > 1) {
          return NextResponse.json({ error: `The split must add up to the order value of ₹${Number(order.netValue).toLocaleString('en-IN')} (it adds up to ₹${total.toLocaleString('en-IN')})` }, { status: 400 });
        }
        await prisma.$transaction([
          prisma.orderIncentiveSplit.deleteMany({ where: { orderId: order.id } }),
          prisma.orderIncentiveSplit.createMany({ data: splits.map((s) => ({ orderId: order.id, businessType: s.businessType, amount: s.amount, setById: director.id })) }),
        ]);
        await audit('ORDER_SPLIT', order.id, 'UPDATE', {
          label: `Order ${order.orderNumber} split: ${splits.map((s) => `${typeLabel(s.businessType)} ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')}`,
          orderNumber: order.orderNumber,
          splits,
        });
        await syncIncentiveEntries();
        return NextResponse.json({ success: true });
      }

      case 'APPROVE':
      case 'PAY': {
        const ids: string[] = Array.isArray(body.entryIds) ? body.entryIds.map(String) : [];
        if (!ids.length) return NextResponse.json({ error: 'Select at least one incentive' }, { status: 400 });
        const paying = body.action === 'PAY';
        const from = paying ? IncentiveEntryStatus.APPROVED : IncentiveEntryStatus.EARNED;
        const picked = await prisma.incentiveEntry.findMany({ where: { id: { in: ids }, status: from }, select: { id: true, incentiveAmount: true, salespersonId: true, financialYear: true } });
        if (!picked.length) return NextResponse.json({ error: paying ? 'None of these are approved and unpaid' : 'None of these are waiting for approval' }, { status: 400 });
        const paidAt = paying && body.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(body.paidAt) ? indiaDayStart(body.paidAt) : new Date();
        await prisma.incentiveEntry.updateMany({
          where: { id: { in: picked.map((p) => p.id) }, status: from },
          data: paying
            ? { status: IncentiveEntryStatus.PAID, paidById: director.id, paidAt, paymentRef: String(body.paymentRef || '').trim() || null }
            : { status: IncentiveEntryStatus.APPROVED, approvedById: director.id, approvedAt: new Date() },
        });
        const amount = r2(picked.reduce((t, p) => t + Number(p.incentiveAmount), 0));
        await audit('INCENTIVE_ENTRY', picked[0].id, paying ? 'PAYOUT' : 'APPROVE', {
          label: `${paying ? 'Paid' : 'Approved'} ${picked.length} incentive${picked.length === 1 ? '' : 's'} · ₹${amount.toLocaleString('en-IN')}${paying && body.paymentRef ? ` · ref ${body.paymentRef}` : ''}`,
          entryIds: picked.map((p) => p.id),
          amount,
          ...(paying ? { paymentRef: body.paymentRef || null } : {}),
        });
        return NextResponse.json({ success: true, count: picked.length, amount });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') return NextResponse.json({ error: 'Only a director can do this' }, { status: 403 });
    return apiErrorResponse(error);
  }
}
