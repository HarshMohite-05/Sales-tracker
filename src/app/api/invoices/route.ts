import { readJson } from '@/lib/inputValidation';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ValidationError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { Role, InvoiceStatus } from '@prisma/client';
import { nextDocNumber } from '@/lib/numbering';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const orderId = searchParams.get('orderId');
    const status = searchParams.get('status') as InvoiceStatus | null;

    const whereClause: any = {};
    if (user.role === Role.SALESPERSON) {
      whereClause.order = { assignedSalespersonId: user.id };
    }

    if (clientId) whereClause.clientId = clientId;
    if (orderId) whereClause.orderId = orderId;
    if (status) whereClause.paymentStatus = status;

    const invoices = await prisma.invoice.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true } },
        order: { select: { id: true, orderNumber: true, assignedSalesperson: { select: { id: true, name: true } } } },
        allocations: {
          include: {
            receipt: {
              select: {
                id: true,
                receiptNumber: true,
                receiptDate: true,
                verificationStatus: true,
                amount: true,
              },
            },
          },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    });

    // Calculate verified paid amount and current outstanding balance for each invoice
    const enhancedInvoices = invoices.map((inv) => {
      // Only VERIFIED receipts reduce the balance
      const verifiedPaid = inv.allocations
        .filter((a) => a.receipt.verificationStatus === 'VERIFIED')
        .reduce((sum, a) => sum + Number(a.allocatedAmount), 0);

      const unverifiedPending = inv.allocations
        .filter((a) => a.receipt.verificationStatus === 'SUBMITTED')
        .reduce((sum, a) => sum + Number(a.allocatedAmount), 0);

      const gross = Number(inv.grossAmount);
      const balance = Math.max(0, gross - verifiedPaid);

      let computedStatus: InvoiceStatus = inv.paymentStatus;
      if (balance <= 0) {
        computedStatus = InvoiceStatus.PAID;
      } else if (verifiedPaid > 0) {
        computedStatus = InvoiceStatus.PARTIALLY_PAID;
      } else {
        computedStatus = InvoiceStatus.UNPAID;
      }

      return {
        ...inv,
        verifiedPaid,
        unverifiedPending,
        balance,
        computedStatus,
      };
    });

    return NextResponse.json({ invoices: enhancedInvoices });
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
      orderId,
      clientId,
      invoiceDate = new Date(),
      dueDate,
      netAmount,
      taxAmount,
      grossAmount,
      remarks,
    } = body;

    if (!orderId || !clientId || !dueDate || !grossAmount) {
      return NextResponse.json(
        { error: 'Order, client, due date and invoice gross amount are required' },
        { status: 400 }
      );
    }

    await assertOrderAccess(user, orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { invoices: { where: { paymentStatus: { not: InvoiceStatus.CANCELLED } }, select: { grossAmount: true } } },
    });
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (clientId && clientId !== order.clientId) {
      return NextResponse.json({ error: 'Invoice client must match the order client' }, { status: 400 });
    }

    // Invoices for an order can't add up to more than the order value
    const alreadyInvoiced = order.invoices.reduce((sum, i) => sum + Number(i.grossAmount), 0);
    const remaining = Number(order.grossValue) - alreadyInvoiced;
    if (parseFloat(grossAmount.toString()) > remaining + 0.5) {
      return NextResponse.json(
        { error: `Only ₹${Math.max(0, remaining).toFixed(2)} of this order is left to invoice` },
        { status: 400 }
      );
    }

    const net = moneyInput(netAmount ?? 0, 'Invoice net amount');
    const tax = moneyInput(taxAmount ?? 0, 'Invoice tax amount');
    const gross = moneyInput(grossAmount, 'Invoice gross amount', false);
    if (Math.abs(net + tax - gross) > 0.01) throw new ValidationError('Invoice gross must equal net plus tax');
    if (!validDateInput(invoiceDate) || !validDateInput(dueDate)) throw new ValidationError('Enter valid invoice and due dates');
    if (order.orderStatus === 'CANCELLED') throw new ValidationError('Cannot invoice a cancelled order');

    const invoice = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `invoice-order:${orderId}`);
      const invoices = await tx.invoice.findMany({ where: { orderId, paymentStatus: { not: InvoiceStatus.CANCELLED } }, select: { grossAmount: true } });
      if (invoices.reduce((sum, i) => sum + Number(i.grossAmount), 0) + gross > Number(order.grossValue) + 0.01) throw new ValidationError('Invoice exceeds the remaining order value');
      await lockRecord(tx, 'number:invoice');
      const invoiceNumber = await nextDocNumber(tx, 'invoice');
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber,
          orderId,
          clientId: order.clientId,
          invoiceDate: new Date(invoiceDate),
          dueDate: new Date(dueDate),
          netAmount: net,
          taxAmount: tax,
          grossAmount: gross,
          paymentStatus: InvoiceStatus.UNPAID,
          remarks,
        },
      });

      await tx.auditEvent.create({
        data: {
          entityType: 'INVOICE',
          entityId: inv.id,
          action: 'CREATE',
          actorId: user.id,
          details: { invoiceNumber, grossAmount: gross },
        },
      });

      return inv;
    });

    return NextResponse.json({ success: true, invoice });
  } catch (error: any) {
    if (error.name === 'AuthorizationError' || error.message === 'UNAUTHORIZED') return errorResponse(error);
    return apiErrorResponse(error);
  }
}
