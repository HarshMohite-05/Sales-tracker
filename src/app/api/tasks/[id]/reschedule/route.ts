import { readJson } from '@/lib/inputValidation';
import { validDateInput } from '@/lib/inputValidation';
import { ConflictError } from '@/lib/apiErrors';
import { lockRecord } from '@/lib/transactionLock';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertTaskAccess } from '@/lib/rbac';
import { NotificationType } from '@prisma/client';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await assertTaskAccess(user, id);

    const body = await readJson(request);
    const { newDueDateTime, reason } = body;

    if (!newDueDateTime || !reason || reason.trim().length === 0) {
      return NextResponse.json(
        { error: 'New due date/time and a valid reason are required for rescheduling' },
        { status: 400 }
      );
    }

    if (!validDateInput(newDueDateTime)) return NextResponse.json({ error: 'Enter a valid due date and time' }, { status: 400 });
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `task:${id}`);
      const current = await tx.task.findUnique({ where: { id } });
      if (current?.status !== 'PENDING') throw new ConflictError('This follow-up is no longer pending. Refresh to see its current status.');
      // 1. Record reschedule history
      await tx.taskRescheduleHistory.create({
        data: {
          taskId: id,
          previousDueDateTime: current.dueDateTime,
          newDueDateTime: new Date(newDueDateTime),
          reason: reason.trim(),
          rescheduledById: user.id,
        },
      });

      // 2. Update task due time
      const updated = await tx.task.update({
        where: { id },
        data: {
          dueDateTime: new Date(newDueDateTime),
        },
      });

      // 3. Clean up unread existing notifications since deadline changed
      await tx.notification.deleteMany({
        where: {
          taskId: id,
          isRead: false,
          type: NotificationType.REMINDER,
        },
      });

      // 4. Audit Event
      await tx.auditEvent.create({
        data: {
          entityType: 'TASK',
          entityId: id,
          action: 'RESCHEDULE',
          actorId: user.id,
          details: {
            from: current.dueDateTime.toISOString(),
            to: new Date(newDueDateTime).toISOString(),
            reason,
          },
        },
      });

      return updated;
    });

    return NextResponse.json({ success: true, task: result });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
