import { readJson } from '@/lib/inputValidation';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertClientRelations } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { parseRequirementTypes } from '@/lib/requirementTypes';
import { Role, EnquiryCategory, EnquiryStage, ActivityType, TaskType, TaskPriority, TaskStatus } from '@prisma/client';
import { nextDocNumber, nextRequirementNumber, toTaskType } from '@/lib/numbering';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage') as EnquiryStage | null;
    const category = searchParams.get('category') as EnquiryCategory | null;
    const assignedToId = searchParams.get('assignedToId') || '';
    const clientId = searchParams.get('clientId') || '';

    const whereClause: any = {};

    if (user.role === Role.SALESPERSON) {
      whereClause.assignedToId = user.id;
    } else if (assignedToId) {
      whereClause.assignedToId = assignedToId;
    }

    if (stage) whereClause.stage = stage;
    // Matches any requirement that includes this type
    if (category) whereClause.categories = { has: category };
    if (clientId) whereClause.clientId = clientId;

    const enquiries = await prisma.enquiry.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true, industrySegment: true } },
        contact: { select: { id: true, name: true, mobile: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        tasks: {
          where: { status: 'PENDING', ...(user.role === Role.SALESPERSON ? { assignedSalespersonId: user.id } : {}) },
          orderBy: { dueDateTime: 'asc' },
          take: 1,
        },
        quotations: {
          where: user.role === Role.DIRECTOR ? {} : { salespersonId: user.id },
          select: {
            id: true,
            quotationNumber: true,
            currentVersionNumber: true,
            approvalStatus: true,
            finalValue: true,
          },
        },
        // Lost requirements: when and by whom (shown on the Orders page)
        ...(stage === EnquiryStage.LOST
          ? {
              stageHistory: {
                where: { toStage: EnquiryStage.LOST },
                orderBy: { createdAt: 'desc' as const },
                take: 1,
                include: { changedBy: { select: { id: true, name: true } } },
              },
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ enquiries });
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
      contactId,
      siteId,
      title,
      categories: rawCategories,
      category: rawCategory,
      categoryOther: rawCategoryOther,
      requirementSummary,
      techSpecs,
      capacity,
      capacityUnit,
      estimatedValue = 0,
      recurringAmount = 0,
      recurringFrequency,
      source,
      expectedCloseDate,
      competitor,
      assignedSalespersonId,
      // Optional: starting stage, the conversation that raised it, and the next follow-up
      stage: initialStage,
      activityType,
      discussionNotes,
      nextAction,
      nextActionDate,
    } = body;

    // New requirements can only start in an open, early stage
    const OPENING_STAGES: string[] = [EnquiryStage.NEW, EnquiryStage.PROPOSAL, EnquiryStage.NEGOTIATION];
    const stage = (OPENING_STAGES.includes(initialStage) ? initialStage : EnquiryStage.NEW) as EnquiryStage;

    if (nextAction?.trim() && !nextActionDate) {
      return NextResponse.json({ error: 'Pick a date and time for the next follow-up' }, { status: 400 });
    }

    if (!clientId || !title?.trim()) {
      return NextResponse.json({ error: 'Client and what they need are required' }, { status: 400 });
    }
    const type = parseRequirementTypes(rawCategories ?? rawCategory, rawCategoryOther);
    if ('error' in type) {
      return NextResponse.json({ error: type.error }, { status: 400 });
    }

    await assertClientRelations(user, { clientId, contactId, siteId });

    // Role check: Salesperson can only create for their assigned client, or director can assign
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (user.role === Role.SALESPERSON && client.assignedToId !== user.id) {
      return NextResponse.json({ error: 'You can only add requirements to your own clients' }, { status: 403 });
    }

    const assignedTo = user.role === Role.DIRECTOR ? assignedSalespersonId || client.assignedToId : user.id;

    const value = moneyInput(estimatedValue, 'Requirement value');
    const recurring = moneyInput(recurringAmount, 'Recurring amount');
    if ((expectedCloseDate && !validDateInput(expectedCloseDate)) || (nextActionDate && !validDateInput(nextActionDate))) {
      return NextResponse.json({ error: 'Enter a valid date' }, { status: 400 });
    }
    const assignee = await prisma.user.findUnique({ where: { id: assignedTo } });
    if (!assignee?.isActive || assignee.role !== Role.SALESPERSON) {
      return NextResponse.json({ error: 'Choose an active salesperson' }, { status: 400 });
    }

    const enquiry = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `requirements:${clientId}`);
      const enquiryNumber = await nextRequirementNumber(tx, clientId);
      const enq = await tx.enquiry.create({
        data: {
          enquiryNumber,
          clientId,
          contactId: contactId || null,
          siteId: siteId || null,
          assignedToId: assignedTo,
          title: title.trim(),
          category: type.category as EnquiryCategory,
          categories: type.categories as EnquiryCategory[],
          categoryOther: type.categoryOther,
          requirementSummary: requirementSummary?.trim() || title.trim(),
          techSpecs,
          capacity,
          capacityUnit,
          estimatedValue: value,
          approxValue: value,
          recurringAmount: recurring || null,
          recurringFrequency,
          source,
          stage,
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
          competitor,
          createdById: user.id,
        },
      });

      await tx.enquiryStageHistory.create({
        data: {
          enquiryId: enq.id,
          fromStage: EnquiryStage.NEW,
          toStage: stage,
          reason: 'Requirement created',
          changedById: user.id,
        },
      });

      await tx.auditEvent.create({
        data: {
          entityType: 'ENQUIRY',
          entityId: enq.id,
          action: 'CREATE',
          actorId: user.id,
          details: { enquiryNumber, title, estimatedValue },
        },
      });

      // Conversation that raised this requirement, linked to it
      if (activityType && discussionNotes?.trim()) {
        await tx.activity.create({
          data: {
            clientId,
            enquiryId: enq.id,
            contactId: contactId || null,
            salespersonId: assignedTo,
            activityType: activityType as ActivityType,
            outcome: `New requirement: ${title.trim()}`,
            keyPoints: discussionNotes.trim(),
            nextAction: nextAction?.trim() || null,
            nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
          },
        });
      }

      // Next follow-up, owned by the requirement's salesperson
      if (nextAction?.trim() && nextActionDate) {
        await tx.task.create({
          data: {
            taskNumber: await nextDocNumber(tx, 'task'),
            clientId,
            enquiryId: enq.id,
            assignedSalespersonId: assignedTo,
            createdById: user.id,
            actionType: toTaskType(activityType),
            description: nextAction.trim(),
            priority: TaskPriority.MEDIUM,
            dueDateTime: new Date(nextActionDate),
            status: TaskStatus.PENDING,
            reminderSettings: { remindMinutesBefore: [1440, 60] },
          },
        });
      }

      return enq;
    });

    return NextResponse.json({ success: true, enquiry });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    return apiErrorResponse(error);
  }
}
