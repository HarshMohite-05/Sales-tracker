import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertEnquiryAccess } from '@/lib/rbac';
import { moveEnquiryToBin } from '@/lib/recycleBin';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertEnquiryAccess(user, id);

    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: { _count: { select: { quotations: true, orders: true } } },
    });
    if (!enquiry) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // Quotations cascade-delete with the enquiry, so never delete commercial records here
    if (enquiry._count.quotations > 0 || enquiry._count.orders > 0) {
      return NextResponse.json(
        { error: 'This requirement has quotations or orders, so it cannot be deleted. Mark it as Lost instead.' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Goes to the recycle bin along with its pending follow-ups; done ones and conversations stay as client history
      const binItem = await moveEnquiryToBin(tx, user, id);

      await tx.auditEvent.create({
        data: {
          entityType: 'ENQUIRY',
          entityId: id,
          action: 'DELETE',
          actorId: user.id,
          details: {
            enquiryNumber: enquiry.enquiryNumber,
            title: enquiry.title,
            clientId: enquiry.clientId,
            recycleBinItemId: binItem.id,
          },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
