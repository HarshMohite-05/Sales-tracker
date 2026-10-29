import { validDateInput } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { salespersonScope } from '@/lib/officeScope';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { formatQuotationNumber } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import { Role, OrderStatus, VerificationStatus, InvoiceStatus, TaskStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { formatINR, formatDate, calculateOverdueDays } from '@/lib/utils';
import { matchesFilters, parseRecordFilters } from '@/lib/recordFilters';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'pipeline';
    const exportFormat = searchParams.get('export'); // 'excel' or null
    let recordFilters;
    try { recordFilters = parseRecordFilters(searchParams.get('filters')); }
    catch (error: any) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const salespersonId = searchParams.get('salespersonId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const startDate = startDateParam ? new Date(startDateParam) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = endDateParam ? new Date(endDateParam) : new Date();
    const allDates = searchParams.get('allDates') === '1';

    if ((startDateParam && !validDateInput(startDateParam)) || (endDateParam && !validDateInput(endDateParam)) || startDate > endDate) {
      return NextResponse.json({ error: 'Enter a valid date range with the start before the end' }, { status: 400 });
    }
    // A salesperson sees their own; a director one salesperson, one office or everyone
    const targetSpId = user.role === Role.SALESPERSON ? user.id : await salespersonScope(salespersonId, searchParams.get('officeId'));

    let reportData: any[] = [];
    let reportTitle = 'CRM Report';

    switch (reportType) {
      case 'pipeline': {
        reportTitle = 'Requirements Report';
        const enquiries = await prisma.enquiry.findMany({
          where: {
            ...(!allDates ? { createdAt: { gte: startDate, lte: endDate } } : {}),
            ...(targetSpId ? { assignedToId: targetSpId } : {}),
          },
          include: {
            client: { select: { name: true, industrySegment: true } },
            assignedTo: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        reportData = enquiries.map((e) => ({
          'Requirement No': e.enquiryNumber,
          'Client': e.client.name,
          'Industry': e.client.industrySegment,
          'Title': e.title,
          'Category': requirementTypeLabel(e),
          'Approx Value': Number(e.approxValue),
          // Quoted price once a quotation exists, otherwise the approximate value
          'Value': Number(e.estimatedValue),
          'Stage': e.stage,
          'Salesperson': e.assignedTo.name,
          'Created Date': formatDate(e.createdAt),
        }));
        break;
      }

      case 'activities': {
        reportTitle = 'Daily Sales Activities Report';
        const activities = await prisma.activity.findMany({
          where: {
            ...(!allDates ? { activityDate: { gte: startDate, lte: endDate } } : {}),
            ...(targetSpId ? { salespersonId: targetSpId } : {}),
          },
          include: {
            client: { select: { name: true } },
            salesperson: { select: { name: true } },
            enquiry: { select: { enquiryNumber: true } },
          },
          orderBy: { activityDate: 'desc' },
        });

        reportData = activities.map((a) => ({
          'Date': formatDate(a.activityDate),
          'Client': a.client.name,
          'Activity Type': a.activityType,
          'Discussion Type': a.discussionType,
          'Outcome': a.outcome,
          'Key Discussion Points': a.keyPoints,
          'Salesperson': a.salesperson.name,
          'Next Action': a.nextAction || '-',
          'Next Action Date': formatDate(a.nextActionDate),
        }));
        break;
      }

      case 'orders': {
        reportTitle = 'Confirmed Orders & Revenue Report';
        const orders = await prisma.order.findMany({
          where: {
            ...(!allDates ? { orderDate: { gte: startDate, lte: endDate } } : {}),
            ...(targetSpId ? { assignedSalespersonId: targetSpId } : {}),
          },
          include: {
            client: { select: { name: true, industrySegment: true } },
            assignedSalesperson: { select: { name: true } },
          },
          orderBy: { orderDate: 'desc' },
        });

        reportData = orders.map((o) => ({
          'Order No': o.orderNumber,
          'PO Ref': o.clientPoNumber || '-',
          'Client': o.client.name,
          'Industry': o.client.industrySegment,
          'Order Date': formatDate(o.orderDate),
          'Net Value': Number(o.netValue),
          'Tax (GST)': Number(o.taxValue),
          'Gross Value': Number(o.grossValue),
          'Status': o.orderStatus,
          'Salesperson': o.assignedSalesperson.name,
        }));
        break;
      }

      case 'receivables': {
        reportTitle = 'Receivables & Ageing Analysis';
        const invoices = await prisma.invoice.findMany({
          where: {
            paymentStatus: { not: InvoiceStatus.PAID },
            ...(targetSpId ? { order: { assignedSalespersonId: targetSpId } } : {}),
          },
          include: {
            client: { select: { name: true } },
            order: { select: { orderNumber: true, assignedSalesperson: { select: { name: true } } } },
            allocations: {
              where: { receipt: { verificationStatus: VerificationStatus.VERIFIED } },
              select: { allocatedAmount: true },
            },
          },
          orderBy: { dueDate: 'asc' },
        });

        reportData = invoices.map((inv) => {
          const paid = inv.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
          const balance = Number(inv.grossAmount) - paid;
          const overdueDays =
            new Date(inv.dueDate).getTime() < Date.now() ? Math.max(1, calculateOverdueDays(inv.dueDate)) : 0;
          let ageBucket = 'Current (Not Due)';
          if (overdueDays > 90) ageBucket = '> 90 Days';
          else if (overdueDays > 60) ageBucket = '61-90 Days';
          else if (overdueDays > 30) ageBucket = '31-60 Days';
          else if (overdueDays > 0) ageBucket = '1-30 Days';

          return {
            'Invoice No': inv.invoiceNumber,
            'Order No': inv.order.orderNumber,
            'Client': inv.client.name,
            'Invoice Date': formatDate(inv.invoiceDate),
            'Due Date': formatDate(inv.dueDate),
            'Gross Amount': Number(inv.grossAmount),
            'Verified Paid': paid,
            'Outstanding Balance': balance,
            'Overdue Days': overdueDays,
            'Ageing Bucket': ageBucket,
            'Salesperson': inv.order.assignedSalesperson.name,
          };
        });
        break;
      }

      case 'quotations': {
        reportTitle = 'Proposals & Quotations Status Report';
        const quotes = await prisma.quotation.findMany({
          where: {
            ...(!allDates ? { proposalDate: { gte: startDate, lte: endDate } } : {}),
            ...(targetSpId ? { salespersonId: targetSpId } : {}),
          },
          include: {
            client: { select: { name: true } },
            enquiry: { select: { title: true } },
            salesperson: { select: { name: true } },
          },
          orderBy: { proposalDate: 'desc' },
        });

        reportData = quotes.map((q) => ({
          'Quote No': formatQuotationNumber(q.quotationNumber, q.currentVersionNumber),
          'Client': q.client.name,
          'Subject': q.enquiry.title,
          'Date': formatDate(q.proposalDate),
          'Original Value': Number(q.originalValue),
          'Discount (%)': Number(q.discountPercent),
          'Final Value': Number(q.finalValue),
          'Status': q.approvalStatus,
          'Salesperson': q.salesperson.name,
        }));
        break;
      }

      case 'followups': {
        reportTitle = 'Follow-up Task Completion & Overdue Report';
        const tasks = await prisma.task.findMany({
          where: {
            ...(!allDates ? { dueDateTime: { gte: startDate, lte: endDate } } : {}),
            ...(targetSpId ? { assignedSalespersonId: targetSpId } : {}),
          },
          include: {
            client: { select: { name: true } },
            assignedSalesperson: { select: { name: true } },
          },
          orderBy: { dueDateTime: 'asc' },
        });

        reportData = tasks.map((t) => {
          const isOverdue = t.status === TaskStatus.PENDING && t.dueDateTime.getTime() < Date.now();
          return {
            'Task No': t.taskNumber,
            'Client': t.client.name,
            'Action Type': t.actionType,
            'Description': t.description,
            'Due Date & Time': formatDate(t.dueDateTime),
            'Status': isOverdue ? 'OVERDUE' : t.status,
            'Salesperson': t.assignedSalesperson.name,
            'Completion Outcome': t.completionOutcome || '-',
          };
        });
        break;
      }

      default:
        reportData = [];
    }

    // Handle Excel download
    reportData = reportData.filter((row) => matchesFilters(row, recordFilters));
    if (exportFormat === 'excel') {
      const worksheet = XLSX.utils.json_to_sheet(reportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
      const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${reportType}_report_${Date.now()}.xlsx"`,
        },
      });
    }

    return NextResponse.json({
      reportType,
      reportTitle,
      count: reportData.length,
      data: reportData,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
