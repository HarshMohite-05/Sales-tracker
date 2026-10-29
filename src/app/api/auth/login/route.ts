import { readJson } from '@/lib/inputValidation';
import { errorResponse } from '@/lib/apiErrors';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth';
import { clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure } from '@/lib/loginThrottle';

export async function POST(request: Request) {
  try {
    const { email, password } = await readJson(request);

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const retryAfter = loginRetryAfterSeconds(normalizedEmail);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      recordLoginFailure(normalizedEmail);
      return NextResponse.json({ error: 'Invalid credentials or inactive account' }, { status: 401 });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      recordLoginFailure(normalizedEmail);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    clearLoginFailures(normalizedEmail);

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mobile: user.mobile,
      designation: user.designation,
    };

    const token = await createSessionToken({ ...sessionUser, sessionVersion: user.sessionVersion });

    const response = NextResponse.json({
      success: true,
      user: sessionUser,
    });

    const maxAge = parseInt(process.env.SESSION_MAX_AGE_SECONDS || '604800', 10);
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return errorResponse(error);
  }
}
