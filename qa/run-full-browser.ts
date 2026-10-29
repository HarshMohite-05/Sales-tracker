// Browser checks for qa/full-test-prompt.md that the API run cannot see: the Ongoing Execution Summary card,
// table and Days filter, the Leads column order, the client page refreshing after Add Client (existing client),
// the Targeted Completion Date being required in Confirm Order, and HTML text never running as code.
// Drives headless Chrome over the DevTools protocol, like qa/run-browser.ts. Run after qa/run-full.ts.
// Usage: QA_BASE=http://127.0.0.1:3100 npx tsx qa/run-full-browser.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.QA_BASE || 'http://127.0.0.1:3100';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const run = JSON.parse(readFileSync('qa/evidence/full-run.json', 'utf8'));
const P: string = run.prefix;
const shots = 'qa/evidence/browser-full-features';
mkdirSync(shots, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: any[] = [];
let seq = 0;
function check(module: string, scenario: string, expected: string, pass: boolean, actual: any) {
  const entry = { id: `FB-${String(++seq).padStart(3, '0')}`, module, scenario, expected, status: pass ? 'PASS' : 'FAIL', actual };
  results.push(entry);
  console.log(entry.id, entry.status, `[${module}] ${scenario}`, JSON.stringify(actual).slice(0, 300));
}

const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'qa-chrome-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws: WebSocket;
let id = 0;
const pending = new Map<number, (v: any) => void>();
const events: any[] = [];
function send(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(msgId, (m: any) => (m.error ? reject(Error(method + ': ' + m.error.message)) : resolve(m.result))));
}
let s = '';
const evaluate = async (expression: string) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function goto(path: string) {
  await send('Page.navigate', { url: base + path }, s);
  for (let i = 0; i < 60; i++) { await wait(200); if ((await evaluate('document.readyState')) === 'complete') break; }
  let stable = 0;
  for (let i = 0; i < 50 && stable < 3; i++) { await wait(200); stable = (await evaluate(`!/Loading/i.test(document.body.innerText) && !document.querySelector('[aria-busy="true"],.animate-pulse')`)) ? stable + 1 : 0; }
}
async function shot(name: string) {
  const r = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(`${shots}/${name}.png`, Buffer.from(r.data, 'base64'));
}
// Set a React-controlled input or select and fire the events React listens to
const setValue = (selector: string, value: string, root = 'document') =>
  evaluate(`(() => { const el = ${root}.querySelector(${JSON.stringify(selector)}); if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const clickText = (selector: string, re: string, root = 'document') =>
  evaluate(`(() => { const b = [...${root}.querySelectorAll(${JSON.stringify(selector)})].find(b => new RegExp(${JSON.stringify(re)}, 'i').test(b.innerText || b.getAttribute('aria-label') || '')); b?.click(); return !!b; })()`);
const api = (path: string, method = 'GET', body?: any) =>
  evaluate(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, ${body ? `body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(r => r.json())`);

async function main() {
  for (let i = 0; i < 40; i++) { try { const v = await (await fetch('http://127.0.0.1:9334/json/version')).json(); ws = new WebSocket(v.webSocketDebuggerUrl); break; } catch { await wait(250); } }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } else events.push(m); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  s = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  for (const d of ['Page', 'Runtime']) await send(`${d}.enable`, {}, s);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, s);

  // Sign in as Amit through the real form
  await goto('/login');
  await setValue('#login-page-field-1', 'amit.patil@nirmaanwater.com');
  await setValue('#login-page-field-2', 'Nirmaan@2026');
  await evaluate(`document.querySelector('button[type=submit]').click()`);
  for (let i = 0; i < 40; i++) { await wait(200); if ((await evaluate('location.pathname')) !== '/login') break; }
  check('Login', 'Amit signs in through the form', 'lands on /dashboard', (await evaluate('location.pathname')) === '/dashboard', {});
  await goto('/dashboard');

  // ------------------------------------------------------------ Ongoing Execution Summary card
  const card = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Ongoing Execution Summary/.test(b.innerText)); return b ? { text: b.innerText.replace(/\\s+/g, ' '), cls: b.className } : null; })()`);
  const stats = await api('/api/dashboard/stats');
  const dsum = stats.summary.delivery;
  check('Ongoing Execution', 'Card sits after Future Due with overdue count, due today · upcoming, and orders in execution', 'text matches the data', !!card && card.text.includes(`${dsum.overdue} overdue`) && card.text.includes(`${dsum.dueToday} due today · ${dsum.upcoming} upcoming`) && card.text.includes(`${dsum.ongoing} order`), { card: card?.text, data: dsum });
  const order = await evaluate(`[...document.querySelectorAll('button')].map(b => b.innerText.split('\\n').find(Boolean)).filter(t => /Future Due|Ongoing Execution Summary/.test(t || ''))`);
  check('Ongoing Execution', 'Card comes right after Future Due', 'Future Due, then Ongoing Execution Summary', order.join('|') === 'Future Due|Ongoing Execution Summary', order);
  await clickText('button', 'Ongoing Execution Summary');
  await wait(1200);
  await shot('ongoing-table');
  const table = await evaluate(`(() => { const t = document.querySelector('#details-table table') || [...document.querySelectorAll('table')].pop(); const heads = [...t.querySelectorAll('thead th')].map(th => th.innerText.trim());
    const di = heads.indexOf('Days'), si = heads.indexOf('Status');
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim())).filter(r => r.length === heads.length);
    return { heads, rows: rows.map(r => ({ days: r[di], status: r[si] })) }; })()`);
  check('Ongoing Execution', 'Table has Days and Status columns and no Delivery Status column', 'Days + Status present', table.heads.includes('Days') && table.heads.includes('Status') && !table.heads.some((h: string) => /Delivery Status/.test(h)), table.heads);
  const pairsOk = table.rows.every((r: any) => (/overdue$/.test(r.days) && r.status === 'Overdue') || (r.days === '0 days' && r.status === 'Due Today') || (/left$/.test(r.days) && r.status === 'Upcoming') || (r.days === '—' && r.status === 'No date'));
  check('Ongoing Execution', 'Every row reads like the day-wise table (N days overdue → Overdue, 0 days → Due Today, N days left → Upcoming)', 'all rows consistent', table.rows.length > 0 && pairsOk, table.rows.slice(0, 12));
  check('Ongoing Execution', 'Rows show "1 day overdue" / "1 day left" in the singular', 'singular for 1', table.rows.filter((r: any) => /^1 /.test(r.days)).every((r: any) => /^1 day /.test(r.days)), table.rows.filter((r: any) => /^1 /.test(r.days)));
  const opened = await evaluate(`(() => { const b = document.querySelector('button[aria-label="Filter Days"]'); b?.click(); return !!b; })()`);
  await wait(400);
  const popup = await evaluate(`(() => { const d = document.querySelector('[role=dialog][aria-label="Filter Days"]'); if (!d) return null; return { text: d.innerText, kinds: [...d.querySelectorAll('select[aria-label="Which rows"] option')].map(o => o.textContent) }; })()`);
  check('Ongoing Execution', 'Days filter has Left / Overdue / Due today and no quick-filter buttons', 'kinds listed, no "Quick filters"', opened && !!popup && popup.kinds.join(',') === 'Left,Overdue,Due today' && !/Quick filters/i.test(popup.text), popup);
  await setValue('select[aria-label="Which rows"]', 'left');
  await setValue('select[aria-label="Condition"]', 'lte');
  await setValue('input[aria-label="Value"]', '3');
  await evaluate(`document.querySelector('[role=dialog][aria-label="Filter Days"] button[type=submit]').click()`);
  await wait(600);
  await shot('ongoing-left-lte-3');
  const left = await evaluate(`(() => { const t = [...document.querySelectorAll('table')].pop(); const heads = [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()); const di = heads.indexOf('Days');
    return [...t.querySelectorAll('tbody tr')].map(tr => tr.children[di]?.innerText.trim()).filter(Boolean); })()`);
  const want = stats.details.delivery.filter((r: any) => r.daysLeft !== null && r.daysLeft > 0 && r.daysLeft <= 3).length;
  check('Ongoing Execution', 'Left + Less than or equal to + 3 shows only orders with 1–3 days left', `${want} rows, all 1–3 days left`, left.length === Math.min(want, 25) && left.every((d: string) => /^[123] days? left$/.test(d)), { rows: left, want });
  await evaluate(`document.querySelector('button[aria-label="Filter Days"]').click()`);
  await wait(300);
  await setValue('select[aria-label="Which rows"]', 'overdue');
  await setValue('select[aria-label="Condition"]', 'gt');
  await setValue('input[aria-label="Value"]', '2');
  await evaluate(`document.querySelector('[role=dialog][aria-label="Filter Days"] button[type=submit]').click()`);
  await wait(600);
  const over = await evaluate(`(() => { const t = [...document.querySelectorAll('table')].pop(); const heads = [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()); const di = heads.indexOf('Days');
    return [...t.querySelectorAll('tbody tr')].map(tr => tr.children[di]?.innerText.trim()).filter(Boolean); })()`);
  check('Ongoing Execution', 'Overdue + Greater than + 2 shows only orders more than 2 days late', 'all ≥ 3 days overdue', over.length > 0 && over.every((d: string) => Number(d.split(' ')[0]) > 2 && /overdue$/.test(d)), over.slice(0, 10));
  await evaluate(`document.querySelector('button[aria-label="Filter Days"]').click()`);
  await wait(300);
  await setValue('select[aria-label="Which rows"]', 'due');
  const noValue = await evaluate(`!document.querySelector('[role=dialog][aria-label="Filter Days"] input[aria-label="Value"]')`);
  await evaluate(`document.querySelector('[role=dialog][aria-label="Filter Days"] button[type=submit]').click()`);
  await wait(600);
  const today = await evaluate(`(() => { const t = [...document.querySelectorAll('table')].pop(); const heads = [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()); const si = heads.indexOf('Status');
    return [...t.querySelectorAll('tbody tr')].map(tr => tr.children[si]?.innerText.trim()).filter(Boolean); })()`);
  check('Ongoing Execution', 'Due today needs no value and shows only Due Today rows', 'no value box; all Due Today', noValue && today.every((x: string) => x === 'Due Today' || /No records/.test(x)), { noValue, rows: today.slice(0, 10) });
  await clickText('button', '^\\s*Clear all filters\\s*$');

  // ------------------------------------------------------------ Leads column order
  await goto('/dashboard');
  await clickText('button', '^\\s*Total Leads');
  await wait(1000);
  const leadHeads = await evaluate(`[...[...document.querySelectorAll('table')].pop().querySelectorAll('thead th')].map(th => th.innerText.trim())`);
  // A salesperson's own dashboard leaves out the Salesperson column
  const wantHeads = ['Sr. No.', 'Enquiry No.', 'Date Created', 'Client', 'Industry', 'City', 'State', 'Requirement', 'Product Type', 'Enquiry Value', 'Stage'];
  check('Dashboard', 'Leads table columns in the agreed order (salesperson view, no Salesperson column)', wantHeads.join(', '), JSON.stringify(leadHeads) === JSON.stringify(wantHeads), leadHeads);
  await clickText('button', '^\\s*Payment Received');
  await wait(1000);
  const payHeads = await evaluate(`[...[...document.querySelectorAll('table')].pop().querySelectorAll('thead th')].map(th => th.innerText.trim())`);
  const wantPay = ['Sr. No.', 'Payment Date', 'Enquiry No.', 'PO No.', 'Client', 'Requirement', 'Payment Stage', 'Payment Mode', 'Amount Received'];
  check('Dashboard', 'Payment Received columns in the agreed order (salesperson view)', wantPay.join(', '), JSON.stringify(payHeads) === JSON.stringify(wantPay), payHeads);

  // ------------------------------------------------------------ client page refreshes after Add Client (existing)
  const mine = (await api('/api/clients')).clients.find((c: any) => c.name === `${P} Agriculture Client 0` || (c.name.startsWith(P) && !/Bulk|Double|GUARD|Director/.test(c.name)));
  await goto(`/clients/${mine.id}?tab=enquiries`);
  const title = `${P} browser refresh check`;
  await evaluate(`document.querySelector('button[aria-label="Add Client"]').click()`);
  await wait(600);
  await clickText('[role=dialog] button', 'Existing client');
  await wait(300);
  await setValue('[role=dialog] input[placeholder^="Search your clients"]', mine.name);
  await wait(1200);
  await clickText('[role=dialog] button', mine.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  await wait(400);
  await setValue('#modals-AddClientModal-field-10', title);
  await evaluate(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(l => /^\\s*Plant\\s*$/i.test(l.innerText)); (l?.querySelector('input') || l)?.click(); })()`);
  await clickText('[role=dialog] button', '^\\s*Save Requirement\\s*$');
  await wait(2500);
  const seen = await evaluate(`({ dialog: !!document.querySelector('[role=dialog]'), onPage: document.body.innerText.includes(${JSON.stringify(title)}), error: [...document.querySelectorAll('[role=dialog] .text-rose-700, [role=dialog] [role=alert]')].map(e => e.innerText).join(' | ') })`);
  await shot('client-page-after-add-requirement');
  check('Clients', 'New requirement added from Add Client (existing client) appears on the open client page without a reload', 'dialog closed, requirement visible', !seen.dialog && seen.onPage, seen);

  // ------------------------------------------------------------ Confirm Order needs Targeted Completion Date
  const en = await api('/api/enquiries', 'POST', { clientId: mine.id, title: `${P} browser convert`, categories: ['SPARES'], estimatedValue: 10000 });
  const qn = await api('/api/quotations/next-number');
  await api('/api/quotations', 'POST', { clientId: mine.id, enquiryId: en.enquiry.id, quotationNo: String(qn.next ?? qn.quotationNo ?? Date.now() % 100000), product: `${P} browser convert`, price: 10000, gstPercent: 18, paymentStages: [{ percent: 100, description: 'Advance' }], transportation: 'INCLUDED' });
  // Quoted requirements waiting for a PO are listed on the Orders tab with a Confirm Order button
  await goto(`/clients/${mine.id}?tab=orders`);
  const conf = await evaluate(`(() => { const bs = [...document.querySelectorAll('button')].filter(b => /Confirm Order/.test(b.innerText)); const n = bs.length; bs.pop()?.click(); return n; })()`);
  await wait(700);
  // First the "Has the client confirmed this order?" step, then the PO form
  await clickText('[role=dialog] button, button', '^\\s*Yes, confirm order\\s*$');
  await wait(600);
  await setValue('#modals-ConvertOrderModal-field-1', `${P}-BROWSER-PO`);
  await setValue('#modals-ConvertOrderModal-field-2', new Date().toISOString().slice(0, 10));
  const label = await evaluate(`document.querySelector('label[for="modals-ConvertOrderModal-field-3"]')?.innerText`);
  const required = await evaluate(`document.querySelector('#modals-ConvertOrderModal-field-3')?.required`);
  await evaluate(`[...document.querySelectorAll('[role=dialog] button[type=submit], [role=dialog] button')].filter(b => /Confirm/.test(b.innerText)).pop()?.click()`);
  await wait(800);
  const stillOpen = await evaluate(`({ open: !!document.querySelector('#modals-ConvertOrderModal-field-3'), invalid: !document.querySelector('#modals-ConvertOrderModal-field-3')?.checkValidity() })`);
  await shot('confirm-order-without-target');
  check('Orders', 'Confirm Order: "Targeted Completion Date *" is required; submitting without it is blocked', 'label + required + form stays open', conf > 0 && /Targeted Completion Date \*/.test(label || '') && required === true && stillOpen.open && stillOpen.invalid, { buttons: conf, label, required, ...stillOpen });

  // ------------------------------------------------------------ HTML text never runs
  // The requirement holding the HTML test text (created by qa/run-full.ts)
  const html = (await api('/api/enquiries')).enquiries.find((e: any) => e.title.startsWith(P) && e.title.includes('onerror'));
  events.length = 0;
  await goto(`/clients/${html.clientId}?tab=enquiries`);
  await wait(800);
  const dialogs = events.filter((e) => e.method === 'Page.javascriptDialogOpening').length;
  const literal = await evaluate(`document.body.innerText.includes('<img src=x onerror=alert(1)>')`);
  check('Security', 'HTML typed into a requirement shows as text and never runs', 'no alert dialog; text shown literally', dialogs === 0 && literal, { dialogs, literal });
}

main()
  .catch((e) => check('Harness', 'Run completed', 'no fatal error', false, { error: e.message }))
  .finally(() => {
    writeFileSync('qa/evidence/full-browser.json', JSON.stringify({ date: new Date().toISOString(), base, results }, null, 2));
    console.log('TOTAL', results.length, 'PASS', results.filter((r) => r.status === 'PASS').length, 'FAIL', results.filter((r) => r.status === 'FAIL').length);
    try { ws?.close(); } catch {}
    chrome.kill('SIGTERM');
    setTimeout(() => process.exit(0), 300);
  });
