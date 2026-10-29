import { readJson } from '@/lib/inputValidation';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertClientAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { parseRequirementTypes } from '@/lib/requirementTypes';
import { Role, EnquiryCategory, EnquiryStage, ActivityType, DiscussionType, TaskType, TaskPriority, TaskStatus } from '@prisma/client';
import { nextDocNumber, nextRequirementNumber } from '@/lib/numbering';
import { checkClientCode } from '@/lib/clientCodeServer';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const industry = searchParams.get('industry') || '';
    const assignedToId = searchParams.get('assignedToId') || '';

    const whereClause: any = {};

    // Strict role check: Salespeople can ONLY see their assigned clients
    if (user.role === Role.SALESPERSON) {
      whereClause.assignedToId = user.id;
    } else if (assignedToId) {
      whereClause.assignedToId = assignedToId;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { contacts: { some: { name: { contains: search, mode: 'insensitive' } } } },
        { contacts: { some: { mobile: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    if (industry) {
      whereClause.industrySegment = industry;
    }

    const clients = await prisma.client.findMany({
      where: whereClause,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contacts: { where: { isPrimary: true } },
        enquiries: {
          where: user.role === Role.DIRECTOR ? {} : { assignedToId: user.id },
          select: {
            id: true,
            enquiryNumber: true,
            title: true,
            stage: true,
            estimatedValue: true,
            category: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        // Next open follow-up, so the list can show who needs a call
        tasks: {
          where: { status: 'PENDING', ...(user.role === Role.SALESPERSON ? { assignedSalespersonId: user.id } : {}) },
          orderBy: { dueDateTime: 'asc' },
          take: 1,
          select: { id: true, description: true, dueDateTime: true, actionType: true },
        },
        _count: {
          select: {
            enquiries: { where: user.role === Role.DIRECTOR ? {} : { assignedToId: user.id } },
            activities: { where: user.role === Role.DIRECTOR ? {} : { salespersonId: user.id } },
            tasks: { where: user.role === Role.DIRECTOR ? {} : { assignedSalespersonId: user.id } },
            orders: { where: user.role === Role.DIRECTOR ? {} : { assignedSalespersonId: user.id } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ clients });
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
      // Duplicate check mode
      checkDuplicatesOnly,

      // Section A: Client Details
      clientName,
      industrySegment,
      contactPerson,
      location,
      mobileNumber,
      emailAddress,

      // Section B: Requirement and Discussion
      clientRequirement,
      stageOfLead = EnquiryStage.NEW,
      typeOfActivity,
      callOutcome,
      meetingType = DiscussionType.INTRODUCTORY,
      keyDiscussionPoints,
      remarks,

      // Section C: Next Follow-up
      nextAction,
      nextActionDate,

      // Auto-filled / selected
      assignedSalespersonId,
      entryDate = new Date(),

      // Collapsed details
      clientType = 'End User',
      contactDesignation,
      leadSource,
      referredBy,
      whatsappNumber,
      siteAddress,
      state,
      gstin,

      // First requirement's type, value and details
      requirementCategories,
      requirementCategory,
      requirementCategoryOther,
      requirementValue,
      requirementDetails,

      // Existing client selection mode
      existingClientId,
      saveMode = 'WITH_FOLLOWUP', // 'WITH_FOLLOWUP' or 'CLIENT_ONLY'

      // Short code for requirement numbers (new clients only), e.g. NGPL
      clientCode,
    } = body;

    if ((!clientName || typeof clientName !== 'string' || !clientName.trim()) && !existingClientId) {
      return NextResponse.json({ error: 'Client / Company Name is required' }, { status: 400 });
    }

    if (existingClientId) await assertClientAccess(user, existingClientId);

    // 1. Duplicate detection check
    const possibleDuplicates = await prisma.client.findMany({
      where: {
        ...(user.role === Role.SALESPERSON ? { assignedToId: user.id } : {}),
        OR: [
          { name: { contains: clientName?.trim(), mode: 'insensitive' } },
          mobileNumber
            ? { contacts: { some: { mobile: { contains: mobileNumber.trim() } } } }
            : { id: 'no-match' },
        ],
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        contacts: true,
      },
      take: 5,
    });

    if (checkDuplicatesOnly) {
      return NextResponse.json({
        hasDuplicates: possibleDuplicates.length > 0,
        duplicates: possibleDuplicates,
      });
    }

    // The first requirement is optional: a client can be saved before they have one
    const hasRequirement = !!clientRequirement?.trim();
    const requirementType = hasRequirement
      ? parseRequirementTypes(requirementCategories ?? requirementCategory ?? ['PLANT'], requirementCategoryOther)
      : null;
    if (requirementType && 'error' in requirementType) {
      return NextResponse.json({ error: requirementType.error }, { status: 400 });
    }

    // Determine responsible salesperson
    // Rule: Salesperson defaults to logged-in user; if Director, must select assigned salesperson
    const targetSalespersonId =
      user.role === Role.DIRECTOR
        ? assignedSalespersonId || user.id
        : user.id;

    // New clients need a unique code before anything is saved
    let code: string | null = null;
    if (!existingClientId) {
      const codeCheck = await checkClientCode(prisma, clientCode || '', undefined, user.role === Role.DIRECTOR);
      if (codeCheck.error) {
        return NextResponse.json(
          { error: codeCheck.error, suggestion: codeCheck.suggestion },
          { status: codeCheck.usedBy ? 409 : 400 }
        );
      }
      code = codeCheck.code;
    }

    if (hasRequirement && ![EnquiryStage.NEW, EnquiryStage.PROPOSAL, EnquiryStage.NEGOTIATION].includes(stageOfLead)) {
      return NextResponse.json({ error: 'New requirements must start in an open stage' }, { status: 400 });
    }
    const value = moneyInput(requirementValue === undefined || requirementValue === '' ? 0 : requirementValue, 'Requirement value');
    if ((nextAction && !nextActionDate) || (nextActionDate && !validDateInput(nextActionDate)) || !validDateInput(entryDate)) {
      return NextResponse.json({ error: 'Enter valid dates and a due date for the follow-up' }, { status: 400 });
    }
    const assignee = await prisma.user.findUnique({ where: { id: targetSalespersonId } });
    if (!assignee?.isActive || assignee.role !== Role.SALESPERSON) {
      return NextResponse.json({ error: 'Choose an active salesperson for this client and follow-up' }, { status: 400 });
    }

    // Transactional creation
    const result = await prisma.$transaction(async (tx) => {
      let client;

      if (existingClientId) {
        client = await tx.client.findUnique({
          where: { id: existingClientId },
          include: { contacts: true, sites: true },
        });
        if (!client) throw new Error('Selected existing client not found');
      } else {
        // Create new Client
        client = await tx.client.create({
          data: {
            name: clientName.trim(),
            code,
            industrySegment: industrySegment || 'Other',
            clientType,
            gstNumber: gstin,
            city: location,
            address: siteAddress,
            state,
            assignedToId: targetSalespersonId,
            createdById: user.id,
            contacts: {
              create: [
                {
                  name: contactPerson || 'Primary Contact',
                  designation: contactDesignation,
                  mobile: mobileNumber || 'N/A',
                  email: emailAddress,
                  whatsappNumber: whatsappNumber || mobileNumber,
                  isPrimary: true,
                },
              ],
            },
            sites: {
              create: [
                {
                  siteName: `${clientName} Main Site`,
                  address: siteAddress || location || 'Site Address',
                  city: location || 'City',
                  state: state || 'State',
                  contactPerson: contactPerson || 'Primary Contact',
                  mobile: mobileNumber || '',
                  isPrimary: true,
                },
              ],
            },
          },
          include: { contacts: true, sites: true },
        });

        // Audit Event
        await tx.auditEvent.create({
          data: {
            entityType: 'CLIENT',
            entityId: client.id,
            action: 'CREATE',
            actorId: user.id,
            details: { name: client.name, industry: client.industrySegment },
          },
        });
      }

      let enquiry = null;
      let activity = null;
      let task = null;

      // Section B: Requirement / Enquiry creation
      if (hasRequirement && requirementType && !('error' in requirementType)) {
        // Generate enquiry number
        const enqNumber = await nextRequirementNumber(tx, client.id);

        enquiry = await tx.enquiry.create({
          data: {
            enquiryNumber: enqNumber,
            clientId: client.id,
            contactId: client.contacts[0]?.id,
            siteId: client.sites[0]?.id,
            assignedToId: targetSalespersonId,
            title: clientRequirement.trim(),
            category: requirementType.category as EnquiryCategory,
            categories: requirementType.categories as EnquiryCategory[],
            categoryOther: requirementType.categoryOther,
            estimatedValue: value,
            approxValue: value,
            requirementSummary: requirementDetails?.trim() || clientRequirement.trim(),
            stage: stageOfLead as EnquiryStage,
            source: leadSource || 'Direct Inbound',
            createdById: user.id,
          },
        });

        await tx.enquiryStageHistory.create({
          data: {
            enquiryId: enquiry.id,
            fromStage: EnquiryStage.NEW,
            toStage: stageOfLead as EnquiryStage,
            reason: 'Requirement created',
            changedById: user.id,
          },
        });
      }

      // Record Activity if interaction occurred
      if (
        saveMode === 'WITH_FOLLOWUP' &&
        (typeOfActivity || callOutcome || keyDiscussionPoints)
      ) {
        activity = await tx.activity.create({
          data: {
            clientId: client.id,
            enquiryId: enquiry?.id,
            contactId: client.contacts[0]?.id,
            salespersonId: targetSalespersonId,
            activityType: (typeOfActivity as ActivityType) || ActivityType.CALL,
            outcome: callOutcome || 'Discussion recorded',
            discussionType: (meetingType as DiscussionType) || DiscussionType.INTRODUCTORY,
            keyPoints: keyDiscussionPoints || 'Discussion points noted',
            remarks: remarks || '',
            activityDate: entryDate ? new Date(entryDate) : new Date(),
            nextAction: nextAction || null,
            nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
          },
        });
      }

      // Section C: Next Follow-up Task creation
      // Rule: Customer follow-ups are performed by salespeople only
      if (saveMode === 'WITH_FOLLOWUP' && nextAction && nextActionDate) {
        const taskNum = await nextDocNumber(tx, 'task');

        task = await tx.task.create({
          data: {
            taskNumber: taskNum,
            clientId: client.id,
            enquiryId: enquiry?.id,
            assignedSalespersonId: targetSalespersonId,
            createdById: user.id,
            actionType: TaskType.CALL,
            description: nextAction.trim(),
            priority: TaskPriority.MEDIUM,
            dueDateTime: new Date(nextActionDate),
            status: TaskStatus.PENDING,
            reminderSettings: { remindMinutesBefore: [1440, 60] },
          },
        });
      }

      return { client, enquiry, activity, task };
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Client and linked workflow records saved successfully',
    });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    // Two people saving the same code at the same moment: the unique index rejects the second
    if (error.code === 'P2002' && error.meta?.target?.includes('code')) {
      return NextResponse.json({ error: 'That client code was just taken. Please pick another.' }, { status: 409 });
    }
    console.error('Error creating client:', error);
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
