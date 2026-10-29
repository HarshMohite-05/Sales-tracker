import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { syncRequirementValue } from '@/lib/requirementValue';
import prisma from '@/lib/prisma';
import { assertQuotationAccess } from '@/lib/rbac';
import { QuotationStatus } from '@prisma/client';
import { moveQuotationToBin } from '@/lib/recycleBin';

// Delete a whole quotation with all its revisions; it goes to the recycle bin
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertQuotationAccess(user, id);

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!quotation) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    if (quotation.approvalStatus === QuotationStatus.ACCEPTED || quotation._count.orders > 0) {
      return NextResponse.json(
        { error: 'An order has been confirmed from this quotation, so it cannot be deleted.' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `quotation:${id}`);
      const current = await tx.quotation.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
      if (!current || current.approvalStatus === QuotationStatus.ACCEPTED || current._count.orders > 0) throw new ConflictError('This quotation changed or has a confirmed order. Refresh before deleting it.');
      const binItem = await moveQuotationToBin(tx, user, id);
      // Without a quotation the requirement goes back to its approximate value
      await syncRequirementValue(tx, quotation.enquiryId);
      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION',
          entityId: id,
          action: 'DELETE',
          actorId: user.id,
          details: { quotationNumber: binItem.label, recycleBinItemId: binItem.id },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
