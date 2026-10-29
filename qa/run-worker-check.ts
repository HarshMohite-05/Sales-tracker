// One reminder-worker pass against the _test database (email off): notifications and escalations, no duplicates.
// Usage: DATABASE_URL=<test db url> npx tsx qa/run-worker-check.ts
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from '../tests/testDatabaseUrl';
const url = testDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.ENABLE_EMAIL_DISPATCH = 'false';
const db = new PrismaClient({ datasourceUrl: url });
(async () => {
  const before = await db.notification.groupBy({ by: ['type'], _count: true });
  const { processTaskReminders } = await import('../src/worker/reminderWorker');
  await processTaskReminders();
  await processTaskReminders(); // a second pass must not duplicate
  const after = await db.notification.groupBy({ by: ['type'], _count: true });
  const overdue = await db.task.findMany({ where: { status: 'PENDING', dueDateTime: { lt: new Date(Date.now() - 24 * 3600e3) }, description: { startsWith: 'QA-' } }, select: { id: true } });
  const esc = await db.notification.count({ where: { type: 'OVERDUE_ESCALATION', taskId: { in: overdue.map((t) => t.id) } } });
  const dupes = await db.$queryRawUnsafe<any[]>(`select "taskId", "userId", type, count(*)::int c from "Notification" where "taskId" is not null group by 1,2,3 having count(*) > 1 limit 5`);
  console.log(JSON.stringify({ db: url.split('/').pop(), before, after, qaOverdueTasks: overdue.length, escalationsForThem: esc, duplicates: dupes }));
  await db.$disconnect(); process.exit(0);
})();
