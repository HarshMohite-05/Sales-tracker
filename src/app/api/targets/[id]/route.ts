import { NextResponse } from 'next/server';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { errorResponse } from '@/lib/apiErrors';
import { moveTargetToBin } from '@/lib/recycleBin';

// Delete a target (directors only), with any higher targets set after it; it goes to the recycle bin
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireDirector();
    const { id } = await params;

    const target = await prisma.target.findUnique({ where: { id }, select: { id: true } });
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });

    await prisma.$transaction(async (tx) => {
      const binItem = await moveTargetToBin(tx, user, id);
      await tx.auditEvent.create({
        data: {
          entityType: 'TARGET',
          entityId: id,
          action: 'DELETE',
          actorId: user.id,
          details: { label: binItem.label, recycleBinItemId: binItem.id },
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
}
