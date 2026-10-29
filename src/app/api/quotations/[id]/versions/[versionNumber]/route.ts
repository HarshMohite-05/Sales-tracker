import { readJson } from '@/lib/inputValidation';
import { lockRecord } from '@/lib/transactionLock';
import { ConflictError } from '@/lib/apiErrors';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { syncRequirementValue } from '@/lib/requirementValue';
import prisma from '@/lib/prisma';
import { assertQuotationAccess } from '@/lib/rbac';
import { QuotationStatus } from '@prisma/client';
import { formatQuotationNumber } from '@/lib/quotation';
import { parseQuotationInput } from '@/lib/quotationInput';
import { moveQuotationVersionToBin } from '@/lib/recycleBin';

type Params = { params: Promise<{ id: string; versionNumber: string }> };

// Numbers made by the current form, e.g. NWTS/26_27/045; only these can have their number edited
const EDITABLE_NUMBER = /^(NWTS\/\d{2}_\d{2}\/)\d+$/;

async function loadVersion(user: any, params: Params['params']) {
  const { id, versionNumber: raw } = await params;
  await assertQuotationAccess(user, id);
  const versionNumber = parseInt(raw, 10);

  const quotation = await prisma.quotation.findUnique({ where: { id } });
  const version = quotation
    ? await prisma.quotationVersion.findUnique({ where: { quotationId_versionNumber: { quotationId: id, versionNumber } } })
    : null;
  return { quotation, version, versionNumber };
}

function errorResponse(error: any) {
  if (error.message === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error.name === 'AuthorizationError') {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return apiErrorResponse(error);
}

// Edit a quotation or one of its revisions in place, without making a new revision
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { quotation, version, versionNumber } = await loadVersion(user, params);
    if (!quotation || !version) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    if (quotation.approvalStatus === QuotationStatus.ACCEPTED) {
      return NextResponse.json({ error: 'An order has been confirmed from this quotation, so it can no longer be edited' }, { status: 400 });
    }

    if (version.isImmutable || versionNumber !== quotation.currentVersionNumber) {
      return NextResponse.json({ error: 'Previous quotation versions are frozen. Revise the current version instead.' }, { status: 409 });
    }

    const body = await readJson(request);
    const input = parseQuotationInput(body);
    if ('error' in input) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }
    const { values, terms } = input;

    // The number belongs to the whole quotation, so it can only be changed when editing the original
    let quotationNumber = quotation.quotationNumber;
    const no = body.quotationNo !== undefined ? String(body.quotationNo).trim() : '';
    const numberMatch = quotation.quotationNumber.match(EDITABLE_NUMBER);
    if (no && versionNumber === 0 && numberMatch) {
      if (!/^\d{1,6}$/.test(no)) {
        return NextResponse.json({ error: 'Quotation number must be digits only, e.g. 045' }, { status: 400 });
      }
      quotationNumber = `${numberMatch[1]}${no}`;
      if (quotationNumber !== quotation.quotationNumber && (await prisma.quotation.findUnique({ where: { quotationNumber } }))) {
        return NextResponse.json({ error: `Quotation number ${quotationNumber} is already used` }, { status: 409 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `quotation:${quotation.id}`);
      const current = await tx.quotation.findUnique({ where: { id: quotation.id } });
      if (!current || current.approvalStatus === QuotationStatus.ACCEPTED || current.currentVersionNumber !== versionNumber) throw new ConflictError('This quotation changed. Refresh before editing it.');
      await tx.quotationVersion.update({ where: { id: version.id }, data: { ...values, ...terms } });

      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          quotationNumber,
          // The summary mirrors the current version
          ...(versionNumber === quotation.currentVersionNumber
            ? {
                originalValue: values.originalValue,
                discountAmount: values.discountAmount,
                discountPercent: values.discountPercent,
                taxAmount: values.taxAmount,
                finalValue: values.finalValue,
                ...terms,
              }
            : {}),
        },
      });

      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION',
          entityId: quotation.id,
          action: 'UPDATE',
          actorId: user.id,
          details: {
            quotationNumber: formatQuotationNumber(quotationNumber, versionNumber),
            edited: true,
            ...(quotationNumber !== quotation.quotationNumber ? { previousNumber: quotation.quotationNumber } : {}),
            finalValue: values.finalValue,
          },
        },
      });

      await syncRequirementValue(tx, quotation.enquiryId);
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}

// Delete one revision; it goes to the recycle bin. The original is deleted with the whole quotation instead.
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { quotation, version, versionNumber } = await loadVersion(user, params);
    if (!quotation || !version) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }
    if (quotation.approvalStatus === QuotationStatus.ACCEPTED) {
      return NextResponse.json({ error: 'An order has been confirmed from this quotation, so it cannot be changed' }, { status: 400 });
    }
    if (versionNumber === 0) {
      return NextResponse.json({ error: 'This is the original quotation. Delete the whole quotation instead.' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const binItem = await moveQuotationVersionToBin(tx, user, quotation.id, versionNumber);
      await syncRequirementValue(tx, quotation.enquiryId);
      await tx.auditEvent.create({
        data: {
          entityType: 'QUOTATION_VERSION',
          entityId: version.id,
          action: 'DELETE',
          actorId: user.id,
          details: { quotationNumber: binItem.label, quotationId: quotation.id, recycleBinItemId: binItem.id },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
