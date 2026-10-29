import { nextFollowUpDates } from '@/lib/followUpDates';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Role, OrderStatus, TaskStatus, QuotationStatus } from '@prisma/client';
import { getIndianFYQuarter, TIMEZONE } from '@/lib/utils';
import { periodLabel } from '@/lib/targetPeriods';
import { achievedFor, currentOfEachChain } from '@/lib/targets';
import { listOffices, salespersonScope } from '@/lib/officeScope';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import { reconcileOrder } from '@/lib/deductions';
import { filterRecord, inferFilterFields, matchesFilters, parseRecordFilters } from '@/lib/recordFilters';
import { deliveryStatus } from '@/lib/deliveryTracking';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);

    const currentFY = getIndianFYQuarter();
    const financialYear = searchParams.get('financialYear') || currentFY.financialYear;
    const quarter = searchParams.get('quarter') || currentFY.quarter;
    const salespersonFilter = searchParams.get('salespersonId');
    const officeFilter = searchParams.get('officeId');
    const industryFilter = searchParams.get('industry');
    const categoryFilter = searchParams.get('category');
    const stageFilter = searchParams.get('stage');
    let recordFilters;
    try { recordFilters = parseRecordFilters(searchParams.get('filters')); }
    catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const clientFields = {
      name: true, code: true, city: true, state: true, industrySegment: true, clientType: true, gstNumber: true,
      contacts: { select: { name: true, designation: true, mobile: true, email: true } },
    } as const;
    const matches = (record: any, recordType: string) => recordFilters.rules.length === 0 || matchesFilters(filterRecord({ ...record, recordType }), recordFilters);

    // Salesperson can only view their own records
    const isDirector = user.role === Role.DIRECTOR;
    const targetSpId = isDirector ? (salespersonFilter || null) : user.id;
    // Directors can also narrow to one office: everyone who belongs to it
    const spScope = isDirector ? await salespersonScope(salespersonFilter, officeFilter) : user.id;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // 1. Follow-up Tasks Counts
    const taskWhere: any = {
      ...(spScope ? { assignedSalespersonId: spScope } : {}),
      ...(industryFilter ? { client: { industrySegment: industryFilter } } : {}),
    };
    const taskCandidates = await prisma.task.findMany({
      where: {
        ...taskWhere,
        status: TaskStatus.PENDING,
      },
      include: {
        client: { select: { id: true, ...clientFields } },
        assignedSalesperson: { select: { id: true, name: true } },
        enquiry: { select: { id: true, enquiryNumber: true, title: true, stage: true, category: true, categories: true } },
        _count: { select: { rescheduleHistory: true } },
      },
      orderBy: { dueDateTime: 'asc' },
    });
    const filteredTasks = taskCandidates.filter((task) => matches(task, 'Follow-up'));
    const dueTodayCount = filteredTasks.filter((task) => task.dueDateTime >= startOfToday && task.dueDateTime <= endOfToday).length;
    // Due = pending and dated before today; anything later today counts as today's, not twice
    const allOverdueTasks = filteredTasks.filter((task) => task.dueDateTime < startOfToday);
    const overdueTasks = allOverdueTasks.slice(0, 10);
    const overdueTasksCount = allOverdueTasks.length;
    const upcomingTasksCount = filteredTasks.filter((task) => task.dueDateTime > endOfToday).length;
    const nextDates = nextFollowUpDates(filteredTasks);
    // Detail rows for the dashboard's tiles (capped; each links to the record)
    const taskRow = (task: (typeof filteredTasks)[number]) => ({
      id: task.id,
      clientId: task.clientId,
      clientName: task.client.name,
      enquiryNumber: task.enquiry?.enquiryNumber ?? null,
      requirement: task.enquiry?.title ?? null,
      description: task.description,
      actionType: task.actionType,
      dueDateTime: task.dueDateTime,
      status: task._count.rescheduleHistory > 0 ? 'RESCHEDULED' : 'PENDING',
      // The next pending follow-up on the same requirement (or client, when not tied to one)
      nextDueDateTime: nextDates.get(task.id) ?? null,
      salesperson: task.assignedSalesperson.name,
    });
    // Pending only: "due" is before today, as the dashboard spec defines it
    const overdueTaskRows = allOverdueTasks.map(taskRow);
    const todayTaskRows = filteredTasks.filter((task) => task.dueDateTime >= startOfToday && task.dueDateTime <= endOfToday).map(taskRow);
    const futureTaskRows = filteredTasks.filter((task) => task.dueDateTime > endOfToday).map(taskRow);

    // 2. Enquiries & Pipeline
    const enqWhere: any = {
      ...(spScope ? { assignedToId: spScope } : {}),
      ...(industryFilter ? { client: { industrySegment: industryFilter } } : {}),
      ...(categoryFilter ? { categories: { has: categoryFilter as any } } : {}),
      ...(stageFilter ? { stage: stageFilter as any } : {}),
    };

    const enquiryCandidates = await prisma.enquiry.findMany({
      where: enqWhere,
      include: {
        client: { select: clientFields },
        assignedTo: { select: { id: true, name: true } },
        tasks: { where: { status: 'PENDING' }, take: 1 },
        activities: { orderBy: { activityDate: 'desc' }, take: 1 },
        // For the conversion funnel: quoted, and reached negotiation
        _count: { select: { quotations: true } },
        // Reached negotiation (funnel) and when it was marked lost (Orders Lost table)
        stageHistory: { where: { toStage: { in: ['NEGOTIATION', 'LOST'] } }, select: { toStage: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const allEnquiries = enquiryCandidates.filter((e) => matches(e, 'Requirement'));
    const openEnquiries = allEnquiries.filter((e) => e.stage !== 'WON' && e.stage !== 'LOST');

    const totalPipelineValue = openEnquiries.reduce((sum, e) => sum + Number(e.estimatedValue), 0);

    // Enquiries missing next actions
    const missingActionEnquiries = openEnquiries.filter((e) => e.tasks.length === 0 && !e.isException);

    // Stalled enquiries (no activity in last 14 days)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const stalledEnquiries = openEnquiries.filter((e) => {
      const lastAct = e.activities[0];
      return !lastAct || lastAct.activityDate.getTime() < fourteenDaysAgo.getTime();
    });

    // Enquiries stage distribution
    const stageCounts: Record<string, { count: number; value: number }> = {};
    for (const enq of allEnquiries) {
      if (!stageCounts[enq.stage]) stageCounts[enq.stage] = { count: 0, value: 0 };
      stageCounts[enq.stage].count += 1;
      stageCounts[enq.stage].value += Number(enq.estimatedValue);
    }

    // 3. Quotations awaiting approval
    const quoteCandidates = await prisma.quotation.findMany({
      where: {
        approvalStatus: QuotationStatus.PENDING_APPROVAL,
        ...(spScope ? { salespersonId: spScope } : {}),
        ...(industryFilter ? { client: { industrySegment: industryFilter } } : {}),
      },
      include: {
        client: { select: clientFields },
        salesperson: { select: { name: true } },
        enquiry: { select: { title: true } },
      },
      orderBy: { proposalDate: 'desc' },
    });
    const pendingQuotes = quoteCandidates.filter((q) => matches(q, 'Quotation'));

    // 4. Financial Metrics: every order that is not cancelled (it stays owed while in execution,
    // dispatched or completed), reconciled stage by stage like the order's Payments tab
    const orderWhere: any = {
      orderStatus: { not: OrderStatus.CANCELLED },
      ...(spScope ? { assignedSalespersonId: spScope } : {}),
      ...(industryFilter ? { client: { industrySegment: industryFilter } } : {}),
    };
    const orderCandidates = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNumber: true,
        orderStatus: true,
        orderDate: true,
        createdAt: true,
        clientPoNumber: true,
        poDate: true,
        deliveryDate: true,
        product: true,
        remarks: true,
        netValue: true,
        grossValue: true,
        tdsAmount: true,
        retentionAmount: true,
        retentionDueDate: true,
        client: { select: { id: true, ...clientFields } },
        assignedSalespersonId: true,
        assignedSalesperson: { select: { name: true } },
        enquiry: { select: { id: true, enquiryNumber: true, title: true, category: true, categories: true, categoryOther: true } },
        payments: {
          select: { id: true, sequence: true, percent: true, description: true, amount: true, expectedAmount: true, gstAmount: true, dueDate: true },
          orderBy: { sequence: 'asc' },
        },
        receipts: { select: { paymentStageId: true, amount: true, isReversed: true, receivedDate: true, createdAt: true, paymentMode: true, reference: true, notes: true } },
        executionSteps: { select: { name: true, status: true, sequence: true, completedDate: true } },
        deliveryRevisions: { select: { previousDate: true, newDate: true, reason: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const orders = orderCandidates.filter((order) => matches(order, 'Order'));
    const totalOrdersNet = orders.reduce((sum, o) => sum + Number(o.netValue), 0);
    const totalOrdersGross = orders.reduce((sum, o) => sum + Number(o.grossValue), 0);

    // Received = receipts that count; outstanding (= due now) = raised as due − received on it;
    // not yet due = balance on stages not raised yet; underpayment = the part of the outstanding on
    // stages the client paid only partly
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let totalPaymentsReceived = 0;
    let totalOutstanding = 0;
    let totalPaymentsPending = 0;
    let totalPaymentsNotYetDue = 0;
    let totalUnderpayment = 0;
    let totalOverpayment = 0;
    let totalRetentionWithheld = 0;
    let retentionOverdue = 0;
    const collections: any[] = [];
    const receiptRows: any[] = [];
    // Every milestone raised as due (overdue or due today) and still owed money; future-due ones are in futureDueRows
    const outstandingRows: any[] = [];
    // Every milestone still to be asked for: not raised as due yet (dated later, or waiting on execution)
    const futureDueRows: any[] = [];
    const startOfTodayMs = startOfToday.getTime();
    const orderBreakdown: any[] = [];
    for (const o of orders) {
      const r = reconcileOrder(o.payments, o.receipts);
      // Days the oldest raised payment has waited unpaid
      const oldestDue = r.rows
        .filter((row) => row.isDue && row.outstanding > 0)
        .map((row) => o.payments.find((p) => p.id === row.stageId)?.dueDate)
        .filter(Boolean)
        .sort((a, b) => a!.getTime() - b!.getTime())[0];
      orderBreakdown.push({
        id: o.id,
        orderNumber: o.orderNumber,
        product: o.product,
        status: r.status,
        daysPending: oldestDue ? Math.max(0, Math.floor((now.getTime() - oldestDue.getTime()) / 86400000)) : 0,
        orderStatus: o.orderStatus,
        orderDate: o.orderDate,
        clientId: o.client.id,
        clientName: o.client.name,
        salesperson: o.assignedSalesperson.name,
        netValue: Number(o.netValue),
        grossValue: Number(o.grossValue),
        received: r.received,
        outstanding: r.outstanding,
        dueNow: r.dueNow,
        notYetDue: r.notYetDue,
      });
      for (const rc of o.receipts) {
        if (rc.isReversed) continue;
        const stage = o.payments.find((p) => p.id === rc.paymentStageId);
        receiptRows.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          poNumber: o.clientPoNumber,
          enquiryNumber: o.enquiry?.enquiryNumber ?? null,
          requirement: o.enquiry?.title ?? null,
          salesperson: o.assignedSalesperson.name,
          clientId: o.client.id,
          clientName: o.client.name,
          stage: stage ? `${Number(stage.percent)}% ${stage.description}` : '',
          amount: Number(rc.amount),
          receivedDate: rc.receivedDate ?? rc.createdAt,
          paymentMode: rc.paymentMode,
          reference: rc.reference,
        });
      }
      totalPaymentsReceived += r.received;
      totalOutstanding += r.outstanding;
      totalPaymentsPending += r.dueNow;
      totalPaymentsNotYetDue += r.notYetDue;
      totalOverpayment += r.excess;
      totalRetentionWithheld += Number(o.retentionAmount);
      if (Number(o.retentionAmount) > 0 && o.retentionDueDate && o.retentionDueDate.getTime() < now.getTime()) {
        retentionOverdue += Number(o.retentionAmount);
      }
      for (const row of r.rows) {
        const due = o.payments.find((p) => p.id === row.stageId)?.dueDate;
        if (row.isDue && row.outstanding > 0 && due) {
          const daysOverdue = Math.max(0, Math.floor((startOfTodayMs - new Date(due).setHours(0, 0, 0, 0)) / 86400000));
          const stageRow = o.payments.find((p) => p.id === row.stageId)!;
          outstandingRows.push({
            orderId: o.id,
            orderNumber: o.orderNumber,
            poNumber: o.clientPoNumber,
            clientId: o.client.id,
            clientName: o.client.name,
            stage: `${Number(stageRow.percent)}% ${stageRow.description}`,
            dueDate: due,
            asked: row.expected,
            received: row.received,
            outstanding: row.outstanding,
            daysOverdue,
            bucket: daysOverdue === 0 ? 'Current' : daysOverdue <= 30 ? '1–30' : daysOverdue <= 60 ? '31–60' : daysOverdue <= 90 ? '61–90' : '90+',
            salesperson: o.assignedSalesperson.name,
          });
        }
        if (!row.isDue && row.outstanding > 0) {
          const stageRow = o.payments.find((p) => p.id === row.stageId)!;
          futureDueRows.push({
            orderId: o.id,
            orderNumber: o.orderNumber,
            poNumber: o.clientPoNumber,
            clientId: o.client.id,
            clientName: o.client.name,
            stage: `${Number(stageRow.percent)}% ${stageRow.description}`,
            dueDate: due ?? null,
            asked: row.expected,
            received: row.received,
            notYetDue: row.outstanding,
            salesperson: o.assignedSalesperson.name,
          });
        }
        if (!row.isDue || row.outstanding <= 0) continue;
        const stage = o.payments.find((p) => p.id === row.stageId)!;
        const underpaid = row.received > 0;
        if (underpaid) totalUnderpayment += row.outstanding;
        collections.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          clientId: o.client.id,
          clientName: o.client.name,
          salesperson: o.assignedSalesperson?.name,
          stage: `${Number(stage.percent)}% ${stage.description}`,
          asked: row.expected,
          received: row.received,
          outstanding: row.outstanding,
          invoiceGst: row.invoiceGst,
          underpaid,
          dueDate: stage.dueDate,
          daysDue: stage.dueDate ? Math.max(0, Math.floor((now.getTime() - stage.dueDate.getTime()) / 86400000)) : 0,
        });
      }
    }
    // Oldest first: the longest-waiting money is chased first
    collections.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    totalPaymentsReceived = r2(totalPaymentsReceived);
    totalOutstanding = r2(totalOutstanding);
    totalPaymentsPending = r2(totalPaymentsPending);
    totalUnderpayment = r2(totalUnderpayment);
    totalOverpayment = r2(totalOverpayment);
    totalPaymentsNotYetDue = r2(totalPaymentsNotYetDue);

    // 5. Ongoing execution: orders whose last Execution stage is not done yet, each against its targeted
    // completion date: Overdue (date passed), Due today, or Upcoming
    const deliveryRows = orders.flatMap((o) => {
      const d = deliveryStatus(o, now);
      if (d.deliveredDate) return [];
      return [
        {
          orderId: o.id,
          clientId: o.client.id,
          clientName: o.client.name,
          orderNumber: o.orderNumber,
          poNumber: o.clientPoNumber,
          enquiryNumber: o.enquiry?.enquiryNumber ?? null,
          requirement: o.enquiry?.title ?? o.product ?? null,
          netValue: Number(o.netValue),
          orderStatus: o.orderStatus,
          ...d,
          dayStatus: d.daysLeft === null ? 'No date' : d.daysLeft < 0 ? 'Overdue' : d.daysLeft === 0 ? 'Due Today' : 'Upcoming',
          lastReason: o.deliveryRevisions.at(-1)?.reason ?? null,
          salesperson: o.assignedSalesperson.name,
        },
      ];
    });
    const deliveryCount = (status: string) => deliveryRows.filter((r) => r.dayStatus === status).length;
    const delivery = {
      ongoing: deliveryRows.length,
      overdue: deliveryCount('Overdue'),
      dueToday: deliveryCount('Due Today'),
      upcoming: deliveryCount('Upcoming'),
      noTarget: deliveryCount('No date'),
    };

    // 6. Targets running today, whatever their period (month, quarter, 6 months, year, custom dates); of each
    // chain (Target 1, Target 2, …) the one being worked toward
    const targets = await currentOfEachChain(
      await prisma.target.findMany({
        where: {
          periodStart: { lte: now },
          periodEnd: { gte: now },
          ...(spScope ? { salespersonId: spScope } : {}),
        },
        include: { salesperson: { select: { name: true } } },
      })
    );

    // 7. Visual dashboard: trends by month (India time), this month vs last month, funnel, order status
    const monthKey = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
    const nowKey = monthKey(now);
    const [nowYear, nowMonth] = nowKey.split('-').map(Number);
    const months = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(Date.UTC(nowYear, nowMonth - 1 - (9 - i), 15));
      return { key: monthKey(d), label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: TIMEZONE }).format(d) };
    });
    const lastKey = months[8].key;
    const monthly = months.map((m) => ({ ...m, enquiries: 0, orders: 0, orderValue: 0, received: 0 }));
    const bucket = (d: Date | null) => (d ? monthly.find((m) => m.key === monthKey(d)) : undefined);
    for (const e of allEnquiries) { const m = bucket(e.createdAt); if (m) m.enquiries += 1; }
    for (const o of orders) {
      const m = bucket(o.orderDate);
      if (m) { m.orders += 1; m.orderValue += Number(o.netValue); }
      for (const rc of o.receipts) {
        if (rc.isReversed) continue;
        const mr = bucket(rc.receivedDate ?? rc.createdAt);
        if (mr) mr.received += Number(rc.amount);
      }
    }
    for (const m of monthly) { m.orderValue = r2(m.orderValue); m.received = r2(m.received); }
    const thisMonth = monthly[9];
    const lastMonth = monthly[8];

    // Follow-ups due yesterday (any status), to compare with today
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const dueYesterdayCount = await prisma.task.count({
      where: { ...taskWhere, dueDateTime: { gte: startOfYesterday, lt: startOfToday } },
    });

    const wonCount = allEnquiries.filter((e) => e.stage === 'WON').length;
    // Each stage with how many requirements reached it and their estimated value
    const stage = (key: string, label: string, reached: typeof allEnquiries) => ({
      key,
      label,
      count: reached.length,
      value: r2(reached.reduce((sum, e) => sum + Number(e.estimatedValue), 0)),
    });
    const funnel = [
      stage('requirements', 'Requirements', allEnquiries),
      stage('quoted', 'Quotation sent', allEnquiries.filter((e) => e._count.quotations > 0)),
      stage(
        'negotiated',
        'Negotiation reached',
        allEnquiries.filter((e) => e.stage === 'NEGOTIATION' || e.stage === 'WON' || e.stageHistory.some((h) => h.toStage === 'NEGOTIATION'))
      ),
      stage('won', 'Order booked', allEnquiries.filter((e) => e.stage === 'WON')),
    ];

    const cancelledCount = await prisma.order.count({ where: { ...orderWhere, orderStatus: OrderStatus.CANCELLED } });
    const cancelledOrders = cancelledCount
      ? (
          await prisma.order.findMany({
            where: { ...orderWhere, orderStatus: OrderStatus.CANCELLED },
            select: {
              id: true, orderNumber: true, orderStatus: true, orderDate: true, clientPoNumber: true, poDate: true, product: true, netValue: true,
              client: { select: { id: true, ...clientFields } },
              assignedSalesperson: { select: { name: true } },
              enquiry: { select: { id: true, enquiryNumber: true, title: true, category: true, categories: true, categoryOther: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        ).filter((order) => matches(order, 'Order'))
      : [];
    // Each status with its orders' count and net value
    const statusRow = (key: string, label: string, list: { netValue: unknown }[], count = list.length) => ({
      key,
      label,
      count,
      value: r2(list.reduce((sum, o) => sum + Number(o.netValue), 0)),
    });
    const orderStatus = [
      statusRow('COMPLETED', 'Completed', orders.filter((o) => o.orderStatus === 'COMPLETED')),
      statusRow('IN_PROGRESS', 'In execution', orders.filter((o) => o.orderStatus === 'IN_EXECUTION' || o.orderStatus === 'DISPATCHED')),
      statusRow('CONFIRMED', 'Not started', orders.filter((o) => o.orderStatus === 'CONFIRMED')),
      statusRow('CANCELLED', 'Cancelled', cancelledOrders, cancelledCount),
    ];

    // Order target: per salesperson, the running ORDERS_BOOKED target with the shortest period (the most
    // immediate one), each measured over its own period like the Targets page
    const orderTargets = new Map<string, (typeof targets)[number]>();
    for (const t of targets) {
      if (t.targetType !== 'ORDERS_BOOKED') continue;
      const seen = orderTargets.get(t.salespersonId);
      const length = (x: typeof t) => x.periodEnd.getTime() - x.periodStart.getTime();
      if (!seen || length(t) < length(seen)) orderTargets.set(t.salespersonId, t);
    }
    const running = [...orderTargets.values()];
    const achievedEach = await Promise.all(running.map((t) => achievedFor(t)));
    const labels = new Set(running.map((t) => periodLabel(t.financialYear, t.periodType, t.periodKey)));
    const periodEnd = running.length ? Math.min(...running.map((t) => t.periodEnd.getTime())) : null;
    const target = {
      label: labels.size === 1 ? [...labels][0] : running.length ? 'current targets' : `${financialYear} ${quarter}`,
      target: r2(running.reduce((sum, t) => sum + Number(t.targetValue), 0)),
      achieved: r2(achievedEach.reduce((sum, a) => sum + a, 0)),
      daysLeft: periodEnd ? Math.max(0, Math.ceil((periodEnd - now.getTime()) / 86400000)) : 0,
    };

    // Best order value this month by salesperson (directors' Top performer)
    const bySalesperson = new Map<string, { name: string; value: number; count: number }>();
    for (const o of orders) {
      if (monthKey(o.orderDate) !== nowKey) continue;
      const row = bySalesperson.get(o.assignedSalesperson.name) || { name: o.assignedSalesperson.name, value: 0, count: 0 };
      row.value += Number(o.netValue);
      row.count += 1;
      bySalesperson.set(row.name, row);
    }
    const topPerformer = [...bySalesperson.values()].sort((a, b) => b.value - a.value)[0] || null;

    const visual = {
      monthly,
      kpis: {
        enquiries: { now: thisMonth.enquiries, before: lastMonth.enquiries },
        followUpsToday: { now: dueTodayCount, before: dueYesterdayCount },
        ordersBooked: { now: thisMonth.orderValue, before: lastMonth.orderValue },
        received: { now: thisMonth.received, before: lastMonth.received },
        avgOrder: {
          now: thisMonth.orders ? r2(thisMonth.orderValue / thisMonth.orders) : 0,
          before: lastMonth.orders ? r2(lastMonth.orderValue / lastMonth.orders) : 0,
          overall: orders.length ? r2(totalOrdersNet / orders.length) : 0,
        },
        conversion: { won: wonCount, total: allEnquiries.length },
        // Leads are requirements; a requirement's value is its quoted (or approximate) value
        leads: { total: allEnquiries.length, thisMonth: thisMonth.enquiries },
        enquiryValue: {
          total: r2(allEnquiries.reduce((sum, e) => sum + Number(e.estimatedValue), 0)),
          thisMonth: r2(allEnquiries.filter((e) => monthKey(e.createdAt) === nowKey).reduce((sum, e) => sum + Number(e.estimatedValue), 0)),
        },
        won: { count: wonCount, value: r2(allEnquiries.filter((e) => e.stage === 'WON').reduce((sum, e) => sum + Number(e.estimatedValue), 0)) },
        lost: {
          count: allEnquiries.filter((e) => e.stage === 'LOST').length,
          value: r2(allEnquiries.filter((e) => e.stage === 'LOST').reduce((sum, e) => sum + Number(e.estimatedValue), 0)),
        },
        orders: { count: orders.length, value: r2(totalOrdersNet), thisMonth: thisMonth.orders },
      },
      monthLabel: `${months[9].label} ${nowYear}`,
      lastKey,
      funnel,
      orderStatus,
      target,
      topPerformer: topPerformer && { ...topPerformer, value: r2(topPerformer.value) },
      outstandingClients: new Set(collections.map((c) => c.clientId)).size,
    };

    // Directors pick whose dashboard to see: the team, or one salesperson
    const salespeople = isDirector
      ? await prisma.user.findMany({
          where: { role: Role.SALESPERSON, isActive: true, ...(officeFilter ? { officeId: officeFilter } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];
    const offices = isDirector ? await listOffices() : [];
    // The team view: one row per salesperson, from the same filtered records as the cards above it
    const team =
      isDirector && !targetSpId
        ? await Promise.all(
            salespeople.map(async (sp) => {
              const leads = allEnquiries.filter((e) => e.assignedTo.id === sp.id);
              const open = leads.filter((e) => e.stage !== 'WON' && e.stage !== 'LOST');
              const won = leads.filter((e) => e.stage === 'WON').length;
              const own = orders.filter((o) => o.assignedSalespersonId === sp.id);
              let received = 0;
              let outstanding = 0;
              for (const o of own) {
                const r = reconcileOrder(o.payments, o.receipts);
                received += r.received;
                outstanding += r.outstanding;
              }
              const t = orderTargets.get(sp.id);
              return {
                id: sp.id,
                name: sp.name,
                target: t
                  ? { value: r2(Number(t.targetValue)), achieved: r2(await achievedFor(t)), label: periodLabel(t.financialYear, t.periodType, t.periodKey) }
                  : null,
                leads: leads.length,
                openLeads: open.length,
                pipeline: r2(open.reduce((sum, e) => sum + Number(e.estimatedValue), 0)),
                won,
                conversion: leads.length ? Math.round((won / leads.length) * 100) : 0,
                orders: own.length,
                orderValue: r2(own.reduce((sum, o) => sum + Number(o.netValue), 0)),
                received: r2(received),
                outstanding: r2(outstanding),
                overdueFollowUps: allOverdueTasks.filter((task) => task.assignedSalesperson.id === sp.id).length,
                todayFollowUps: filteredTasks.filter((task) => task.assignedSalesperson.id === sp.id && task.dueDateTime >= startOfToday && task.dueDateTime <= endOfToday).length,
                pendingApprovals: pendingQuotes.filter((q) => q.salespersonId === sp.id).length,
              };
            })
          )
        : null;
    const viewing = isDirector && targetSpId ? salespeople.find((sp) => sp.id === targetSpId) ?? null : null;

    return NextResponse.json({
      role: user.role,
      salespeople,
      offices: offices.map((o) => ({ id: o.id, name: o.name })),
      team,
      viewing,
      visual,
      user: { id: user.id, name: user.name },
      financialYear,
      quarter,
      summary: {
        dueTodayCount,
        overdueTasksCount,
        upcomingTasksCount,
        openEnquiriesCount: openEnquiries.length,
        totalPipelineValue,
        missingActionCount: missingActionEnquiries.length,
        stalledEnquiriesCount: stalledEnquiries.length,
        pendingQuotesCount: pendingQuotes.length,
        totalOrdersNet,
        totalOrdersGross,
        totalPaymentsReceived,
        totalPaymentsPending,
        totalPaymentsNotYetDue,
        totalOutstanding,
        totalUnderpayment,
        totalOverpayment,
        totalRetentionWithheld: r2(totalRetentionWithheld),
        retentionOverdue: r2(retentionOverdue),
        collectionsCount: collections.length,
        futureDueCount: futureDueRows.length,
        delivery,
      },
      pipelineEntries: openEnquiries.map((e) => ({
        id: e.id,
        clientId: e.clientId,
        clientName: e.client.name,
        enquiryNumber: e.enquiryNumber,
        title: e.title,
        stage: e.stage,
        value: Number(e.estimatedValue),
        salesperson: e.assignedTo.name,
      })),
      orderBreakdown,
      collections: collections.slice(0, 15),
      details: {
        // Every lead in the filters (one row per requirement, however many orders it led to)
        leads: allEnquiries.map((e) => ({
          id: e.id,
          clientId: e.clientId,
          clientName: e.client.name,
          industry: e.client.industrySegment,
          city: e.client.city,
          state: e.client.state,
          enquiryNumber: e.enquiryNumber,
          title: e.title,
          productType: requirementTypeLabel(e),
          description: e.requirementSummary,
          stage: e.stage,
          value: Number(e.estimatedValue),
          salesperson: e.assignedTo.name,
          createdAt: e.createdAt,
          lostReason: e.lostReason,
          // Funnel stages the lead reached, so a funnel click opens the same leads it counts
          quoted: e._count.quotations > 0,
          negotiated: e.stage === 'NEGOTIATION' || e.stage === 'WON' || e.stageHistory.some((h) => h.toStage === 'NEGOTIATION'),
          month: monthKey(e.createdAt),
          lostDate: e.stage === 'LOST' ? e.stageHistory.find((h) => h.toStage === 'LOST')?.createdAt ?? null : null,
        })),
        orders: [...orders, ...cancelledOrders].map((o) => {
          const rec = orderBreakdown.find((b) => b.id === o.id);
          return {
            id: o.id,
            clientId: o.client.id,
            clientName: o.client.name,
            industry: o.client.industrySegment,
            city: o.client.city,
            state: o.client.state,
            enquiryId: o.enquiry?.id ?? null,
            enquiryNumber: o.enquiry?.enquiryNumber ?? null,
            orderNumber: o.orderNumber,
            orderDate: o.orderDate,
            poNumber: o.clientPoNumber,
            poDate: o.poDate,
            product: o.product,
            productType: o.enquiry ? requirementTypeLabel(o.enquiry) : null,
            netValue: Number(o.netValue),
            orderStatus: o.orderStatus,
            received: rec?.received ?? 0,
            outstanding: rec?.outstanding ?? 0,
            paymentStatus: rec?.status ?? null,
            salesperson: o.assignedSalesperson.name,
          };
        }),
        outstanding: outstandingRows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding),
        // Soonest first; milestones with no date yet (waiting on execution) last
        futureDue: futureDueRows.sort(
          (a, b) => Number(!a.dueDate) - Number(!b.dueDate) || (a.dueDate ? new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() : 0)
        ),
        // Most overdue first; orders with no targeted completion date last
        delivery: deliveryRows.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)),
        todayTasks: todayTaskRows,
        futureTasks: futureTaskRows,
        overdueTasks: overdueTaskRows,
        receipts: receiptRows.sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime()),
      },
      overdueTasks,
      pendingQuotes,
      missingActionEnquiries: missingActionEnquiries.slice(0, 10),
      stalledEnquiries: stalledEnquiries.slice(0, 10),
      stageCounts,
      targets,
      filterFields: inferFilterFields([
        ...taskCandidates.map((record) => filterRecord({ ...record, recordType: 'Follow-up' })),
        ...enquiryCandidates.map((record) => filterRecord({ ...record, recordType: 'Requirement' })),
        ...quoteCandidates.map((record) => filterRecord({ ...record, recordType: 'Quotation' })),
        ...orderCandidates.map((record) => filterRecord({ ...record, recordType: 'Order' })),
      ]),
      filterTotal: taskCandidates.length + enquiryCandidates.length + quoteCandidates.length + orderCandidates.length,
      filterCount: filteredTasks.length + allEnquiries.length + pendingQuotes.length + orders.length,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
