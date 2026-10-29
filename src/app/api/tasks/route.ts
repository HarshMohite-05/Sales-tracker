import { readJson } from '@/lib/inputValidation';
import { validDateInput } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Role, TaskStatus, TaskType, TaskPriority } from '@prisma/client';
import { nextDocNumber, toTaskType } from '@/lib/numbering';
import { assertClientAccess, assertEnquiryAccess } from '@/lib/rbac';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'all'; // 'today', 'overdue', 'upcoming', 'completed', 'all'
    const salespersonId = searchParams.get('salespersonId');
    const clientId = searchParams.get('clientId');

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const whereClause: any = {};

    if (user.role === Role.SALESPERSON) {
      whereClause.assignedSalespersonId = user.id;
    } else if (salespersonId) {
      whereClause.assignedSalespersonId = salespersonId;
    }

    if (clientId) whereClause.clientId = clientId;

    if (view === 'today') {
      whereClause.status = TaskStatus.PENDING;
      whereClause.dueDateTime = { gte: startOfToday, lte: endOfToday };
    } else if (view === 'overdue') {
      whereClause.status = TaskStatus.PENDING;
      whereClause.dueDateTime = { lt: now };
    } else if (view === 'upcoming') {
      whereClause.status = TaskStatus.PENDING;
      whereClause.dueDateTime = { gt: endOfToday };
    } else if (view === 'completed') {
      whereClause.status = TaskStatus.COMPLETED;
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true, industrySegment: true } },
        enquiry: { select: { id: true, enquiryNumber: true, title: true, stage: true } },
        assignedSalesperson: { select: { id: true, name: true, email: true } },
        rescheduleHistory: {
          include: { rescheduledBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { dueDateTime: 'asc' },
    });

    // Also get enquiries missing a next action if requested or for summary cards
    const openEnquiriesMissingNextAction = await prisma.enquiry.findMany({
      where: {
        stage: { notIn: ['WON', 'LOST'] },
        isException: false,
        ...(user.role === Role.SALESPERSON ? { assignedToId: user.id } : {}),
        tasks: {
          none: {
            status: TaskStatus.PENDING,
          },
        },
      },
      include: {
        client: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      tasks,
      missingActionCount: openEnquiriesMissingNextAction.length,
      missingActionEnquiries: openEnquiriesMissingNextAction,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await readJson(request);

    const {
      clientId,
      enquiryId,
      assignedSalespersonId,
      actionType,
      description,
      priority = TaskPriority.MEDIUM,
      dueDateTime,
      reminderSettings,
    } = body;

    if (!clientId || typeof description !== 'string' || !description.trim() || !dueDateTime) {
      return NextResponse.json(
        { error: 'Client, description and due date/time are required' },
        { status: 400 }
      );
    }

    if (!validDateInput(dueDateTime)) {
      return NextResponse.json({ error: 'Pick a valid date and time' }, { status: 400 });
    }

    // Salespeople may only add follow-ups to their own clients / requirements
    if (enquiryId) {
      await assertEnquiryAccess(user, enquiryId);
      const enquiry = await prisma.enquiry.findUnique({ where: { id: enquiryId }, select: { clientId: true } });
      if (!enquiry || enquiry.clientId !== clientId) {
        return NextResponse.json({ error: 'Requirement does not belong to this client' }, { status: 400 });
      }
    } else {
      await assertClientAccess(user, clientId);
    }

    // Follow-up ownership rule: Customer follow-ups are performed by salespeople only
    let assignedId = user.id;
    if (user.role === Role.DIRECTOR) {
      if (!assignedSalespersonId) {
        return NextResponse.json(
          { error: 'Director must assign customer follow-up to a salesperson' },
          { status: 400 }
        );
      }
      assignedId = assignedSalespersonId;
    }

    // Verify assigned user is indeed a salesperson
    const targetUser = await prisma.user.findUnique({ where: { id: assignedId } });
    if (!targetUser || !targetUser.isActive || targetUser.role !== Role.SALESPERSON) {
      return NextResponse.json(
        { error: 'Client-facing follow-ups must be assigned to a salesperson' },
        { status: 400 }
      );
    }

    const task = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, 'number:task');
      const taskNumber = await nextDocNumber(tx, 'task');
      return tx.task.create({
      data: {
        taskNumber,
        clientId,
        enquiryId: enquiryId || null,
        assignedSalespersonId: assignedId,
        createdById: user.id,
        actionType: toTaskType(actionType),
        description: description.trim(),
        priority: priority as TaskPriority,
        dueDateTime: new Date(dueDateTime),
        status: TaskStatus.PENDING,
        reminderSettings: reminderSettings || { remindMinutesBefore: [1440, 60] },
      },
      include: {
        client: { select: { id: true, name: true } },
        assignedSalesperson: { select: { id: true, name: true } },
      },
    });

    });
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
