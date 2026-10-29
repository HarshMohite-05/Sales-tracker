import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { readJson } from '@/lib/inputValidation';
import { errorResponse, ValidationError } from '@/lib/apiErrors';
import { loginRetryAfterSeconds, recordLoginFailure } from '@/lib/loginThrottle';
import { PASSWORD_RECOVERY_MESSAGE, passwordRecoveryKey } from '@/lib/passwordRecovery';

export async function POST(request: Request) {
  try {
    const { email } = await readJson(request);
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new ValidationError('Enter a valid email address');
    const normalized = email.trim().toLowerCase();
    // Separate keys keep unauthenticated recovery requests from locking normal sign-in.
    const key = `password-recovery:${normalized}`;
    const retryAfter = loginRetryAfterSeconds(key);
    if (retryAfter > 0) return NextResponse.json({ error: 'Too many recovery requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
    recordLoginFailure(key);
    const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, isActive: true } });
    if (user?.isActive) {
      // One outstanding request per account; no credentials, reset tokens or email delivery.
      await prisma.appSetting.upsert({ where: { key: passwordRecoveryKey(user.id) },
        create: { key: passwordRecoveryKey(user.id), value: { requestedAt: new Date().toISOString() } },
        update: { value: { requestedAt: new Date().toISOString() }, updatedById: null },
      });
    }
    // Same response for unknown, inactive and active accounts.
    return NextResponse.json({ success: true, message: PASSWORD_RECOVERY_MESSAGE });
  } catch (error) { return errorResponse(error); }
}
