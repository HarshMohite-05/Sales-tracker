import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role, TaskStatus, TaskType } from '@prisma/client';
import prisma from '@/lib/prisma';
import { processTaskReminders } from '../src/worker/reminderWorker';
import { buildMorningSummary, indiaNow, sendMorningSummaries, summaryDue } from '@/lib/morningSummary';
import { processDirectorFeed } from '@/lib/directorFeed';

const minutes = (n: number) => n * 60 * 1000;

describe('notifications', () => {
  let salesperson: { id: string; name: string; role: Role };
  let director: { id: string };
  let clientId: string;
  const taskNumber = `TSK-NOTIFY-${Date.now()}`;

  beforeAll(async () => {
    salesperson = await prisma.user.findFirstOrThrow({ where: { role: Role.SALESPERSON, isActive: true }, select: { id: true, name: true, role: true } });
    director = await prisma.user.findFirstOrThrow({ where: { role: Role.DIRECTOR, isActive: true }, select: { id: true } });
    clientId = (await prisma.client.findFirstOrThrow({ where: { assignedToId: salesperson.id }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { taskNumber } });
    await prisma.auditEvent.deleteMany({ where: { entityType: 'CLIENT', entityId: 'notify-test' } });
  });

  it('alerts the salesperson 30 minutes before a follow-up and again when it is due, once each', async () => {
    const task = await prisma.task.create({
      data: { taskNumber, clientId, assignedSalespersonId: salesperson.id, createdById: salesperson.id, actionType: TaskType.CALL, description: 'Call about the RO plant', dueDateTime: new Date(Date.now() + minutes(20)) },
    });
    await processTaskReminders();
    await processTaskReminders();
    const soon = await prisma.notification.findMany({ where: { taskId: task.id, category: 'FOLLOWUP_SOON' } });
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ userId: salesperson.id, link: `/clients/${clientId}` });
    expect(soon[0].title).toMatch(/^Follow-up at .*: Call · /);

    // Now due (moved to 5 minutes ago): the due alert, once
    await prisma.task.update({ where: { id: task.id }, data: { dueDateTime: new Date(Date.now() - minutes(5)) } });
    await processTaskReminders();
    await processTaskReminders();
    expect(await prisma.notification.count({ where: { taskId: task.id, category: 'FOLLOWUP_DUE' } })).toBe(1);

    // Rescheduled: alerted again for the new time
    await prisma.task.update({ where: { id: task.id }, data: { dueDateTime: new Date(Date.now() + minutes(10)) } });
    await processTaskReminders();
    expect(await prisma.notification.count({ where: { taskId: task.id, category: 'FOLLOWUP_SOON' } })).toBe(2);
    await prisma.task.update({ where: { id: task.id }, data: { status: TaskStatus.COMPLETED } });
  });

  it('sends the morning summary at the chosen time, once a day, and skips one missed by over 3 hours', async () => {
    expect(summaryDue('09:00', '08:59')).toBe(false);
    expect(summaryDue('09:00', '09:00')).toBe(true);
    expect(summaryDue('09:00', '12:00')).toBe(true);
    expect(summaryDue('09:00', '12:01')).toBe(false);

    // 03:30 India time today: only the person who chose 03:30 is due (everyone else keeps the 09:00 default)
    const { date } = indiaNow();
    const at = new Date(`${date}T03:30:00+05:30`);
    await prisma.user.update({ where: { id: salesperson.id }, data: { morningSummaryTime: '03:30', morningSummaryEnabled: true, morningSummaryLastSent: null } });
    try {
      expect(await sendMorningSummaries(at)).toBe(1);
      expect(await sendMorningSummaries(at)).toBe(0);
      const summary = await prisma.notification.findFirstOrThrow({ where: { userId: salesperson.id, type: 'MORNING_SUMMARY' }, orderBy: { createdAt: 'desc' } });
      expect(summary.title).toBe(`Good morning, ${salesperson.name.split(' ')[0]}`);
      expect(summary.link).toBe('/dashboard');
    } finally {
      await prisma.user.update({ where: { id: salesperson.id }, data: { morningSummaryTime: '09:00', morningSummaryLastSent: null } });
    }
  });

  it("gives directors the team's numbers and what is waiting for them", async () => {
    const { message } = await buildMorningSummary({ id: director.id, name: 'Test Director', role: Role.DIRECTOR }, indiaNow().date);
    expect(message).toMatch(/Team: \d+ follow-ups? today, \d+ overdue\./);
    expect(message).toMatch(/Waiting for you: |Nothing waiting for your approval\./);
  });

  it("tells directors about other people's changes, not their own", async () => {
    // Start the feed from now, then make one change as the salesperson and one as the director
    await prisma.appSetting.deleteMany({ where: { key: 'notifications.directorFeedCursor' } });
    const start = new Date();
    await processDirectorFeed(new Date(start.getTime() + 15 * 1000));
    await prisma.auditEvent.create({ data: { entityType: 'CLIENT', entityId: 'notify-test', action: 'CREATE', actorId: salesperson.id, details: { name: 'Feed Test Industries' } } });
    await prisma.auditEvent.create({ data: { entityType: 'CLIENT', entityId: 'notify-test', action: 'UPDATE', actorId: director.id, details: { name: 'Feed Test Industries' } } });

    await processDirectorFeed(new Date(Date.now() + 20 * 1000));
    const got = await prisma.notification.findMany({ where: { userId: director.id, type: 'ACTIVITY_UPDATE', createdAt: { gte: start } } });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: 'Client added', message: `${salesperson.name}: Feed Test Industries`, category: 'CLIENTS', link: '/clients/notify-test' });
  });
});
