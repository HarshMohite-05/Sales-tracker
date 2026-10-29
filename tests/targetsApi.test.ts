import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/lib/auth', () => ({ requireAuth: async () => session.user, requireDirector: async () => session.user }));

import prisma from '@/lib/prisma';
import { GET, POST } from '@/app/api/targets/route';

const post = (body: Record<string, unknown>) => POST(new Request('http://test/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const plant = (incentive: number) => ({ PLANT: { incentive }, SPARES: { incentive: incentive + 1 } });

describe('setting order booking targets', () => {
  let salesperson: { id: string };
  // A custom period far in the future, so it never overlaps the seeded targets
  const period = { periodType: 'CUSTOM', startDate: '2031-04-01', endDate: '2031-09-30' };

  beforeAll(async () => {
    session.user = await prisma.user.findFirstOrThrow({ where: { role: 'DIRECTOR' }, select: { id: true, role: true, name: true } });
    salesperson = await prisma.user.findFirstOrThrow({ where: { role: 'SALESPERSON' }, select: { id: true } });
    await prisma.target.deleteMany({ where: { salespersonId: salesperson.id, periodStart: { gte: new Date('2031-01-01') } } });
  });
  afterAll(async () => {
    await prisma.target.deleteMany({ where: { salespersonId: salesperson.id, periodStart: { gte: new Date('2031-01-01') } } });
  });

  it('saves Target 1 and Target 2 at once, each with its incentives by business type', async () => {
    const res = await post({ salespersonId: salesperson.id, ...period, levels: [{ targetValue: 1000, typeRates: plant(2) }, { targetValue: 2000, typeRates: plant(3) }] });
    expect(res.status).toBe(200);
    const rows = await prisma.target.findMany({ where: { salespersonId: salesperson.id, periodKey: 'C20310401-20310930' }, orderBy: { level: 'asc' } });
    expect(rows.map((t) => [t.level, Number(t.targetValue), t.financialYear])).toEqual([
      [1, 1000, 'FY 2031-32'],
      [2, 2000, 'FY 2031-32'],
    ]);
    expect(rows[1].typeRates).toMatchObject({ PLANT: { incentive: 3 }, SPARES: { incentive: 4 }, AMC: { incentive: 0 } });
  });

  it('works toward Target 1 first, with Target 2 after it', async () => {
    const res = await GET(new Request(`http://test/api/targets?allPeriods=1&salespersonId=${salesperson.id}`));
    const { targets } = await res.json();
    const ours = targets.filter((t: any) => t.periodKey === 'C20310401-20310930');
    expect(ours.find((t: any) => t.level === 1)).toMatchObject({ isCurrent: true, raisedTo: 2000, chainSize: 2 });
    expect(ours.find((t: any) => t.level === 2)).toMatchObject({ isCurrent: false, raisedTo: null });
  });

  it('replaces the targets when the period is set again', async () => {
    const res = await post({ salespersonId: salesperson.id, ...period, levels: [{ targetValue: 1500, typeRates: plant(2.5) }] });
    expect(res.status).toBe(200);
    const rows = await prisma.target.findMany({ where: { salespersonId: salesperson.id, periodKey: 'C20310401-20310930' } });
    expect(rows.map((t) => [t.level, Number(t.targetValue)])).toEqual([[1, 1500]]);
  });

  it('refuses a target that is not higher than the one before, rates without any %, and overlapping dates', async () => {
    const lower = await post({ salespersonId: salesperson.id, ...period, levels: [{ targetValue: 2000, typeRates: plant(2) }, { targetValue: 2000, typeRates: plant(3) }] });
    expect((await lower.json()).error).toBe('Target 2 must be higher than Target 1');

    const noRates = await post({ salespersonId: salesperson.id, ...period, levels: [{ targetValue: 1000, typeRates: {} }] });
    expect((await noRates.json()).error).toMatch(/at least one business type/);

    const overlap = await post({ salespersonId: salesperson.id, periodType: 'CUSTOM', startDate: '2031-09-01', endDate: '2031-12-31', levels: [{ targetValue: 1000, typeRates: plant(2) }] });
    expect(overlap.status).toBe(400);
    expect((await overlap.json()).error).toMatch(/overlaps/);
  });
});
