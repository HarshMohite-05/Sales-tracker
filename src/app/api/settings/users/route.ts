import { PASSWORD_RECOVERY_PREFIX, passwordRecoveryKey } from '@/lib/passwordRecovery';
import { readJson } from '@/lib/inputValidation';
import { errorResponse as apiErrorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import { requireDirector, requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

export async function GET() {
  try {
    const user = await requireAuth();

    // Salespeople get their own account only; team data and team counts belong to directors.
    const users = await prisma.user.findMany({
      where: user.role === Role.SALESPERSON ? { id: user.id } : { NOT: { email: { startsWith: 'deleted+' } } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobile: true,
        designation: true,
        isActive: true,
        createdAt: true,
        office: { select: { id: true, name: true } },
        _count: {
          select: {
            assignedClients: true,
            assignedEnquiries: true,
            assignedTasks: { where: { status: 'PENDING' } },
            assignedOrders: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    const requests = user.role === Role.DIRECTOR ? await prisma.appSetting.findMany({ where: { key: { startsWith: PASSWORD_RECOVERY_PREFIX } }, select: { key: true, value: true } }) : [];
    const pending = new Map(requests.map(r => [r.key, r.value as { requestedAt?: string }]));
    const offices = await prisma.office.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json({ offices, users: users.map(u => ({ ...u, ...(user.role === Role.DIRECTOR ? { passwordResetRequestedAt: pending.get(passwordRecoveryKey(u.id))?.requestedAt ?? null } : {}) })) });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);

    const { name, email, password, mobile, designation, role = Role.SALESPERSON, officeId } = body;

    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || !password) {
      return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      return NextResponse.json({ error: 'A user with this email address already exists' }, { status: 400 });
    }

    if (email.trim().toLowerCase().startsWith('deleted+')) return NextResponse.json({ error: 'This email prefix is reserved' }, { status: 400 });
    if (!Object.values(Role).includes(role)) return NextResponse.json({ error: 'Choose a valid role' }, { status: 400 });
    const office = officeId ? await prisma.office.findUnique({ where: { id: String(officeId) } }) : null;
    if (officeId && !office) return NextResponse.json({ error: 'Choose a valid office' }, { status: 400 });
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        role: role as Role,
        mobile: mobile || null,
        designation: designation || null,
        officeId: office?.id ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobile: true,
        designation: true,
      },
    });

    await prisma.auditEvent.create({
      data: {
        entityType: 'USER',
        entityId: newUser.id,
        action: 'CREATE',
        actorId: director.id,
        details: { name: newUser.name, role: newUser.role, email: newUser.email, ...(office ? { office: office.name } : {}) },
      },
    });

    return NextResponse.json({ success: true, user: newUser });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can create user accounts' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const director = await requireDirector();
    const body = await readJson(request);

    const { userId, isActive, reassignToSalespersonId, officeId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (targetUser?.email.startsWith('deleted+')) return NextResponse.json({ error: 'Employee was removed' }, { status: 404 });
    if (isActive === false && userId === director.id) return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
    if (isActive !== undefined && typeof isActive !== 'boolean') return NextResponse.json({ error: 'Active status must be true or false' }, { status: 400 });
    if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Moving someone to another office (or none): their records then count under it
    if (officeId !== undefined) {
      const office = officeId ? await prisma.office.findUnique({ where: { id: String(officeId) } }) : null;
      if (officeId && !office) return NextResponse.json({ error: 'Choose a valid office' }, { status: 400 });
      const updated = await prisma.user.update({ where: { id: userId }, data: { officeId: office?.id ?? null }, select: { id: true, name: true, office: { select: { id: true, name: true } } } });
      await prisma.auditEvent.create({
        data: { entityType: 'USER', entityId: userId, action: 'UPDATE', actorId: director.id, details: { label: `${updated.name} moved to ${office ? `the ${office.name} office` : 'no office'}` } },
      });
      return NextResponse.json({ success: true, user: updated });
    }

    if (reassignToSalespersonId) {
      const assignee = await prisma.user.findUnique({ where: { id: reassignToSalespersonId } });
      if (!assignee?.isActive || assignee.role !== Role.SALESPERSON || assignee.id === userId) {
        return NextResponse.json({ error: 'Choose a different active salesperson for reassignment' }, { status: 400 });
      }
    }
    const result = await prisma.$transaction(async (tx) => {
      // If deactivating and reassigning open work
      if (isActive === false && reassignToSalespersonId) {
        // Reassign active clients
        await tx.client.updateMany({
          where: { assignedToId: userId },
          data: { assignedToId: reassignToSalespersonId },
        });

        // Reassign open enquiries
        await tx.enquiry.updateMany({
          where: { assignedToId: userId, stage: { notIn: ['WON', 'LOST'] } },
          data: { assignedToId: reassignToSalespersonId },
        });

        // Reassign pending tasks
        await tx.task.updateMany({
          where: { assignedSalespersonId: userId, status: 'PENDING' },
          data: { assignedSalespersonId: reassignToSalespersonId },
        });
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: isActive !== undefined ? isActive : targetUser.isActive, ...(isActive === false ? { sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, name: true, email: true, isActive: true },
      });

      await tx.auditEvent.create({
        data: {
          entityType: 'USER',
          entityId: userId,
          action: 'UPDATE',
          actorId: director.id,
          details: { isActive, reassignTo: reassignToSalespersonId },
        },
      });

      return updated;
    });

    return NextResponse.json({ success: true, user: result });
  } catch (error: any) {
    if (error.message === 'FORBIDDEN_DIRECTOR_ONLY') {
      return NextResponse.json({ error: 'Only directors can update user status' }, { status: 403 });
    }
    return apiErrorResponse(error);
  }
}

/** Remove login/personal details while retaining the relational identity used by company history. */
export async function DELETE(request: Request) {
  try {
    const director = await requireDirector();
    const { userId, reassignToSalespersonId } = await readJson(request);
    if (typeof userId !== 'string' || !userId) return NextResponse.json({ error: 'Choose an employee' }, { status: 400 });
    if (userId === director.id) return NextResponse.json({ error: 'You cannot remove your own account' }, { status: 400 });
    await prisma.$transaction(async tx => {
      // Serialize removals so two directors cannot remove the last active director concurrently.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(81734021)`;
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target || target.email.startsWith('deleted+')) throw new Error('EMPLOYEE_NOT_FOUND');
      if (target.role === Role.DIRECTOR && target.isActive && await tx.user.count({ where: { role: Role.DIRECTOR, isActive: true } }) <= 1) throw new Error('LAST_DIRECTOR');
      const assigned = await Promise.all([
        tx.client.count({ where: { assignedToId: userId } }),
        tx.enquiry.count({ where: { assignedToId: userId, stage: { notIn: ['WON', 'LOST'] } } }),
        tx.task.count({ where: { assignedSalespersonId: userId, status: 'PENDING' } }),
        tx.order.count({ where: { assignedSalespersonId: userId, orderStatus: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
        tx.quotation.count({ where: { salespersonId: userId, approvalStatus: { notIn: ['ACCEPTED', 'REJECTED'] } } }),
      ]);
      if (assigned.some(n => n > 0) && !reassignToSalespersonId) throw new Error('REASSIGN_REQUIRED');
      if (reassignToSalespersonId) {
        const next = await tx.user.findUnique({ where: { id: reassignToSalespersonId } });
        if (!next?.isActive || next.role !== Role.SALESPERSON || next.id === userId) throw new Error('INVALID_ASSIGNEE');
        await tx.client.updateMany({ where: { assignedToId: userId }, data: { assignedToId: next.id } });
        await tx.enquiry.updateMany({ where: { assignedToId: userId, stage: { notIn: ['WON', 'LOST'] } }, data: { assignedToId: next.id } });
        await tx.task.updateMany({ where: { assignedSalespersonId: userId, status: 'PENDING' }, data: { assignedSalespersonId: next.id } });
        await tx.order.updateMany({ where: { assignedSalespersonId: userId, orderStatus: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { assignedSalespersonId: next.id } });
        await tx.quotation.updateMany({ where: { salespersonId: userId, approvalStatus: { notIn: ['ACCEPTED', 'REJECTED'] } }, data: { salespersonId: next.id } });
      }
      await tx.user.update({ where: { id: userId }, data: { name: 'Former employee', email: `deleted+${userId}@accounts.invalid`, mobile: null, designation: null, passwordHash: '', isActive: false, sessionVersion: { increment: 1 } } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.appSetting.deleteMany({ where: { key: passwordRecoveryKey(userId) } });
      await tx.auditEvent.create({ data: { entityType: 'USER', entityId: userId, action: 'DELETE', actorId: director.id, details: { action: 'EMPLOYEE_REMOVED', reassignTo: reassignToSalespersonId || null, historyPreserved: true } } });
    });
    return NextResponse.json({ success: true, message: 'Employee removed. Login and personal account details deleted; company history retained.' });
  } catch (error: any) {
    const messages: Record<string, string> = { EMPLOYEE_NOT_FOUND: 'Employee not found', LAST_DIRECTOR: 'The last active director cannot be removed', REASSIGN_REQUIRED: 'Reassign this employee’s clients and unfinished work before removal', INVALID_ASSIGNEE: 'Choose a different active salesperson' };
    if (messages[error.message]) return NextResponse.json({ error: messages[error.message] }, { status: 400 });
    return apiErrorResponse(error);
  }
}
