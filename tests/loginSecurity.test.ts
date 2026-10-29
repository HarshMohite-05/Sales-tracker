import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
const { db, jar } = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn(), update: vi.fn() } }, jar: { token: '' } }));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (jar.token ? { value: jar.token } : undefined) }) }));
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { createSessionToken, getCurrentUser, verifySessionToken } from '@/lib/auth';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure } from '@/lib/loginThrottle';
const stored = { id: 'qa-user', email: 'qa@example.test', name: 'QA', role: 'SALESPERSON' as const, mobile: null, designation: null, isActive: true, sessionVersion: 3, passwordHash: bcrypt.hashSync('right-password', 4) };
const post = (body: any) => new Request('http://qa/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const cookieToken = (res: Response) => res.headers.get('set-cookie')!.split(';')[0].split('=')[1];
beforeEach(() => { vi.clearAllMocks(); jar.token = ''; db.user.findUnique.mockResolvedValue({ ...stored }); clearLoginFailures('qa@example.test'); clearLoginFailures('nobody@example.test'); });
describe('Sign-out revokes the session on the server', () => {
  it('issues tokens carrying the stored session version', async () => {
    const res = await login(post({ email: 'qa@example.test', password: 'right-password' }));
    expect(res.status).toBe(200);
    expect(await verifySessionToken(cookieToken(res))).toMatchObject({ id: 'qa-user', sessionVersion: 3 });
  });
  it('treats tokens from before session versions as version 0', async () => {
    const { sessionVersion, ...legacy } = { ...stored, sessionVersion: undefined };
    expect((await verifySessionToken(await createSessionToken(legacy)))?.sessionVersion).toBe(0);
  });
  it('accepts a current token and refuses it once the version moves on', async () => {
    jar.token = await createSessionToken(stored);
    expect(await getCurrentUser()).toMatchObject({ id: 'qa-user' });
    db.user.findUnique.mockResolvedValue({ ...stored, sessionVersion: 4 });
    expect(await getCurrentUser()).toBeNull();
  });
  it('bumps the version on sign-out and clears the cookie', async () => {
    jar.token = await createSessionToken(stored);
    const res = await logout();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'qa-user' }, data: { sessionVersion: { increment: 1 } } });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
  it('signs out cleanly with no session', async () => {
    expect((await logout()).status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
describe('Repeated wrong passwords are throttled', () => {
  it(`blocks the email after ${LOGIN_MAX_FAILURES} failures, even with the right password`, async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login(post({ email: 'QA@example.test ', password: 'wrong' }))).status).toBe(401);
    const blocked = await login(post({ email: 'qa@example.test', password: 'right-password' }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('counts unknown emails too, so probing for accounts is throttled', async () => {
    db.user.findUnique.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(post({ email: 'nobody@example.test', password: 'x' }));
    expect((await login(post({ email: 'nobody@example.test', password: 'x' }))).status).toBe(429);
  });
  it('resets the count after a successful sign-in', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await login(post({ email: 'qa@example.test', password: 'wrong' }));
    expect((await login(post({ email: 'qa@example.test', password: 'right-password' }))).status).toBe(200);
    expect((await login(post({ email: 'qa@example.test', password: 'wrong' }))).status).toBe(401);
  });
  it('lifts the block when the window ends', () => {
    const start = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure('nobody@example.test', start);
    expect(loginRetryAfterSeconds('nobody@example.test', start + 1000)).toBe(LOGIN_WINDOW_MS / 1000 - 1);
    expect(loginRetryAfterSeconds('nobody@example.test', start + LOGIN_WINDOW_MS)).toBe(0);
  });
});
