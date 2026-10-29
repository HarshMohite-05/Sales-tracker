import { readJson } from '@/lib/inputValidation';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Prisma, Role, OrderStatus, EnquiryStage, QuotationStatus } from '@prisma/client';
import { assertQuotationAccess, assertClientRelations } from '@/lib/rbac';
import { nextDocNumber } from '@/lib/numbering';
import { createOrderPayments } from '@/lib/orderPayments';
import { createExecutionSteps, syncPaymentDues } from '@/lib/orderExecution';
import { calculateDeductions, deductionPercentError, parseRetentionDueDate } from '@/lib/deductions';
import { getDeductionRules } from '@/lib/paymentSettings';
import { ValidationError } from '@/lib/apiErrors';


export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as OrderStatus | null;
    const clientId = searchParams.get('clientId');
    const salespersonId = searchParams.get('salespersonId');

    const whereClause: any = {};
    if (user.role === Role.SALESPERSON) {
      whereClause.assignedSalespersonId = user.id;
    } else if (salespersonId) {
      whereClause.assignedSalespersonId = salespersonId;
    }

    if (status) whereClause.orderStatus = status;
    if (clientId) whereClause.clientId = clientId;

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        client: { select: { id: true, name: true, city: true, gstNumber: true } },
        enquiry: {
          select: { id: true, enquiryNumber: true, title: true, category: true, categories: true, categoryOther: true, approxValue: true },
        },
        quotation: { select: { id: true, quotationNumber: true } },
        quotationVersion: { select: { versionNumber: true, remarks: true } },
        payments: { include: { completedBy: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
        executionSteps: { include: { updatedBy: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } },
        deliveryRevisions: { include: { revisedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        receipts: {
          include: { recordedBy: { select: { id: true, name: true } }, reversedBy: { select: { id: true, name: true } } },
          orderBy: { receivedDate: 'asc' },
        },
        excessReviewedBy: { select: { id: true, name: true } },
        assignedSalesperson: { select: { id: true, name: true, email: true } },
        invoices: {
          select: {
            id: true,
            invoiceNumber: true,
            grossAmount: true,
            paymentStatus: true,
            allocations: { select: { allocatedAmount: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return NextResponse.json({ orders });
  } catch (error: any) {
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
      quotationId,
      quotationVersionId,
      clientPoNumber,
      poDate,
      deliveryDate,
      // Deductions the client will make from payments
      tdsEnabled = false,
      tdsPercent,
      retentionEnabled = false,
      retentionPercent,
      retentionDueDate,
      orderDate = new Date(),
      paymentTerms,
      remarks,
      // Direct order fields (when no quotation exists)
      isDirectOrder = false,
      directOrderReason,
      clientId,
      enquiryId,
      items = [],
      netValue,
      taxValue,
      grossValue,
      assignedSalespersonId,
    } = body;

    if (quotationId) {
      await assertQuotationAccess(user, quotationId);
      // An order from a quotation is confirmed against the client's PO
      if (!clientPoNumber?.trim()) {
        return NextResponse.json({ error: 'Enter the client PO number' }, { status: 400 });
      }
      if (!poDate || Number.isNaN(new Date(poDate).getTime())) {
        return NextResponse.json({ error: 'Enter the PO date' }, { status: 400 });
      }
    }
    if (!quotationId) {
      if (!clientId) return NextResponse.json({ error: 'Client is required' }, { status: 400 });
      await assertClientRelations(user, { clientId, enquiryId });
    }
    if (deliveryDate && Number.isNaN(new Date(deliveryDate).getTime())) {
      return NextResponse.json({ error: 'Targeted completion date is not a valid date' }, { status: 400 });
    }

    for (const err of [
      deductionPercentError('TDS', !!tdsEnabled, tdsPercent),
      deductionPercentError('Retention', !!retentionEnabled, retentionPercent),
    ]) {
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    const retentionDue = parseRetentionDueDate(!!retentionEnabled, retentionDueDate);
    if ('error' in retentionDue) return NextResponse.json({ error: retentionDue.error }, { status: 400 });

    if (!quotationId) {
      if (!isDirectOrder || typeof directOrderReason !== 'string' || !directOrderReason.trim()) {
        return NextResponse.json({ error: 'Direct orders require a supporting reason' }, { status: 400 });
      }
      const net = moneyInput(netValue, 'Net value', false);
      const tax = moneyInput(taxValue ?? 0, 'Tax value');
      const gross = moneyInput(grossValue, 'Gross value', false);
      if (Math.abs(net + tax - gross) > 0.01) return NextResponse.json({ error: 'Gross value must equal net value plus tax' }, { status: 400 });
    }
    if ((poDate && !validDateInput(poDate)) || !validDateInput(orderDate)) return NextResponse.json({ error: 'Enter a valid order and PO date' }, { status: 400 });

    // Snapshot of today's rules, kept on the order
    const rules = await getDeductionRules();

    // The client's PO number is the order number; a direct order without a PO gets the next ORD- number
    const poNumber = clientPoNumber?.trim() || '';
    if (poNumber) {
      const taken = await prisma.order.findUnique({ where: { orderNumber: poNumber }, select: { id: true } });
      if (taken) {
        return NextResponse.json({ error: `PO No ${poNumber} is already used by another order. Check the PO number.` }, { status: 400 });
      }
    }


    const order = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, quotationId ? `quotation:${quotationId}` : 'number:order');
      const orderNumber = poNumber || (await nextDocNumber(tx, 'order'));
      let finalClientId = clientId;
      let finalEnquiryId = enquiryId;
      let finalSalespersonId = user.role === Role.SALESPERSON ? user.id : assignedSalespersonId;
      let orderItems = items;
      let net = parseFloat(netValue?.toString() || '0');
      let disc = 0;
      let tax = parseFloat(taxValue?.toString() || '0');
      let gross = parseFloat(grossValue?.toString() || '0');
      let usedVersionId: string | null = quotationVersionId || null;
      // Commercial terms as quoted; a direct order has only what was typed in
      let quotedTerms: { product: string | null; paymentTerms: string | null; paymentStages: any; transportation: any } = {
        product: null,
        paymentTerms: paymentTerms || null,
        paymentStages: Prisma.JsonNull,
        transportation: null,
      };

      // Conversion from Quotation
      if (quotationId) {
        const quote = await tx.quotation.findUnique({
          where: { id: quotationId },
          include: {
            versions: {
              where: quotationVersionId ? { id: quotationVersionId } : { versionNumber: { gte: 0 } },
              orderBy: { versionNumber: 'desc' },
              take: 1,
            },
            enquiry: true,
          },
        });

        if (!quote || quote.versions.length === 0) {
          throw new Error('Valid quotation not found for order conversion');
        }
        if (quote.approvalStatus === QuotationStatus.PENDING_APPROVAL) {
          throw new ValidationError('This quotation is waiting for discount approval. Get it approved before confirming the order.');
        }
        if (quote.approvalStatus === QuotationStatus.REJECTED) {
          throw new ValidationError('This quotation was rejected. Revise it before confirming the order.');
        }
        if (quote.approvalStatus === QuotationStatus.ACCEPTED) {
          throw new ConflictError('An order has already been confirmed from this quotation.');
        }

        const quoteVersion = quote.versions[0];
        usedVersionId = quoteVersion.id;
        finalClientId = quote.clientId;
        finalEnquiryId = quote.enquiryId;
        finalSalespersonId = quote.salespersonId;
        orderItems = (quoteVersion.lineItems as any[]) || [];
        net = Number(quoteVersion.originalValue) - Number(quoteVersion.discountAmount);
        disc = Number(quoteVersion.discountAmount);
        tax = Number(quoteVersion.taxAmount);
        gross = Number(quoteVersion.finalValue);
        quotedTerms = {
          product: quoteVersion.product,
          paymentTerms: quoteVersion.paymentTerms || paymentTerms || null,
          paymentStages: quoteVersion.paymentStages ?? Prisma.JsonNull,
          transportation: quoteVersion.transportation,
        };

        // Update Quotation to ACCEPTED
        await tx.quotation.update({
          where: { id: quotationId },
          data: { approvalStatus: QuotationStatus.ACCEPTED, closedAt: new Date() },
        });
      } else if (isDirectOrder) {
        if (!directOrderReason || directOrderReason.trim().length === 0) {
          throw new Error('Direct confirmed orders without a quotation require a supporting reason');
        }
        if (!finalClientId) throw new Error('Client is required for direct order');
      }

      const deductions = calculateDeductions({
        netValue: net,
        gstValue: tax,
        tdsEnabled: !!tdsEnabled,
        tdsPercent: Number(tdsPercent) || 0,
        retentionEnabled: !!retentionEnabled,
        retentionPercent: Number(retentionPercent) || 0,
        rules,
      });
      if (deductions.expectedPayment <= 0) {
        throw new ValidationError('TDS and retention together cannot be the whole order value or more');
      }

      // Create Order
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          clientPoNumber: clientPoNumber?.trim() || 'Verbal / Direct Confirmed',
          poDate: poDate ? new Date(poDate) : null,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          clientId: finalClientId,
          enquiryId: finalEnquiryId || null,
          quotationId: quotationId || null,
          quotationVersionId: usedVersionId,
          assignedSalespersonId: finalSalespersonId,
          // An order confirmed against a PO is dated by the PO
          orderDate: poDate ? new Date(poDate) : new Date(orderDate),
          items: orderItems,
          netValue: net,
          discountValue: disc,
          taxValue: tax,
          grossValue: gross,
          product: quotedTerms.product,
          paymentTerms: quotedTerms.paymentTerms || 'Standard milestone terms',
          paymentStages: quotedTerms.paymentStages,
          transportation: quotedTerms.transportation,
          tdsEnabled: !!tdsEnabled,
          tdsPercent: deductions.tdsPercent,
          tdsBase: rules.tdsBase,
          tdsAmount: deductions.tdsAmount,
          retentionEnabled: !!retentionEnabled,
          retentionPercent: deductions.retentionPercent,
          retentionBase: rules.retentionBase,
          retentionAmount: deductions.retentionAmount,
          retentionDueDate: retentionDue.date,
          expectedPayment: deductions.expectedPayment,
          orderStatus: OrderStatus.CONFIRMED,
          isDirectOrder: !!isDirectOrder,
          directOrderReason: isDirectOrder ? directOrderReason : null,
          remarks,
        },
      });

      // Payments due follow the payment stages that were quoted
      await createOrderPayments(tx, newOrder);
      // Execution follows the payment terms: one row per payment stage
      await createExecutionSteps(tx, newOrder.id);
      await syncPaymentDues(tx, newOrder.id);

            // Transactional rule: If linked to an enquiry, mark enquiry as WON
      if (finalEnquiryId) {
        const enq = await tx.enquiry.findUnique({ where: { id: finalEnquiryId } });
        if (enq && enq.stage !== EnquiryStage.WON) {
          await tx.enquiry.update({
            where: { id: finalEnquiryId },
            data: { stage: EnquiryStage.WON },
          });

          await tx.enquiryStageHistory.create({
            data: {
              enquiryId: finalEnquiryId,
              fromStage: enq.stage,
              toStage: EnquiryStage.WON,
              reason: `Won via confirmed order ${orderNumber}`,
              changedById: user.id,
            },
          });
        }
      }

      // Audit Event
      await tx.auditEvent.create({
        data: {
          entityType: 'ORDER',
          entityId: newOrder.id,
          action: 'CREATE',
          actorId: user.id,
          details: { orderNumber, grossValue: gross, isDirectOrder: !!isDirectOrder },
        },
      });

      return newOrder;
    });

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Another order took the same PO number while this one was being saved
    if (error.code === 'P2002' && String(error.meta?.target ?? '').includes('orderNumber')) {
      return NextResponse.json({ error: 'This PO No is already used by another order. Check the PO number.' }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
