import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/lib/auth', () => ({ requireAuth: async () => session.user, requireDirector: async () => session.user }));

import prisma from '@/lib/prisma';
import { salespersonScope } from '@/lib/officeScope';
import { PATCH as patchUser } from '@/app/api/settings/users/route';
import { PATCH as patchOffice } from '@/app/api/settings/offices/route';

const patch = (handler: (r: Request) => Promise<Response>, body: object) =>
  handler(new Request('http://test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

describe('offices', () => {
  let mumbai: { id: string };
  let ahmedabad: { id: string };
  let amit: { id: string; officeId: string | null };

  beforeAll(async () => {
    session.user = await prisma.user.findUniqueOrThrow({ where: { email: 'rajesh.sharma@nirmaanwater.com' }, select: { id: true, role: true, name: true } });
    mumbai = await prisma.office.findUniqueOrThrow({ where: { code: 'MUM' } });
    ahmedabad = await prisma.office.findUniqueOrThrow({ where: { code: 'AMD' } });
    amit = await prisma.user.findUniqueOrThrow({ where: { email: 'amit.patil@nirmaanwater.com' }, select: { id: true, officeId: true } });
  });
  afterAll(async () => {
    await prisma.user.update({ where: { id: amit.id }, data: { officeId: amit.officeId } });
    await prisma.office.update({ where: { id: mumbai.id }, data: { address: null, gstin: null } });
  });

  it("covers one salesperson, everyone in an office, or everyone", async () => {
    expect(await salespersonScope('someone', mumbai.id)).toBe('someone');
    expect(await salespersonScope(null, null)).toBeNull();
    const inMumbai = (await prisma.user.findMany({ where: { officeId: mumbai.id }, select: { id: true } })).map((u) => u.id).sort();
    expect(((await salespersonScope(null, mumbai.id)) as { in: string[] }).in.sort()).toEqual(inMumbai);
    expect(inMumbai).toContain(amit.id);
  });

  it('moves a salesperson to another office, so their records count there', async () => {
    const res = await patch(patchUser, { userId: amit.id, officeId: ahmedabad.id });
    expect(res.status).toBe(200);
    expect(((await salespersonScope(null, ahmedabad.id)) as { in: string[] }).in).toContain(amit.id);
    expect(((await salespersonScope(null, mumbai.id)) as { in: string[] }).in).not.toContain(amit.id);
  });

  it("saves an office's letterhead details and checks the GSTIN", async () => {
    const bad = await patch(patchOffice, { id: mumbai.id, gstin: '12345' });
    expect(bad.status).toBe(400);
    const ok = await patch(patchOffice, { id: mumbai.id, address: '204, Sai Plaza, Andheri (E), Mumbai 400069', gstin: '27abcde1234f1z5' });
    expect(ok.status).toBe(200);
    expect(await prisma.office.findUnique({ where: { id: mumbai.id } })).toMatchObject({ address: '204, Sai Plaza, Andheri (E), Mumbai 400069', gstin: '27ABCDE1234F1Z5' });
  });
});
