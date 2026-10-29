import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { mergeIndustrySegments } from '@/lib/industries';
import { Role } from '@prisma/client';

export async function GET() {
  try {
    const user = await requireAuth();

    // Custom segments are persisted implicitly through the clients that use them
    const rows = await prisma.client.findMany({
      where: user.role === Role.DIRECTOR ? {} : { assignedToId: user.id },
      distinct: ['industrySegment'],
      select: { industrySegment: true },
    });

    return NextResponse.json({ industries: mergeIndustrySegments(rows.map((r) => r.industrySegment)) });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
