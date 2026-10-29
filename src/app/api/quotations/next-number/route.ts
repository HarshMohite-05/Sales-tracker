import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { suggestQuotationNo } from '@/lib/numbering';
import { quotationPrefix } from '@/lib/quotation';

// Fixed prefix for this financial year plus a suggested number for the new-quotation form
export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ prefix: quotationPrefix(), suggestedNo: await suggestQuotationNo(prisma) });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
