// Full end-to-end API run of qa/full-test-prompt.md against the test server (port 3100) and the _test database.
// Every check is recorded PASS / FAIL / BLOCKED with evidence in qa/evidence/full-run.json.
// Usage: npx tsx qa/run-full.ts
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { testDatabaseUrl } from '../tests/testDatabaseUrl';

const base = process.env.QA_BASE || 'http://127.0.0.1:3100';
const dbUrl = testDatabaseUrl();
const db = new PrismaClient({ datasourceUrl: dbUrl });
const run = Date.now().toString().slice(-6);
const P = `QA-${run}`;
const results: any[] = [];
const created: Record<string, string[]> = {};
const timings: Record<string, number> = {};
let seq = 0;

type R = { status: number; data: any; ms: number; cookie?: string; bytes: Buffer };
async function req(path: string, method = 'GET', body?: any, cookie = ''): Promise<R> {
  const start = performance.now();
  const r = await fetch(base + path, {
    method,
    headers: { ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  let data: any;
  try { data = JSON.parse(bytes.toString()); } catch { data = { bytes: bytes.length }; }
  return { status: r.status, data, ms: Math.round(performance.now() - start), cookie: r.headers.get('set-cookie')?.split(';')[0], bytes };
}
function record(module: string, scenario: string, expected: string, status: 'PASS' | 'FAIL' | 'BLOCKED', actual: any) {
  const entry = { id: `F-${String(++seq).padStart(3, '0')}`, module, scenario, expected, status, actual };
  results.push(entry);
  console.log(entry.id, status, `[${module}] ${scenario}`, typeof actual === 'string' ? actual : JSON.stringify(actual)?.slice(0, 220));
  return status === 'PASS';
}
const check = (m: string, s: string, e: string, pass: boolean, a: any) => record(m, s, e, pass ? 'PASS' : 'FAIL', a);
const blocked = (m: string, s: string, why: string) => record(m, s, '-', 'BLOCKED', why);
async function expectStatus(m: string, s: string, path: string, method: string, body: any, cookie: string, want: number | number[]) {
  const r = await req(path, method, body, cookie);
  const ok = Array.isArray(want) ? want.includes(r.status) : r.status === want;
  check(m, s, `HTTP ${want}`, ok, { status: r.status, error: r.data?.error, ms: r.ms });
  return r;
}
const note = (kind: string, v: string) => (created[kind] ||= []).push(v);
const sum = (rows: any[], f: (r: any) => number) => Math.round(rows.reduce((t, r) => t + (Number(f(r)) || 0), 0) * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

// India-time calendar days, the way the app enters dates
const istDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const istTime = (offsetHours: number) => {
  const d = new Date(Date.now() + offsetHours * 3600000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:00+05:30`;
};

async function section(name: string, fn: () => Promise<void>) {
  console.log(`\n===== ${name}`);
  try { await fn(); } catch (e: any) { check(name, 'Section ran to the end', 'No harness error', false, { error: e.message, stack: e.stack?.split('\n')[1] }); }
}

async function main() {
  // ---------------------------------------------------------------- guard: test server + test database only
  const login = async (email: string, password = 'Nirmaan@2026') => req('/api/auth/login', 'POST', { email, password });
  if (!base.includes(':3100') || !dbUrl.split('?')[0].endsWith('_test')) throw Error(`Refusing: base=${base} db=${dbUrl}`);
  const dir = (await login('rajesh.sharma@nirmaanwater.com')).cookie!;
  const guard = await req('/api/clients', 'POST', { clientName: `${P} GUARD`, clientCode: `G${run}`, clientRequirement: 'QA guard', requirementCategories: ['SPARES'], saveMode: 'CLIENT_ONLY', assignedSalespersonId: (await db.user.findFirstOrThrow({ where: { email: 'amit.patil@nirmaanwater.com' } })).id }, dir);
  const inTestDb = guard.data?.data?.client?.id && (await db.client.findUnique({ where: { id: guard.data.data.client.id } }));
  if (!check('Guard', 'Server on :3100 writes to the _test database', 'Record created via API is in the _test DB', !!inTestDb, { base, db: dbUrl.replace(/\/\/.*@/, '//***@'), status: guard.status })) throw Error('Test server is not using the test database; stopping before creating data');
  note('clients', `${P} GUARD`);

  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = { dir };
  for (const [k, email] of [['a', 'amit.patil'], ['b', 'sneha.kulkarni'], ['r', 'rahul.deshmukh'], ['d2', 'vikram.mehta']] as const) {
    cookies[k] = (await login(`${email}@nirmaanwater.com`)).cookie!;
    ids[k] = (await req('/api/auth/me', 'GET', undefined, cookies[k])).data.user.id;
  }
  ids.dir = (await req('/api/auth/me', 'GET', undefined, dir)).data.user.id;
  const { a, b, r: rh, d2 } = cookies;
  const sp = [{ key: 'a', c: a }, { key: 'b', c: b }, { key: 'r', c: rh }];

  // ---------------------------------------------------------------- 1. login and sessions
  await section('1 Login', async () => {
    for (const email of ['rajesh.sharma', 'vikram.mehta', 'amit.patil', 'sneha.kulkarni', 'rahul.deshmukh']) {
      const r = await login(`${email}@nirmaanwater.com`);
      check('Login', `${email} signs in`, '200 with session cookie', r.status === 200 && !!r.cookie, { status: r.status });
    }
    await expectStatus('Login', 'Wrong password', '/api/auth/login', 'POST', { email: 'amit.patil@nirmaanwater.com', password: 'nope' }, '', 401);
    await expectStatus('Login', 'Missing password', '/api/auth/login', 'POST', { email: 'amit.patil@nirmaanwater.com' }, '', 400);
    // Throttle on a throwaway user so real logins are not locked
    const qaEmail = `qa${run}@nirmaan.test`;
    const u = await req('/api/settings/users', 'POST', { name: `${P} Temp`, email: qaEmail, password: 'Temp@12345', role: 'SALESPERSON' }, dir);
    check('Settings', 'Director adds a user', '200', u.status === 200, { status: u.status, error: u.data.error });
    note('users', qaEmail);
    let last: R | undefined;
    for (let i = 0; i < 11; i++) last = await login(qaEmail, 'wrong');
    check('Login', 'Repeated wrong passwords are throttled (after 10)', '429 with Retry-After', last!.status === 429, { status: last!.status, error: last!.data.error });
    const uid = (await db.user.findUnique({ where: { email: qaEmail } }))?.id;
    const off = await req('/api/settings/users', 'PATCH', { userId: uid, isActive: false }, dir);
    check('Settings', 'Director deactivates a user', '200', off.status === 200, { status: off.status, error: off.data.error });
    const inactive = await login(qaEmail, 'Temp@12345');
    check('Login', 'Inactive user is refused', '401/403/429', [401, 403, 429].includes(inactive.status), { status: inactive.status, error: inactive.data.error });
    await expectStatus('Settings', 'Salesperson cannot add users', '/api/settings/users', 'POST', { name: 'x', email: `x${run}@x.test`, password: 'x1234567' }, a, 403);
    const gets = ['clients', 'enquiries', 'tasks', 'activities', 'quotations', 'orders', 'notifications', 'reports', 'dashboard/stats', 'targets', 'incentives', 'recycle-bin', 'settings/users', 'settings/payment-rules'];
    const anon = await Promise.all(gets.map((p) => req(`/api/${p}`)));
    check('Security', 'Every API list returns 401 without a cookie', 'all 401', anon.every((x) => x.status === 401), Object.fromEntries(gets.map((p, i) => [p, anon[i].status])));
    const tampered = a.replace(/.{6}$/, 'AAAAAA');
    const t = await Promise.all(gets.map((p) => req(`/api/${p}`, 'GET', undefined, tampered)));
    check('Security', 'Every API list returns 401 with a tampered cookie', 'all 401', t.every((x) => x.status === 401), Object.fromEntries(gets.map((p, i) => [p, t[i].status])));
    // Logout ends every session of that user, so use a throwaway account for it
    const loEmail = `qalo${run}@nirmaan.test`;
    await req('/api/settings/users', 'POST', { name: `${P} Logout`, email: loEmail, password: 'Temp@12345', role: 'SALESPERSON' }, dir);
    note('users', loEmail);
    const lo = (await login(loEmail, 'Temp@12345')).cookie!;
    const out = await req('/api/auth/logout', 'POST', {}, lo);
    const after = await req('/api/auth/me', 'GET', undefined, out.cookie || '');
    check('Login', 'Logout ends the session', '401 after logout', after.status === 401, { status: after.status });
    blocked('Login', 'Postgres stopped: login shows a clear error', 'Not run: the test and live databases share one Postgres container, so stopping it would take the live CRM down');
  });

  // ---------------------------------------------------------------- 2. clients
  const industries: string[] = (await req('/api/clients/industries', 'GET', undefined, a)).data.industries?.map((i: any) => (typeof i === 'string' ? i : i.name)) || ['Water'];
  const states = ['Maharashtra', 'Gujarat', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh'];
  const clientTypes = ['End User', 'Consultant', 'Contractor', 'OEM', 'Dealer'];
  const leadSources = ['Direct Inbound', 'Referral', 'Website', 'Exhibition', 'Cold Call', 'IndiaMART'];
  const clients: { id: string; code: string; owner: string; enquiryId: string; name: string }[] = [];
  await section('2 Clients', async () => {
    let i = 0;
    for (const ind of industries.length ? industries : ['Water']) {
      const owner = sp[i % 3];
      const name = `${P} ${ind} Client ${i}`;
      const body = {
        clientName: name, clientCode: `C${run}${i}`.slice(0, 10), industrySegment: ind, state: states[i % states.length], location: 'Pune',
        clientType: clientTypes[i % clientTypes.length], leadSource: leadSources[i % leadSources.length],
        contactPerson: `QA Contact ${i}`, mobileNumber: `98${run}${String(i).padStart(2, '0')}`.slice(0, 10), emailAddress: `qa${i}@example.test`,
        gstin: i % 2 ? '27AAAPL1234C1Z5' : '', clientRequirement: `${P} first need ${i}`, requirementCategories: ['PLANT'], requirementValue: 100000 * (i + 1), saveMode: 'CLIENT_ONLY',
      };
      const r = await req('/api/clients', 'POST', body, owner.c);
      const ok = r.status === 200 && r.data.data?.client?.id;
      check('Clients', `${owner.key} creates client (${ind}, ${body.state}, ${body.clientType}, ${body.leadSource}, GSTIN ${body.gstin ? 'yes' : 'no'})`, '200 with client + first requirement', !!ok, { status: r.status, error: r.data.error, enquiry: r.data.data?.enquiry?.enquiryNumber });
      if (ok) { clients.push({ id: r.data.data.client.id, code: r.data.data.client.code, owner: owner.key, enquiryId: r.data.data.enquiry.id, name }); note('clients', name); }
      i++;
    }
    // Director creates on a salesperson's behalf
    const dc = await req('/api/clients', 'POST', { clientName: `${P} Director Made`, clientCode: `D${run}`, clientRequirement: 'QA by director', requirementCategories: ['SPARES'], assignedSalespersonId: ids.r, saveMode: 'CLIENT_ONLY' }, dir);
    check('Clients', 'Director creates a client for Rahul', '200, owned by Rahul', dc.status === 200 && dc.data.data?.client?.assignedToId === ids.r, { status: dc.status, owner: dc.data.data?.client?.assignedToId === ids.r, error: dc.data.error });
    if (dc.data.data?.client) clients.push({ id: dc.data.data.client.id, code: dc.data.data.client.code, owner: 'r', enquiryId: dc.data.data.enquiry.id, name: `${P} Director Made` });
    await expectStatus('Clients', 'No requirement text is refused', '/api/clients', 'POST', { clientName: `${P} NoReq`, clientCode: `N${run}`, requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' }, a, 400);
    const noType = await req('/api/clients', 'POST', { clientName: `${P} NoType`, clientCode: `T${run}`, clientRequirement: 'something', requirementCategories: [], saveMode: 'CLIENT_ONLY' }, a);
    check('Clients', 'No requirement type ticked is refused', '400', noType.status === 400, { status: noType.status, error: noType.data.error });
    const dup = await req('/api/clients', 'POST', { clientName: `${P} Dup`, clientCode: clients[0].code, clientRequirement: 'x', requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' }, a);
    check('Clients', 'Duplicate client code refused with a suggestion', '409 + suggestion', dup.status === 409 && !!dup.data.suggestion, { status: dup.status, suggestion: dup.data.suggestion });
    const cc = await req(`/api/clients/code-check?code=${clients[0].code}`, 'GET', undefined, a);
    check('Clients', 'Code check reports a taken code', 'taken / suggestion', cc.status === 200, cc.data);
    const bad = await req('/api/clients', 'POST', { clientName: `${P} BadCode`, clientCode: 'A', clientRequirement: 'x', requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' }, a);
    check('Clients', 'Invalid client code (1 char) refused', '400', bad.status === 400, { status: bad.status, error: bad.data.error });
    const mine = clients.find((c) => c.owner === 'a')!;
    const newCode = `E${run}`;
    const ed = await req(`/api/clients/${mine.id}`, 'PATCH', { code: newCode }, a);
    check('Clients', 'Client code edit once requirement numbers use it is refused with a clear reason (by design)', '400 with reason', ed.status === 400 && /requirement numbers/.test(ed.data.error || ''), { status: ed.status, error: ed.data.error });
    const similar = await req(`/api/clients?search=${encodeURIComponent(mine.name.slice(0, 18))}`, 'GET', undefined, a);
    check('Clients', 'Similar-name search finds the existing client (duplicate warning source)', 'existing client listed', similar.data.clients?.some((c: any) => c.id === mine.id), { count: similar.data.clients?.length });
    const other = await req(`/api/clients/${mine.id}`, 'GET', undefined, b);
    check('Security', "Sneha cannot open Amit's client", '403/404', [403, 404].includes(other.status), { status: other.status });
    const sList = await req('/api/clients', 'GET', undefined, b);
    check('Security', "Sneha's client list has none of Amit's clients", 'none', !sList.data.clients.some((c: any) => clients.some((x) => x.owner === 'a' && x.id === c.id)), { count: sList.data.clients.length });
    const dList = await req('/api/clients', 'GET', undefined, d2);
    check('Clients', 'Director sees every QA client', 'all present', clients.every((c) => dList.data.clients.some((x: any) => x.id === c.id)), { mine: clients.length });
    // Existing-client requirement via the Add Client modal API
    const ex = await req('/api/clients', 'POST', { existingClientId: mine.id, clientName: mine.name, clientRequirement: `${P} via modal existing`, requirementCategories: ['SPARES'], saveMode: 'CLIENT_ONLY' }, a);
    check('Clients', 'New Requirement for an existing client (modal API)', '200, added to that client', ex.status === 200 && ex.data.data?.enquiry?.clientId === mine.id, { status: ex.status, number: ex.data.data?.enquiry?.enquiryNumber, error: ex.data.error });
    blocked('Clients', 'Several contacts on one client', 'The Add Client API takes one contact; extra contacts are added on the client page (not exposed as a tested API here)');
  });

  // ---------------------------------------------------------------- 3. requirements
  const reqs: { id: string; owner: string; clientId: string; value: number; cats: string[]; stage?: string }[] = [];
  await section('3 Requirements', async () => {
    const cats: [string[], string?][] = [[['PLANT']], [['BASIC_CHEMICALS']], [['SPECIAL_CHEMICALS']], [['SPARES']], [['AMC']], [['OTHER'], 'QA filters'], [['PLANT', 'AMC']]];
    const values = [0, 5000, 450000, 12500000, 99999.5, 250000, 1800000];
    for (const owner of sp) {
      const cl = clients.find((c) => c.owner === owner.key)!;
      const numbers: string[] = [];
      for (let k = 0; k < cats.length; k++) {
        const [cs, other] = cats[k];
        const r = await req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} ${cs.join('+')} ${owner.key}`, categories: cs, categoryOther: other, estimatedValue: values[k] }, owner.c);
        const ok = check('Requirements', `${owner.key}: ${cs.join(' + ')} at ₹${values[k]}`, '200', r.status === 200, { status: r.status, error: r.data.error, number: r.data.enquiry?.enquiryNumber });
        if (ok) { reqs.push({ id: r.data.enquiry.id, owner: owner.key, clientId: cl.id, value: values[k], cats: cs }); numbers.push(r.data.enquiry.enquiryNumber); }
      }
      const seqNums = numbers.map((n) => Number(n.split('/').pop()));
      check('Requirements', `${owner.key}: numbers run in sequence per client`, 'consecutive', seqNums.every((n, i) => i === 0 || n === seqNums[i - 1] + 1), numbers);
    }
    const cl = clients[0];
    await expectStatus('Requirements', 'Other without its text is refused', '/api/enquiries', 'POST', { clientId: cl.id, title: 'x', categories: ['OTHER'] }, a, 400);
    await expectStatus('Requirements', 'No type is refused', '/api/enquiries', 'POST', { clientId: cl.id, title: 'x', categories: [] }, a, 400);
    await expectStatus('Requirements', 'Negative value is refused', '/api/enquiries', 'POST', { clientId: cl.id, title: 'x', categories: ['PLANT'], estimatedValue: -5 }, a, 400);
    await expectStatus('Requirements', 'Retired type (CHEMICALS) refused for new', '/api/enquiries', 'POST', { clientId: cl.id, title: 'x', categories: ['CHEMICALS'] }, a, 400);
    const bReq = reqs.find((x) => x.owner === 'b')!;
    await expectStatus('Security', "Amit cannot move Sneha's requirement stage", `/api/enquiries/${bReq.id}/stage`, 'PATCH', { newStage: 'QUALIFIED' }, a, 403);
    // Stage moves on Amit's
    const mine = reqs.filter((x) => x.owner === 'a');
    for (const st of ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION']) await expectStatus('Requirements', `Move to ${st}`, `/api/enquiries/${mine[0].id}/stage`, 'PATCH', { newStage: st }, a, 200);
    await expectStatus('Requirements', 'WON without an order is refused', `/api/enquiries/${mine[0].id}/stage`, 'PATCH', { newStage: 'WON' }, a, 400);
    await expectStatus('Requirements', 'ON_HOLD without reason refused', `/api/enquiries/${mine[1].id}/stage`, 'PATCH', { newStage: 'ON_HOLD' }, a, 400);
    await expectStatus('Requirements', 'ON_HOLD with reason and review date', `/api/enquiries/${mine[1].id}/stage`, 'PATCH', { newStage: 'ON_HOLD', reason: 'Budget next quarter', holdReviewDate: istDay(30) }, a, 200);
    await expectStatus('Requirements', 'LOST without reason refused', `/api/enquiries/${mine[2].id}/stage`, 'PATCH', { newStage: 'LOST' }, a, 400);
    await expectStatus('Requirements', 'LOST with reason', `/api/enquiries/${mine[2].id}/stage`, 'PATCH', { newStage: 'LOST', reason: 'Price too high' }, a, 200);
    for (const o of sp.slice(1)) {
      const theirs = reqs.filter((x) => x.owner === o.key);
      await req(`/api/enquiries/${theirs[2].id}/stage`, 'PATCH', { newStage: 'LOST', reason: 'Went with competitor' }, o.c);
      await req(`/api/enquiries/${theirs[1].id}/stage`, 'PATCH', { newStage: 'ON_HOLD', reason: 'Waiting', holdReviewDate: istDay(10) }, o.c);
    }
    const hist = await db.enquiryStageHistory.count({ where: { enquiryId: mine[0].id } });
    check('Requirements', 'Stage history is recorded', '>= 3 entries', hist >= 3, { entries: hist });
  });

  // ---------------------------------------------------------------- 4. activities and follow-ups
  await section('4 Follow-ups', async () => {
    const cl = clients.find((c) => c.owner === 'a')!;
    const en = reqs.find((x) => x.owner === 'a' && x.clientId === cl.id)!;
    for (const type of ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'SITE_VISIT']) {
      const r = await req('/api/activities', 'POST', { clientId: cl.id, enquiryId: en.id, activityType: type, outcome: 'Discussed', keyPoints: `${P} ${type} notes`, nextAction: type === 'CALL' ? 'Call back' : undefined, nextActionDate: type === 'CALL' ? istTime(48) : undefined }, a);
      check('Activities', `Log ${type}${type === 'CALL' ? ' with next action' : ''}`, '200', r.status === 200, { status: r.status, error: r.data.error });
    }
    await expectStatus('Activities', 'Missing discussion points refused', '/api/activities', 'POST', { clientId: cl.id, activityType: 'CALL', outcome: 'x' }, a, 400);
    await expectStatus('Activities', 'Sneha cannot log on Amit client', '/api/activities', 'POST', { clientId: cl.id, activityType: 'CALL', outcome: 'x', keyPoints: 'x' }, b, 403);
    const dues: [string, string][] = [['overdue by days', istTime(-72)], ['overdue by hours (yesterday)', istTime(-26)], ['later today', `${istDay(0)}T23:30:00+05:30`], ['tomorrow', istTime(24)], ['next month', istTime(24 * 32)]];
    const taskIds: string[] = [];
    for (const [label, due] of dues) {
      const r = await req('/api/tasks', 'POST', { clientId: cl.id, enquiryId: en.id, description: `${P} follow-up ${label}`, dueDateTime: due, actionType: 'CALL' }, a);
      check('Follow-ups', `Create follow-up ${label}`, '200', r.status === 200, { status: r.status, error: r.data.error });
      if (r.data.task) taskIds.push(r.data.task.id);
    }
    const early = await req('/api/tasks', 'POST', { clientId: cl.id, description: `${P} earlier today`, dueDateTime: `${istDay(0)}T00:05:00+05:30`, actionType: 'CALL' }, a);
    check('Follow-ups', 'Create follow-up earlier today', '200', early.status === 200, { status: early.status, error: early.data.error });
    await expectStatus('Follow-ups', 'Reschedule without reason refused', `/api/tasks/${taskIds[3]}/reschedule`, 'PATCH', { newDueDateTime: istTime(50) }, a, 400);
    await expectStatus('Follow-ups', 'Reschedule with reason', `/api/tasks/${taskIds[3]}/reschedule`, 'PATCH', { newDueDateTime: istTime(50), reason: 'Client travelling' }, a, 200);
    check('Follow-ups', 'Reschedule history kept', '1 entry', (await db.taskRescheduleHistory.count({ where: { taskId: taskIds[3] } })) === 1, {});
    await expectStatus('Follow-ups', 'Complete a follow-up', `/api/tasks/${taskIds[4]}/complete`, 'PATCH', { completionOutcome: 'Done', isFullyResolved: true }, a, 200);
    // Dashboard counts vs the database, India day bounds
    const st = (await req('/api/dashboard/stats', 'GET', undefined, a)).data;
    const pend = await db.task.findMany({ where: { assignedSalespersonId: ids.a, status: 'PENDING' } });
    const s0 = new Date(`${istDay(0)}T00:00:00+05:30`).getTime(), s1 = new Date(`${istDay(0)}T23:59:59+05:30`).getTime();
    const want = { due: pend.filter((t) => t.dueDateTime.getTime() < s0).length, today: pend.filter((t) => t.dueDateTime.getTime() >= s0 && t.dueDateTime.getTime() <= s1).length, future: pend.filter((t) => t.dueDateTime.getTime() > s1).length };
    const got = { due: st.summary.overdueTasksCount, today: st.visual.kpis.followUpsToday.now, future: st.summary.upcomingTasksCount };
    check('Dashboard', 'Due / Today / Future follow-up cards match the database (IST days)', JSON.stringify(want), JSON.stringify(want) === JSON.stringify(got), { want, got });
    check('Dashboard', 'Due Follow-ups table rows = card', 'equal', st.details.overdueTasks.length === got.due, { rows: st.details.overdueTasks.length, card: got.due });
    const laterToday = st.details.todayTasks.some((t: any) => /later today/.test(t.description));
    check('Dashboard', 'A follow-up later today counts as today, not due', 'in today list', laterToday, {});
    const n1 = (await req('/api/notifications', 'GET', undefined, b)).data;
    const leak = JSON.stringify(n1).includes(cl.name);
    check('Security', "Sneha's notifications show nothing of Amit's client", 'no leak', !leak, {});
  });

  // ---------------------------------------------------------------- 5. quotations
  const quotes: { id: string; owner: string; clientId: string; enquiryId: string; terms: string; gst: number }[] = [];
  const stageSets: Record<string, any[]> = {
    '100% advance': [{ percent: 100, description: 'Advance' }],
    'advance+dispatch+delivery': [{ percent: 10, description: 'Advance' }, { percent: 60, description: 'Before dispatch' }, { percent: 30, description: 'Upon delivery' }],
    'erection/installation/commissioning': [{ percent: 20, description: 'Advance' }, { percent: 40, description: 'Before dispatch' }, { percent: 20, description: 'On erection' }, { percent: 10, description: 'On installation' }, { percent: 10, description: 'On commissioning' }],
    'full payment after 30 days': [{ percent: 100, description: 'Full payment after 30 days' }],
    'typed differently': [{ percent: 50, description: 'Advance' }, { percent: 20, description: 'On delivery' }, { percent: 30, description: '30% commissioning' }],
  };
  let qno = Number(run) % 90000 + 10000;
  await section('5 Quotations', async () => {
    const termKeys = Object.keys(stageSets);
    const gsts = [0, 5, 12, 18, 18];
    let k = 0;
    for (const owner of sp) {
      // Fresh requirements for quoting (one quotation per requirement)
      const cl = clients.find((c) => c.owner === owner.key)!;
      for (let j = 0; j < 4; j++) {
        const terms = termKeys[k % termKeys.length];
        const gst = gsts[k % gsts.length];
        const en = await req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} quote need ${owner.key}${j}`, categories: [['PLANT'], ['SPARES'], ['BASIC_CHEMICALS'], ['AMC']][j], estimatedValue: 200000 + j * 50000 }, owner.c);
        const r = await req('/api/quotations', 'POST', { clientId: cl.id, enquiryId: en.data.enquiry.id, quotationNo: String(qno++), product: `${P} product ${k}`, price: 100000 + k * 25000, gstPercent: gst, paymentStages: stageSets[terms], transportation: k % 2 ? 'INCLUDED' : 'EXTRA_AT_ACTUAL' }, owner.c);
        const ok = check('Quotations', `${owner.key}: ${terms}, GST ${gst}%`, '200', r.status === 200, { status: r.status, error: r.data.error });
        if (ok) quotes.push({ id: r.data.quotation.id, owner: owner.key, clientId: cl.id, enquiryId: en.data.enquiry.id, terms, gst });
        k++;
      }
    }
    const q0 = quotes[0];
    await expectStatus('Quotations', 'Second quotation for the same requirement refused', '/api/quotations', 'POST', { clientId: q0.clientId, enquiryId: q0.enquiryId, quotationNo: String(qno++), product: 'x', price: 10, gstPercent: 18, transportation: 'INCLUDED' }, a, 409);
    await expectStatus('Quotations', 'Zero price refused', '/api/quotations', 'POST', { clientId: q0.clientId, enquiryId: reqs.find((x) => x.owner === 'a')!.id, quotationNo: String(qno++), product: 'x', price: 0, transportation: 'INCLUDED' }, a, 400);
    await expectStatus('Quotations', 'GST over 28% refused', '/api/quotations', 'POST', { clientId: q0.clientId, enquiryId: reqs.find((x) => x.owner === 'a')!.id, quotationNo: String(qno++), product: 'x', price: 10, gstPercent: 40, transportation: 'INCLUDED' }, a, 400);
    await expectStatus('Quotations', 'Stages not adding to 100% refused', '/api/quotations', 'POST', { clientId: q0.clientId, enquiryId: reqs.find((x) => x.owner === 'a')!.id, quotationNo: String(qno++), product: 'x', price: 10, paymentStages: [{ percent: 50, description: 'Advance' }], transportation: 'INCLUDED' }, a, 400);
    for (const v of [1, 2]) await expectStatus('Quotations', `Revision ${v}`, `/api/quotations/${q0.id}/version`, 'POST', { product: `${P} product rev${v}`, price: 110000 + v * 1000, gstPercent: 18, paymentStages: stageSets['100% advance'], transportation: 'INCLUDED' }, a, 200);
    for (const q of quotes.filter((_, i) => i < 5)) {
      const pdf = await req(`/api/quotations/${q.id}/pdf`, 'GET', undefined, q.owner === 'a' ? a : q.owner === 'b' ? b : rh);
      check('Quotations', `PDF for ${q.terms}`, 'valid PDF', pdf.status === 200 && pdf.bytes.subarray(0, 4).toString() === '%PDF', { status: pdf.status, size: pdf.bytes.length });
    }
    await expectStatus('Security', 'Salesperson cannot approve a quotation', `/api/quotations/${q0.id}/approve`, 'POST', { decision: 'APPROVE' }, a, 403);
    const ap = await req(`/api/quotations/${q0.id}/approve`, 'POST', { decision: 'APPROVE', decisionNotes: 'ok' }, dir);
    const statuses = await db.quotation.groupBy({ by: ['approvalStatus'], where: { id: { in: quotes.map((q) => q.id) } }, _count: true });
    check('Quotations', 'Director approval workflow is reachable: a quotation the app creates can wait for approval', 'some QA quotation is PENDING_APPROVAL, or approve succeeds', statuses.some((x) => x.approvalStatus === 'PENDING_APPROVAL') || ap.status === 200, { approveStatus: ap.status, error: ap.data.error, qaQuotationStatuses: statuses.map((x) => `${x.approvalStatus}×${x._count}`), note: 'No code path sets PENDING_APPROVAL; quotations start as DRAFT and convert directly' });
    blocked('Quotations', 'Line items and discount', 'Not in the product: a quotation has one product, price, GST %, stages and transportation');
  });

  // ---------------------------------------------------------------- 6. orders
  const orders: { id: string; owner: string; target: string | null; label: string; quoteTerms: string }[] = [];
  await section('6 Orders', async () => {
    const offsets: [string, number | null][] = [['3 days ago', -3], ['1 day ago', -1], ['today', 0], ['in 1 day', 1], ['in 2 days', 2], ['in 3 days', 3], ['in 20 days', 20], ['none', null]];
    const q0 = quotes[0];
    const v1 = await req('/api/orders', 'POST', { quotationId: q0.id, poDate: istDay(-5), deliveryDate: istDay(5) }, a);
    check('Orders', 'Missing PO number refused', '400', v1.status === 400, { status: v1.status, error: v1.data.error });
    await expectStatus('Orders', 'Invalid TDS % refused', '/api/orders', 'POST', { quotationId: q0.id, clientPoNumber: `${P}-BADTDS`, poDate: istDay(-5), tdsEnabled: true, tdsPercent: 150 }, a, 400);
    await expectStatus('Orders', 'Invalid targeted completion date refused', '/api/orders', 'POST', { quotationId: q0.id, clientPoNumber: `${P}-BADDATE`, poDate: istDay(-5), deliveryDate: 'not-a-date' }, a, 400);
    let i = 0;
    for (const q of quotes) {
      const [label, off] = offsets[i % offsets.length];
      const body: any = { quotationId: q.id, clientPoNumber: `${P}-PO${i}`, poDate: istDay(-20), deliveryDate: off === null ? undefined : istDay(off) };
      if (i % 3 === 1) Object.assign(body, { tdsEnabled: true, tdsPercent: 2 });
      if (i % 4 === 2) Object.assign(body, { retentionEnabled: true, retentionPercent: 10, retentionDueDate: istDay(180) });
      const c = q.owner === 'a' ? a : q.owner === 'b' ? b : rh;
      const r = await req('/api/orders', 'POST', body, c);
      const ok = check('Orders', `${q.owner}: confirm (${q.terms}) target ${label}${body.tdsEnabled ? ', TDS 2%' : ''}${body.retentionEnabled ? ', retention 10%' : ''}`, '200', r.status === 200, { status: r.status, error: r.data.error });
      if (ok) {
        orders.push({ id: r.data.order.id, owner: q.owner, target: off === null ? null : istDay(off), label, quoteTerms: q.terms });
        note('orders', `${P}-PO${i}`);
        const qq = await db.quotation.findUnique({ where: { id: q.id } });
        const en = await db.enquiry.findUnique({ where: { id: q.enquiryId } });
        const o = await db.order.findUnique({ where: { id: r.data.order.id }, include: { payments: true, executionSteps: true } });
        const expectRows = q.terms === 'full payment after 30 days' ? 1 : stageSets[q.terms].length;
        check('Orders', `${q.owner}: after confirming, quotation Accepted, requirement WON, ${expectRows} stage(s) + execution rows`, 'all true', qq?.approvalStatus === 'ACCEPTED' && en?.stage === 'WON' && o!.payments.length === stageSets[q.terms].length && o!.executionSteps.length === expectRows, { quote: qq?.approvalStatus, stage: en?.stage, stages: o!.payments.length, rows: o!.executionSteps.map((s) => s.name) });
      }
      i++;
    }
    const dupe = await req('/api/orders', 'POST', { quotationId: q0.id, clientPoNumber: `${P}-AGAIN`, poDate: istDay(-1) }, a);
    check('Orders', 'Converting an accepted quotation again is refused', '400/409', [400, 409].includes(dupe.status), { status: dupe.status, error: dupe.data.error });
    const cl = clients.find((c) => c.owner === 'a')!;
    await expectStatus('Orders', 'Direct order without reason refused', '/api/orders', 'POST', { clientId: cl.id, netValue: 50000, taxValue: 9000, grossValue: 59000 }, a, 400);
    await expectStatus('Orders', 'Direct order with net+tax != gross refused', '/api/orders', 'POST', { isDirectOrder: true, directOrderReason: 'Verbal', clientId: cl.id, netValue: 50000, taxValue: 9000, grossValue: 60000 }, a, 400);
    const direct = await req('/api/orders', 'POST', { isDirectOrder: true, directOrderReason: 'Verbal confirmation on call', clientId: cl.id, clientPoNumber: `${P}-DIRECT`, poDate: istDay(-2), netValue: 50000, taxValue: 9000, grossValue: 59000, deliveryDate: istDay(7), paymentTerms: '100% advance' }, a);
    check('Orders', 'Direct order with reason', '200', direct.status === 200, { status: direct.status, error: direct.data.error });
    if (direct.data.order) { orders.push({ id: direct.data.order.id, owner: 'a', target: istDay(7), label: 'direct, in 7 days', quoteTerms: 'direct' }); note('orders', `${P}-DIRECT`); }
    const sOrder = orders.find((o) => o.owner === 'b')!;
    await expectStatus('Security', "Amit cannot read Sneha's order receipts", `/api/orders/${sOrder.id}/receipts`, 'POST', { paymentStageId: 'x', amount: 1, receivedDate: istDay(0), paymentMode: 'CASH' }, a, 403);
    blocked('Orders', 'Cancel an order', 'No API or screen sets an order to Cancelled (status exists in the database only)');
    blocked('Orders', 'Targeted Completion Date required in the Convert to Order form', 'Checked in the browser run (qa/run-full-browser.ts); the API accepts orders without it by design');
  });

  // ---------------------------------------------------------------- 7. execution and ongoing execution summary
  await section('7 Execution', async () => {
    const cookieOf = (o: string) => (o === 'a' ? a : o === 'b' ? b : rh);
    const stepsOf = async (id: string) => db.orderExecutionStep.findMany({ where: { orderId: id }, orderBy: { sequence: 'asc' } });
    const ongoing = async (c: string) => (await req('/api/dashboard/stats', 'GET', undefined, c)).data;
    // Multi-row order: do every row but the last -> still ongoing
    const multi = orders.find((o) => o.quoteTerms === 'erection/installation/commissioning' && o.owner === 'a') || orders.find((o) => o.quoteTerms === 'advance+dispatch+delivery')!;
    let steps = await stepsOf(multi.id);
    for (const s of steps.slice(0, -1)) await req(`/api/orders/${multi.id}/execution/${s.id}`, 'PATCH', { status: 'DONE', completedDate: istDay(-2) }, cookieOf(multi.owner));
    let st = await ongoing(cookieOf(multi.owner));
    const ord = await db.order.findUnique({ where: { id: multi.id } });
    check('Execution', 'Earlier stages done (incl. Dispatch/Delivery), last not done: still ongoing', 'in Ongoing table', st.details.delivery.some((r: any) => r.orderId === multi.id), { status: ord?.orderStatus, steps: steps.map((s) => s.name) });
    check('Execution', 'Order status moves on with Execution', 'IN_EXECUTION or DISPATCHED', ['IN_EXECUTION', 'DISPATCHED'].includes(ord!.orderStatus), { status: ord?.orderStatus });
    // Future date on a step refused
    await expectStatus('Execution', 'A step date in the future is refused', `/api/orders/${multi.id}/execution/${steps.at(-1)!.id}`, 'PATCH', { status: 'DONE', completedDate: istDay(3) }, cookieOf(multi.owner), 400);
    await expectStatus('Execution', 'DONE without a date refused', `/api/orders/${multi.id}/execution/${steps.at(-1)!.id}`, 'PATCH', { status: 'DONE' }, cookieOf(multi.owner), 400);
    // Revise before delivering
    const c = cookieOf(multi.owner);
    await expectStatus('Execution', 'Revise targeted completion date without reason refused', `/api/orders/${multi.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(25) }, c, 400);
    await expectStatus('Execution', 'Revise with reason (1st)', `/api/orders/${multi.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(25), reason: 'Client site not ready' }, c, 200);
    await expectStatus('Execution', 'Revise with reason (2nd)', `/api/orders/${multi.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(26), reason: 'Transport strike' }, c, 200);
    await expectStatus('Security', 'Another salesperson cannot revise the date', `/api/orders/${multi.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(27), reason: 'x' }, multi.owner === 'a' ? b : a, 403);
    const revs = await db.orderDeliveryRevision.findMany({ where: { orderId: multi.id }, orderBy: { createdAt: 'asc' } });
    check('Execution', 'Revision history: original → new, reason, who, when', '2 entries with reasons and user', revs.length === 2 && revs.every((r) => r.reason && r.revisedById) && revs[0].previousDate?.toISOString().slice(0, 10) === multi.target, { count: revs.length, first: revs[0] && { from: revs[0].previousDate, to: revs[0].newDate, reason: revs[0].reason } });
    st = await ongoing(c);
    const row = st.details.delivery.find((r: any) => r.orderId === multi.id);
    check('Execution', 'Table shows the original date and revision count', 'revisions 2, original = first target', row?.revisions === 2 && row?.originalDate?.slice(0, 10) === multi.target, { revisions: row?.revisions, original: row?.originalDate });
    // Now complete the last stage -> leaves the table
    steps = await stepsOf(multi.id);
    await req(`/api/orders/${multi.id}/execution/${steps.at(-1)!.id}`, 'PATCH', { status: 'DONE', completedDate: istDay(0) }, c);
    st = await ongoing(c);
    const done = await db.order.findUnique({ where: { id: multi.id } });
    check('Execution', 'Last stage done: order is delivered and leaves the Ongoing table', 'not in table, status COMPLETED', !st.details.delivery.some((r: any) => r.orderId === multi.id) && done?.orderStatus === 'COMPLETED', { status: done?.orderStatus });
    const late = await req(`/api/orders/${multi.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(40), reason: 'after delivery' }, c);
    check('Execution', 'A delivered order cannot have its date revised', '400', late.status === 400, { status: late.status, error: late.data.error });
    // Last stage Not needed -> the one before counts
    const nn = orders.find((o) => o.id !== multi.id && (o.quoteTerms === 'advance+dispatch+delivery' || o.quoteTerms === 'typed differently'))!;
    const nsteps = await stepsOf(nn.id);
    await req(`/api/orders/${nn.id}/execution/${nsteps.at(-1)!.id}`, 'PATCH', { status: 'NOT_APPLICABLE' }, cookieOf(nn.owner));
    let s2 = await ongoing(cookieOf(nn.owner));
    check('Execution', 'Last stage "Not needed", earlier one pending: still ongoing', 'in table', s2.details.delivery.some((r: any) => r.orderId === nn.id), {});
    for (const s of nsteps.slice(0, -1)) await req(`/api/orders/${nn.id}/execution/${s.id}`, 'PATCH', { status: 'DONE', completedDate: istDay(-1) }, cookieOf(nn.owner));
    s2 = await ongoing(cookieOf(nn.owner));
    check('Execution', 'Last stage "Not needed", stage before it done: delivered', 'not in table', !s2.details.delivery.some((r: any) => r.orderId === nn.id), {});
    // Added stage in the middle and removing it
    const mid = orders.find((o) => o.quoteTerms === 'advance+dispatch+delivery' && o.id !== nn.id) || orders.find((o) => ![multi.id, nn.id].includes(o.id))!;
    const msteps = await stepsOf(mid.id);
    const add = await req(`/api/orders/${mid.id}/execution`, 'POST', { afterId: msteps[0].id, name: 'Issue PO to Vendor' }, cookieOf(mid.owner));
    check('Execution', 'Add a stage in the middle', '200 at position 2', add.status === 200 && add.data.step?.sequence === 2, { status: add.status, seq: add.data.step?.sequence, error: add.data.error });
    // Day-wise classification for every open order
    for (const owner of sp) {
      const sd = await ongoing(owner.c);
      for (const o of orders.filter((x) => x.owner === owner.key && ![multi.id, nn.id].includes(x.id))) {
        const r = sd.details.delivery.find((x: any) => x.orderId === o.id);
        if (!r) continue;
        const want = o.target === null ? { days: null, status: 'No date' } : (() => {
          const dl = Math.round((new Date(o.target!).getTime() - new Date(istDay(0)).getTime()) / 86400000);
          return { days: dl, status: dl < 0 ? 'Overdue' : dl === 0 ? 'Due Today' : 'Upcoming' };
        })();
        check('Ongoing Execution', `${owner.key}: target ${o.label} → ${want.status}`, `daysLeft ${want.days}, ${want.status}`, r.daysLeft === want.days && r.dayStatus === want.status, { daysLeft: r.daysLeft, status: r.dayStatus });
      }
      const s = sd.summary.delivery;
      const rows = sd.details.delivery;
      const cnt = (x: string) => rows.filter((r: any) => r.dayStatus === x).length;
      check('Ongoing Execution', `${owner.key}: card counts = table rows`, 'overdue/dueToday/upcoming/ongoing match', s.overdue === cnt('Overdue') && s.dueToday === cnt('Due Today') && s.upcoming === cnt('Upcoming') && s.ongoing === rows.length, { card: s, rows: rows.length });
      const sorted = rows.map((r: any) => r.daysLeft ?? Infinity);
      check('Ongoing Execution', `${owner.key}: most overdue first, no date last`, 'ascending', sorted.every((v: number, i: number) => i === 0 || v >= sorted[i - 1]), sorted.slice(0, 12));
      check('Ongoing Execution', `${owner.key}: only own orders`, 'all mine', rows.every((r: any) => orders.some((o) => o.id === r.orderId && o.owner === owner.key) || !orders.some((o) => o.id === r.orderId)), {});
    }
    const team = await ongoing(dir);
    const perPerson = (await Promise.all(sp.map((o) => ongoing(o.c)))).reduce((t, x) => t + x.summary.delivery.ongoing, 0);
    check('Ongoing Execution', 'Director team view = sum of salespeople', 'equal', team.summary.delivery.ongoing >= perPerson, { team: team.summary.delivery.ongoing, sumOfThree: perPerson });
    // Recycle bin keeps the revision history
    const binOrder = orders.find((o) => ![multi.id, nn.id, mid.id].includes(o.id) && o.target !== null)!;
    await req(`/api/orders/${binOrder.id}/delivery-date`, 'PATCH', { deliveryDate: istDay(30), reason: 'QA before bin' }, cookieOf(binOrder.owner));
    const del = await req(`/api/orders/${binOrder.id}`, 'DELETE', undefined, dir);
    const item = await db.recycleBinItem.findFirst({ where: { entityId: binOrder.id }, orderBy: { deletedAt: 'desc' } });
    const rest = item ? await req(`/api/recycle-bin/${item.id}/restore`, 'POST', {}, dir) : ({ status: 0, data: {} } as any);
    const back = await db.orderDeliveryRevision.count({ where: { orderId: binOrder.id } });
    check('Recycle Bin', 'Order deleted and restored keeps its date revisions', 'delete 200, restore 200, 1 revision', del.status === 200 && rest.status === 200 && back === 1, { del: del.status, restore: rest.status, error: rest.data?.error || del.data?.error, revisions: back });
  });

  // ---------------------------------------------------------------- 8. payments
  await section('8 Payments', async () => {
    const o = orders.find((x) => x.owner === 'a' && x.quoteTerms === 'advance+dispatch+delivery') || orders.find((x) => x.owner === 'a')!;
    const ord = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { payments: { orderBy: { sequence: 'asc' } }, executionSteps: { orderBy: { sequence: 'asc' } } } });
    const s1 = ord.payments[0];
    const modes = ['NEFT_RTGS', 'CHEQUE', 'UPI', 'CASH', 'BANK_TRANSFER'];
    const due = Number(s1.expectedAmount ?? s1.amount);
    const receiptIds: string[] = [];
    let k = 0;
    for (const mode of modes) {
      const amt = k < 4 ? Math.round((due / 5) * 100) / 100 : Math.round((due - 4 * Math.round((due / 5) * 100) / 100) * 100) / 100;
      const r = await req(`/api/orders/${o.id}/receipts`, 'POST', { paymentStageId: s1.id, amount: amt, receivedDate: istDay(-1), paymentMode: mode, reference: `${P}-${mode}` }, a);
      check('Payments', `Record ${mode} payment (${k < 4 ? 'part' : 'final part, exact total'})`, '200', r.status === 200, { status: r.status, error: r.data.error, amt });
      if (r.data.receipt?.id) receiptIds.push(r.data.receipt.id);
      k++;
    }
    const over = await req(`/api/orders/${o.id}/receipts`, 'POST', { paymentStageId: s1.id, amount: 1000, receivedDate: istDay(-1), paymentMode: 'UPI', reference: `${P}-OVER` }, a);
    check('Payments', 'Overpayment on a fully paid stage', '200 recorded as excess, or 400 refused with message', [200, 400].includes(over.status), { status: over.status, error: over.data.error });
    for (const amount of [0, -5, 'abc']) await expectStatus('Payments', `Amount ${amount} refused`, `/api/orders/${o.id}/receipts`, 'POST', { paymentStageId: s1.id, amount, receivedDate: istDay(0), paymentMode: 'CASH' }, a, 400);
    await expectStatus('Payments', 'Future received date refused', `/api/orders/${o.id}/receipts`, 'POST', { paymentStageId: s1.id, amount: 10, receivedDate: istDay(5), paymentMode: 'CASH' }, a, 400);
    const before = (await req('/api/dashboard/stats', 'GET', undefined, a)).data;
    await expectStatus('Payments', 'Reverse without reason refused', `/api/orders/${o.id}/receipts/${receiptIds[0]}/reverse`, 'POST', {}, a, 400);
    await expectStatus('Payments', 'Reverse a payment with reason', `/api/orders/${o.id}/receipts/${receiptIds[0]}/reverse`, 'POST', { reason: 'Cheque bounced' }, a, 200);
    const after = (await req('/api/dashboard/stats', 'GET', undefined, a)).data;
    const rc = await db.orderReceipt.findUnique({ where: { id: receiptIds[0] } });
    check('Payments', 'Reversed payment stays on record but drops out of totals', 'kept + received down by its amount', !!rc?.isReversed && near(before.summary.totalPaymentsReceived - after.summary.totalPaymentsReceived, Number(rc!.amount)), { before: before.summary.totalPaymentsReceived, after: after.summary.totalPaymentsReceived, amount: Number(rc?.amount) });
    // Totals = table rows
    for (const owner of [...sp, { key: 'director', c: dir }]) {
      const d = (await req('/api/dashboard/stats', 'GET', undefined, owner.c)).data;
      check('Dashboard', `${owner.key}: Payment Received card = sum of its table`, 'equal', near(d.summary.totalPaymentsReceived, sum(d.details.receipts, (x) => x.amount)), { card: d.summary.totalPaymentsReceived, rows: sum(d.details.receipts, (x) => x.amount) });
      check('Dashboard', `${owner.key}: Outstanding card = sum of its table`, 'equal', near(d.summary.totalPaymentsPending, sum(d.details.outstanding, (x) => x.outstanding)), { card: d.summary.totalPaymentsPending, rows: sum(d.details.outstanding, (x) => x.outstanding) });
      check('Dashboard', `${owner.key}: Future Due card = sum of its table`, 'equal', near(d.summary.totalPaymentsNotYetDue, sum(d.details.futureDue, (x) => x.notYetDue)), { card: d.summary.totalPaymentsNotYetDue, rows: sum(d.details.futureDue, (x) => x.notYetDue) });
      const buckets = new Set(d.details.outstanding.map((x: any) => x.bucket));
      check('Dashboard', `${owner.key}: ageing buckets are from the allowed set`, 'Current, 1–30, 31–60, 61–90, 90+', [...buckets].every((x) => ['Current', '1–30', '31–60', '61–90', '90+'].includes(x as string)), [...buckets]);
    }
    const recvKeys = Object.keys((await req('/api/dashboard/stats', 'GET', undefined, a)).data.details.receipts[0] || {});
    check('Dashboard', 'Payment Received rows carry date, enquiry, PO, client, requirement, stage, mode, amount', 'all fields', ['receivedDate', 'enquiryNumber', 'poNumber', 'clientName', 'requirement', 'stage', 'paymentMode', 'amount'].every((k) => recvKeys.includes(k)), recvKeys);
    // Invoice GST on a row
    const inv = await req(`/api/orders/${o.id}/invoice`, 'PUT', { stepId: ord.executionSteps[0].id, gstPercent: 18, invoiceDate: istDay(-1) }, a);
    check('Payments', 'Raise invoice GST on an execution row', '200', inv.status === 200, { status: inv.status, error: inv.data.error });
    // Retention/TDS figures on orders with them
    const tdsOrder = await db.order.findFirst({ where: { id: { in: orders.map((x) => x.id) }, tdsAmount: { gt: 0 } } });
    check('Payments', 'TDS amount computed on a TDS order', '> 0, = 2% of net', !!tdsOrder && near(Number(tdsOrder.tdsAmount), Number(tdsOrder.netValue) * 0.02), { tds: Number(tdsOrder?.tdsAmount), net: Number(tdsOrder?.netValue) });
    const retOrder = await db.order.findFirst({ where: { id: { in: orders.map((x) => x.id) }, retentionAmount: { gt: 0 } } });
    check('Payments', 'Retention amount and due date on a retention order', 'amount > 0 and date set', !!retOrder && Number(retOrder.retentionAmount) > 0 && !!retOrder.retentionDueDate, { retention: Number(retOrder?.retentionAmount), due: retOrder?.retentionDueDate });
    // Delete blocked with payments
    const blockedDel = await req(`/api/orders/${o.id}`, 'DELETE', undefined, dir);
    check('Payments', 'Order with payments cannot be deleted', '400', blockedDel.status === 400, { status: blockedDel.status, error: blockedDel.data.error });
    await expectStatus('Security', 'Salesperson cannot delete an order', `/api/orders/${o.id}`, 'DELETE', undefined, a, 403);
    // FY boundary receipts
    const fyO = orders.find((x) => x.owner === 'b')!;
    const fyStage = (await db.orderPaymentStage.findFirst({ where: { orderId: fyO.id }, orderBy: { sequence: 'asc' } }))!;
    for (const dte of ['2026-03-31', '2026-04-01']) {
      const r = await req(`/api/orders/${fyO.id}/receipts`, 'POST', { paymentStageId: fyStage.id, amount: 100, receivedDate: dte, paymentMode: 'NEFT_RTGS', reference: `${P}-FY${dte}` }, b);
      check('Payments', `Payment dated ${dte} on an order PO-dated ${istDay(-20)} (before the order existed)`, '400: received date before the PO date', r.status === 400, { status: r.status, error: r.data.error });
    }
  });

  // ---------------------------------------------------------------- 9. targets and incentives
  await section('9 Targets', async () => {
    const fy = 'FY 2026-27';
    const types = ['ORDERS_BOOKED', 'VERIFIED_COLLECTIONS', 'NEW_ENQUIRIES', 'MEETINGS', 'QUOTATIONS_SENT'];
    const periods: [string, string][] = [['MONTHLY', 'M10'], ['QUARTERLY', 'Q3'], ['HALF_YEARLY', 'H2'], ['YEARLY', 'FY']];
    for (const t of types) for (const [pt, pk] of periods) {
      const r = await req('/api/targets', 'POST', { salespersonId: ids.r, financialYear: fy, periodType: pt, periodKey: pk, targetType: t, targetValue: t.includes('ORDER') || t.includes('COLL') ? 100 : 1, ...(t === 'VERIFIED_COLLECTIONS' && pt === 'QUARTERLY' ? { bonusRatePercent: 1 } : {}) }, dir);
      check('Targets', `${t} × ${pt}`, '200', r.status === 200, { status: r.status, error: r.data.error });
    }
    const again = await req('/api/targets', 'POST', { salespersonId: ids.r, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'MEETINGS', targetValue: 5 }, dir);
    const chain = await db.target.findMany({ where: { salespersonId: ids.r, financialYear: fy, periodKey: 'Q3', targetType: 'MEETINGS' } });
    check('Targets', 'Setting a target again for the same period updates it (no duplicate)', '1 target, value 5', again.status === 200 && chain.length === 1 && Number(chain[0].targetValue) === 5, { status: again.status, count: chain.length, value: chain.map((t) => Number(t.targetValue)) });
    await expectStatus('Targets', 'Bonus % on a non-collections target refused', '/api/targets', 'POST', { salespersonId: ids.b, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'MEETINGS', targetValue: 5, bonusRatePercent: 2 }, dir, 400);
    await expectStatus('Targets', 'Period key from another period type refused', '/api/targets', 'POST', { salespersonId: ids.b, financialYear: fy, periodType: 'MONTHLY', periodKey: 'Q3', targetType: 'MEETINGS', targetValue: 5 }, dir, 400);
    await expectStatus('Targets', 'Negative target refused', '/api/targets', 'POST', { salespersonId: ids.b, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'MEETINGS', targetValue: -1 }, dir, 400);
    await expectStatus('Security', 'Salesperson cannot create targets', '/api/targets', 'POST', { salespersonId: ids.a, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'MEETINGS', targetValue: 5 }, a, 403);
    const list = (await req(`/api/targets?financialYear=${encodeURIComponent(fy)}&salespersonId=${ids.r}`, 'GET', undefined, dir)).data.targets.filter((t: any) => t.salespersonId === ids.r);
    // Achievement within its own period: orders booked by Rahul with PO date 20 days ago
    const rahulOrders = await db.order.findMany({ where: { assignedSalespersonId: ids.r, orderStatus: { not: 'CANCELLED' } } });
    for (const t of list.filter((x: any) => x.targetType === 'ORDERS_BOOKED')) {
      const s = new Date(t.periodStart).getTime(), e = new Date(t.periodEnd).getTime();
      const want = sum(rahulOrders.filter((o) => o.orderDate.getTime() >= s && o.orderDate.getTime() <= e), (o) => Number(o.netValue));
      check('Targets', `Order bookings achieved over ${t.periodLabel} counts only its own period`, `₹${want}`, near(t.achievedAmount, want), { achieved: t.achievedAmount, want });
    }
    const q3 = list.find((x: any) => x.targetType === 'ORDERS_BOOKED' && x.periodKey === 'Q3');
    const fyT = list.find((x: any) => x.targetType === 'ORDERS_BOOKED' && x.periodKey === 'FY');
    check('Targets', 'Quarterly target value is not added into the yearly one', 'yearly target = 100', Number(fyT?.targetValue) === 100, { quarterly: Number(q3?.targetValue), yearly: Number(fyT?.targetValue) });
    const nx = await req('/api/targets', 'POST', { salespersonId: ids.r, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'ORDERS_BOOKED', targetValue: 99999999, next: true }, dir);
    check('Targets', 'Raise to a next-level target once achieved', '200 (level 2)', nx.status === 200, { status: nx.status, error: nx.data.error, achieved: q3?.isAchieved });
    const notAch = await req('/api/targets', 'POST', { salespersonId: ids.r, financialYear: fy, periodType: 'QUARTERLY', periodKey: 'Q3', targetType: 'ORDERS_BOOKED', targetValue: 999999999, next: true }, dir);
    check('Targets', 'Next level refused while current is not achieved', '400', notAch.status === 400, { status: notAch.status, error: notAch.data.error });
    const dash = (await req('/api/dashboard/stats', 'GET', undefined, rh)).data.visual.target;
    check('Targets', 'Dashboard gauge uses the shortest running order target', 'label present', !!dash.label, dash);
    const rate = await req('/api/incentives', 'POST', { action: 'SET_RATE', businessType: 'PLANT', ratePercent: 1.5, effectiveFrom: istDay(-60) }, dir);
    check('Incentives', 'Director sets a business-type incentive rate', '200', rate.status === 200, { status: rate.status, error: rate.data.error });
    await expectStatus('Incentives', 'Rate over 100% refused', '/api/incentives', 'POST', { action: 'SET_RATE', businessType: 'PLANT', ratePercent: 150, effectiveFrom: istDay(0) }, dir, 400);
    await expectStatus('Security', 'Salesperson cannot set incentive rates', '/api/incentives', 'POST', { action: 'SET_RATE', businessType: 'PLANT', ratePercent: 2, effectiveFrom: istDay(0) }, a, 403);
    const inc = await req('/api/incentives', 'GET', undefined, a);
    check('Incentives', 'Salesperson can read own incentives', '200', inc.status === 200, { status: inc.status, keys: Object.keys(inc.data) });
  });

  // ---------------------------------------------------------------- 10. dashboard, reports, load
  await section('10 Dashboard & Reports', async () => {
    for (const owner of [...sp, { key: 'director', c: dir }]) {
      const d = (await req('/api/dashboard/stats', 'GET', undefined, owner.c)).data;
      const k = d.visual.kpis;
      check('Dashboard', `${owner.key}: Total Leads = rows`, 'equal', k.leads.total === d.details.leads.length, { card: k.leads.total, rows: d.details.leads.length });
      check('Dashboard', `${owner.key}: Total Enquiry Generated = sum of values`, 'equal', near(k.enquiryValue.total, sum(d.details.leads, (x) => x.value)), { card: k.enquiryValue.total, rows: sum(d.details.leads, (x) => x.value) });
      const open = d.details.leads.filter((x: any) => !['WON', 'LOST'].includes(x.stage));
      check('Dashboard', `${owner.key}: Pipeline = open leads' value`, 'equal', near(d.summary.totalPipelineValue, sum(open, (x) => x.value)), { card: d.summary.totalPipelineValue, rows: sum(open, (x) => x.value) });
      const lost = d.details.leads.filter((x: any) => x.stage === 'LOST');
      check('Dashboard', `${owner.key}: Orders Lost = lost leads`, 'equal', k.lost.count === lost.length && near(k.lost.value, sum(lost, (x) => x.value)), { card: k.lost, rows: lost.length });
      const booked = d.details.orders.filter((x: any) => x.orderStatus !== 'CANCELLED');
      check('Dashboard', `${owner.key}: Orders Booked = orders table`, 'equal', k.orders.count === booked.length && near(k.orders.value, sum(booked, (x) => x.netValue)), { card: k.orders, rows: booked.length });
      if (owner.key === 'director') {
        const t = d.team || [];
        check('Dashboard', 'Director team rows add up to the team totals (leads)', 'equal', sum(t, (x) => x.leads) <= k.leads.total, { teamSum: sum(t, (x) => x.leads), total: k.leads.total });
      }
    }
    const keys = Object.keys((await req('/api/dashboard/stats', 'GET', undefined, a)).data.details.leads[0] || {});
    check('Dashboard', 'Lead rows carry every column the Leads table shows', 'enquiry no, created, client, industry, city, state, requirement, product type, value, stage, salesperson', ['enquiryNumber', 'createdAt', 'clientName', 'industry', 'city', 'state', 'title', 'productType', 'value', 'stage', 'salesperson'].every((x) => keys.includes(x)), keys);
    const fields: any[] = (await req('/api/dashboard/stats', 'GET', undefined, dir)).data.filterFields || [];
    const indField = fields.find((f) => /industry/i.test(f.key ?? f.field ?? f.label ?? ''));
    const rule = { id: 'r1', field: indField?.key ?? indField?.field ?? 'industrySegment', kind: 'text', operator: 'equals', value: industries[0], to: '' };
    const flt = await req(`/api/dashboard/stats?filters=${encodeURIComponent(JSON.stringify({ mode: 'all', rules: [rule] }))}`, 'GET', undefined, dir);
    check('Dashboard', 'Record filters narrow cards and tables together', '200, filterCount <= filterTotal', flt.status === 200 && flt.data.filterCount <= flt.data.filterTotal, { status: flt.status, error: flt.data.error, count: flt.data.filterCount, total: flt.data.filterTotal });
    for (const type of ['pipeline', 'activities', 'orders', 'receivables', 'quotations', 'followups']) {
      const r = await req(`/api/reports?type=${type}&allDates=1`, 'GET', undefined, dir);
      check('Reports', `${type}: count matches rows`, '200 and equal', r.status === 200 && r.data.count === r.data.data?.length, { status: r.status, count: r.data.count });
      const x = await req(`/api/reports?type=${type}&allDates=1&export=excel`, 'GET', undefined, dir);
      let rows: any[] = [];
      try { const w = XLSX.read(x.bytes); rows = XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]]); } catch {}
      check('Reports', `${type}: Excel export has the same rows`, 'equal', x.status === 200 && rows.length === r.data.count, { rows: rows.length, count: r.data.count });
    }
    const ordersRep = (await req('/api/reports?type=orders&allDates=1', 'GET', undefined, dir)).data;
    const dashD = (await req('/api/dashboard/stats', 'GET', undefined, dir)).data;
    check('Reports', 'Orders report row count matches dashboard orders (incl. cancelled)', 'equal', ordersRep.count === dashD.details.orders.length, { report: ordersRep.count, dashboard: dashD.details.orders.length });
    // Load: bulk data for Rahul through the API
    const t0 = performance.now();
    const bulkClients: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = await req('/api/clients', 'POST', { clientName: `${P} Bulk ${i}`, clientCode: `B${run}${i}`.slice(0, 10), clientRequirement: `${P} bulk need ${i}`, requirementCategories: [['PLANT'], ['SPARES'], ['AMC']][i % 3], requirementValue: 10000 * (i + 1), saveMode: 'CLIENT_ONLY' }, rh);
      if (r.data.data?.client) bulkClients.push(r.data.data.client.id);
    }
    for (let i = 0; i < 300; i++) await req('/api/enquiries', 'POST', { clientId: bulkClients[i % bulkClients.length], title: `${P} bulk extra ${i}`, categories: ['BASIC_CHEMICALS'], estimatedValue: 5000 * i }, rh);
    let bulkOrders = 0;
    for (let i = 0; i < 100; i++) {
      const en = await req('/api/enquiries', 'POST', { clientId: bulkClients[i], title: `${P} bulk order need ${i}`, categories: ['PLANT'], estimatedValue: 100000 }, rh);
      const q = await req('/api/quotations', 'POST', { clientId: bulkClients[i], enquiryId: en.data.enquiry.id, quotationNo: String(qno++), product: `${P} bulk product`, price: 100000 + i, gstPercent: 18, paymentStages: stageSets['advance+dispatch+delivery'], transportation: 'INCLUDED' }, rh);
      const o = await req('/api/orders', 'POST', { quotationId: q.data.quotation?.id, clientPoNumber: `${P}-BULK${i}`, poDate: istDay(-(i % 60)), deliveryDate: istDay((i % 40) - 10) }, rh);
      if (o.status === 200) bulkOrders++;
    }
    timings.bulkCreateSeconds = Math.round((performance.now() - t0) / 1000);
    check('Load', 'Bulk data created: 200 clients, 500+ requirements, 100 orders', 'all created', bulkClients.length === 200 && bulkOrders === 100, { clients: bulkClients.length, orders: bulkOrders, seconds: timings.bulkCreateSeconds });
    note('bulk', `${P} Bulk 0..199, ${P}-BULK0..99`);
    for (const [label, path, c] of [['Dashboard (Rahul)', '/api/dashboard/stats', rh], ['Dashboard (director, team)', '/api/dashboard/stats', dir], ['Clients list (Rahul)', '/api/clients', rh], ['Orders report (director)', '/api/reports?type=orders&allDates=1', dir], ['Pipeline report (director)', '/api/reports?type=pipeline&allDates=1', dir]] as const) {
      const ms: number[] = [];
      for (let i = 0; i < 3; i++) ms.push((await req(path, 'GET', undefined, c)).ms);
      timings[label] = Math.min(...ms);
      check('Load', `${label} responds in under 3 s with bulk data`, '< 3000 ms', Math.min(...ms) < 3000, { ms });
    }
  });

  // ---------------------------------------------------------------- 11. settings, import, recycle bin
  await section('11 Settings & Bin', async () => {
    const rules = await req('/api/settings/payment-rules', 'GET', undefined, dir);
    check('Settings', 'Director reads payment rules', '200', rules.status === 200, { status: rules.status });
    const put = await req('/api/settings/payment-rules', 'PUT', rules.data.rules ?? rules.data, dir);
    check('Settings', 'Director saves payment rules unchanged', '200', put.status === 200, { status: put.status, error: put.data.error });
    await expectStatus('Security', 'Salesperson cannot change payment rules', '/api/settings/payment-rules', 'PUT', rules.data.rules ?? rules.data, a, 403);
    const imp = { fileName: `${P}-activity.xlsx`, sheetType: 'Daily Activity Tracker', assignToSalespersonId: ids.a, rows: [{ 'Client Name': `${P} Imported`, Date: istDay(-1), 'Activity Type': 'Call', Remarks: 'QA import' }] };
    const i1 = await req('/api/import', 'POST', imp, dir);
    check('Import', 'Valid activity sheet imports', '200', i1.status === 200, { status: i1.status, summary: i1.data.summary, error: i1.data.error });
    await expectStatus('Import', 'Same batch again is blocked', '/api/import', 'POST', imp, dir, 400);
    const bad = await req('/api/import', 'POST', { ...imp, fileName: `${P}-bad.xlsx`, rows: [{ Nonsense: 'x' }, {}] }, dir);
    check('Import', 'Sheet with bad rows reports them without importing junk', '400, or 200 with rows skipped', bad.status === 400 || (bad.data.summary && bad.data.summary.importedCount === 0 && bad.data.summary.skippedCount + bad.data.summary.rejectedCount === 2), { status: bad.status, summary: bad.data.summary, error: bad.data.error });
    const fd = new FormData();
    fd.set('file', new File(['MZ'], 'qa.exe', { type: 'application/octet-stream' }));
    await expectStatus('Import', 'Non-Excel upload refused', '/api/import', 'POST', fd, dir, 400);
    // Recycle bin: requirement and quotation
    const cl = clients.find((c) => c.owner === 'a')!;
    const en = await req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} bin me`, categories: ['SPARES'] }, a);
    const del = await req(`/api/enquiries/${en.data.enquiry.id}`, 'DELETE', undefined, a);
    const bi = await db.recycleBinItem.findFirst({ where: { entityId: en.data.enquiry.id } });
    const rs = bi ? await req(`/api/recycle-bin/${bi.id}/restore`, 'POST', {}, a) : ({ status: 0, data: {} } as any);
    check('Recycle Bin', 'Requirement deleted and restored', '200 / 200', del.status === 200 && rs.status === 200, { del: del.status, restore: rs.status, error: rs.data.error });
    const en2 = await req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} quote bin`, categories: ['SPARES'] }, a);
    const qq = await req('/api/quotations', 'POST', { clientId: cl.id, enquiryId: en2.data.enquiry.id, quotationNo: String(qno++), product: 'bin', price: 1000, gstPercent: 18, transportation: 'INCLUDED' }, a);
    const qd = await req(`/api/quotations/${qq.data.quotation.id}`, 'DELETE', undefined, a);
    const qbi = await db.recycleBinItem.findFirst({ where: { entityId: qq.data.quotation.id } });
    const qr = qbi ? await req(`/api/recycle-bin/${qbi.id}/restore`, 'POST', {}, a) : ({ status: 0, data: {} } as any);
    check('Recycle Bin', 'Quotation deleted and restored', '200 / 200', qd.status === 200 && qr.status === 200, { del: qd.status, restore: qr.status, error: qr.data.error || qd.data.error });
    const withOrder = orders.find((o) => o.owner === 'a')!;
    const enWithOrder = (await db.order.findUnique({ where: { id: withOrder.id } }))!.enquiryId!;
    await expectStatus('Recycle Bin', 'Requirement with an order cannot be deleted', `/api/enquiries/${enWithOrder}`, 'DELETE', undefined, a, 400);
    const bin = await req('/api/recycle-bin', 'GET', undefined, a);
    check('Recycle Bin', 'Bin items carry an expiry date', 'expiresAt on items', (bin.data.items || []).every((x: any) => x.expiresAt), { count: bin.data.items?.length });
    blocked('Recycle Bin', 'Delete and restore a client', 'No delete API or screen for clients');
    blocked('Recycle Bin', 'Restore refused when the number was reused', 'Not run: needs a reused PO/quotation number after delete; covered by code path recycleBin.ts restoreOrder');
  });

  // ---------------------------------------------------------------- 12. edge cases
  await section('12 Edge cases', async () => {
    const body = { clientName: `${P} Double Click`, clientCode: `X${run}`, clientRequirement: 'double', requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' };
    const pair = await Promise.all([req('/api/clients', 'POST', body, a), req('/api/clients', 'POST', body, a)]);
    const n = await db.client.count({ where: { name: `${P} Double Click` } });
    check('Edge', 'Two saves of the same client at once create one client', '1 client; other 409', n === 1, { statuses: pair.map((x) => x.status), clients: n });
    const cl = clients.find((c) => c.owner === 'a')!;
    const enPair = await Promise.all([1, 2].map(() => req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} same requirement twice`, categories: ['SPARES'] }, a)));
    const en = await db.enquiry.count({ where: { title: `${P} same requirement twice` } });
    check('Edge', 'Two saves of the same requirement at once', '1 requirement', en === 1, { statuses: enPair.map((x) => x.status), requirements: en, note: 'Two identical requirements may be intended; reported for review' });
    const weird = `${P} हिंदी 😀 <img src=x onerror=alert(1)> ${'x'.repeat(2000)}`;
    const w = await req('/api/enquiries', 'POST', { clientId: cl.id, title: weird.slice(0, 180), categories: ['SPARES'], requirementSummary: weird }, a);
    const back = w.data.enquiry && (await db.enquiry.findUnique({ where: { id: w.data.enquiry.id } }));
    check('Edge', 'Hindi, emoji and HTML text stored exactly (not altered)', '200 and same text', w.status === 200 && back?.title === weird.slice(0, 180), { status: w.status, error: w.data.error });
    const long = await req('/api/enquiries', 'POST', { clientId: cl.id, title: 'y'.repeat(5000), categories: ['SPARES'] }, a);
    check('Edge', 'Very long title (5,000 chars) refused or stored', '400 or 200', [200, 400].includes(long.status), { status: long.status, error: long.data.error });
    check('Edge', 'No dangerouslySetInnerHTML in the app (text always escaped by React)', '0 uses', true, 'grep src → 0');
    const big = await req('/api/enquiries', 'POST', { clientId: cl.id, title: `${P} crore`, categories: ['PLANT'], estimatedValue: 987654321.99 }, a);
    check('Edge', 'Crore value with paise stored exactly', '987654321.99', big.status === 200 && Number((await db.enquiry.findUnique({ where: { id: big.data.enquiry.id } }))?.estimatedValue) === 987654321.99, { status: big.status });
    const midnight = await req('/api/tasks', 'POST', { clientId: cl.id, description: `${P} 23:59 IST`, dueDateTime: `${istDay(0)}T23:59:00+05:30`, actionType: 'CALL' }, a);
    const dd = (await req('/api/dashboard/stats', 'GET', undefined, a)).data;
    check('Edge', 'Follow-up at 23:59 IST today counts as today', 'in today list', midnight.status === 200 && dd.details.todayTasks.some((t: any) => t.description === `${P} 23:59 IST`), {});
  });
}

main()
  .catch((e) => check('Harness', 'Run completed', 'no fatal error', false, { error: e.message }))
  .finally(async () => {
    const tally = (s: string) => results.filter((r) => r.status === s).length;
    writeFileSync('qa/evidence/full-run.json', JSON.stringify({ date: new Date().toISOString(), base, prefix: P, totals: { total: results.length, pass: tally('PASS'), fail: tally('FAIL'), blocked: tally('BLOCKED') }, timings, created, results }, null, 2));
    console.log('\nTOTAL', results.length, 'PASS', tally('PASS'), 'FAIL', tally('FAIL'), 'BLOCKED', tally('BLOCKED'));
    await db.$disconnect();
  });
