import { readJson } from '@/lib/inputValidation';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ValidationError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertClientAccess, assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { Role, VerificationStatus, PaymentMode } from '@prisma/client';
import { nextDocNumber } from '@/lib/numbering';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const verificationStatus = searchParams.get('status') as VerificationStatus | null;
    const recordedById = searchParams.get('recordedById');

    const whereClause: any = {};
    if (user.role === Role.SALESPERSON) {
      whereClause.client = { assignedToId: user.id };
      whereClause.OR = [{ recordedById: user.id }, { allocations: { some: { invoice: { order: { assignedSalespersonId: user.id } } } } }];
    } else if (recordedById) {
      whereClause.recordedById = recordedById;
    }

    if (clientId) whereClause.clientId = clientId;
    if (verificationStatus) whereClause.verificationStatus = verificationStatus;

    const receipts = await prisma.receipt.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true } },
        recordedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
        allocations: {
          where: user.role === Role.DIRECTOR ? {} : { invoice: { order: { assignedSalespersonId: user.id } } },
          include: {
            invoice: { select: { id: true, invoiceNumber: true, grossAmount: true } },
          },
        },
      },
      orderBy: { receiptDate: 'desc' },
    });

    return NextResponse.json({ receipts });
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
      amount,
      paymentMode,
      transactionRef,
      receiptDate = new Date(),
      allocations = [], // Array<{ invoiceId: string, allocatedAmount: number }>
      proofDocument,
    } = body;

    if (!clientId || !amount || !paymentMode) {
      return NextResponse.json(
        { error: 'Client, amount and payment mode are required' },
        { status: 400 }
      );
    }

    await assertClientAccess(user, clientId);

    const receiptAmount = moneyInput(amount, 'Receipt amount', false);
    if (!validDateInput(receiptDate)) throw new ValidationError('Enter a valid receipt date');
    if (!Array.isArray(allocations)) throw new ValidationError('Allocations must be a list');
    const invoiceIds = allocations.map((a: any) => a?.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) throw new ValidationError('Allocate to each invoice only once');
    for (const alloc of allocations) moneyInput(alloc.allocatedAmount, 'Allocated amount', false);
    if (receiptAmount <= 0) {
      return NextResponse.json({ error: 'Receipt amount must be positive' }, { status: 400 });
    }

    // Verify all allocated invoices belong to the SAME client (Cross-client allocation prevention)
    let totalAllocated = 0;
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        const inv = await prisma.invoice.findUnique({
          where: { id: alloc.invoiceId },
          include: { allocations: { where: { receipt: { verificationStatus: { not: VerificationStatus.REJECTED } } } } },
        });
        if (!inv || inv.clientId !== clientId) {
          return NextResponse.json(
            { error: 'Allocated invoice does not exist or does not belong to the selected client' },
            { status: 400 }
          );
        }
        await assertOrderAccess(user, inv.orderId);
        // Can't allocate more than the invoice still owes (counting payments awaiting verification)
        const owed = Number(inv.grossAmount) - inv.allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0);
        if (Number(alloc.allocatedAmount) > owed + 0.01) {
          return NextResponse.json(
            { error: `${inv.invoiceNumber} only has ₹${Math.max(0, owed).toFixed(2)} left to pay` },
            { status: 400 }
          );
        }
        totalAllocated += Number(alloc.allocatedAmount);
      }

      if (totalAllocated > receiptAmount) {
        return NextResponse.json(
          { error: 'Total allocated amounts cannot exceed the receipt amount' },
          { status: 400 }
        );
      }
    }



    const receipt = await prisma.$transaction(async (tx) => {
      // Lock invoices in a stable order so concurrent submissions cannot over-allocate.
      for (const invoiceId of [...invoiceIds].sort()) {
        await lockRecord(tx, `invoice-allocation:${invoiceId}`);
        const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { allocations: { where: { receipt: { verificationStatus: { not: VerificationStatus.REJECTED } } } } } });
        if (!invoice || invoice.paymentStatus === 'CANCELLED') throw new ValidationError('Invoice is unavailable');
        const allocated = allocations.find((a: any) => a.invoiceId === invoiceId);
        const existing = invoice.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
        if (existing + Number(allocated.allocatedAmount) > Number(invoice.grossAmount) + 0.01) throw new ValidationError('Allocated amount exceeds the remaining invoice balance');
      }
      await lockRecord(tx, 'number:receipt');
      const receiptNumber = await nextDocNumber(tx, 'receipt');
      const rec = await tx.receipt.create({
        data: {
          receiptNumber,
          clientId,
          receiptDate: new Date(receiptDate),
          amount: receiptAmount,
          paymentMode: paymentMode as PaymentMode,
          transactionRef: transactionRef || '',
          proofDocument,
          recordedById: user.id,
          verificationStatus: VerificationStatus.SUBMITTED, // Salesperson submits, Director verifies
          allocations: {
            create: allocations.map((a: any) => ({
              invoiceId: a.invoiceId,
              allocatedAmount: Number(a.allocatedAmount),
            })),
          },
        },
        include: { allocations: true },
      });

      // Audit event
      await tx.auditEvent.create({
        data: {
          entityType: 'RECEIPT',
          entityId: rec.id,
          action: 'CREATE',
          actorId: user.id,
          details: { receiptNumber, amount: receiptAmount, totalAllocated },
        },
      });

      return rec;
    });

    return NextResponse.json({ success: true, receipt });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    return apiErrorResponse(error);
  }
}
