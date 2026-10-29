import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { analysisPeriod, emptySalesMetrics } from '@/lib/salesAnalysis';
import { formatInTimeZone } from 'date-fns-tz';

export async function GET(request: Request) {
  try {
    await requireDirector();
    const params = new URL(request.url).searchParams;
    let range;
    try { range = analysisPeriod(params); }
    catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const salespersonId = params.get('salespersonId');
    const people = await prisma.user.findMany({ where: { role: 'SALESPERSON' }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } });
    if (salespersonId && !people.some((person) => person.id === salespersonId)) return NextResponse.json({ error: 'Salesperson not found.' }, { status: 400 });
    const date = { gte: range.from, lt: range.until };
    const owner = salespersonId ? { salespersonId } : {};
    const assigned = salespersonId ? { assignedSalespersonId: salespersonId } : {};
    const [enquiries, activities, tasks, quotes, orders, receipts] = await Promise.all([
      prisma.enquiry.findMany({ where: { createdAt: date, ...(salespersonId ? { assignedToId: salespersonId } : {}) }, select: { assignedToId: true, createdAt: true } }),
      prisma.activity.findMany({ where: { activityDate: date, ...owner }, select: { salespersonId: true, activityDate: true } }),
      prisma.task.findMany({ where: { status: 'COMPLETED', completedAt: date, ...assigned }, select: { assignedSalespersonId: true, completedAt: true } }),
      prisma.quotation.findMany({ where: { sentAt: date, ...owner }, select: { salespersonId: true, sentAt: true } }),
      prisma.order.findMany({ where: { orderStatus: { not: 'CANCELLED' }, orderDate: date, ...assigned }, select: { assignedSalespersonId: true, orderDate: true, netValue: true } }),
      prisma.orderReceipt.findMany({ where: { receivedDate: date, isReversed: false, order: { orderStatus: { not: 'CANCELLED' }, ...assigned } }, select: { receivedDate: true, amount: true, order: { select: { assignedSalespersonId: true } } } }),
    ]);
    const rows = people.filter((person) => !salespersonId || person.id === salespersonId).map((person) => ({ ...person, ...emptySalesMetrics() }));
    const byPerson = new Map(rows.map((row) => [row.id, row]));
    const daily = new Map<string, ReturnType<typeof emptySalesMetrics>>();
    for (let day = range.from.getTime(); day < range.until.getTime(); day += 86400000) daily.set(formatInTimeZone(new Date(day), 'Asia/Kolkata', 'yyyy-MM-dd'), emptySalesMetrics());
    const add = (id: string, at: Date | null, metric: keyof ReturnType<typeof emptySalesMetrics>, value = 1) => {
      if (!at) return;
      const person = byPerson.get(id);
      if (!person) return;
      person[metric] += value;
      const day = daily.get(formatInTimeZone(at, 'Asia/Kolkata', 'yyyy-MM-dd'));
      if (day) day[metric] += value;
    };
    enquiries.forEach((row) => add(row.assignedToId, row.createdAt, 'enquiries'));
    activities.forEach((row) => add(row.salespersonId, row.activityDate, 'activities'));
    tasks.forEach((row) => add(row.assignedSalespersonId, row.completedAt, 'followUps'));
    quotes.forEach((row) => add(row.salespersonId, row.sentAt, 'quotations'));
    orders.forEach((row) => { add(row.assignedSalespersonId, row.orderDate, 'orders'); add(row.assignedSalespersonId, row.orderDate, 'orderValue', Number(row.netValue)); });
    receipts.forEach((row) => add(row.order.assignedSalespersonId, row.receivedDate, 'received', Number(row.amount)));
    const totals = emptySalesMetrics();
    rows.forEach((row) => Object.keys(totals).forEach((key) => { totals[key as keyof typeof totals] += row[key as keyof typeof totals]; }));
    return NextResponse.json({ start: range.start, end: range.end, people, rows, totals, daily: Array.from(daily, ([date, metrics]) => ({ date, ...metrics })) });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') return NextResponse.json({ error: 'Only directors can view team analysis.' }, { status: 403 });
    return NextResponse.json({ error: 'Could not load sales analysis.' }, { status: 500 });
  }
}
