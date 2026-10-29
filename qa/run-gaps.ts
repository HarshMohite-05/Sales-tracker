// Gap suite: security and input cases not covered by run-api / run-edge / run-workflows.
// Usage: QA_BASE=http://127.0.0.1:3200 npx tsx qa/run-gaps.ts [label]
import { writeFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from '../tests/testDatabaseUrl';
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
const base = process.env.QA_BASE || 'http://127.0.0.1:3200';
const secret = new TextEncoder().encode(process.env.QA_AUTH_SECRET || 'qa-local-only-32-bytes-session-secret-2026');
const run = Date.now().toString().slice(-7), prefix = `QG-${run}`;
const results: any[] = []; let seq = 0;
async function req(path: string, method = 'GET', body?: any, cookie = '') {
  const start = performance.now();
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const bytes = Buffer.from(await r.arrayBuffer()); let data: any; try { data = JSON.parse(bytes.toString()); } catch { data = { bytes: bytes.length }; }
  return { status: r.status, data, ms: Math.round(performance.now() - start), cookie: r.headers.get('set-cookie')?.split(';')[0], bytes, headers: Object.fromEntries(r.headers) };
}
function check(module: string, scenario: string, expected: string, pass: boolean, evidence: any) {
  const entry = { id: `QG-${String(++seq).padStart(3, '0')}`, module, scenario, expected, actual: evidence, status: pass ? 'PASS' : 'FAIL' };
  results.push(entry); console.log(entry.id, entry.status, scenario, JSON.stringify(evidence).slice(0, 240));
}
async function expectStatus(module: string, scenario: string, path: string, method: string, body: any, cookie: string, expected: number[]) {
  const r = await req(path, method, body, cookie);
  check(module, scenario, `HTTP ${expected.join('/')}`, expected.includes(r.status), { status: r.status, error: r.data?.error });
  return r;
}
async function main() {
  const login = async (email: string) => { const r = await req('/api/auth/login', 'POST', { email, password: 'Nirmaan@2026' }); if (r.status !== 200 || !r.cookie) throw Error('login ' + email + ' ' + r.status); return r.cookie; };
  const pick = { id: true, email: true, name: true, role: true, mobile: true, designation: true } as const;
  const amit = await db.user.findUniqueOrThrow({ where: { email: 'amit.patil@nirmaanwater.com' }, select: pick });
  const sneha = await db.user.findUniqueOrThrow({ where: { email: 'sneha.kulkarni@nirmaanwater.com' }, select: pick });

  // --- Sessions and tokens (first: signing out ends every session of that user)
  const throwaway = await login('amit.patil@nirmaanwater.com');
  await req('/api/auth/logout', 'POST', {}, throwaway);
  const reuse = await req('/api/auth/me', 'GET', undefined, throwaway);
  check('Auth', 'Token captured before logout is refused after logout', '401', reuse.status === 401, { status: reuse.status });
  const forgedRole = await new SignJWT({ ...amit, role: 'DIRECTOR' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret'));
  await expectStatus('Auth', 'Token signed with wrong secret', '/api/auth/me', 'GET', undefined, `nirmaan_session=${forgedRole}`, [401]);
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ ...amit, role: 'DIRECTOR', exp: 9999999999 })).toString('base64url') + '.';
  await expectStatus('Auth', 'Unsigned alg=none token', '/api/auth/me', 'GET', undefined, `nirmaan_session=${none}`, [401]);
  const expired = await new SignJWT({ ...amit }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(secret);
  await expectStatus('Auth', 'Expired session token', '/api/auth/me', 'GET', undefined, `nirmaan_session=${expired}`, [401]);
  // A validly signed token claiming DIRECTOR must not grant director rights: role must come from the database.
  const { sessionVersion } = await db.user.findUniqueOrThrow({ where: { id: amit.id } });
  const claimDirector = await new SignJWT({ ...amit, role: 'DIRECTOR', sv: sessionVersion }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(secret);
  await expectStatus('Auth', 'Signed token claiming DIRECTOR for salesperson', '/api/settings/users', 'POST', { name: 'x' }, `nirmaan_session=${claimDirector}`, [403]);
  const caseLogin = await req('/api/auth/login', 'POST', { email: '  AMIT.PATIL@nirmaanwater.com ', password: 'Nirmaan@2026' });
  check('Auth', 'Email is trimmed and case-insensitive at login', '200', caseLogin.status === 200, { status: caseLogin.status });
  // A made-up address, so the lockout does not block the seeded accounts other suites sign in with
  const attempts: number[] = [];
  for (let i = 0; i < 25; i++) attempts.push((await req('/api/auth/login', 'POST', { email: `${prefix.toLowerCase()}-bruteforce@example.test`, password: 'wrong' + i })).status);
  check('Auth', '25 wrong passwords in a row are throttled', 'Some 429 or lockout', attempts.some(s => s === 429 || s === 423), { statuses: [...new Set(attempts)], firstBlockedAt: attempts.findIndex(s => s === 429) + 1 });
  await expectStatus('Auth', 'Lockout of one email does not block other users', '/api/auth/login', 'POST', { email: 'vikram.mehta@nirmaanwater.com', password: 'Nirmaan@2026' }, '', [200]);
  const a = await login('amit.patil@nirmaanwater.com'), b = await login('sneha.kulkarni@nirmaanwater.com'), d = await login('rajesh.sharma@nirmaanwater.com');

  // --- Fixtures owned by Amit
  const c = await req('/api/clients', 'POST', { clientName: `${prefix} =HYPERLINK("http://evil","x") 🚰 जल`, clientCode: `G${run}`, clientRequirement: 'QA gap RO plant', requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' }, a);
  if (!c.data?.data) throw Error('client create ' + JSON.stringify(c.data));
  const { client, enquiry } = c.data.data;
  check('Clients', 'Unicode and emoji client name round-trips', 'Stored unchanged', (await db.client.findUnique({ where: { id: client.id } }))?.name.includes('🚰 जल') === true, { name: client.name });
  const terms = { product: 'QA gap plant', price: 10000, gstPercent: 18, paymentStages: [{ percent: 100, description: 'Advance' }], transportation: 'INCLUDED' };
  const q = await req('/api/quotations', 'POST', { ...terms, clientId: client.id, enquiryId: enquiry.id, quotationNo: String(Number(run) % 900000 + 100000) }, a);
  if (!q.data?.quotation) throw Error('quotation ' + JSON.stringify(q.data));
  const qid = q.data.quotation.id;
  const o = await req('/api/orders', 'POST', { quotationId: qid, clientPoNumber: prefix + '-PO', poDate: '2026-10-20' }, a);
  if (!o.data?.order) throw Error('order ' + JSON.stringify(o.data));
  const oid = o.data.order.id;
  const t = await req('/api/tasks', 'POST', { clientId: client.id, enquiryId: enquiry.id, description: 'QA gap follow up', dueDateTime: '2026-11-05T10:00:00+05:30', actionType: 'CALL' }, a);
  const tid = t.data.task.id;

  // --- Another salesperson (Sneha) against Amit's records
  await expectStatus('Access', 'Other salesperson deletes requirement', `/api/enquiries/${enquiry.id}`, 'DELETE', undefined, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson moves requirement stage', `/api/enquiries/${enquiry.id}/stage`, 'PATCH', { newStage: 'LOST', reason: 'x' }, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson downloads quotation PDF', `/api/quotations/${qid}/pdf`, 'GET', undefined, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson revises quotation', `/api/quotations/${qid}/version`, 'POST', terms, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson edits quotation revision', `/api/quotations/${qid}/versions/1`, 'PATCH', terms, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson deletes quotation', `/api/quotations/${qid}`, 'DELETE', undefined, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson deletes order', `/api/orders/${oid}`, 'DELETE', undefined, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson changes deductions', `/api/orders/${oid}/deductions`, 'PATCH', { tdsEnabled: false }, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson raises invoice', `/api/orders/${oid}/invoice`, 'PUT', { gstPercent: 18, invoiceDate: '2026-10-20' }, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson adds execution step', `/api/orders/${oid}/execution`, 'POST', { name: 'intrusion' }, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson reschedules follow-up', `/api/tasks/${tid}/reschedule`, 'PATCH', { newDueDateTime: '2026-11-09T10:00:00+05:30', reason: 'x' }, b, [403, 404]);
  await expectStatus('Access', 'Other salesperson comments on client', '/api/comments', 'POST', { entityType: 'CLIENT', entityId: client.id, instruction: 'intrusion' }, b, [403, 404]);
  for (const [name, path, key] of [['clients', '/api/clients', 'clients'], ['requirements', '/api/enquiries', 'enquiries'], ['quotations', '/api/quotations', 'quotations'], ['orders', '/api/orders', 'orders'], ['follow-ups', '/api/tasks', 'tasks']] as const) {
    const r = await req(path, 'GET', undefined, b);
    const rows: any[] = r.data?.[key] || r.data?.data || [];
    check('Access', `Other salesperson list of ${name} excludes Amit's record`, 'No foreign rows', !JSON.stringify(rows).includes(client.id), { status: r.status, rows: rows.length });
  }
  const spoof = await req(`/api/orders?salespersonId=${amit.id}`, 'GET', undefined, b);
  check('Access', 'Salesperson filter cannot reveal another salesperson\'s orders', 'No foreign rows', !JSON.stringify(spoof.data).includes(oid), { status: spoof.status });
  const spoofTasks = await req(`/api/tasks?salespersonId=${amit.id}`, 'GET', undefined, b);
  check('Access', 'Salesperson filter cannot reveal another salesperson\'s follow-ups', 'No foreign rows', !JSON.stringify(spoofTasks.data).includes(tid), { status: spoofTasks.status });
  const spoofReport = await req(`/api/reports?type=orders&allDates=1&salespersonId=${amit.id}`, 'GET', undefined, b);
  check('Access', 'Salesperson report filter cannot reveal another salesperson\'s orders', 'No foreign rows', !JSON.stringify(spoofReport.data).includes(prefix), { status: spoofReport.status });
  await expectStatus('Access', 'Salesperson promotes self via user settings', '/api/settings/users', 'PATCH', { id: amit.id, role: 'DIRECTOR' }, a, [403, 405]);
  await expectStatus('Access', 'Salesperson changes payment rules', '/api/settings/payment-rules', 'PUT', {}, a, [403, 405]);
  await expectStatus('Access', 'Salesperson views incentive ledger of colleague', `/api/incentives?salespersonId=${sneha.id}`, 'GET', undefined, a, [200, 403]).then(async r => {
    if (r.status === 200) check('Access', 'Incentive ledger scoped to self', 'No colleague entries', !JSON.stringify(r.data).includes(sneha.name), { status: r.status });
  });

  // --- Mass assignment on client edit
  const before = await db.client.findUniqueOrThrow({ where: { id: client.id } });
  await req(`/api/clients/${client.id}`, 'PATCH', { code: 'HACKED', createdById: sneha.id, assignedSalespersonId: sneha.id, deletedAt: new Date().toISOString() }, a);
  const after = await db.client.findUniqueOrThrow({ where: { id: client.id } });
  check('Access', 'Client edit ignores ownership and system fields', 'Owner and deletion unchanged', JSON.stringify({ ...after, updatedAt: null, name: null }) === JSON.stringify({ ...before, updatedAt: null, name: null }) || ((after as any).deletedAt == null && (after as any).assignedSalespersonId === (before as any).assignedSalespersonId), { changed: Object.keys(after).filter(k => k !== 'updatedAt' && JSON.stringify((after as any)[k]) !== JSON.stringify((before as any)[k])) });

  // --- Inputs
  const long = await req('/api/clients', 'POST', { clientName: prefix + ' ' + 'L'.repeat(5000), clientCode: `H${run}`, clientRequirement: 'QA long', requirementCategories: ['PLANT'], saveMode: 'CLIENT_ONLY' }, a);
  check('Validation', '5,000-character company name', '400, or saved without a server error', long.status === 400 || long.status === 200, { status: long.status, error: long.data?.error });
  const longNote = await req('/api/tasks', 'POST', { clientId: client.id, description: 'D'.repeat(100000), dueDateTime: '2026-11-05T10:00:00+05:30' }, a);
  check('Validation', '100,000-character follow-up description', '400, or saved without a server error', longNote.status === 400 || longNote.status === 200, { status: longNote.status });
  for (const [path, label] of [['/api/quotations?status=BOGUS', 'quotation status'], ['/api/orders?status=BOGUS', 'order status'], ['/api/enquiries?stage=BOGUS', 'requirement stage'], ['/api/enquiries?category=BOGUS', 'requirement category'], ['/api/tasks?view=BOGUS', 'follow-up view'], ['/api/reports?type=BOGUS', 'report type'], ['/api/clients/not-a-uuid', 'client id']])
    await expectStatus('Validation', `Unknown ${label} in URL`, path, 'GET', undefined, d, [200, 400, 404]);
  await expectStatus('Validation', 'Requirement with 1e15 value', '/api/enquiries', 'POST', { clientId: client.id, title: 'QA huge', categories: ['PLANT'], estimatedValue: 1e15 }, a, [200, 400]);
  const spare = (await req('/api/enquiries', 'POST', { clientId: client.id, title: 'QA gap spare', categories: ['PLANT'] }, a)).data.enquiry;
  const spareQuote = { ...terms, clientId: client.id, enquiryId: spare.id, quotationNo: String(Number(run) % 900000 + 100001) };
  await expectStatus('Validation', 'Quotation GST 29%', '/api/quotations', 'POST', { ...spareQuote, gstPercent: 29 }, a, [400]);
  await expectStatus('Validation', 'Quotation stages adding to 90%', '/api/quotations', 'POST', { ...spareQuote, paymentStages: [{ percent: 90, description: 'x' }] }, a, [400]);
  await expectStatus('Validation', 'Quotation price 0', '/api/quotations', 'POST', { ...spareQuote, price: 0 }, a, [400]);
  await expectStatus('Validation', 'Unknown order id', '/api/orders/00000000-0000-0000-0000-000000000000', 'DELETE', undefined, d, [400, 404]);
  await expectStatus('Validation', 'Unknown quotation id', '/api/quotations/00000000-0000-0000-0000-000000000000/pdf', 'GET', undefined, d, [404]);
  await expectStatus('Validation', 'Follow-up on 31 Feb', '/api/tasks', 'POST', { clientId: client.id, description: 'QA', dueDateTime: '2026-02-31T10:00:00+05:30' }, a, [400]);
  await expectStatus('Validation', 'Receipt dated in the future', `/api/orders/${oid}/receipts`, 'POST', { paymentStageId: (await db.orderPaymentStage.findFirstOrThrow({ where: { orderId: oid } })).id, amount: 1, receivedDate: '2099-01-01', paymentMode: 'NEFT_RTGS', reference: prefix + 'F' }, a, [400]);
  const sqli = await req(`/api/clients?search=${encodeURIComponent("' OR 1=1 --")}`, 'GET', undefined, b);
  check('Security', 'SQL-like search text is treated as text', '200 with no foreign rows', sqli.status === 200 && !JSON.stringify(sqli.data).includes(client.id), { status: sqli.status, rows: sqli.data?.clients?.length });

  // --- Export formula injection
  const x = await req('/api/reports?type=pipeline&allDates=1&export=excel', 'GET', undefined, a);
  if (x.status === 200 && x.bytes[0] === 0x50) {
    const ws = XLSX.read(x.bytes, { type: 'buffer', cellFormula: true }); const sheet = ws.Sheets[ws.SheetNames[0]];
    const hit = Object.entries(sheet).find(([k, v]: any) => !k.startsWith('!') && String(v.v ?? '').includes('HYPERLINK'));
    check('Security', 'Client name starting with = exports as text, not a formula', 'Cell type s, no formula', !!hit && (hit[1] as any).t === 's' && !(hit[1] as any).f, { cell: hit?.[0], type: (hit?.[1] as any)?.t, formula: (hit?.[1] as any)?.f });
  } else check('Security', 'Pipeline export downloads', 'xlsx', false, { status: x.status, ct: x.headers['content-type'] });

  // --- Response hardening
  const h = await req('/login'); const headers = Object.keys(h.headers);
  check('Security', 'Clickjacking and sniffing headers on pages', 'x-frame-options or CSP frame-ancestors; nosniff', (headers.includes('x-frame-options') || /frame-ancestors/.test(h.headers['content-security-policy'] || '')) && headers.includes('x-content-type-options'), { xfo: h.headers['x-frame-options'] ?? null, csp: h.headers['content-security-policy'] ?? null, nosniff: h.headers['x-content-type-options'] ?? null, poweredBy: h.headers['x-powered-by'] ?? null });
  const err = await req('/api/clients', 'POST', '{bad json', a);
  check('Security', 'Errors do not leak stack traces or Prisma internals', 'No stack/prisma text', !/prisma|at .*\.ts|invocation/i.test(JSON.stringify(err.data)), { status: err.status, error: err.data?.error });
}
main().catch(e => { check('Harness', 'Execution completed', 'No harness errors', false, { error: e.message }); console.error(e); }).finally(async () => {
  writeFileSync(`qa/evidence/gaps-${process.argv[2] || 'latest'}.json`, JSON.stringify({ date: new Date().toISOString(), environment: base, prefix, results }, null, 2));
  console.log('TOTAL', results.length, 'PASS', results.filter(r => r.status === 'PASS').length, 'FAIL', results.filter(r => r.status === 'FAIL').length);
  await db.$disconnect();
});
