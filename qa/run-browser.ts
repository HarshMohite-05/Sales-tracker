// Browser suite: drives headless Google Chrome over the DevTools protocol.
// Checks real sign-in, every page at phone/tablet/desktop widths (overflow, console errors, axe-core WCAG A/AA),
// keyboard focus visibility and empty-form validation.
// Usage: QA_BASE=http://127.0.0.1:3200 npx tsx qa/run-browser.ts [label]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.QA_BASE || 'http://127.0.0.1:3200';
const label = process.argv[2] || 'latest';
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const shots = `qa/evidence/browser-${label}`; mkdirSync(shots, { recursive: true });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: any[] = []; let seq = 0;
function check(module: string, scenario: string, expected: string, pass: boolean, evidence: any) {
  const entry = { id: `QB-${String(++seq).padStart(3, '0')}`, module, scenario, expected, actual: evidence, status: pass ? 'PASS' : 'FAIL' };
  results.push(entry); console.log(entry.id, entry.status, scenario, JSON.stringify(evidence).slice(0, 400));
}

const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'qa-chrome-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ws: WebSocket; let id = 0; const pending = new Map<number, (v: any) => void>(); const events: any[] = [];
function send(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const msgId = ++id; ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(msgId, (m: any) => m.error ? reject(Error(method + ': ' + m.error.message)) : resolve(m.result)));
}
async function connect() {
  for (let i = 0; i < 40; i++) { try { const v = await (await fetch('http://127.0.0.1:9333/json/version')).json(); ws = new WebSocket(v.webSocketDebuggerUrl); break; } catch { await wait(250); } }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } else events.push(m); });
}
let s = '';
const evaluate = async (expression: string) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
async function goto(path: string) {
  events.length = 0;
  await send('Page.navigate', { url: base + path }, s);
  for (let i = 0; i < 60; i++) { await wait(200); if (await evaluate('document.readyState') === 'complete') break; }
  // Let client-side data requests settle: wait until no "Loading" text and no pending spinner for 600ms.
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) { await wait(200); stable = (await evaluate(`!/Loading/i.test(document.body.innerText) && !document.querySelector('[aria-busy="true"],.animate-spin')`)) ? stable + 1 : 0; }
}
const consoleErrors = () => events.filter(e => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')).map(e => (e.params.exceptionDetails?.exception?.description || e.params.args?.map((a: any) => a.value ?? a.description).join(' ') || `${e.params.entry?.text} ${e.params.entry?.url ?? ''}`).slice(0, 200));
async function screenshot(name: string) { const r = await send('Page.captureScreenshot', { format: 'png' }, s); writeFileSync(`${shots}/${name}.png`, Buffer.from(r.data, 'base64')); }
async function viewport(width: number, height: number) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, s); }

async function main() {
  await connect();
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  s = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await send(`${domain}.enable`, {}, s);
  await viewport(1366, 768);

  // Sign-in form: empty submit, wrong password, real sign-in via keyboard.
  await goto('/login');
  await evaluate(`document.querySelector('button[type=submit]').click()`); await wait(400);
  const emptyLogin = await evaluate(`({ url: location.pathname, invalid: [...document.querySelectorAll('input')].filter(i => !i.checkValidity()).length })`);
  check('Login', 'Empty sign-in is blocked in the browser', 'Stays on /login with invalid fields', emptyLogin.url === '/login' && emptyLogin.invalid > 0, emptyLogin);
  const fill = (sel: string, value: string) => evaluate(`(() => { const el = document.querySelector('${sel}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await fill('#login-page-field-1', 'rajesh.sharma@nirmaanwater.com'); await fill('#login-page-field-2', 'wrong-password');
  await evaluate(`document.querySelector('button[type=submit]').click()`); await wait(1200);
  const wrong = await evaluate(`({ url: location.pathname, alert: [...document.querySelectorAll('[role=alert],.text-red-600,.text-red-700,.text-rose-600,.text-rose-700')].map(e => e.innerText).join(' | ') })`);
  check('Login', 'Wrong password shows an error and stays signed out', 'Error text on /login', wrong.url === '/login' && wrong.alert.length > 0, wrong);
  await fill('#login-page-field-2', 'Nirmaan@2026');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, s);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, s);
  for (let i = 0; i < 30; i++) { await wait(200); if (await evaluate('location.pathname') !== '/login') break; }
  const landed = await evaluate('location.pathname');
  check('Login', 'Director signs in with Enter key', 'Leaves /login for the dashboard', landed === '/dashboard', { landed });

  // Every page at three widths.
  const pages = ['/dashboard', '/clients', '/proposals', '/orders', '/activities', '/targets', '/reports', '/recycle-bin', '/settings'];
  const clientId = (await evaluate(`fetch('/api/clients').then(r => r.json()).then(d => d.clients[0]?.id)`));
  if (clientId) pages.push(`/clients/${clientId}`);
  const axeTotals: Record<string, any> = {};
  for (const [vw, vh, name] of [[390, 844, 'phone'], [768, 1024, 'tablet'], [1366, 768, 'desktop']] as const) {
    await viewport(vw, vh);
    for (const path of pages) {
      await goto(path);
      const tag = `${name} ${path.replace(/[0-9a-f-]{36}/, ':id')}`;
      const layout = await evaluate(`(() => {
        const vw = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          if (!r.width || cs.visibility === 'hidden' || cs.display === 'none') return false;
          for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; }
          return r.right > vw + 1 || r.left < -1; }).slice(0, 5).map(el => (el.tagName + '.' + String(el.className).split(' ').slice(0, 3).join('.')).slice(0, 80) + ' ' + (el.innerText || '').slice(0, 30));
        // Content inside clipping parents can still widen the page; name the widest such element too
        const wide = [];
        if (document.documentElement.scrollWidth > vw) {
          // Deepest elements whose content spills past them (overflow visible) beyond the viewport
          const spill = [...document.querySelectorAll('body *')].filter(el => getComputedStyle(el).overflowX === 'visible' && el.scrollWidth > vw + 1);
          for (const el of spill.slice(-3)) wide.push((el.tagName + '.' + String(el.className).split(' ').slice(0, 5).join('.')).slice(0, 100) + ' sw=' + el.scrollWidth + ' "' + (el.innerText || '').slice(0, 20) + '"');
        }
        return { scrollWidth: document.documentElement.scrollWidth, vw, offenders, wide, heading: document.querySelector('h1')?.innerText, errorBanner: [...document.querySelectorAll('[role=alert]')].map(e => e.innerText).filter(Boolean).join(' | ') };
      })()`);
      check('Layout', `${tag}: no horizontal page scroll or off-screen content`, 'scrollWidth <= viewport and no clipped elements', layout.scrollWidth <= layout.vw && layout.offenders.length === 0, layout);
      check('Pages', `${tag}: loads with a heading and no error banner`, 'h1 present, no alert', !!layout.heading && !layout.errorBanner, { heading: layout.heading, alert: layout.errorBanner });
      const errors = consoleErrors();
      check('Pages', `${tag}: no console errors`, 'none', errors.length === 0, errors);
      await screenshot(tag.replace(/[^a-z0-9]+/gi, '_'));
      if (name === 'desktop' || name === 'phone') {
        await evaluate(axeSource + ';0');
        const axe = await evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes[0]?.target?.join(' ')?.slice(0, 80), summary: v.nodes[0]?.failureSummary?.slice(0, 160), pairs: v.id === 'color-contrast' ? v.nodes.map(n => { const d = n.any[0]?.data || {}; return d.fgColor + ' on ' + d.bgColor + ' ' + d.contrastRatio + ' ' + d.fontSize + ' | ' + n.target.join(' ').slice(-50); }) : [] })))`);
        for (const v of axe) { const k = v.id; axeTotals[k] = axeTotals[k] || { impact: v.impact, pages: [], nodes: 0, sample: v.sample, summary: v.summary, pairs: {} }; axeTotals[k].pages.push(tag); axeTotals[k].nodes += v.count; for (const p of v.pairs) { const key = p.split(' | ')[0]; axeTotals[k].pairs[key] = axeTotals[k].pairs[key] || { count: 0, example: p.split(' | ')[1] }; axeTotals[k].pairs[key].count++; } }
        const serious = axe.filter((v: any) => v.impact === 'serious' || v.impact === 'critical');
        check('Accessibility', `${tag}: no serious or critical WCAG 2.1 AA violations (axe-core)`, 'none', serious.length === 0, serious.map((v: any) => `${v.id}×${v.count}`));
      }
    }
  }

  // Keyboard: Tab through the clients page; every focused element must show a visible focus indicator.
  await viewport(1366, 768); await goto('/clients');
  const focus: any[] = [];
  for (let i = 0; i < 25; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, s);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, s);
    focus.push(await evaluate(`(() => { const el = document.activeElement; const cs = getComputedStyle(el); const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      return { el: el.tagName + ' ' + (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().slice(0, 30), visible }; })()`));
  }
  const invisible = focus.filter(f => !f.visible);
  check('Accessibility', 'Keyboard focus is visible on every tab stop (clients page, 25 stops)', 'All stops show outline or ring', invisible.length === 0, { stops: focus.length, invisible: invisible.map(f => f.el) });

  // Empty "Add client" form: submit and confirm the user is told what is missing.
  await goto('/clients');
  const opened = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^\\s*Add client\\s*$/i.test(b.innerText)); b?.click(); return !!b; })()`); await wait(700);
  const submitted = await evaluate(`(() => { const dlg = document.querySelector('[role=dialog]') || document; const b = [...dlg.querySelectorAll('button')].filter(b => /save|create|add/i.test(b.innerText)).pop(); b?.click(); return b?.innerText; })()`); await wait(700);
  const formState = await evaluate(`(() => { const dlg = document.querySelector('[role=dialog]') || document; return { dialogOpen: !!document.querySelector('[role=dialog]'), invalidNative: [...dlg.querySelectorAll('input,select,textarea')].filter(i => !i.checkValidity()).map(i => i.name || i.id).slice(0, 6), messages: [...dlg.querySelectorAll('[role=alert],[aria-invalid=true],.text-red-600,.text-rose-600')].map(e => e.innerText || e.getAttribute('name') || e.id).filter(Boolean).slice(0, 6) }; })()`);
  await screenshot('desktop_add_client_empty_submit');
  check('Forms', 'Empty Add client submission is blocked with a visible reason', 'Dialog stays open with invalid fields or messages', opened && formState.dialogOpen && (formState.invalidNative.length > 0 || formState.messages.length > 0), { submitted, ...formState });

  writeFileSync(`qa/evidence/browser-${label}-axe.json`, JSON.stringify(axeTotals, null, 2));
  console.log('AXE SUMMARY', JSON.stringify(Object.entries(axeTotals).map(([k, v]: any) => `${k}(${v.impact}) nodes=${v.nodes} pages=${v.pages.length} e.g. ${v.sample}`), null, 1));
}
main().catch(e => { check('Harness', 'Execution completed', 'No harness errors', false, { error: e.message }); console.error(e); }).finally(() => {
  writeFileSync(`qa/evidence/browser-${label}.json`, JSON.stringify({ date: new Date().toISOString(), environment: base, results }, null, 2));
  console.log('TOTAL', results.length, 'PASS', results.filter(r => r.status === 'PASS').length, 'FAIL', results.filter(r => r.status === 'FAIL').length);
  try { ws?.close(); } catch {} chrome.kill('SIGTERM'); setTimeout(() => process.exit(0), 300);
});
