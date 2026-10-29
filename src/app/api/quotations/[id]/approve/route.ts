import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { QuotationStatus, ApprovalStatus } from '@prisma/client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const director = await requireDirector();
    const { id } = await params;

    const body = await readJson(request);
    const { decision, decisionNotes, rejectionReason } = body; // decision: 'APPROVE' | 'REJECT'

    if (!decision || (decision !== 'APPROVE' && decision !== 'REJECT')) {
      return NextResponse.json({ error: 'Valid decision (APPROVE or REJECT) is required' }, { status: 400 });
    }

    if (decision === 'REJECT' && (!rejectionReason || rejectionReason.trim().length === 0)) {
      return NextResponse.json({ error: 'A specific reason is required when rejecting a quotation approval' }, { status: 400 });
    }

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: {
        approvals: { where: { status: ApprovalStatus.PENDING }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    if (quotation.approvalStatus !== QuotationStatus.PENDING_APPROVAL) {
      return NextResponse.json({ error: 'This quotation is not waiting for approval' }, { status: 400 });
    }

    const isApproved = decision === 'APPROVE';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update quotation status
      const updatedQuote = await tx.quotation.update({
        where: { id },
        data: {
          approvalStatus: isApproved ? QuotationStatus.APPROVED : QuotationStatus.REJECTED,
          remarks: isApproved
            ? `Approved by Director ${director.name}. ${decisionNotes || ''}`
            : `Rejected by Director ${director.name}. Reason: ${rejectionReason}`,
        },
      });

      // 2. Update pending approval record
      if (quotation.approvals.length > 0) {
        await tx.quotationApproval.update({
          where: { id: quotation.approvals[0].id },
          data: {
            status: isApproved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
            decisionNotes: isApproved ? decisionNotes : rejectionReason,
            decidedById: director.id,
            decidedAt: new Date(),
          },
        });
      }

      // 3. Audit Event
      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION',
          entityId: id,
          action: isApproved ? 'APPROVE' : 'REJECT',
          actorId: director.id,
          details: { quotationNumber: quotation.quotationNumber, isApproved, notes: decisionNotes || rejectionReason },
        },
      });

      return updatedQuote;
    });

    return NextResponse.json({ success: true, quotation: result });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can approve or reject quotations' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
