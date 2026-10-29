import { readJson } from '@/lib/inputValidation';
import { validDateInput } from '@/lib/inputValidation';
import { ConflictError } from '@/lib/apiErrors';
import { lockRecord } from '@/lib/transactionLock';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assertTaskAccess } from '@/lib/rbac';
import { TaskStatus, TaskPriority, TaskType, NotificationType } from '@prisma/client';
import { nextDocNumber } from '@/lib/numbering';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role !== 'SALESPERSON') return NextResponse.json({ error: 'Customer follow-ups are performed by salespeople' }, { status: 403 });
    const { id } = await params;
    await assertTaskAccess(user, id);

    const body = await readJson(request);
    const {
      completionOutcome,
      nextAction,
      nextActionDate,
      nextActionType,
      isFullyResolved = false,
      resolutionReason,
    } = body;

    if (!completionOutcome || completionOutcome.trim().length === 0) {
      return NextResponse.json({ error: 'Completion outcome is required' }, { status: 400 });
    }

    if ((nextAction && !nextActionDate) || (nextActionDate && !validDateInput(nextActionDate))) {
      return NextResponse.json({ error: 'Enter a valid date for the next follow-up' }, { status: 400 });
    }
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      await lockRecord(tx, `task:${id}`);
      const current = await tx.task.findUnique({ where: { id } });
      if (current?.status !== 'PENDING') throw new ConflictError('This follow-up is no longer pending. Refresh to see its current status.');
      // 1. Mark task completed
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          completionOutcome: completionOutcome.trim(),
          completedAt: new Date(),
        },
      });

      // 2. Clean up unread reminder notifications for this task
      await tx.notification.deleteMany({
        where: {
          taskId: id,
          isRead: false,
          type: NotificationType.REMINDER,
        },
      });

      // 3. Optional subsequent follow-up task
      let nextTask = null;
      if (!isFullyResolved && nextAction && nextActionDate) {
        await lockRecord(tx, 'number:task');
        const nextTaskNumber = await nextDocNumber(tx, 'task');

        nextTask = await tx.task.create({
          data: {
            taskNumber: nextTaskNumber,
            clientId: task.clientId,
            enquiryId: task.enquiryId,
            quotationId: task.quotationId,
            orderId: task.orderId,
            invoiceId: task.invoiceId,
            assignedSalespersonId: task.assignedSalespersonId,
            createdById: user.id,
            actionType: (nextActionType as TaskType) || task.actionType,
            description: nextAction.trim(),
            priority: TaskPriority.MEDIUM,
            dueDateTime: new Date(nextActionDate),
            status: TaskStatus.PENDING,
            reminderSettings: { remindMinutesBefore: [1440, 60] },
          },
        });
      }

      // 4. Audit Event
      await tx.auditEvent.create({
        data: {
          entityType: 'TASK',
          entityId: id,
          action: 'UPDATE',
          actorId: user.id,
          details: { outcome: completionOutcome, hasNextTask: !!nextTask, resolutionReason },
        },
      });

      return { completedTask: updated, nextTask };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}
