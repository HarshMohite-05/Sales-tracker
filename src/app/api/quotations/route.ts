import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { syncRequirementValue } from '@/lib/requirementValue';
import prisma from '@/lib/prisma';
import { assertClientRelations } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { Role, QuotationStatus, EnquiryStage } from '@prisma/client';
import { formatQuotationNumber, quotationPrefix } from '@/lib/quotation';
import { parseQuotationInput } from '@/lib/quotationInput';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as QuotationStatus | null;
    const clientId = searchParams.get('clientId');
    const salespersonId = searchParams.get('salespersonId');

    const whereClause: any = {};
    if (user.role === Role.SALESPERSON) {
      whereClause.salespersonId = user.id;
    } else if (salespersonId) {
      whereClause.salespersonId = salespersonId;
    }

    if (status) whereClause.approvalStatus = status;
    if (clientId) whereClause.clientId = clientId;

    const quotations = await prisma.quotation.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true, gstNumber: true } },
        enquiry: { select: { id: true, enquiryNumber: true, title: true, stage: true } },
        salesperson: { select: { id: true, name: true, email: true, mobile: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        approvals: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            decidedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ quotations });
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

    const { clientId, enquiryId, quotationNo, validityDays = 30 } = body;

    if (!clientId || !enquiryId) {
      return NextResponse.json({ error: 'Client and requirement are required' }, { status: 400 });
    }
    const no = String(quotationNo ?? '').trim();
    if (!/^\d{1,6}$/.test(no)) {
      return NextResponse.json({ error: 'Quotation number must be digits only, e.g. 045' }, { status: 400 });
    }
    await assertClientRelations(user, { clientId, enquiryId });

    const input = parseQuotationInput(body);
    if ('error' in input) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }
    const { values, terms } = input;

    // Verify client & enquiry
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { client: true, quotations: { select: { quotationNumber: true, currentVersionNumber: true }, take: 1 } },
    });

    if (!enquiry) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }
    if (enquiry.clientId !== clientId) {
      return NextResponse.json({ error: 'Requirement does not belong to this client' }, { status: 400 });
    }
    // Each requirement has one quotation; price changes go in as revisions of it
    if (enquiry.quotations.length > 0) {
      const existing = enquiry.quotations[0];
      return NextResponse.json(
        {
          error: `This requirement already has quotation ${formatQuotationNumber(existing.quotationNumber, existing.currentVersionNumber)}. Revise that quotation instead.`,
        },
        { status: 409 }
      );
    }

    const proposalDate = new Date();
    const quotationNumber = `${quotationPrefix(proposalDate)}${no}`;
    if (await prisma.quotation.findUnique({ where: { quotationNumber } })) {
      return NextResponse.json({ error: `Quotation number ${quotationNumber} is already used` }, { status: 409 });
    }


    const quotation = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `requirement-quote:${enquiryId}`);
      if (await tx.quotation.count({ where: { enquiryId } })) throw new ConflictError('This requirement already has a quotation. Revise it instead.');
      const quote = await tx.quotation.create({
        data: {
          quotationNumber,
          clientId,
          enquiryId,
          salespersonId: user.role === Role.SALESPERSON ? user.id : enquiry.assignedToId,
          currentVersionNumber: 0,
          approvalStatus: QuotationStatus.DRAFT,
          proposalDate,
          validityDays: parseInt(validityDays.toString(), 10) || 30,
          originalValue: values.originalValue,
          discountAmount: values.discountAmount,
          discountPercent: values.discountPercent,
          taxAmount: values.taxAmount,
          finalValue: values.finalValue,
          ...terms,
          versions: {
            create: [
              {
                versionNumber: 0,
                proposalDate,
                ...values,
                ...terms,
                isImmutable: false,
                createdById: user.id,
              },
            ],
          },
        },
        include: { versions: true },
      });

      // A quotation on a fresh requirement moves it to the Quotation stage
      if (enquiry.stage === EnquiryStage.NEW) {
        await tx.enquiry.update({ where: { id: enquiryId }, data: { stage: EnquiryStage.PROPOSAL } });
        await tx.enquiryStageHistory.create({
          data: {
            enquiryId,
            fromStage: EnquiryStage.NEW,
            toStage: EnquiryStage.PROPOSAL,
            reason: `Quotation ${quotationNumber} prepared`,
            changedById: user.id,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION',
          entityId: quote.id,
          action: 'CREATE',
          actorId: user.id,
          details: { quotationNumber, finalValue: values.finalValue },
        },
      });

      // The requirement's value is now the quoted price
      await syncRequirementValue(tx, enquiryId);

      return quote;
    });

    return NextResponse.json({ success: true, quotation });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    console.error('Error creating quotation:', error);
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
