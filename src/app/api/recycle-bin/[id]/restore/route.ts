import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { binVisibilityFilter, restoreBinItem } from '@/lib/recycleBin';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const visible = await prisma.recycleBinItem.findFirst({ where: { id, ...binVisibilityFilter(user) }, select: { id: true } });
    if (!visible) {
      return NextResponse.json({ error: 'Item not found in the recycle bin' }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const restored = await restoreBinItem(tx, id, user);
      await tx.auditEvent.create({
        data: {
          entityType: restored.item.entityType,
          entityId: restored.item.entityId,
          action: 'RESTORE',
          actorId: user.id,
          details: { label: restored.item.label },
        },
      });
      return restored;
    });

    return NextResponse.json({
      success: true,
      clientId: result.item.clientId,
      message: result.message,
    });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error.name === 'RestoreError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
