import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const { auth, db } = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() });
  return { auth: vi.fn(), db: {
    client: model(), enquiry: model(), quotation: model(), order: model(), task: model(),
    user: model(), contact: model(), site: model(), directorComment: model(), auditEvent: model(),
    receipt: model(), appSetting: model(), office: model(), $transaction: vi.fn(),
  } };
});
vi.mock('@/lib/auth', () => ({ requireAuth: auth, requireDirector: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: db }));

import { assertClientAccess, assertEnquiryAccess, assertOrderAccess, assertQuotationAccess, assertTaskAccess, assertClientRelations, commentVisibility } from '@/lib/rbac';
import { GET as users } from '@/app/api/settings/users/route';
import { GET as clientProfile } from '@/app/api/clients/[id]/route';
import { POST as activity } from '@/app/api/activities/route';
import { POST as invoice } from '@/app/api/invoices/route';
import { POST as receipt } from '@/app/api/receipts/route';
import { POST as order } from '@/app/api/orders/route';
import { POST as quotation } from '@/app/api/quotations/route';
import { POST as client } from '@/app/api/clients/route';
import { checkClientCode } from '@/lib/clientCodeServer';
import { binVisibilityFilter } from '@/lib/recycleBin';

const salesperson = { id: 'sales-a', name: 'Sales A', email: 'a@example.test', role: Role.SALESPERSON };
const director = { ...salesperson, id: 'director', role: Role.DIRECTOR };
const post = (body: any) => new Request('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue(salesperson);
  for (const model of [db.client, db.enquiry, db.quotation, db.order, db.task, db.user, db.directorComment, db.auditEvent]) model.findMany.mockResolvedValue([]);
});

describe('Salesperson and director access boundaries', () => {
  it.each([
    ['client', 'assignedToId', assertClientAccess],
    ['enquiry', 'assignedToId', assertEnquiryAccess],
    ['quotation', 'salespersonId', assertQuotationAccess],
    ['order', 'assignedSalespersonId', assertOrderAccess],
    ['task', 'assignedSalespersonId', assertTaskAccess],
  ] as const)('protects %s access on direct record IDs', async (model, ownerField, guard) => {
    db[model].findUnique.mockResolvedValue({ [ownerField]: 'sales-b' });
    await expect(guard(salesperson, 'foreign-id')).rejects.toMatchObject({ name: 'AuthorizationError' });
    db[model].findUnique.mockResolvedValue({ [ownerField]: salesperson.id });
    await expect(guard(salesperson, 'own-id')).resolves.toBe(true);
    db[model].findUnique.mockClear();
    await expect(guard(director, 'foreign-id')).resolves.toBe(true);
    expect(db[model].findUnique).not.toHaveBeenCalled();
  });

  it('prevents linking another client’s contact or site to an owned client', async () => {
    db.client.findUnique.mockResolvedValue({ assignedToId: salesperson.id });
    db.contact.findUnique.mockResolvedValue({ clientId: 'another-client' });
    db.site.findUnique.mockResolvedValue({ clientId: 'another-client' });
    await expect(assertClientRelations(salesperson, { clientId: 'mine', contactId: 'foreign' })).rejects.toMatchObject({ name: 'AuthorizationError' });
    await expect(assertClientRelations(salesperson, { clientId: 'mine', siteId: 'foreign' })).rejects.toMatchObject({ name: 'AuthorizationError' });
  });

  it('returns only the signed-in account to a salesperson, and the whole team to a director', async () => {
    db.user.findMany.mockResolvedValue([]);
    db.appSetting.findMany.mockResolvedValue([]);
    db.office.findMany.mockResolvedValue([]);
    await users();
    expect(db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: salesperson.id } }));
    auth.mockResolvedValue(director);
    await users();
    // The whole team, except employees who were removed (their accounts are kept as deleted+…)
    expect(db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { NOT: { email: { startsWith: 'deleted+' } } } }));
  });

  it('denies another salesperson’s client profile before loading any nested records', async () => {
    db.client.findUnique.mockResolvedValue({ assignedToId: 'sales-b' });
    const response = await clientProfile(new Request('http://localhost/api/clients/foreign'), { params: Promise.resolve({ id: 'foreign' }) });
    expect(response.status).toBe(403);
    expect(db.client.findUnique).toHaveBeenCalledTimes(1);
    expect(db.directorComment.findMany).not.toHaveBeenCalled();
  });

  it('scopes all collections in an owned client profile to the salesperson', async () => {
    db.client.findUnique.mockResolvedValueOnce({ assignedToId: salesperson.id }).mockResolvedValueOnce({
      id: 'mine', enquiries: [], quotations: [], orders: [], receipts: [],
    });
    const response = await clientProfile(new Request('http://localhost/api/clients/mine'), { params: Promise.resolve({ id: 'mine' }) });
    expect(response.status).toBe(200);
    const include = db.client.findUnique.mock.calls[1][0].include;
    expect(include.enquiries.where).toEqual({ assignedToId: salesperson.id });
    expect(include.quotations.where).toEqual({ salespersonId: salesperson.id });
    expect(include.orders.where).toEqual({ assignedSalespersonId: salesperson.id });
    expect(include.tasks.where).toEqual({ assignedSalespersonId: salesperson.id });
    expect(include.activities.where).toEqual({ salespersonId: salesperson.id });
    expect(include.invoices.where).toEqual({ order: { assignedSalespersonId: salesperson.id } });
  });

  it.each([
    ['activity', activity, { clientId: 'foreign', activityType: 'CALL', outcome: 'Connected', keyPoints: 'Test' }],
    ['invoice', invoice, { clientId: 'foreign', orderId: 'foreign', dueDate: '2026-10-24', grossAmount: 100 }],
    ['receipt', receipt, { clientId: 'foreign', amount: 100, paymentMode: 'CASH' }],
    ['direct order', order, { clientId: 'foreign', isDirectOrder: true }],
    ['existing client selection', client, { existingClientId: 'foreign' }],
    ['quotation', quotation, { clientId: 'foreign', enquiryId: 'foreign', quotationNo: '123' }],
  ] as const)('blocks forged ownership in %s creation before any write', async (_, handler, body) => {
    db.client.findUnique.mockResolvedValue({ assignedToId: 'sales-b' });
    db.order.findUnique.mockResolvedValue({ assignedSalespersonId: 'sales-b' });
    const response = await handler(post(body));
    expect(response.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('limits untargeted director notes to owned records', async () => {
    db.client.findMany.mockResolvedValue([{ id: 'my-client' }]);
    const visibility = await commentVisibility(salesperson);
    expect(visibility).toMatchObject({ AND: [
      { OR: [{ targetSalespersonId: salesperson.id }, { targetSalespersonId: null }] },
      { OR: expect.arrayContaining([{ entityType: 'CLIENT', entityId: { in: ['my-client'] } }]) },
    ] });
    expect(await commentVisibility(director)).toEqual({});
  });

  it('does not reveal another client’s name through a code conflict', async () => {
    db.client.findUnique.mockResolvedValue({ id: 'foreign', name: 'Private Client' });
    db.client.findMany.mockResolvedValue([{ code: 'ACME' }]);
    const result = await checkClientCode(db as any, 'ACME', undefined, false);
    expect(JSON.stringify(result)).not.toContain('Private Client');
    expect(result.error).toContain('already in use');
  });

  it('keeps recycle-bin ownership separate from who deleted the item', () => {
    expect(binVisibilityFilter(salesperson)).toEqual({ ownerId: salesperson.id });
    expect(binVisibilityFilter(director)).toEqual({});
  });
});
