import webpush from 'web-push';
import { NotificationType } from '@prisma/client';
import prisma from '@/lib/prisma';

/**
 * Notifications: each one is kept in the person's notification list (the bell) and, when asked, also sent
 * as a push message to every phone or browser where they turned phone notifications on. Push needs the
 * VAPID keys in the environment; without them only the list is used.
 */

let pushConfigured: boolean | null = null;

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function pushReady(): boolean {
  if (pushConfigured === null) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    pushConfigured = !!(publicKey && privateKey);
    if (pushConfigured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:notifications@nirmaanwater.com', publicKey!, privateKey!);
  }
  return pushConfigured;
}

export type PushMessage = { title: string; body: string; link?: string | null; tag?: string };

/**
 * Send a push message to every device of these people. Devices the push service no longer knows (the app
 * was removed or permission withdrawn) are forgotten. Returns how many devices it reached.
 */
export async function sendPush(userIds: string[], message: PushMessage): Promise<number> {
  if (!userIds.length || !pushReady()) return 0;
  const devices = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  let reached = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(message), { TTL: 12 * 60 * 60 });
        reached += 1;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => undefined);
        } else {
          console.error(`Push to a device of user ${d.userId} failed:`, err?.statusCode || '', err?.body || err?.message);
        }
      }
    })
  );
  return reached;
}

/** Add a notification to someone's list and, with push: true, send it to their phone too. */
export async function notify(n: {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string | null;
  category?: string | null;
  taskId?: string | null;
  scheduledFor?: Date;
  push: boolean;
}) {
  const created = await prisma.notification.create({
    data: {
      userId: n.userId,
      title: n.title,
      message: n.message,
      type: n.type,
      link: n.link ?? null,
      category: n.category ?? null,
      taskId: n.taskId ?? null,
      scheduledFor: n.scheduledFor ?? new Date(),
      deliveries: { create: [{ channel: 'IN_APP', status: 'SENT', attempts: 1 }] },
    },
  });
  if (n.push) {
    const reached = await sendPush([n.userId], { title: n.title, body: n.message, link: n.link, tag: created.id });
    if (reached) await prisma.notificationDelivery.create({ data: { notificationId: created.id, channel: 'PUSH', status: 'SENT', attempts: 1 } });
  }
  return created;
}
