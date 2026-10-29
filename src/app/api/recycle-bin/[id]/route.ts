import { canPermanentlyDelete } from '@/lib/recycleBinPermissions';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { binVisibilityFilter } from '@/lib/recycleBin';

// Permanently delete a single bin item
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (!canPermanentlyDelete(user)) {
      return NextResponse.json({ error: 'Only directors and admins can permanently delete recycle bin items' }, { status: 403 });
    }
    const { id } = await params;

    const item = await prisma.recycleBinItem.findFirst({ where: { id, ...binVisibilityFilter(user) } });
    if (!item) {
      return NextResponse.json({ error: 'Item not found in the recycle bin' }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.recycleBinItem.delete({ where: { id } }),
      prisma.auditEvent.create({
        data: {
          entityType: item.entityType,
          entityId: item.entityId,
          action: 'PURGE',
          actorId: user.id,
          details: { label: item.label },
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
