import { Role } from '@prisma/client';
import { UserSession } from './auth';
import prisma from './prisma';

export class AuthorizationError extends Error {
  constructor(message: string = 'Access denied: insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** A signed-in salesperson cannot attach their records to somebody else's client or related data. */
export async function assertClientRelations(user: UserSession, links: { clientId: string; enquiryId?: string | null; contactId?: string | null; siteId?: string | null }) {
  await assertClientAccess(user, links.clientId);
  if (links.enquiryId) {
    await assertEnquiryAccess(user, links.enquiryId);
    const enquiry = await prisma.enquiry.findUnique({ where: { id: links.enquiryId }, select: { clientId: true } });
    if (!enquiry || enquiry.clientId !== links.clientId) throw new AuthorizationError('The requirement does not belong to the selected client.');
  }
  if (links.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: links.contactId }, select: { clientId: true } });
    if (!contact || contact.clientId !== links.clientId) throw new AuthorizationError('The contact does not belong to the selected client.');
  }
  if (links.siteId) {
    const site = await prisma.site.findUnique({ where: { id: links.siteId }, select: { clientId: true } });
    if (!site || site.clientId !== links.clientId) throw new AuthorizationError('The site does not belong to the selected client.');
  }
}

/** Untargeted notes are visible only when they relate to this salesperson's records. */
export async function commentVisibility(user: UserSession) {
  if (user.role === Role.DIRECTOR) return {};
  const [clients, enquiries, quotations, orders] = await Promise.all([
    prisma.client.findMany({ where: { assignedToId: user.id }, select: { id: true } }),
    prisma.enquiry.findMany({ where: { assignedToId: user.id }, select: { id: true } }),
    prisma.quotation.findMany({ where: { salespersonId: user.id }, select: { id: true } }),
    prisma.order.findMany({ where: { assignedSalespersonId: user.id }, select: { id: true } }),
  ]);
  return { AND: [
    { OR: [{ targetSalespersonId: user.id }, { targetSalespersonId: null }] },
    { OR: [
      { entityType: 'CLIENT', entityId: { in: clients.map((record) => record.id) } },
      { entityType: 'ENQUIRY', entityId: { in: enquiries.map((record) => record.id) } },
      { entityType: 'QUOTATION', entityId: { in: quotations.map((record) => record.id) } },
      { entityType: 'ORDER', entityId: { in: orders.map((record) => record.id) } },
    ] },
  ] };
}

/**
 * Check if the user can access or modify a Client
 */
export async function assertClientAccess(user: UserSession, clientId: string): Promise<boolean> {
  if (user.role === Role.DIRECTOR) return true;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { assignedToId: true },
  });

  if (!client || client.assignedToId !== user.id) {
    throw new AuthorizationError('You do not have permission to access this client.');
  }
  return true;
}

/**
 * Check if the user can access or modify an Enquiry
 */
export async function assertEnquiryAccess(user: UserSession, enquiryId: string): Promise<boolean> {
  if (user.role === Role.DIRECTOR) return true;

  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: { assignedToId: true },
  });

  if (!enquiry || enquiry.assignedToId !== user.id) {
    throw new AuthorizationError('This requirement belongs to another salesperson.');
  }
  return true;
}

/**
 * Check if the user can access or complete a Task
 * Rule: Customer follow-ups are performed by salespeople only.
 */
export async function assertTaskAccess(user: UserSession, taskId: string): Promise<boolean> {
  if (user.role === Role.DIRECTOR) return true;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assignedSalespersonId: true },
  });

  if (!task || task.assignedSalespersonId !== user.id) {
    throw new AuthorizationError('You do not have permission to access or complete this task.');
  }
  return true;
}

/**
 * Check if user can access or modify a Quotation
 */
export async function assertQuotationAccess(user: UserSession, quotationId: string): Promise<boolean> {
  if (user.role === Role.DIRECTOR) return true;

  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { salespersonId: true },
  });

  if (!quote || quote.salespersonId !== user.id) {
    throw new AuthorizationError('You do not have permission to access this quotation.');
  }
  return true;
}

/**
 * Check if user can access an Order
 */
export async function assertOrderAccess(user: UserSession, orderId: string): Promise<boolean> {
  if (user.role === Role.DIRECTOR) return true;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { assignedSalespersonId: true },
  });

  if (!order || order.assignedSalespersonId !== user.id) {
    throw new AuthorizationError('You do not have permission to access this order.');
  }
  return true;
}
