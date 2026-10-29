import { readJson } from '@/lib/inputValidation';
import { validDateInput } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertClientRelations } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { Role, ActivityType, DiscussionType, TaskType, TaskPriority, TaskStatus, EnquiryStage } from '@prisma/client';
import { nextDocNumber, toTaskType } from '@/lib/numbering';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const enquiryId = searchParams.get('enquiryId');
    const salespersonId = searchParams.get('salespersonId');
    const type = searchParams.get('type') as ActivityType | null;

    const whereClause: any = {};
    if (user.role === Role.SALESPERSON) {
      whereClause.salespersonId = user.id;
    } else if (salespersonId) {
      whereClause.salespersonId = salespersonId;
    }

    if (clientId) whereClause.clientId = clientId;
    if (enquiryId) whereClause.enquiryId = enquiryId;
    if (type) whereClause.activityType = type;

    const activities = await prisma.activity.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true } },
        enquiry: { select: { id: true, enquiryNumber: true, title: true } },
        contact: { select: { id: true, name: true, mobile: true } },
        salesperson: { select: { id: true, name: true } },
      },
      orderBy: { activityDate: 'desc' },
      take: 100,
    });

    return NextResponse.json({ activities });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
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
      contactId,
      activityType,
      outcome,
      discussionType = DiscussionType.INTRODUCTORY,
      keyPoints,
      remarks,
      activityDate = new Date(),
      stageUpdate,
      nextAction,
      nextActionDate,
      assignedSalespersonId,
    } = body;

    if (!clientId || !activityType || !outcome || !keyPoints) {
      return NextResponse.json(
        { error: 'Client, activity type, outcome and discussion points are required' },
        { status: 400 }
      );
    }

    await assertClientRelations(user, { clientId, enquiryId, contactId });

    const salesperson =
      user.role === Role.DIRECTOR ? assignedSalespersonId || user.id : user.id;

    if (!String(outcome).trim() || !String(keyPoints).trim() || !validDateInput(activityDate) || (nextActionDate && !validDateInput(nextActionDate)) || (nextAction && !nextActionDate)) {
      return NextResponse.json({ error: 'Enter discussion details and valid dates' }, { status: 400 });
    }
    if (nextAction) {
      const assignee = await prisma.user.findUnique({ where: { id: salesperson } });
      if (!assignee?.isActive || assignee.role !== Role.SALESPERSON) return NextResponse.json({ error: 'Choose an active salesperson for the follow-up' }, { status: 400 });
    }
    if (stageUpdate) {
      if (!Object.values(EnquiryStage).includes(stageUpdate) || ['LOST', 'ON_HOLD'].includes(stageUpdate)) {
        return NextResponse.json({ error: 'Use the stage change form to record the reason and review date for Lost or On hold' }, { status: 400 });
      }
      if (stageUpdate === EnquiryStage.WON && (!enquiryId || !await prisma.order.count({ where: { enquiryId, orderStatus: 'CONFIRMED' } }))) {
        return NextResponse.json({ error: 'A requirement can only be marked as Won after an order is confirmed.' }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const activity = await tx.activity.create({
        data: {
          clientId,
          enquiryId: enquiryId || null,
          contactId: contactId || null,
          salespersonId: salesperson,
          activityType: activityType as ActivityType,
          outcome,
          discussionType: discussionType as DiscussionType,
          keyPoints,
          remarks: remarks || '',
          activityDate: new Date(activityDate),
          nextAction: nextAction || null,
          nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
        },
      });

      // Optional enquiry stage update
      if (enquiryId && stageUpdate) {
        const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
        if (enq && enq.stage !== stageUpdate) {
          await tx.enquiry.update({
            where: { id: enquiryId },
            data: { stage: stageUpdate as EnquiryStage },
          });

          await tx.enquiryStageHistory.create({
            data: {
              enquiryId,
              fromStage: enq.stage,
              toStage: stageUpdate as EnquiryStage,
              reason: `Stage changed during activity: ${outcome}`,
              changedById: user.id,
            },
          });
        }
      }

      // Schedule next action task if specified
      let task = null;
      if (nextAction && nextActionDate) {
        const taskNumber = await nextDocNumber(tx, 'task');

        task = await tx.task.create({
          data: {
            taskNumber,
            clientId,
            enquiryId: enquiryId || null,
            assignedSalespersonId: salesperson,
            createdById: user.id,
            actionType: toTaskType(activityType),
            description: nextAction,
            priority: TaskPriority.MEDIUM,
            dueDateTime: new Date(nextActionDate),
            status: TaskStatus.PENDING,
            reminderSettings: { remindMinutesBefore: [1440, 60] },
          },
        });
      }

      return { activity, task };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    return apiErrorResponse(error);
  }
}
