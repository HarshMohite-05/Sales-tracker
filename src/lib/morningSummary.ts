import { ApprovalStatus, IncentiveEntryStatus, NotificationType, Role, TaskStatus, VerificationStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { notify } from '@/lib/notify';
import { humanize, TIMEZONE } from '@/lib/utils';

/**
 * The morning summary: once a day, at the time each person chose (India time), a notification with what to
 * do today. Salespeople get their follow-ups for today and the overdue ones; directors also get the team's
 * follow-ups and what is waiting for them (quotation approvals, payments to verify, incentives to approve).
 * A summary missed by more than three hours (the worker was not running) is skipped for the day.
 */

const LATE_LIMIT_MINUTES = 3 * 60;

// Today's date and the time now in India, e.g. { date: '2026-10-29', time: '09:05' }
export function indiaNow(now: Date = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return { date, time };
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Whether a summary set for `at` is due now: its time has come today, not more than three hours ago. */
export function summaryDue(at: string, now: string): boolean {
  const late = minutesOf(now) - minutesOf(at);
  return late >= 0 && late <= LATE_LIMIT_MINUTES;
}

const clock = (d: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The summary text for one person on a day (YYYY-MM-DD, India time). */
export async function buildMorningSummary(user: { id: string; name: string; role: Role }, date: string) {
  const dayStart = new Date(`${date}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const mine = { status: TaskStatus.PENDING, assignedSalespersonId: user.id };
  const [today, overdue] = await Promise.all([
    prisma.task.findMany({ where: { ...mine, dueDateTime: { gte: dayStart, lt: dayEnd } }, include: { client: { select: { name: true } } }, orderBy: { dueDateTime: 'asc' } }),
    prisma.task.count({ where: { ...mine, dueDateTime: { lt: dayStart } } }),
  ]);

  const lines: string[] = [];
  if (today.length) {
    const first = today.slice(0, 3).map((t) => `${clock(t.dueDateTime)} ${humanize(t.actionType)} – ${t.client.name}`);
    lines.push(`Today: ${plural(today.length, 'follow-up')} (${first.join('; ')}${today.length > 3 ? '; …' : ''}).`);
  } else if (user.role === Role.SALESPERSON) {
    lines.push('No follow-ups due today.');
  }
  if (overdue) lines.push(`${plural(overdue, 'follow-up')} overdue.`);

  if (user.role === Role.DIRECTOR) {
    const team = { status: TaskStatus.PENDING };
    const [teamToday, teamOverdue, approvals, toVerify, toApprove] = await Promise.all([
      prisma.task.count({ where: { ...team, dueDateTime: { gte: dayStart, lt: dayEnd } } }),
      prisma.task.count({ where: { ...team, dueDateTime: { lt: dayStart } } }),
      prisma.quotationApproval.count({ where: { status: ApprovalStatus.PENDING } }),
      prisma.receipt.count({ where: { verificationStatus: VerificationStatus.SUBMITTED } }),
      prisma.incentiveEntry.count({ where: { status: IncentiveEntryStatus.EARNED } }),
    ]);
    lines.push(`Team: ${plural(teamToday, 'follow-up')} today, ${teamOverdue} overdue.`);
    const waiting = [
      approvals && plural(approvals, 'quotation approval'),
      toVerify && plural(toVerify, 'payment') + ' to verify',
      toApprove && plural(toApprove, 'incentive') + ' to approve',
    ].filter(Boolean);
    lines.push(waiting.length ? `Waiting for you: ${waiting.join(', ')}.` : 'Nothing waiting for your approval.');
  }

  return { title: `Good morning, ${user.name.split(' ')[0]}`, message: lines.join(' ') };
}

/** Send every summary that is due now. Returns how many were sent. */
export async function sendMorningSummaries(now: Date = new Date()): Promise<number> {
  const { date, time } = indiaNow(now);
  const people = await prisma.user.findMany({
    where: { isActive: true, morningSummaryEnabled: true, OR: [{ morningSummaryLastSent: null }, { morningSummaryLastSent: { not: date } }] },
    select: { id: true, name: true, role: true, morningSummaryTime: true },
  });
  let sent = 0;
  for (const person of people) {
    if (!summaryDue(person.morningSummaryTime, time)) continue;
    // Mark the day first, so a slow send is not repeated by the next run
    const claimed = await prisma.user.updateMany({
      where: { id: person.id, OR: [{ morningSummaryLastSent: null }, { morningSummaryLastSent: { not: date } }] },
      data: { morningSummaryLastSent: date },
    });
    if (!claimed.count) continue;
    const { title, message } = await buildMorningSummary(person, date);
    await notify({ userId: person.id, title, message, type: NotificationType.MORNING_SUMMARY, link: '/dashboard', category: 'MORNING_SUMMARY', push: true });
    sent += 1;
  }
  return sent;
}
