import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { syncRequirementValue } from '@/lib/requirementValue';
import prisma from '@/lib/prisma';
import { assertQuotationAccess } from '@/lib/rbac';
import { QuotationStatus, ApprovalStatus, EnquiryStage } from '@prisma/client';
import { formatQuotationNumber } from '@/lib/quotation';
import { parseQuotationInput } from '@/lib/quotationInput';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertQuotationAccess(user, id);

    const body = await readJson(request);

    const input = parseQuotationInput(body);
    if ('error' in input) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }
    const { values, terms } = input;

    const quotation = await prisma.quotation.findUnique({ where: { id } });

    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    if (quotation.approvalStatus === QuotationStatus.ACCEPTED) {
      return NextResponse.json({ error: 'An order has been confirmed from this quotation, so it can no longer be revised' }, { status: 400 });
    }

    const nextVersionNumber = quotation.currentVersionNumber + 1;
    const revisionNumber = formatQuotationNumber(quotation.quotationNumber, nextVersionNumber);
    const proposalDate = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `quotation:${id}`);
      const current = await tx.quotation.findUnique({ where: { id } });
      if (!current || current.approvalStatus === QuotationStatus.ACCEPTED || current.currentVersionNumber !== quotation.currentVersionNumber) throw new ConflictError('This quotation changed. Refresh before revising it.');
      // 1. Mark previous versions as immutable
      await tx.quotationVersion.updateMany({
        where: { quotationId: id },
        data: { isImmutable: true },
      });

      // Requests for older versions are no longer relevant
      await tx.quotationApproval.updateMany({
        where: { quotationId: id, status: ApprovalStatus.PENDING },
        data: { status: ApprovalStatus.REJECTED, decisionNotes: `Superseded by ${revisionNumber}` },
      });

      // 2. Create new revision
      const newVersion = await tx.quotationVersion.create({
        data: {
          quotationId: id,
          versionNumber: nextVersionNumber,
          proposalDate,
          ...values,
          ...terms,
          isImmutable: false,
          createdById: user.id,
        },
      });

      // 3. Update main quotation summary; a revision goes back to draft until it is sent again
      const quote = await tx.quotation.update({
        where: { id },
        data: {
          currentVersionNumber: nextVersionNumber,
          approvalStatus: QuotationStatus.DRAFT,
          originalValue: values.originalValue,
          discountAmount: values.discountAmount,
          discountPercent: values.discountPercent,
          taxAmount: values.taxAmount,
          finalValue: values.finalValue,
          ...terms,
        },
      });

      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: { quotationNumber: revisionNumber, revision: nextVersionNumber, finalValue: values.finalValue },
        },
      });

      // A revised quotation means terms are being worked out, so the requirement moves to Negotiation
      const enquiry = await tx.enquiry.findUnique({ where: { id: quotation.enquiryId }, select: { stage: true } });
      const AUTO_NEGOTIATE_FROM: EnquiryStage[] = [EnquiryStage.NEW, EnquiryStage.QUALIFIED, EnquiryStage.PROPOSAL, EnquiryStage.ON_HOLD];
      if (enquiry && AUTO_NEGOTIATE_FROM.includes(enquiry.stage)) {
        await tx.enquiry.update({ where: { id: quotation.enquiryId }, data: { stage: EnquiryStage.NEGOTIATION } });
        await tx.enquiryStageHistory.create({
          data: {
            enquiryId: quotation.enquiryId,
            fromStage: enquiry.stage,
            toStage: EnquiryStage.NEGOTIATION,
            reason: `Quotation revised to ${revisionNumber}`,
            changedById: user.id,
          },
        });
      }

      await syncRequirementValue(tx, quotation.enquiryId);

      return { quote, newVersion };
    });

    return NextResponse.json({ success: true, ...updated });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
