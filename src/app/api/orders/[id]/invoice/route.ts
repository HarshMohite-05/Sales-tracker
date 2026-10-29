import { readJson } from '@/lib/inputValidation';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertOrderAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';
import { invoiceGstAmount } from '@/lib/deductions';
import { applyInvoiceGst } from '@/lib/orderExecution';
import { FULL_PAYMENT_STEP, isAddedStage } from '@/lib/executionSteps';

const day = (d: Date) => d.toISOString().slice(0, 10);

async function loadOrder(id: string) {
  return prisma.order.findUnique({ where: { id }, include: { executionSteps: true, payments: true } });
}

// Raise the order's invoice at one execution step, with the GST % to charge. An order has one
// invoice: it has to be removed before it can be raised at another step.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await loadOrder(id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.orderStatus === 'CANCELLED') {
      return NextResponse.json({ error: 'This order was cancelled' }, { status: 400 });
    }

    const { stepId, gstPercent, invoiceDate } = await readJson(request);
    const step = order.executionSteps.find((s) => s.id === stepId);
    if (!step) return NextResponse.json({ error: 'Step not found on this order' }, { status: 404 });
    if (step.name === FULL_PAYMENT_STEP) {
      return NextResponse.json({ error: 'Orders on fixed payment terms have no invoice or GST' }, { status: 400 });
    }
    if (isAddedStage(step.name, order.payments)) {
      return NextResponse.json({ error: 'Raise the invoice on a payment row, not a stage added for tracking' }, { status: 400 });
    }
    const current = order.executionSteps.find((s) => s.id === order.invoiceStepId);
    if (current && current.id !== step.id) {
      return NextResponse.json(
        { error: `The invoice is already raised at "${current.name}". Untick it there first.` },
        { status: 409 }
      );
    }

    const gstIncluded = Number(order.taxValue) > 0;
    const percent = gstIncluded ? Math.round((Number(order.taxValue) / Number(order.netValue)) * 10000) / 100 : Number(gstPercent);
    if (!gstIncluded && (gstPercent === '' || gstPercent === null || gstPercent === undefined || !(percent > 0 && percent < 100))) {
      return NextResponse.json({ error: 'Enter the GST percentage, more than 0 and less than 100' }, { status: 400 });
    }
    const date = invoiceDate ? new Date(invoiceDate) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: 'Enter the invoice date' }, { status: 400 });
    }
    if (day(date) > day(new Date())) {
      return NextResponse.json({ error: 'The invoice date cannot be in the future' }, { status: 400 });
    }
    const gstAmount = invoiceGstAmount(order, percent);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id },
        data: { invoiceStepId: step.id, invoiceDate: date, invoiceGstPercent: percent, invoiceGstAmount: gstAmount },
      });
      await applyInvoiceGst(tx, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: order.orderNumber,
            invoiceRaised: step.name,
            invoiceDate: day(date),
            gstPercent: percent,
            gstAmount,
            ...(current
              ? { before: { invoiceDate: order.invoiceDate && day(order.invoiceDate), gstPercent: Number(order.invoiceGstPercent) } }
              : {}),
          },
        },
      });
      return result;
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error: any) {
    return errorResponse(error);
  }
}

// Remove the invoice: its GST is no longer asked for, and another step can take the invoice
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertOrderAccess(user, id);

    const order = await loadOrder(id);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (!order.invoiceStepId) return NextResponse.json({ error: 'No invoice has been raised on this order' }, { status: 400 });
    const step = order.executionSteps.find((s) => s.id === order.invoiceStepId);
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { invoiceStepId: null, invoiceDate: null, invoiceGstPercent: null, invoiceGstAmount: 0 },
      });
      await applyInvoiceGst(tx, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            orderNumber: order.orderNumber,
            invoiceRemoved: step?.name ?? null,
            before: { invoiceDate: order.invoiceDate && day(order.invoiceDate), gstAmount: Number(order.invoiceGstAmount) },
          },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
