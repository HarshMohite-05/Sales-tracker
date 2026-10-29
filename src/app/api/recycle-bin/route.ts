import { canPermanentlyDelete } from '@/lib/recycleBinPermissions';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { binVisibilityFilter, purgeExpiredBinItems, RECYCLE_BIN_RETENTION_DAYS } from '@/lib/recycleBin';

export async function GET() {
  try {
    const user = await requireAuth();

    // The worker purges on a schedule too, but don't show expired items if it isn't running
    await purgeExpiredBinItems();

    const items = await prisma.recycleBinItem.findMany({
      where: binVisibilityFilter(user),
      select: {
        id: true,
        entityType: true,
        label: true,
        description: true,
        clientId: true,
        clientName: true,
        deletedAt: true,
        expiresAt: true,
        deletedBy: { select: { id: true, name: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });

    return NextResponse.json({ items, canPermanentlyDelete: canPermanentlyDelete(user), retentionDays: RECYCLE_BIN_RETENTION_DAYS });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}

// Directors and admins may permanently delete bin items across the team.
export async function DELETE() {
  try {
    const user = await requireAuth();
    if (!canPermanentlyDelete(user)) {
      return NextResponse.json({ error: 'Only directors and admins can permanently delete recycle bin items' }, { status: 403 });
    }

    const count = await prisma.$transaction(async (tx) => {
      const items = await tx.recycleBinItem.findMany({
        where: binVisibilityFilter(user),
        select: { id: true, entityType: true, entityId: true, label: true },
      });
      if (items.length === 0) return 0;

      await tx.recycleBinItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await tx.auditEvent.createMany({
        data: items.map((i) => ({
          entityType: i.entityType,
          entityId: i.entityId,
          action: 'PURGE' as const,
          actorId: user.id,
          details: { label: i.label, via: 'EMPTY_RECYCLE_BIN' },
        })),
      });
      return items.length;
    });

    return NextResponse.json({ success: true, deletedCount: count });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}
