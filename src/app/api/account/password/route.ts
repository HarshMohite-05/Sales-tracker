import { passwordRecoveryKey } from '@/lib/passwordRecovery';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth, SESSION_COOKIE_NAME } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse, ValidationError } from '@/lib/apiErrors';
import { passwordError } from '@/lib/passwordPolicy';

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const { currentPassword, newPassword } = await readJson(request);
    const problem = passwordError(newPassword);
    if (problem) throw new ValidationError(problem);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }
    if (await bcrypt.compare(newPassword, account.passwordHash)) throw new ValidationError('Choose a different new password');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({ where: { id: user.id, passwordHash: account.passwordHash, isActive: true }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new ValidationError('Account changed. Sign in again and retry.');
      await tx.appSetting.deleteMany({ where: { key: passwordRecoveryKey(user.id) } });
      await tx.auditEvent.create({ data: { entityType: 'USER', entityId: user.id, action: 'UPDATE', actorId: user.id, details: { action: 'PASSWORD_CHANGED' } } });
    });
    const response = NextResponse.json({ success: true, message: 'Password changed. Sign in with your new password.' });
    response.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
    return response;
  } catch (error) { return errorResponse(error); }
}
