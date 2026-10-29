/**
 * Creates 5 sample requirements through the app's own API (the same requests the screens send), so every
 * validation and calculation runs as it would for a user. Covers each stage from new to won and lost,
 * mixed business types, quotations, orders, execution, payments, follow-ups, targets and incentives.
 * Run on an empty database with the app running and the seeded logins (password Nirmaan@2026):
 *   npx tsx scripts/create-sample-data.ts            (BASE_URL defaults to http://localhost:3000)
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = 'Nirmaan@2026';

type Who = 'director' | 'amit' | 'sneha' | 'rahul';
const EMAIL: Record<Who, string> = {
  director: 'rajesh.sharma@nirmaanwater.com',
  amit: 'amit.patil@nirmaanwater.com',
  sneha: 'sneha.kulkarni@nirmaanwater.com',
  rahul: 'rahul.deshmukh@nirmaanwater.com',
};
const cookies: Partial<Record<Who, string>> = {};

async function login(who: Who) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL[who], password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed for ${EMAIL[who]}: ${res.status} ${await res.text()}`);
  cookies[who] = (res.headers.get('set-cookie') || '').split(';')[0];
}

/** One API call as a user; stops the run with the app's own error message if it fails. */
async function api(who: Who, method: string, path: string, body?: unknown): Promise<any> {
  if (!cookies[who]) await login(who);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[who]! },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} as ${who} → ${res.status}: ${typeof data === 'string' ? data.slice(0, 300) : data.error || JSON.stringify(data)}`);
  return data;
}

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const step = (text: string) => console.log(`  ✓ ${text}`);

async function users() {
  const { users } = await api('director', 'GET', '/api/settings/users');
  const id = (who: Who) => users.find((u: any) => u.email === EMAIL[who])?.id as string;
  return { amit: id('amit'), sneha: id('sneha'), rahul: id('rahul') };
}

async function client(who: Who, data: Record<string, unknown>) {
  await api(who, 'POST', '/api/clients', { saveMode: 'WITH_FOLLOWUP', stageOfLead: 'NEW', typeOfActivity: 'CALL', meetingType: 'INTRODUCTORY', clientType: 'End User', ...data });
  const { clients } = await api('director', 'GET', '/api/clients');
  const c = clients.find((x: any) => x.name === data.clientName);
  if (!c) throw new Error(`Client ${data.clientName} was not found after saving`);
  return c.id as string;
}

async function detail(clientId: string) {
  const res = await api('director', 'GET', `/api/clients/${clientId}`);
  return res.client ?? res;
}

async function requirement(clientId: string, title: string) {
  const c = await detail(clientId);
  const e = c.enquiries.find((x: any) => x.title === title);
  if (!e) throw new Error(`Requirement "${title}" not found on the client`);
  return e;
}

async function main() {
  console.log(`Creating sample data on ${BASE}`);
  const { clients: existing } = await api('director', 'GET', '/api/clients');
  if (existing.length) throw new Error(`The database already has ${existing.length} client(s). Run this on an empty database.`);
  const sp = await users();

  // ---- Client 1: Shree Ganesh Pharma (Amit) ------------------------------------------------------
  console.log('Shree Ganesh Pharma Pvt Ltd · Amit Patil');
  const ganesh = await client('amit', {
    clientName: 'Shree Ganesh Pharma Pvt Ltd',
    clientCode: 'SGP',
    industrySegment: 'Pharmaceutical',
    contactPerson: 'Dr. Anil Kulkarni',
    contactDesignation: 'Plant Head',
    mobileNumber: '9822011223',
    emailAddress: 'anil.kulkarni@sgpharma.example',
    location: 'Pune',
    state: 'Maharashtra',
    leadSource: 'Direct Inbound',
    clientRequirement: '50 KLD ETP with dosing chemicals',
    requirementCategories: ['PLANT', 'BASIC_CHEMICALS'],
    requirementValue: 1800000,
    requirementDetails: '50 KLD effluent treatment plant plus first-year supply of coagulant and antiscalant',
    keyDiscussionPoints: 'Needs commissioning before the March audit; wants chemicals supplied with the plant',
    nextAction: 'CALL',
    nextActionDate: at(-3, 11), // overdue follow-up
  });
  step('client + requirement 1 (Plant + Basic Chemicals, ₹18 L), follow-up 3 days overdue');

  // Requirement 1 → quotation → order → execution → payments
  const r1 = await requirement(ganesh, '50 KLD ETP with dosing chemicals');
  const q1 = await api('amit', 'POST', '/api/quotations', {
    clientId: ganesh,
    enquiryId: r1.id,
    quotationNo: '101',
    product: '50 KLD ETP with dosing chemicals',
    price: 1800000,
    gstPercent: 18,
    transportation: 'EXTRA_AT_ACTUAL',
    paymentStages: [
      { percent: 30, description: 'Advance' },
      { percent: 60, description: 'Before Dispatch' },
      { percent: 10, description: 'On Commissioning' },
    ],
  });
  const quote1 = q1.quotation ?? q1.data ?? q1;
  step(`quotation ${quote1.quotationNumber ?? ''} (30% advance / 60% before dispatch / 10% commissioning)`);
  const o1 = await api('amit', 'POST', '/api/orders', {
    quotationId: quote1.id,
    clientPoNumber: 'SGP/PO/2026/101',
    poDate: day(-20),
    orderDate: day(-20),
    deliveryDate: day(40),
    tdsEnabled: true,
    tdsPercent: 2,
  });
  const order1 = o1.order ?? o1.data ?? o1;
  step(`order ${order1.orderNumber} confirmed from the quotation, 2% TDS`);

  // ---- Client 2: Aqua Textiles (Sneha) ------------------------------------------------------------
  console.log('Aqua Textiles Ltd · Sneha Kulkarni');
  const aqua = await client('sneha', {
    clientName: 'Aqua Textiles Ltd',
    clientCode: 'AQT',
    industrySegment: 'Textiles',
    contactPerson: 'Meera Shah',
    contactDesignation: 'Purchase Manager',
    mobileNumber: '9825033441',
    emailAddress: 'meera.shah@aquatex.example',
    location: 'Surat',
    state: 'Gujarat',
    leadSource: 'Referral',
    referredBy: 'Krishna Chemicals',
    clientRequirement: 'Special chemicals for dye-house RO',
    requirementCategories: ['SPECIAL_CHEMICALS'],
    requirementValue: 450000,
    requirementDetails: 'Antiscalant and membrane cleaner for 3 RO trains, 12-month supply',
    keyDiscussionPoints: 'Comparing with current supplier on price per kg',
    nextAction: 'MEETING',
    nextActionDate: at(0, 16), // follow-up today
  });
  step('client + requirement 3 (Special Chemicals, ₹4.5 L), follow-up today');
  const r3 = await requirement(aqua, 'Special chemicals for dye-house RO');
  const q3 = await api('sneha', 'POST', '/api/quotations', {
    clientId: aqua,
    enquiryId: r3.id,
    quotationNo: '102',
    product: 'RO antiscalant + membrane cleaner, 12 months',
    price: 450000,
    gstPercent: 18,
    transportation: 'INCLUDED',
    paymentStages: [{ creditDays: 30 }],
  });
  step(`quotation ${(q3.quotation ?? q3.data ?? q3).quotationNumber ?? ''} sent (full payment 30 days after delivery)`);
  await api('sneha', 'PATCH', `/api/enquiries/${r3.id}/stage`, { newStage: 'NEGOTIATION', reason: 'Client asked for 5% off on a 12-month contract' });
  step('requirement 3 moved to Negotiation');

  // Requirement 4: AMC for the same client, new requirement on an existing client
  await api('sneha', 'POST', '/api/enquiries', {
    clientId: aqua,
    title: 'Annual O&M for 200 KLD STP',
    categories: ['AMC'],
    estimatedValue: 240000,
    requirementSummary: 'Operation & maintenance with monthly visits and quarterly membrane cleaning',
    nextAction: 'CALL',
    nextActionDate: at(5, 11), // future follow-up
  });
  step('requirement 4 (O&M & AMC, ₹2.4 L) on the same client, follow-up in 5 days');

  // ---- Client 3: Krishna Chemicals (Rahul) --------------------------------------------------------
  console.log('Krishna Chemicals · Rahul Deshmukh');
  const krishna = await client('rahul', {
    clientName: 'Krishna Chemicals',
    clientCode: 'KCH',
    industrySegment: 'Chemical',
    contactPerson: 'Vikas Patel',
    contactDesignation: 'Director',
    mobileNumber: '9879012345',
    emailAddress: 'vikas@krishnachem.example',
    location: 'Vapi',
    state: 'Gujarat',
    leadSource: 'Exhibition',
    clientRequirement: '100 KLD zero liquid discharge plant',
    requirementCategories: ['PLANT'],
    requirementValue: 2500000,
    requirementDetails: 'ZLD with MEE and ATFD for process effluent',
    keyDiscussionPoints: 'Budget approval pending with the board',
    nextAction: 'CALL',
    nextActionDate: at(2, 12),
  });
  step('client + requirement 5 (Plant, ₹25 L)');
  const r5 = await requirement(krishna, '100 KLD zero liquid discharge plant');
  await api('rahul', 'PATCH', `/api/enquiries/${r5.id}/stage`, { newStage: 'LOST', reason: 'Went with a lower-priced competitor' });
  step('requirement 5 marked Lost');

  // Requirement 2: spares for Shree Ganesh, ordered on fixed credit terms
  console.log('Shree Ganesh Pharma Pvt Ltd · second requirement');
  await api('amit', 'POST', '/api/enquiries', {
    clientId: ganesh,
    title: 'RO membranes and cartridge spares',
    categories: ['SPARES'],
    estimatedValue: 120000,
    requirementSummary: '4 x 8040 RO membranes and 50 cartridge filters',
    nextAction: 'CALL',
    nextActionDate: at(1, 11),
  });
  const r2 = await requirement(ganesh, 'RO membranes and cartridge spares');
  const q2 = await api('amit', 'POST', '/api/quotations', {
    clientId: ganesh,
    enquiryId: r2.id,
    quotationNo: '103',
    product: 'RO membranes 8040 x4 + cartridges x50',
    price: 120000,
    gstPercent: 18,
    transportation: 'INCLUDED',
    paymentStages: [{ creditDays: 30 }],
  });
  const o2 = await api('amit', 'POST', '/api/orders', {
    quotationId: (q2.quotation ?? q2.data ?? q2).id,
    clientPoNumber: 'SGP/PO/2026/115',
    poDate: day(-10),
    orderDate: day(-10),
  });
  step(`requirement 2 (Spares, ₹1.2 L) quoted and ordered: ${(o2.order ?? o2.data ?? o2).orderNumber}`);

  // ---- Execution and payments on order 1 --------------------------------------------------------
  console.log('Order SGP/PO/2026/101 · execution and payments');
  const c1 = await detail(ganesh);
  const ord1 = c1.orders.find((o: any) => o.orderNumber === 'SGP/PO/2026/101');
  const steps1 = [...ord1.executionSteps].sort((a: any, b: any) => a.sequence - b.sequence);
  const advanceStep = steps1.find((s: any) => /advance/i.test(s.name)) ?? steps1[0];
  await api('amit', 'PATCH', `/api/orders/${ord1.id}/execution/${advanceStep.id}`, { status: 'DONE', completedDate: day(-18) });
  step(`execution: "${advanceStep.name}" done 18 days ago (raises the advance as due)`);
  const fresh1 = (await detail(ganesh)).orders.find((o: any) => o.id === ord1.id);
  const stages = [...fresh1.payments].sort((a: any, b: any) => a.sequence - b.sequence);
  const advance = stages[0];
  const part = Math.round(Number(advance.expectedAmount) * 0.6);
  await api('amit', 'POST', `/api/orders/${ord1.id}/receipts`, { paymentStageId: advance.id, amount: part, receivedDate: day(-15), paymentMode: 'NEFT_RTGS', reference: 'UTR-SGP-0001' });
  await api('amit', 'POST', `/api/orders/${ord1.id}/receipts`, {
    paymentStageId: advance.id,
    amount: Number(advance.expectedAmount) - part,
    receivedDate: day(-5),
    paymentMode: 'CHEQUE',
    reference: 'CHQ-458812',
  });
  step(`advance received in two parts (60% then 40%) of ₹${Number(advance.expectedAmount).toLocaleString('en-IN')}`);

  // ---- Targets, a mixed-order split and incentives --------------------------------------------------
  console.log('Targets and incentives');
  const fy = (await api('director', 'GET', '/api/incentives')).financialYear as string;
  const quarter = `Q${Math.floor(((new Date().getMonth() + 9) % 12) / 3) + 1}`;
  await api('director', 'POST', '/api/targets', {
    salespersonId: sp.amit, financialYear: fy, periodType: 'QUARTERLY', periodKey: quarter,
    targetType: 'VERIFIED_COLLECTIONS', targetValue: 300000, bonusRatePercent: 1,
  });
  await api('director', 'POST', '/api/targets', { salespersonId: sp.amit, financialYear: fy, periodType: 'YEARLY', periodKey: 'FY', targetType: 'ORDERS_BOOKED', targetValue: 5000000 });
  await api('director', 'POST', '/api/targets', { salespersonId: sp.sneha, financialYear: fy, periodType: 'YEARLY', periodKey: 'FY', targetType: 'ORDERS_BOOKED', targetValue: 2000000 });
  await api('director', 'POST', '/api/targets', {
    salespersonId: sp.rahul, financialYear: fy, periodType: 'MONTHLY', periodKey: `M${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    targetType: 'NEW_ENQUIRIES', targetValue: 5,
  });
  step(`targets: Amit ${quarter} collections ₹3 L (+1% beyond) and yearly bookings ₹50 L; Sneha yearly bookings ₹20 L; Rahul monthly 5 new requirements`);
  await api('director', 'POST', '/api/incentives', {
    action: 'SET_SPLIT', orderId: ord1.id,
    splits: [{ businessType: 'PLANT', amount: 1500000 }, { businessType: 'BASIC_CHEMICALS', amount: 300000 }],
  });
  step('order SGP/PO/2026/101 split: Plant ₹15 L + Basic Chemicals ₹3 L');
  const inc = await api('director', 'GET', '/api/incentives');
  const first = inc.entries.find((e: any) => e.status === 'EARNED');
  if (first) {
    await api('director', 'POST', '/api/incentives', { action: 'APPROVE', entryIds: [first.id] });
    step(`approved one incentive entry (₹${first.incentiveAmount})`);
  }

  // ---- Activity and a note --------------------------------------------------------------------------
  await api('amit', 'POST', '/api/activities', {
    clientId: ganesh, enquiryId: r1.id, activityType: 'SITE_VISIT', discussionType: 'TECHNICAL',
    outcome: 'Site survey completed', keyPoints: 'Space for the ETP and chemical dosing skid confirmed', activityDate: day(-2),
  });
  step('site visit logged on requirement 1');

  console.log('\nDone. Summary:');
  const { clients } = await api('director', 'GET', '/api/clients');
  console.log(`  ${clients.length} clients`);
  const stats = await api('director', 'GET', '/api/dashboard/stats');
  console.log(`  ${stats.visual.kpis.leads.total} requirements · ${stats.visual.kpis.orders.count} orders · received ₹${stats.summary.totalPaymentsReceived.toLocaleString('en-IN')}`);
  console.log(`  follow-ups: ${stats.summary.overdueTasksCount} overdue, ${stats.summary.dueTodayCount} today, ${stats.summary.upcomingTasksCount} later`);
}

main().catch((e) => {
  console.error(`\nSTOPPED: ${e.message}`);
  process.exitCode = 1;
});
