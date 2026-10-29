import { NotificationType, Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { notify, sendPush } from '@/lib/notify';
import { pushCategoriesOf } from '@/lib/notificationCategories';
import { humanize } from '@/lib/utils';

/**
 * Directors hear about every update: each change in the change log, each discussion logged and each
 * follow-up set. The worker picks up what is new since its last run and adds it to every director's
 * notification list, except their own changes. The kinds a director ticked in Settings also buzz their
 * phone; when a run finds more than three, they get one message with the count instead of one each, and
 * more than fifty (an import) are listed as one notification per kind.
 */

const CURSOR_KEY = 'notifications.directorFeedCursor';
// Changes are read up to this long ago, so rows written inside a transaction that is still open are not skipped
const SETTLE_MS = 15 * 1000;
const PUSH_ONE_BY_ONE = 3;
// More than this in one run (e.g. an Excel import) are listed as one notification per kind, with the count
const LIST_ONE_BY_ONE = 50;

type Update = { at: Date; actorId: string; category: string; title: string; message: string; link: string | null };

const CATEGORY_OF: Record<string, string> = {
  CLIENT: 'CLIENTS',
  ENQUIRY: 'ENQUIRIES',
  TASK: 'FOLLOW_UPS',
  ACTIVITY: 'FOLLOW_UPS',
  QUOTATION: 'QUOTATIONS',
  QUOTATION_VERSION: 'QUOTATIONS',
  ORDER: 'ORDERS',
  ORDER_SPLIT: 'ORDERS',
  INVOICE: 'PAYMENTS',
  RECEIPT: 'PAYMENTS',
  TARGET: 'TARGETS',
  INCENTIVE_ENTRY: 'TARGETS',
  INCENTIVE_RATE: 'TARGETS',
  USER: 'TEAM',
  SETTINGS: 'TEAM',
};

const ENTITY_LABEL: Record<string, string> = {
  CLIENT: 'Client',
  ENQUIRY: 'Requirement',
  TASK: 'Follow-up',
  QUOTATION: 'Quotation',
  QUOTATION_VERSION: 'Quotation revision',
  ORDER: 'Order',
  ORDER_SPLIT: 'Order split',
  INVOICE: 'Invoice',
  RECEIPT: 'Payment',
  TARGET: 'Target',
  INCENTIVE_ENTRY: 'Incentive',
  INCENTIVE_RATE: 'Incentive rate',
  USER: 'Team member',
  SETTINGS: 'Setting',
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'added',
  UPDATE: 'updated',
  DELETE: 'deleted',
  REASSIGN: 'reassigned',
  STAGE_CHANGE: 'moved',
  APPROVE: 'approved',
  REJECT: 'rejected',
  VERIFY: 'verified',
  RESCHEDULE: 'rescheduled',
  PAYOUT: 'paid',
  RESTORE: 'restored',
  PURGE: 'deleted for good',
};

// The most telling detail of a change, e.g. its label, the client's name or the order number
function detailOf(details: any): string {
  if (!details || typeof details !== 'object') return '';
  for (const k of ['label', 'name', 'title', 'enquiryNumber', 'orderNumber', 'quotationNumber', 'invoiceNumber', 'receiptNumber', 'taskNumber']) {
    if (typeof details[k] === 'string' && details[k].trim()) return details[k].trim();
  }
  return '';
}

/** What changed since `since` (up to `until`), oldest first. */
async function updatesBetween(since: Date, until: Date): Promise<Update[]> {
  const during = { gt: since, lte: until };
  const [events, activities, tasks] = await Promise.all([
    prisma.auditEvent.findMany({ where: { createdAt: during }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.activity.findMany({
      where: { createdAt: during },
      include: { salesperson: { select: { name: true } }, client: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: { createdAt: during },
      include: { createdBy: { select: { name: true } }, assignedSalesperson: { select: { name: true } }, client: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Pages to open: the client for requirements and follow-ups, else the record's own page
  const enquiryIds = events.filter((e) => e.entityType === 'ENQUIRY').map((e) => e.entityId);
  const taskIds = events.filter((e) => e.entityType === 'TASK').map((e) => e.entityId);
  const [enquiries, eventTasks] = await Promise.all([
    enquiryIds.length ? prisma.enquiry.findMany({ where: { id: { in: enquiryIds } }, select: { id: true, clientId: true } }) : [],
    taskIds.length ? prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, clientId: true } }) : [],
  ]);
  const clientOf = new Map([...enquiries, ...eventTasks].map((r) => [r.id, r.clientId]));
  const linkOf = (entityType: string, entityId: string): string | null => {
    switch (entityType) {
      case 'CLIENT':
        return `/clients/${entityId}`;
      case 'ENQUIRY':
      case 'TASK':
        return clientOf.has(entityId) ? `/clients/${clientOf.get(entityId)}` : null;
      case 'QUOTATION':
      case 'QUOTATION_VERSION':
        return '/proposals';
      case 'ORDER':
      case 'ORDER_SPLIT':
      case 'INVOICE':
      case 'RECEIPT':
        return '/orders';
      case 'TARGET':
      case 'INCENTIVE_ENTRY':
      case 'INCENTIVE_RATE':
        return '/targets';
      case 'USER':
      case 'SETTINGS':
        return '/settings';
      default:
        return null;
    }
  };

  const updates: Update[] = [
    ...events.map((e) => {
      const entity = ENTITY_LABEL[e.entityType] || humanize(e.entityType);
      const detail = detailOf(e.details);
      return {
        at: e.createdAt,
        actorId: e.actorId,
        category: ['DELETE', 'PURGE', 'RESTORE'].includes(e.action) ? 'DELETIONS' : CATEGORY_OF[e.entityType] || 'TEAM',
        title: `${entity} ${ACTION_LABEL[e.action] || humanize(e.action).toLowerCase()}`,
        message: `${e.actor.name}${detail ? `: ${detail}` : ''}`,
        link: linkOf(e.entityType, e.entityId),
      };
    }),
    ...activities.map((a) => ({
      at: a.createdAt,
      actorId: a.salespersonId,
      category: 'FOLLOW_UPS',
      title: `${humanize(a.activityType)} logged · ${a.client.name}`,
      message: `${a.salesperson.name}: ${a.outcome}${a.keyPoints ? ` – ${a.keyPoints}` : ''}`.slice(0, 300),
      link: `/clients/${a.clientId}`,
    })),
    ...tasks.map((t) => ({
      at: t.createdAt,
      actorId: t.createdById,
      category: 'FOLLOW_UPS',
      title: `Follow-up set · ${t.client.name}`,
      message: `${t.createdBy.name}${t.createdById !== t.assignedSalespersonId ? ` for ${t.assignedSalesperson.name}` : ''}: ${humanize(t.actionType)} on ${t.dueDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`,
      link: `/clients/${t.clientId}`,
    })),
  ];
  return updates.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Tell the directors about everything new since the last run. Returns how many notifications were added. */
export async function processDirectorFeed(now: Date = new Date()): Promise<number> {
  const until = new Date(now.getTime() - SETTLE_MS);
  const saved = await prisma.appSetting.findUnique({ where: { key: CURSOR_KEY } });
  const since = saved ? new Date((saved.value as { at: string }).at) : null;
  // The first run starts from now, so the directors are not sent the whole history
  if (!since || until <= since) {
    if (!since) await prisma.appSetting.create({ data: { key: CURSOR_KEY, value: { at: until.toISOString() } } });
    return 0;
  }

  const updates = await updatesBetween(since, until);
  const directors = await prisma.user.findMany({ where: { role: Role.DIRECTOR, isActive: true }, select: { id: true, pushCategories: true } });
  let added = 0;
  for (const director of directors) {
    const theirs = updates.filter((u) => u.actorId !== director.id);
    const buzz = pushCategoriesOf(director.pushCategories);
    const toPush = theirs.filter((u) => buzz.includes(u.category));
    const oneByOne = toPush.length <= PUSH_ONE_BY_ONE;
    if (theirs.length > LIST_ONE_BY_ONE) {
      const byKind = new Map<string, Update[]>();
      for (const u of theirs) byKind.set(u.category, [...(byKind.get(u.category) || []), u]);
      for (const [category, list] of byKind) {
        const people = [...new Set(list.map((u) => u.message.split(':')[0]))];
        await notify({
          userId: director.id,
          title: `${list.length} updates · ${humanize(category)}`,
          message: `By ${people.slice(0, 3).join(', ')}${people.length > 3 ? ` and ${people.length - 3} more` : ''}. Latest: ${list[list.length - 1].title}`,
          type: NotificationType.ACTIVITY_UPDATE,
          category,
          push: false,
        });
        added += 1;
      }
    } else {
      for (const u of theirs) {
        await notify({ userId: director.id, title: u.title, message: u.message, type: NotificationType.ACTIVITY_UPDATE, link: u.link, category: u.category, push: oneByOne && toPush.includes(u) });
        added += 1;
      }
    }
    if (!oneByOne) {
      await sendPush([director.id], {
        title: `${toPush.length} new updates`,
        body: toPush.slice(-3).map((u) => `${u.title} (${u.message.split(':')[0]})`).join(' · '),
        link: '/dashboard',
        tag: `feed-${until.getTime()}`,
      });
    }
  }
  await prisma.appSetting.update({ where: { key: CURSOR_KEY }, data: { value: { at: until.toISOString() } } });
  return added;
}
