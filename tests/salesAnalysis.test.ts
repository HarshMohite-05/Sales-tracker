import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisPeriod } from '@/lib/salesAnalysis';
const { director, db } = vi.hoisted(() => ({ director: vi.fn(), db: Object.fromEntries(['user', 'enquiry', 'activity', 'task', 'quotation', 'order', 'orderReceipt'].map((model) => [model, { findMany: vi.fn() }])) }));
vi.mock('@/lib/auth', () => ({ requireDirector: director }));
vi.mock('@/lib/prisma', () => ({ default: db }));
import { GET } from '@/app/api/dashboard/analysis/route';
const request = (query = '') => new Request(`http://localhost/api/dashboard/analysis?${query}`);
beforeEach(() => {
  vi.resetAllMocks(); director.mockResolvedValue({ id: 'director', role: 'DIRECTOR' });
  Object.values(db).forEach((model) => model.findMany.mockResolvedValue([]));
  db.user.findMany.mockResolvedValue([{ id: 'amit', name: 'Amit', isActive: true }, { id: 'sneha', name: 'Sneha', isActive: true }]);
});
describe('Director analysis', () => {
  it('uses India midnight and Monday-based weeks at year boundaries', () => {
    const today = analysisPeriod(new URLSearchParams('period=today'), new Date('2026-10-22T19:00:00Z'));
    expect(today.start).toBe('2026-10-23');
    expect(today.from.toISOString()).toBe('2026-10-22T18:30:00.000Z');
    expect(today.until.toISOString()).toBe('2026-10-23T18:30:00.000Z');
    expect(analysisPeriod(new URLSearchParams('period=week'), new Date('2027-01-01T12:00:00Z')).start).toBe('2026-12-28');
  });
  it.each(['period=custom&start=2026-02-30&end=2026-03-01', 'period=custom&start=2026-10-24&end=2026-10-23', 'period=custom&start=2024-01-01&end=2026-01-01'])('rejects invalid ranges before querying: %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it.each([['UNAUTHORIZED', 401], ['FORBIDDEN_DIRECTOR_ONLY', 403]])('blocks unauthorized access: %s', async (message, status) => {
    director.mockRejectedValue(new Error(message));
    expect((await GET(request())).status).toBe(status);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it('groups dated events by owner and day, retaining zero-activity people', async () => {
    const at = new Date('2026-10-23T09:00:00Z');
    db.enquiry.findMany.mockResolvedValue([{ assignedToId: 'amit', createdAt: at }]);
    db.order.findMany.mockResolvedValue([{ assignedSalespersonId: 'amit', orderDate: at, netValue: '1000.50' }]);
    db.orderReceipt.findMany.mockResolvedValue([{ order: { assignedSalespersonId: 'amit' }, receivedDate: at, amount: '250.25' }]);
    const result = await (await GET(request('period=custom&start=2026-10-22&end=2026-10-23'))).json();
    expect(result.totals).toMatchObject({ enquiries: 1, orders: 1, orderValue: 1000.5, received: 250.25 });
    expect(result.rows[1]).toMatchObject({ id: 'sneha', orders: 0, received: 0 });
    expect(result.daily[0].orders).toBe(0);
    expect(result.daily[1].orders).toBe(1);
    expect(db.orderReceipt.findMany.mock.calls[0][0].where).toMatchObject({ isReversed: false, order: { orderStatus: { not: 'CANCELLED' } } });
  });
  it('applies selected salesperson to every event query', async () => {
    expect((await GET(request('salespersonId=amit'))).status).toBe(200);
    expect(db.enquiry.findMany.mock.calls[0][0].where.assignedToId).toBe('amit');
    for (const model of ['activity', 'quotation']) expect(db[model].findMany.mock.calls[0][0].where.salespersonId).toBe('amit');
    for (const model of ['order', 'task']) expect(db[model].findMany.mock.calls[0][0].where.assignedSalespersonId).toBe('amit');
    expect(db.orderReceipt.findMany.mock.calls[0][0].where.order.assignedSalespersonId).toBe('amit');
  });
});
