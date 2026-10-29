import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { Role } from '@prisma/client';
import prisma from './prisma';

function sessionKey() {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32 || secret.startsWith('replace-with-') || secret === 'nirmaan-watertech-super-secure-jwt-auth-session-key-2026')) {
    throw new Error('Configure a random AUTH_SECRET of at least 32 characters');
  }
  return new TextEncoder().encode(secret || 'local-development-only-session-secret');
}

export const SESSION_COOKIE_NAME = 'nirmaan_session';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: Role;
  mobile?: string | null;
  designation?: string | null;
  sessionVersion?: number;
}

export async function createSessionToken(user: UserSession): Promise<string> {
  const maxAge = parseInt(process.env.SESSION_MAX_AGE_SECONDS || '604800', 10);
  return await new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mobile: user.mobile,
    designation: user.designation,
    sv: user.sessionVersion ?? 0,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(sessionKey());
}

export async function verifySessionToken(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ['HS256'] });
    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as Role,
      mobile: payload.mobile as string | null,
      designation: payload.designation as string | null,
      // Tokens issued before session versions existed count as version 0
      sessionVersion: typeof payload.sv === 'number' ? payload.sv : 0,
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const session = await verifySessionToken(token);
    if (!session) return null;

    // Verify active status in DB
    const dbUser = await prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, email: true, name: true, role: true, mobile: true, designation: true, isActive: true, sessionVersion: true },
    });

    if (!dbUser || !dbUser.isActive) return null;
    // A sign-out bumps the version, so tokens issued before it are refused
    if (dbUser.sessionVersion !== session.sessionVersion) return null;

    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      mobile: dbUser.mobile,
      designation: dbUser.designation,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<UserSession> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  return user;
}

export async function requireDirector(): Promise<UserSession> {
  const user = await requireAuth();
  if (user.role !== Role.DIRECTOR) {
    throw new Error('FORBIDDEN_DIRECTOR_ONLY');
  }
  return user;
}
