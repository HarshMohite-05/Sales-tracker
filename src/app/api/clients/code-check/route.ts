import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { checkClientCode } from '@/lib/clientCodeServer';
import { Role } from '@prisma/client';
import { assertClientAccess } from '@/lib/rbac';
import { errorResponse } from '@/lib/apiErrors';

// GET /api/clients/code-check?code=NGPL[&excludeId=<clientId>]
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const excludeId = searchParams.get('excludeId') || undefined;
    if (excludeId) await assertClientAccess(user, excludeId);
    const result = await checkClientCode(prisma, searchParams.get('code') || '', excludeId, user.role === Role.DIRECTOR);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.name === 'AuthorizationError') return errorResponse(error);
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
