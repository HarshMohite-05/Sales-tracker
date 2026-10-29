import { PrismaClient, TaskStatus, NotificationType, Role } from '@prisma/client';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import { notify } from '../lib/notify';
import { sendMorningSummaries } from '../lib/morningSummary';
import { processDirectorFeed } from '../lib/directorFeed';
import { pushCategoriesOf } from '../lib/notificationCategories';
import { humanize, TIMEZONE } from '../lib/utils';

const prisma = new PrismaClient();

// Setup optional nodemailer transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '2525', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

// A follow-up's salesperson is alerted this long before it is due, and again when it falls due
const REMIND_BEFORE_MS = 30 * 60 * 1000;
// Follow-ups that fell due longer ago than this get no due alert (they are in the morning summary instead),
// so turning the worker on does not alert every old overdue follow-up at once
const DUE_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

const clock = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

export async function processTaskReminders() {
  console.log(`[${new Date().toISOString()}] 🔔 Running Task Reminder & Escalation Check...`);

  const now = new Date();
  const escalationThresholdHours = parseInt(process.env.OVERDUE_ESCALATION_HOURS || '24', 10);
  const overdueCutoff = new Date(now.getTime() - escalationThresholdHours * 60 * 60 * 1000);

  // 1. Fetch pending tasks that are due soon or already overdue
  const pendingTasks = await prisma.task.findMany({
    where: {
      status: TaskStatus.PENDING,
    },
    include: {
      assignedSalesperson: true,
      client: true,
      enquiry: true,
      notifications: true,
    },
  });

  // 2. Fetch both directors for escalations
  const directors = await prisma.user.findMany({
    where: {
      role: Role.DIRECTOR,
      isActive: true,
    },
  });

  let notificationsCreated = 0;
  let escalationsCreated = 0;

  for (const task of pendingTasks) {
    const isOverdueForEscalation = task.dueDateTime.getTime() <= overdueCutoff.getTime();

    // A. The salesperson's alerts: 30 minutes before, then when due. Each is sent once for the follow-up's
    // current due time, so a rescheduled follow-up is alerted again for its new time.
    const sentFor = (category: string) =>
      task.notifications.some((n) => n.userId === task.assignedSalespersonId && n.category === category && n.scheduledFor.getTime() === task.dueDateTime.getTime());
    const dueIn = task.dueDateTime.getTime() - now.getTime();
    const alert =
      dueIn > 0 && dueIn <= REMIND_BEFORE_MS && !sentFor('FOLLOWUP_SOON')
        ? { category: 'FOLLOWUP_SOON', title: `Follow-up at ${clock(task.dueDateTime)}: ${humanize(task.actionType)} · ${task.client.name}` }
        : dueIn <= 0 && -dueIn <= DUE_ALERT_WINDOW_MS && !sentFor('FOLLOWUP_DUE')
          ? { category: 'FOLLOWUP_DUE', title: `Follow-up due now: ${humanize(task.actionType)} · ${task.client.name}` }
          : null;

    if (alert) {
      const notif = await notify({
        userId: task.assignedSalespersonId,
        taskId: task.id,
        title: alert.title,
        message: `${task.taskNumber}: ${task.description}`,
        type: NotificationType.REMINDER,
        category: alert.category,
        link: `/clients/${task.clientId}`,
        scheduledFor: task.dueDateTime,
        push: true,
      });
      notificationsCreated++;

      // Dispatch email if enabled
      if (process.env.ENABLE_EMAIL_DISPATCH === 'true' && task.assignedSalesperson.email) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'notifications@nirmaanwater.com',
            to: task.assignedSalesperson.email,
            subject: `[CRM Reminder] ${task.taskNumber}: ${task.actionType} for ${task.client.name}`,
            text: `Hello ${task.assignedSalesperson.name},\n\nYou have a follow-up task due:\nClient: ${task.client.name}\nAction: ${task.actionType}\nDescription: ${task.description}\nDeadline: ${task.dueDateTime.toISOString()}\n\nPlease update your discussion notes once completed.`,
          });
          await prisma.notificationDelivery.create({
            data: {
              notificationId: notif.id,
              channel: 'EMAIL',
              status: 'SENT',
              attempts: 1,
            },
          });
        } catch (err: any) {
          console.error(`Email delivery failed for notification ${notif.id}:`, err?.message);
          await prisma.notificationDelivery.create({
            data: {
              notificationId: notif.id,
              channel: 'EMAIL',
              status: 'FAILED',
              attempts: 1,
              errorDetails: err?.message || 'SMTP delivery failure',
            },
          });
        }
      }
    }

    // B. Check if Overdue Escalation to BOTH Directors is triggered
    // Requirement: Overdue escalation informs both directors; task responsibility remains with the salesperson.
    if (isOverdueForEscalation) {
      for (const director of directors) {
        const existingEscalation = task.notifications.find(
          (n) => n.userId === director.id && n.type === NotificationType.OVERDUE_ESCALATION
        );

        if (!existingEscalation) {
          await notify({
            userId: director.id,
            taskId: task.id,
            title: `[OVERDUE ESCALATION] ${task.taskNumber} - ${task.client.name}`,
            message: `Task assigned to ${task.assignedSalesperson.name} has exceeded the overdue threshold of ${escalationThresholdHours} hours. Deadline was ${task.dueDateTime.toLocaleString('en-IN', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })}.`,
            type: NotificationType.OVERDUE_ESCALATION,
            category: 'ESCALATIONS',
            link: `/clients/${task.clientId}`,
            push: pushCategoriesOf(director.pushCategories).includes('ESCALATIONS'),
          });
          escalationsCreated++;
        }
      }
    }
  }

  // 3. Cancel obsolete notifications for completed or cancelled tasks
  const completedOrCancelledTasks = await prisma.task.findMany({
    where: {
      status: { in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
    },
    select: { id: true },
  });

  const taskIds = completedOrCancelledTasks.map((t) => t.id);
  if (taskIds.length > 0) {
    const unreadDeleted = await prisma.notification.deleteMany({
      where: {
        taskId: { in: taskIds },
        isRead: false,
        type: NotificationType.REMINDER,
      },
    });
    if (unreadDeleted.count > 0) {
      console.log(`🧹 Cleaned up ${unreadDeleted.count} obsolete notifications for completed/cancelled tasks.`);
    }
  }

  console.log(`✅ Reminder run finished: ${notificationsCreated} reminders created, ${escalationsCreated} escalations created.`);
  return { notificationsCreated, escalationsCreated };
}

// Recycle bin items past their expiry (5 days after deletion) are deleted for good
export async function purgeExpiredRecycleBin() {
  const { count } = await prisma.recycleBinItem.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  if (count > 0) {
    console.log(`🗑️ Permanently deleted ${count} expired recycle bin item(s).`);
  }
  return count;
}

// Morning summaries and directors' updates, logged rather than thrown so one failure does not stop the rest
async function runNotifications() {
  const summaries = await sendMorningSummaries().catch((e) => (console.error('Morning summaries failed:', e), 0));
  const updates = await processDirectorFeed().catch((e) => (console.error("Directors' updates failed:", e), 0));
  if (summaries || updates) console.log(`📬 ${summaries} morning summaries, ${updates} director updates sent.`);
}

// If executed directly
if (require.main === module) {
  console.log('🚀 Starting Nirmaan CRM background worker: follow-up alerts, morning summaries and directors’ updates every minute...');

  // Run once immediately
  processTaskReminders().catch(console.error);
  runNotifications().catch(console.error);
  purgeExpiredRecycleBin().catch(console.error);

  // Every minute, so a follow-up's 30-minute alert and each person's summary time are kept to the minute
  cron.schedule('* * * * *', () => {
    processTaskReminders().catch(console.error);
    runNotifications().catch(console.error);
  });
  cron.schedule('0 * * * *', () => {
    purgeExpiredRecycleBin().catch(console.error);
  });
}
