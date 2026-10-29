import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  // Invalidate the token server-side too, so a copied cookie stops working after sign-out
  const user = await getCurrentUser();
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  }
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
