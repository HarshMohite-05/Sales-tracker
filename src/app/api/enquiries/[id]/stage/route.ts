import { readJson } from '@/lib/inputValidation';
import { validDateInput } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertEnquiryAccess } from '@/lib/rbac';
import { EnquiryStage } from '@prisma/client';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertEnquiryAccess(user, id);

    const body = await readJson(request);
    const { newStage, reason, holdReviewDate, exceptionReason } = body;

    if (!Object.values(EnquiryStage).includes(newStage)) {
      return NextResponse.json({ error: 'Target stage is required' }, { status: 400 });
    }

    // Validation rules
    if (newStage === EnquiryStage.LOST && (!reason || reason.trim().length === 0)) {
      return NextResponse.json({ error: 'Please give a reason why it was lost' }, { status: 400 });
    }

    if (newStage === EnquiryStage.ON_HOLD) {
      if (!reason || reason.trim().length === 0) {
        return NextResponse.json({ error: 'Please give a reason for putting it on hold' }, { status: 400 });
      }
      if (!validDateInput(holdReviewDate)) {
        return NextResponse.json({ error: 'Please pick a date to check back' }, { status: 400 });
      }
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: { orders: true },
    });

    if (!enquiry) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // Rule: Won requires a confirmed order
    if (newStage === EnquiryStage.WON) {
      const hasConfirmedOrder = enquiry.orders.some((o) => o.orderStatus === 'CONFIRMED');
      if (!hasConfirmedOrder) {
        return NextResponse.json(
          { error: 'A requirement can only be marked as Won after an order is confirmed.' },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedEnq = await tx.enquiry.update({
        where: { id },
        data: {
          stage: newStage as EnquiryStage,
          lostReason: newStage === EnquiryStage.LOST ? reason : enquiry.lostReason,
          holdReason: newStage === EnquiryStage.ON_HOLD ? reason : enquiry.holdReason,
          holdReviewDate: newStage === EnquiryStage.ON_HOLD ? new Date(holdReviewDate) : enquiry.holdReviewDate,
          exceptionReason: exceptionReason ?? enquiry.exceptionReason,
          isException: exceptionReason ? true : enquiry.isException,
        },
      });

      // Record stage history
      await tx.enquiryStageHistory.create({
        data: {
          enquiryId: id,
          fromStage: enquiry.stage,
          toStage: newStage as EnquiryStage,
          reason: reason || 'Stage updated',
          changedById: user.id,
        },
      });

      // Audit event
      await tx.auditEvent.create({
        data: {
          entityType: 'ENQUIRY',
          entityId: id,
          action: 'STAGE_CHANGE',
          actorId: user.id,
          details: { from: enquiry.stage, to: newStage, reason },
        },
      });

      return updatedEnq;
    });

    return NextResponse.json({ success: true, enquiry: updated });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
