import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { formatQuotationNumber } from '@/lib/quotation';
import { assertQuotationAccess } from '@/lib/rbac';
import { generateQuotationPdf } from '@/lib/pdf';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertQuotationAccess(user, id);

    // ?version=N prints an earlier revision; by default the latest one
    const versionParam = new URL(request.url).searchParams.get('version');
    const versionNumber = versionParam !== null ? parseInt(versionParam, 10) : NaN;

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: {
        client: true,
        enquiry: true,
        salesperson: { include: { office: true } },
        versions: {
          where: Number.isNaN(versionNumber) ? undefined : { versionNumber },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    if (!quotation || quotation.versions.length === 0) {
      return NextResponse.json({ error: 'Quotation or version data not found' }, { status: 404 });
    }

    const currentVersion = quotation.versions[0];
    const lineItems = (currentVersion.lineItems as any[]) || [];

    const pdfDoc = generateQuotationPdf({
      quotationNumber: quotation.quotationNumber,
      versionNumber: currentVersion.versionNumber,
      proposalDate: currentVersion.proposalDate,
      validityDays: quotation.validityDays,
      clientName: quotation.client.name,
      clientAddress: quotation.client.address || quotation.client.city,
      clientGst: quotation.client.gstNumber,
      salespersonName: quotation.salesperson.name,
      salespersonMobile: quotation.salesperson.mobile,
      salespersonEmail: quotation.salesperson.email,
      office: quotation.salesperson.office,
      enquiryTitle: quotation.enquiry.title,
      lineItems,
      originalValue: Number(currentVersion.originalValue),
      discountAmount: Number(currentVersion.discountAmount),
      taxAmount: Number(currentVersion.taxAmount),
      finalValue: Number(currentVersion.finalValue),
      commercialTerms: currentVersion.commercialTerms,
      paymentTerms: currentVersion.paymentTerms,
      transportation: currentVersion.transportation,
      remarks: currentVersion.remarks,
    });

    const pdfBuffer = new Uint8Array(pdfDoc.output('arraybuffer'));

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${formatQuotationNumber(quotation.quotationNumber, currentVersion.versionNumber).replace(/\//g, '-')}.pdf"`,
      },
    });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
