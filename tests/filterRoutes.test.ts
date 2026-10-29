import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const { auth, db } = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    task: { findMany: vi.fn(), count: vi.fn() }, enquiry: { findMany: vi.fn(), count: vi.fn() }, quotation: { findMany: vi.fn() },
    order: { findMany: vi.fn(), count: vi.fn() }, target: { findMany: vi.fn() },
    incentiveRate: { findMany: vi.fn() }, incentiveEntry: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() }, auditEvent: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ requireAuth: auth, requireDirector: auth }));
vi.mock('@/lib/prisma', () => ({ default: db }));

import { GET as dashboard } from '@/app/api/dashboard/stats/route';
import { GET as report } from '@/app/api/reports/route';
import { GET as targets } from '@/app/api/targets/route';
import { GET as incentives } from '@/app/api/incentives/route';

const conditions = (field: string, kind: string, operator: string, value: string) => JSON.stringify({
  mode: 'all', rules: [{ id: 'condition-1', field, kind, operator, value, to: '' }],
});
const url = (path: string, params: Record<string, string>) => new Request(`http://localhost${path}?${new URLSearchParams(params)}`);

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ id: 'amit', name: 'Amit', role: 'SALESPERSON' });
  db.task.findMany.mockResolvedValue([]);
  db.task.count.mockResolvedValue(0);
  db.order.count.mockResolvedValue(0);
  db.enquiry.findMany.mockResolvedValue([]);
  db.enquiry.count.mockResolvedValue(2);
  db.incentiveRate.findMany.mockResolvedValue([]);
  db.incentiveEntry.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.auditEvent.findMany.mockResolvedValue([]);
  db.quotation.findMany.mockResolvedValue([]);
  db.target.findMany.mockResolvedValue([]);
  db.order.findMany.mockResolvedValue([
    {
      id: 'order-a', orderNumber: 'ORD-A', orderStatus: 'IN_EXECUTION', orderDate: new Date('2026-10-23T00:00:00Z'),
      client: { id: 'client-a', name: 'NEER WATER', industrySegment: 'Water' }, assignedSalesperson: { name: 'Amit' },
      netValue: 1000, taxValue: 0, grossValue: 1000, tdsAmount: 0, retentionAmount: 0,
      payments: [{ id: 'stage-a', percent: 100, description: 'Advance', amount: 1000, expectedAmount: 1000, dueDate: new Date('2026-10-20T00:00:00Z') }],
      receipts: [{ paymentStageId: 'stage-a', amount: 500 }],
      executionSteps: [], deliveryRevisions: [],
    },
    {
      id: 'order-b', orderNumber: 'ORD-B', orderStatus: 'COMPLETED', orderDate: new Date('2026-10-23T00:00:00Z'),
      client: { id: 'client-b', name: 'Other Client', industrySegment: 'Textiles' }, assignedSalesperson: { name: 'Amit' },
      netValue: 2000, taxValue: 0, grossValue: 2000, tdsAmount: 0, retentionAmount: 0,
      payments: [{ id: 'stage-b', percent: 100, description: 'Full payment', amount: 2000, expectedAmount: 2000 }],
      receipts: [{ paymentStageId: 'stage-b', amount: 2000 }],
      executionSteps: [], deliveryRevisions: [],
    },
  ]);
});

describe('Filtered dashboard and report routes', () => {
  it('loads all report dates without dropping salesperson restrictions', async () => {
    const response = await report(url('/api/reports', { type: 'orders', allDates: '1', salespersonId: 'another-user' }));
    expect(response.status).toBe(200);
    const query = db.order.findMany.mock.calls[0][0];
    expect(query.where.assignedSalespersonId).toBe('amit');
    expect(query.where.orderDate).toBeUndefined();
  });

  it('uses each target period for achievements when all periods are visible', async () => {
    db.target.findMany.mockResolvedValue([
      { id: 'first', salespersonId: 'amit', financialYear: '2025-26', periodType: 'QUARTERLY', periodKey: 'Q4', periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-03-31T23:59:59Z'), level: 1, targetType: 'NEW_ENQUIRIES', targetValue: 10 },
      { id: 'second', salespersonId: 'amit', financialYear: '2026-27', periodType: 'MONTHLY', periodKey: 'M04', periodStart: new Date('2026-04-01T00:00:00Z'), periodEnd: new Date('2026-04-30T23:59:59Z'), level: 1, targetType: 'NEW_ENQUIRIES', targetValue: 10 },
    ]);
    const response = await targets(url('/api/targets', { allPeriods: '1', salespersonId: 'another-user' }));
    expect(response.status).toBe(200);
    expect(db.target.findMany.mock.calls[0][0].where).toEqual({ salespersonId: 'amit' });
    const ranges = db.enquiry.count.mock.calls.map(([query]) => query.where.createdAt);
    expect(ranges[0].gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(ranges[1].gte).toEqual(new Date('2026-04-01T00:00:00Z'));
    expect(ranges[1].lte).toEqual(new Date('2026-04-30T23:59:59Z'));
    expect((await response.json()).targets.map((t: any) => t.periodLabel)).toEqual(['Q4 (Jan–Mar)', 'Apr 2026']);
  });

  it('loads incentives keeping a salesperson to their own orders and entries, whatever they ask for', async () => {
    db.order.findMany.mockResolvedValue([]);
    const res = await incentives(url('/api/incentives', { salespersonId: 'another-user' }));
    expect(res.status).toBe(200);
    // The first entry and order reads are the ledger sync over everything; the page's own reads follow
    const pageEntries = db.incentiveEntry.findMany.mock.calls.at(-1)![0];
    const pageOrders = db.order.findMany.mock.calls.at(-1)![0];
    expect(pageEntries.where).toEqual({ salespersonId: 'amit' });
    expect(pageOrders.where).toEqual({ assignedSalespersonId: 'amit' });
    expect((await res.json()).audit).toEqual([]);
    auth.mockResolvedValue({ id: 'director', role: 'DIRECTOR' });
    await incentives(url('/api/incentives', {}));
    expect(db.incentiveEntry.findMany.mock.calls.at(-1)![0].where).toEqual({});
    expect(db.order.findMany.mock.calls.at(-1)![0].where).toEqual({});
  });

  it('recalculates financial totals, collections, and breakdowns from matching orders', async () => {
    const response = await dashboard(url('/api/dashboard/stats', { filters: conditions('outstanding', 'number', 'gt', '0') }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.summary).toMatchObject({ totalOrdersNet: 1000, totalPaymentsReceived: 500, totalOutstanding: 500, totalPaymentsPending: 500, collectionsCount: 1 });
    expect(data.orderBreakdown.map((row: any) => row.orderNumber)).toEqual(['ORD-A']);
    expect(data.filterTotal).toBe(2);
    expect(data.filterCount).toBe(1);
  });

  it('keeps salesperson access restrictions when arbitrary filters and another salesperson are requested', async () => {
    await dashboard(url('/api/dashboard/stats', { salespersonId: 'another-user', filters: conditions('__all', 'text', 'contains', 'NEER') }));
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assignedSalespersonId: 'amit' }) }));
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assignedSalespersonId: 'amit' }) }));
    expect(db.enquiry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assignedToId: 'amit' }) }));
    expect(db.quotation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salespersonId: 'amit' }) }));
  });

  it('exports exactly the rows shown by the same report filter', async () => {
    const params = { type: 'orders', filters: conditions('Client', 'text', 'contains', 'NEER') };
    const preview = await (await report(url('/api/reports', params))).json();
    expect(preview.count).toBe(1);
    expect(preview.data[0]['Order No']).toBe('ORD-A');
    const response = await report(url('/api/reports', { ...params, export: 'excel' }));
    expect(response.headers.get('Content-Type')).toContain('spreadsheetml');
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Report)).toEqual(preview.data);
  });

  it('rejects invalid filter input before querying records', async () => {
    expect((await dashboard(url('/api/dashboard/stats', { filters: '{invalid' }))).status).toBe(400);
    expect((await report(url('/api/reports', { filters: '{invalid' }))).status).toBe(400);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it('requires authentication before filtering or exporting records', async () => {
    auth.mockRejectedValue(new Error('UNAUTHORIZED'));
    expect((await dashboard(url('/api/dashboard/stats', {}))).status).toBe(401);
    expect((await report(url('/api/reports', { export: 'excel' }))).status).toBe(401);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
});
