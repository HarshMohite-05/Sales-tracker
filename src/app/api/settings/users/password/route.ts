import { passwordRecoveryKey } from '@/lib/passwordRecovery';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireDirector } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse, ValidationError } from '@/lib/apiErrors';
import { passwordError } from '@/lib/passwordPolicy';

export async function POST(request: Request) {
  try {
    const director = await requireDirector();
    const { userId, newPassword } = await readJson(request);
    if (typeof userId !== 'string' || !userId) throw new ValidationError('Choose an employee');
    if (userId === director.id) throw new ValidationError('Use Change password for your own account');
    const problem = passwordError(newPassword);
    if (problem) throw new ValidationError(problem);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async tx => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target?.isActive) throw new ValidationError('Choose an active employee');
      await tx.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await tx.appSetting.deleteMany({ where: { key: passwordRecoveryKey(userId) } });
      await tx.auditEvent.create({ data: { entityType: 'USER', entityId: userId, action: 'UPDATE', actorId: director.id, details: { action: 'PASSWORD_RESET_BY_DIRECTOR' } } });
    });
    return NextResponse.json({ success: true, message: 'Password reset. Existing sessions have been signed out.' });
  } catch (error) { return errorResponse(error); }
}
