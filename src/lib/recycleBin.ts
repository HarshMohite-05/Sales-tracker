import { canPermanentlyDelete } from './recycleBinPermissions';
import prisma from '@/lib/prisma';
import { ApprovalStatus, EnquiryStage, Prisma, QuotationStatus, TaskStatus } from '@prisma/client';
import { UserSession } from '@/lib/auth';
import { nextDocNumber, nextRequirementNumber } from '@/lib/numbering';
import { formatQuotationNumber } from '@/lib/quotation';
import { syncRequirementValue } from '@/lib/requirementValue';
import { humanize } from '@/lib/utils';
import { periodLabel } from '@/lib/targetPeriods';

type Db = typeof prisma | Prisma.TransactionClient;

export const RECYCLE_BIN_RETENTION_DAYS = 5;

export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

// Dates become ISO strings and Decimals become strings, both of which Prisma accepts back on create
function toJson<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Bin items a user may see: directors see everything, salespeople see
 * records that belonged to them.
 */
export function binVisibilityFilter(user: UserSession): Prisma.RecycleBinItemWhereInput {
  if (canPermanentlyDelete(user)) return {};
  return { ownerId: user.id };
}

/**
 * Remove a requirement and keep a restorable snapshot of it in the bin.
 * Callers must already have checked that it has no quotations or orders.
 */
export async function moveEnquiryToBin(tx: Prisma.TransactionClient, user: UserSession, enquiryId: string) {
  const enquiry = await tx.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    include: {
      client: { select: { name: true } },
      stageHistory: true,
      tasks: { include: { rescheduleHistory: true } },
      activities: { select: { id: true } },
    },
  });

  const { client, stageHistory, tasks, activities, ...enquiryRow } = enquiry;
  const pendingTasks = tasks.filter((t) => t.status === TaskStatus.PENDING);
  // Done follow-ups and conversations stay with the client; remember the link so a restore can reattach them
  const linkedTaskIds = tasks.filter((t) => t.status !== TaskStatus.PENDING).map((t) => t.id);

  const item = await tx.recycleBinItem.create({
    data: {
      entityType: 'ENQUIRY',
      entityId: enquiry.id,
      label: `${enquiry.enquiryNumber} · ${enquiry.title}`,
      description: `${pendingTasks.length} pending follow-up${pendingTasks.length === 1 ? '' : 's'}`,
      clientId: enquiry.clientId,
      clientName: client.name,
      ownerId: enquiry.assignedToId,
      deletedById: user.id,
      expiresAt: bump(),
      snapshot: toJson({
        enquiry: enquiryRow,
        stageHistory,
        pendingTasks,
        linkedTaskIds,
        linkedActivityIds: activities.map((a) => a.id),
      }),
    },
  });

  await tx.task.deleteMany({ where: { enquiryId, status: TaskStatus.PENDING } });
  await tx.enquiry.delete({ where: { id: enquiryId } });

  return item;
}

async function restoreEnquiry(tx: Prisma.TransactionClient, snapshot: any) {
  const { enquiry, stageHistory, pendingTasks, linkedTaskIds, linkedActivityIds } = snapshot;

  const client = await tx.client.findUnique({ where: { id: enquiry.clientId }, select: { id: true } });
  if (!client) throw new RestoreError('The client this requirement belonged to no longer exists.');

  // Contacts and sites may have been removed while the requirement sat in the bin
  const contactId = enquiry.contactId && (await tx.contact.findUnique({ where: { id: enquiry.contactId } })) ? enquiry.contactId : null;
  const siteId = enquiry.siteId && (await tx.site.findUnique({ where: { id: enquiry.siteId } })) ? enquiry.siteId : null;

  // Numbering continues from the highest existing number, so the old one may have been reused
  const numberTaken = await tx.enquiry.findUnique({ where: { enquiryNumber: enquiry.enquiryNumber } });
  const enquiryNumber = numberTaken ? await nextRequirementNumber(tx, enquiry.clientId) : enquiry.enquiryNumber;

  await tx.enquiry.create({ data: { ...enquiry, contactId, siteId, enquiryNumber } });

  if (stageHistory.length > 0) {
    await tx.enquiryStageHistory.createMany({ data: stageHistory });
  }

  for (const { rescheduleHistory, ...task } of pendingTasks) {
    const taskNumberTaken = await tx.task.findUnique({ where: { taskNumber: task.taskNumber } });
    const [quotation, order, invoice] = await Promise.all([
      task.quotationId ? tx.quotation.findUnique({ where: { id: task.quotationId } }) : null,
      task.orderId ? tx.order.findUnique({ where: { id: task.orderId } }) : null,
      task.invoiceId ? tx.invoice.findUnique({ where: { id: task.invoiceId } }) : null,
    ]);
    await tx.task.create({
      data: {
        ...task,
        taskNumber: taskNumberTaken ? await nextDocNumber(tx, 'task') : task.taskNumber,
        quotationId: quotation ? task.quotationId : null,
        orderId: order ? task.orderId : null,
        invoiceId: invoice ? task.invoiceId : null,
        reminderSettings: task.reminderSettings ?? Prisma.JsonNull,
      },
    });
    if (rescheduleHistory.length > 0) {
      await tx.taskRescheduleHistory.createMany({ data: rescheduleHistory });
    }
  }

  // Only reattach records nobody has linked to something else in the meantime
  await tx.task.updateMany({ where: { id: { in: linkedTaskIds }, enquiryId: null }, data: { enquiryId: enquiry.id } });
  await tx.activity.updateMany({ where: { id: { in: linkedActivityIds }, enquiryId: null }, data: { enquiryId: enquiry.id } });

  const renumbered = enquiryNumber !== enquiry.enquiryNumber;
  return {
    message: renumbered
      ? `Restored. Its old number was taken, so it is now ${enquiryNumber}.`
      : `Restored ${enquiryNumber}.`,
  };
}

// JSON columns need Prisma.JsonNull rather than null when written back
function jsonOrNull(value: any) {
  return value === null || value === undefined ? Prisma.JsonNull : value;
}

function bump(days = RECYCLE_BIN_RETENTION_DAYS) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Remove a whole quotation (all its revisions) and keep a restorable snapshot in the bin.
 * Callers must already have checked that no order was made from it.
 */
export async function moveQuotationToBin(tx: Prisma.TransactionClient, user: UserSession, quotationId: string) {
  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: {
      client: { select: { name: true } },
      enquiry: { select: { enquiryNumber: true, title: true } },
      versions: { orderBy: { versionNumber: 'asc' } },
      approvals: true,
      tasks: { select: { id: true } },
    },
  });
  const { client, enquiry, versions, approvals, tasks, ...quotationRow } = quotation;

  const item = await tx.recycleBinItem.create({
    data: {
      entityType: 'QUOTATION',
      entityId: quotation.id,
      label: formatQuotationNumber(quotation.quotationNumber, quotation.currentVersionNumber),
      description: `For ${enquiry.enquiryNumber} - ${enquiry.title} · ${versions.length} version${versions.length === 1 ? '' : 's'}`,
      clientId: quotation.clientId,
      clientName: client.name,
      ownerId: quotation.salespersonId,
      deletedById: user.id,
      expiresAt: bump(),
      snapshot: toJson({ quotation: quotationRow, versions, approvals, linkedTaskIds: tasks.map((t) => t.id) }),
    },
  });

  // Versions and approvals cascade; follow-up tasks keep their requirement and just lose the quotation link
  await tx.quotation.delete({ where: { id: quotationId } });
  return item;
}

/**
 * Remove one revision of a quotation and keep it in the bin. If it was the latest,
 * the revision before it becomes current again.
 */
export async function moveQuotationVersionToBin(
  tx: Prisma.TransactionClient,
  user: UserSession,
  quotationId: string,
  versionNumber: number
) {
  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { client: { select: { name: true } }, versions: { orderBy: { versionNumber: 'asc' } } },
  });
  const version = quotation.versions.find((v) => v.versionNumber === versionNumber);
  if (!version) throw new RestoreError('That revision does not exist.');

  const approvals = await tx.quotationApproval.findMany({ where: { quotationVersionId: version.id }, select: { id: true } });

  const item = await tx.recycleBinItem.create({
    data: {
      entityType: 'QUOTATION_VERSION',
      entityId: version.id,
      label: formatQuotationNumber(quotation.quotationNumber, versionNumber),
      description: `Revision of ${quotation.quotationNumber}`,
      clientId: quotation.clientId,
      clientName: quotation.client.name,
      ownerId: quotation.salespersonId,
      deletedById: user.id,
      expiresAt: bump(),
      snapshot: toJson({ version, linkedApprovalIds: approvals.map((a) => a.id) }),
    },
  });

  await tx.quotationVersion.delete({ where: { id: version.id } });

  if (versionNumber === quotation.currentVersionNumber) {
    const previous = [...quotation.versions].reverse().find((v) => v.versionNumber < versionNumber)!;
    await makeVersionCurrent(tx, quotation, previous);
  }
  return item;
}

// Point a quotation's summary at one of its versions and keep only that one editable
async function makeVersionCurrent(tx: Prisma.TransactionClient, quotation: { id: string; approvalStatus: string }, version: any) {
  await tx.quotationVersion.updateMany({ where: { quotationId: quotation.id }, data: { isImmutable: true } });
  await tx.quotationVersion.update({ where: { id: version.id }, data: { isImmutable: false } });

  // A pending approval belonged to the revision that is no longer current
  const wasPending = quotation.approvalStatus === QuotationStatus.PENDING_APPROVAL;
  if (wasPending) {
    await tx.quotationApproval.updateMany({
      where: { quotationId: quotation.id, status: ApprovalStatus.PENDING },
      data: { status: ApprovalStatus.REJECTED, decisionNotes: 'Revision removed' },
    });
  }

  await tx.quotation.update({
    where: { id: quotation.id },
    data: {
      currentVersionNumber: version.versionNumber,
      ...(wasPending ? { approvalStatus: QuotationStatus.DRAFT } : {}),
      originalValue: version.originalValue,
      discountAmount: version.discountAmount,
      discountPercent: version.discountPercent,
      taxAmount: version.taxAmount,
      finalValue: version.finalValue,
      commercialTerms: version.commercialTerms,
      product: version.product,
      paymentTerms: version.paymentTerms,
      paymentStages: jsonOrNull(version.paymentStages),
      transportation: version.transportation,
      remarks: version.remarks,
    },
  });
}

async function restoreQuotation(tx: Prisma.TransactionClient, snapshot: any) {
  const { quotation, versions, approvals, linkedTaskIds } = snapshot;

  const enquiry = await tx.enquiry.findUnique({
    where: { id: quotation.enquiryId },
    include: { quotations: { select: { quotationNumber: true } } },
  });
  if (!enquiry) throw new RestoreError('The requirement this quotation was for no longer exists.');
  if (enquiry.quotations.length > 0) {
    throw new RestoreError(
      `Requirement ${enquiry.enquiryNumber} already has quotation ${enquiry.quotations[0].quotationNumber}. Delete that one first to restore this.`
    );
  }
  if (await tx.quotation.findUnique({ where: { quotationNumber: quotation.quotationNumber } })) {
    throw new RestoreError(`Quotation number ${quotation.quotationNumber} has been used again since, so this can't be restored.`);
  }

  await tx.quotation.create({ data: { ...quotation, paymentStages: jsonOrNull(quotation.paymentStages) } });
  for (const v of versions) {
    await tx.quotationVersion.create({ data: { ...v, lineItems: v.lineItems ?? [], paymentStages: jsonOrNull(v.paymentStages) } });
  }
  if (approvals.length > 0) {
    await tx.quotationApproval.createMany({ data: approvals });
  }
  await tx.task.updateMany({ where: { id: { in: linkedTaskIds }, quotationId: null }, data: { quotationId: quotation.id } });
  await syncRequirementValue(tx, quotation.enquiryId);

  return { message: `Restored ${formatQuotationNumber(quotation.quotationNumber, quotation.currentVersionNumber)}.` };
}

async function restoreQuotationVersion(tx: Prisma.TransactionClient, snapshot: any) {
  const { version, linkedApprovalIds } = snapshot;

  const quotation = await tx.quotation.findUnique({ where: { id: version.quotationId } });
  if (!quotation) throw new RestoreError('The quotation this revision belonged to no longer exists.');
  if (quotation.approvalStatus === QuotationStatus.ACCEPTED) {
    throw new RestoreError('An order has been confirmed from this quotation since, so the revision cannot be put back.');
  }
  const taken = await tx.quotationVersion.findUnique({
    where: { quotationId_versionNumber: { quotationId: quotation.id, versionNumber: version.versionNumber } },
  });
  const label = formatQuotationNumber(quotation.quotationNumber, version.versionNumber);
  if (taken) throw new RestoreError(`${label} has been created again since, so this one can't be restored.`);

  const restored = await tx.quotationVersion.create({
    data: { ...version, lineItems: version.lineItems ?? [], paymentStages: jsonOrNull(version.paymentStages) },
  });
  await tx.quotationApproval.updateMany({
    where: { id: { in: linkedApprovalIds }, quotationVersionId: null },
    data: { quotationVersionId: restored.id },
  });

  if (version.versionNumber > quotation.currentVersionNumber) {
    await makeVersionCurrent(tx, quotation, restored);
  } else {
    await tx.quotationVersion.update({ where: { id: restored.id }, data: { isImmutable: true } });
  }
  await syncRequirementValue(tx, quotation.enquiryId);
  return { message: `Restored ${label}.` };
}

/**
 * Remove an order with its payment stages, execution steps, receipts and invoices, and keep a
 * restorable snapshot in the bin. The quotation it was confirmed from goes back to Approved and a
 * requirement it marked as Won goes back to its earlier stage, so both can be changed or deleted again.
 * Callers must already have checked that no payment on it still counts.
 */
export async function moveOrderToBin(tx: Prisma.TransactionClient, user: UserSession, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      client: { select: { name: true } },
      payments: true,
      executionSteps: true,
      deliveryRevisions: true,
      receipts: true,
      invoices: true,
      tasks: { select: { id: true } },
    },
  });
  const { client, payments, executionSteps, deliveryRevisions, receipts, invoices, tasks, ...orderRow } = order;

  // The stage change this order made when it was confirmed, if the requirement is still Won by it
  let wonChange: { enquiryId: string; fromStage: EnquiryStage } | null = null;
  if (order.enquiryId) {
    const [enquiry, otherOrders, history] = await Promise.all([
      tx.enquiry.findUnique({ where: { id: order.enquiryId }, select: { stage: true } }),
      tx.order.count({ where: { enquiryId: order.enquiryId, id: { not: orderId } } }),
      tx.enquiryStageHistory.findFirst({
        where: { enquiryId: order.enquiryId, toStage: EnquiryStage.WON, reason: `Won via confirmed order ${order.orderNumber}` },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (enquiry?.stage === EnquiryStage.WON && otherOrders === 0 && history) {
      wonChange = { enquiryId: order.enquiryId, fromStage: history.fromStage as EnquiryStage };
    }
  }

  const item = await tx.recycleBinItem.create({
    data: {
      entityType: 'ORDER',
      entityId: order.id,
      label: order.orderNumber,
      description: `PO ${order.clientPoNumber ?? '-'} · ${receipts.length} payment${receipts.length === 1 ? '' : 's'} (reversed)`,
      clientId: order.clientId,
      clientName: client.name,
      ownerId: order.assignedSalespersonId,
      deletedById: user.id,
      expiresAt: bump(),
      snapshot: toJson({
        order: orderRow,
        payments,
        executionSteps,
        deliveryRevisions,
        receipts,
        invoices,
        linkedTaskIds: tasks.map((t) => t.id),
        wonChange,
      }),
    },
  });

  // Stages, steps, delivery revisions, receipts and invoices cascade; tasks keep their client and just lose the order link
  await tx.order.delete({ where: { id: orderId } });

  if (order.quotationId) {
    await tx.quotation.updateMany({
      where: { id: order.quotationId, approvalStatus: QuotationStatus.ACCEPTED },
      data: { approvalStatus: QuotationStatus.APPROVED, closedAt: null },
    });
  }
  if (wonChange) {
    await tx.enquiry.update({ where: { id: wonChange.enquiryId }, data: { stage: wonChange.fromStage } });
    await tx.enquiryStageHistory.create({
      data: {
        enquiryId: wonChange.enquiryId,
        fromStage: EnquiryStage.WON,
        toStage: wonChange.fromStage,
        reason: `Order ${order.orderNumber} deleted`,
        changedById: user.id,
      },
    });
  }
  return item;
}

async function restoreOrder(tx: Prisma.TransactionClient, snapshot: any, user: { id: string }) {
  // Orders binned before delivery revisions were tracked have none in their snapshot
  const { order, payments, executionSteps, deliveryRevisions = [], receipts, invoices, linkedTaskIds, wonChange } = snapshot;

  const client = await tx.client.findUnique({ where: { id: order.clientId }, select: { id: true } });
  if (!client) throw new RestoreError('The client this order belonged to no longer exists.');
  if (await tx.order.findUnique({ where: { orderNumber: order.orderNumber } })) {
    throw new RestoreError(`Order number ${order.orderNumber} has been used again since, so this can't be restored.`);
  }
  for (const inv of invoices) {
    if (await tx.invoice.findUnique({ where: { invoiceNumber: inv.invoiceNumber } })) {
      throw new RestoreError(`Invoice number ${inv.invoiceNumber} has been used again since, so this can't be restored.`);
    }
  }

  // The requirement, quotation and version may have been removed while the order sat in the bin
  const [enquiry, quotation, version] = await Promise.all([
    order.enquiryId ? tx.enquiry.findUnique({ where: { id: order.enquiryId } }) : null,
    order.quotationId ? tx.quotation.findUnique({ where: { id: order.quotationId } }) : null,
    order.quotationVersionId ? tx.quotationVersion.findUnique({ where: { id: order.quotationVersionId } }) : null,
  ]);

  await tx.order.create({
    data: {
      ...order,
      enquiryId: enquiry ? order.enquiryId : null,
      quotationId: quotation ? order.quotationId : null,
      quotationVersionId: version ? order.quotationVersionId : null,
      items: order.items ?? [],
      paymentStages: jsonOrNull(order.paymentStages),
    },
  });
  if (payments.length > 0) await tx.orderPaymentStage.createMany({ data: payments });
  if (executionSteps.length > 0) await tx.orderExecutionStep.createMany({ data: executionSteps });
  if (deliveryRevisions.length > 0) await tx.orderDeliveryRevision.createMany({ data: deliveryRevisions });
  if (receipts.length > 0) await tx.orderReceipt.createMany({ data: receipts });
  if (invoices.length > 0) await tx.invoice.createMany({ data: invoices });
  await tx.task.updateMany({ where: { id: { in: linkedTaskIds }, orderId: null }, data: { orderId: order.id } });

  if (quotation) {
    await tx.quotation.update({ where: { id: quotation.id }, data: { approvalStatus: QuotationStatus.ACCEPTED, closedAt: new Date() } });
  }
  if (enquiry && wonChange && enquiry.stage !== EnquiryStage.WON) {
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stage: EnquiryStage.WON } });
    await tx.enquiryStageHistory.create({
      data: {
        enquiryId: enquiry.id,
        fromStage: enquiry.stage,
        toStage: EnquiryStage.WON,
        reason: `Won via confirmed order ${order.orderNumber}`,
        changedById: user.id,
      },
    });
  }
  return { message: `Restored ${order.orderNumber}.` };
}

/**
 * Remove a target and keep it in the bin. Higher targets set after it was achieved go with it, as they
 * only exist on top of it; deleting the newest one makes the one before it current again.
 */
export async function moveTargetToBin(tx: Prisma.TransactionClient, user: UserSession, targetId: string) {
  const target = await tx.target.findUniqueOrThrow({ where: { id: targetId }, include: { salesperson: { select: { name: true } } } });
  const { salesperson, ...targetRow } = target;
  const higher = await tx.target.findMany({
    where: {
      salespersonId: target.salespersonId,
      financialYear: target.financialYear,
      periodKey: target.periodKey,
      targetType: target.targetType,
      level: { gt: target.level },
    },
    orderBy: { level: 'asc' },
  });

  const item = await tx.recycleBinItem.create({
    data: {
      entityType: 'TARGET',
      entityId: target.id,
      label: `${humanize(target.targetType)} target · ${salesperson.name}`,
      description: `${target.financialYear} · ${periodLabel(target.financialYear, target.periodType, target.periodKey)}${
        higher.length ? ` · with ${higher.length} higher target${higher.length === 1 ? '' : 's'} set after it` : ''
      }`,
      // Targets are the director's to manage, so the bin item is not shown to the salesperson
      ownerId: null,
      deletedById: user.id,
      expiresAt: bump(),
      snapshot: toJson({ targets: [targetRow, ...higher] }),
    },
  });

  await tx.target.deleteMany({ where: { id: { in: [target.id, ...higher.map((t) => t.id)] } } });
  return item;
}

async function restoreTargets(tx: Prisma.TransactionClient, snapshot: any) {
  const { targets } = snapshot as { targets: any[] };
  const [first] = targets;

  const salesperson = await tx.user.findUnique({ where: { id: first.salespersonId }, select: { id: true } });
  if (!salesperson) throw new RestoreError('The salesperson this target belonged to no longer exists.');
  const taken = await tx.target.findFirst({
    where: {
      salespersonId: first.salespersonId,
      financialYear: first.financialYear,
      periodKey: first.periodKey,
      targetType: first.targetType,
      level: { in: targets.map((t) => t.level) },
    },
  });
  if (taken) throw new RestoreError('A target has been set again for this salesperson, type and period since, so this one cannot be restored.');

  await tx.target.createMany({ data: targets });
  return { message: `Restored ${targets.length === 1 ? 'the target' : `${targets.length} targets`}.` };
}

/**
 * Put a bin item's record back and remove it from the bin.
 */
export async function restoreBinItem(tx: Prisma.TransactionClient, itemId: string, user: { id: string }) {
  const item = await tx.recycleBinItem.findUnique({ where: { id: itemId } });
  if (!item) throw new RestoreError('This item is no longer in the recycle bin.');

  let result;
  switch (item.entityType) {
    case 'ENQUIRY':
      result = await restoreEnquiry(tx, item.snapshot);
      break;
    case 'QUOTATION':
      result = await restoreQuotation(tx, item.snapshot);
      break;
    case 'QUOTATION_VERSION':
      result = await restoreQuotationVersion(tx, item.snapshot);
      break;
    case 'ORDER':
      result = await restoreOrder(tx, item.snapshot, user);
      break;
    case 'TARGET':
      result = await restoreTargets(tx, item.snapshot);
      break;
    default:
      throw new RestoreError(`Items of type ${item.entityType} cannot be restored.`);
  }

  await tx.recycleBinItem.delete({ where: { id: itemId } });
  return { item, ...result };
}

/**
 * Permanently remove everything that has been in the bin longer than the retention period.
 */
export async function purgeExpiredBinItems(db: Db = prisma) {
  const { count } = await db.recycleBinItem.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
