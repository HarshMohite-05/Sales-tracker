import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { VerificationStatus, InvoiceStatus } from '@prisma/client';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const director = await requireDirector();
    const { id } = await params;

    const body = await readJson(request);
    const { decision, rejectionReason } = body; // 'VERIFY' | 'REJECT'

    if (!decision || (decision !== 'VERIFY' && decision !== 'REJECT')) {
      return NextResponse.json({ error: 'Valid decision (VERIFY or REJECT) is required' }, { status: 400 });
    }

    if (decision === 'REJECT' && (!rejectionReason || rejectionReason.trim().length === 0)) {
      return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id },
      include: {
        allocations: {
          include: { invoice: true },
        },
      },
    });

    if (!receipt) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }
    if (receipt.verificationStatus !== VerificationStatus.SUBMITTED) {
      return NextResponse.json({ error: 'This payment has already been verified or rejected' }, { status: 400 });
    }

    const isVerified = decision === 'VERIFY';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update receipt status
      const updated = await tx.receipt.update({
        where: { id },
        data: {
          verificationStatus: isVerified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED,
          rejectionReason: isVerified ? null : rejectionReason.trim(),
          verifiedById: director.id,
          verifiedAt: new Date(),
        },
      });

      // 2. If verified, update invoice payment statuses based on total verified receipts
      if (isVerified) {
        for (const alloc of receipt.allocations) {
          const invoiceId = alloc.invoiceId;
          const invoice = alloc.invoice;

          // Fetch all verified allocations for this invoice
          const allVerifiedAllocations = await tx.receiptAllocation.findMany({
            where: {
              invoiceId,
              receipt: { verificationStatus: VerificationStatus.VERIFIED },
            },
          });

          // Sum verified paid (including this newly verified allocation)
          const totalVerifiedPaid = allVerifiedAllocations.reduce(
            (sum, a) => sum + Number(a.allocatedAmount),
            0
          );

          let newStatus: InvoiceStatus = InvoiceStatus.PARTIALLY_PAID;
          if (totalVerifiedPaid >= Number(invoice.grossAmount)) {
            newStatus = InvoiceStatus.PAID;
          } else if (totalVerifiedPaid === 0) {
            newStatus = InvoiceStatus.UNPAID;
          }

          await tx.invoice.update({
            where: { id: invoiceId },
            data: { paymentStatus: newStatus },
          });
        }
      }

      // 3. Audit Event
      await tx.auditEvent.create({
        data: {
          entityType: 'RECEIPT',
          entityId: id,
          action: isVerified ? 'VERIFY' : 'REJECT',
          actorId: director.id,
          details: { receiptNumber: receipt.receiptNumber, amount: receipt.amount, isVerified },
        },
      });

      return updated;
    });

    return NextResponse.json({ success: true, receipt: result });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can verify or reject receipts' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
