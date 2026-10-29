import {
  PrismaClient,
  Role,
  EnquiryCategory,
  EnquiryStage,
  ActivityType,
  DiscussionType,
  TaskType,
  TaskPriority,
  TaskStatus,
  QuotationStatus,
  ApprovalStatus,
  OrderStatus,
  InvoiceStatus,
  VerificationStatus,
  PaymentMode,
  TargetPeriod,
  TargetType,
  MonetaryBasis,
  SlabMode,
  AuditAction,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { nextDocNumber, nextRequirementNumber } from '../src/lib/numbering';
import { createOrderPayments, recalculateOrderPayments } from '../src/lib/orderPayments';
import { createExecutionSteps, syncPaymentDues } from '../src/lib/orderExecution';
import { getIndianFYQuarter } from '../src/lib/utils';

/**
 * Sample data for Nirmaan WaterTech Solutions CRM.
 *
 * Every record is created the way the app creates it, so all links hold:
 * client (code) -> requirement (CODE/001) -> conversations -> follow-ups -> quotation versions
 * -> approval -> order (from the exact version) -> invoices -> payments (allocated, verified).
 *
 * Re-runnable: it replaces only its own sample clients (SAMPLE_CODES) and leaves
 * any other clients, and existing users' passwords, untouched.
 * Dates are relative to today so "due today" and "overdue" always make sense.
 */

const prisma = new PrismaClient();

const SAMPLE_CODES = ['TWSPL', 'CLL', 'RTM', 'SGACPL'];
const POLICY_TITLE = 'Sales Incentive Policy FY 2026-27';
const LEGACY_POLICY_TITLES = ['Industrial Sales Performance Policy FY 26-27 (Demo)'];

// Probability that matches each stage, as used for the weighted pipeline
const STAGE_PROBABILITY: Record<EnquiryStage, number> = {
  NEW: 20,
  QUALIFIED: 35,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  ON_HOLD: 30,
  WON: 100,
  LOST: 0,
};

// ---------- dates (India time) ----------

const IST_OFFSET_MIN = 330;
const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60000);

/** A moment `days` from today at hh:mm India time (negative days = in the past). */
function at(days: number, hour = 11, minute = 0): Date {
  return new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + days, hour, minute) -
      IST_OFFSET_MIN * 60000
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- users ----------

// The company's offices; employees belong to one
const OFFICES = [
  { code: 'MUM', name: 'Mumbai' },
  { code: 'AMD', name: 'Ahmedabad' },
] as const;

const USERS = [
  { key: 'rajesh', email: 'rajesh.sharma@nirmaanwater.com', name: 'Rajesh Sharma', role: Role.DIRECTOR, mobile: '+91 98200 11223', designation: 'Managing Director', office: 'MUM' },
  { key: 'vikram', email: 'vikram.mehta@nirmaanwater.com', name: 'Vikram Mehta', role: Role.DIRECTOR, mobile: '+91 98200 44556', designation: 'Technical Director', office: 'AMD' },
  { key: 'amit', email: 'amit.patil@nirmaanwater.com', name: 'Amit Patil', role: Role.SALESPERSON, mobile: '+91 98330 55667', designation: 'Senior Sales Engineer - Western Region', office: 'MUM' },
  { key: 'sneha', email: 'sneha.kulkarni@nirmaanwater.com', name: 'Sneha Kulkarni', role: Role.SALESPERSON, mobile: '+91 98190 77889', designation: 'Key Account Manager - Industrial Water', office: 'MUM' },
  { key: 'rahul', email: 'rahul.deshmukh@nirmaanwater.com', name: 'Rahul Deshmukh', role: Role.SALESPERSON, mobile: '+91 98210 99001', designation: 'Sales Executive - OEM & Projects', office: 'AMD' },
] as const;

type UserKey = (typeof USERS)[number]['key'];
type Users = Record<UserKey, { id: string; name: string }>;

async function upsertUsers(): Promise<Users> {
  const passwordHash = await bcrypt.hash('Nirmaan@2026', 10);
  const offices: Record<string, string> = {};
  for (const o of OFFICES) offices[o.code] = (await prisma.office.upsert({ where: { code: o.code }, update: {}, create: o })).id;
  const users = {} as Users;
  for (const { office, ...u } of USERS) {
    // Existing users keep their password; only profile details are refreshed
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, mobile: u.mobile, designation: u.designation, officeId: offices[office], isActive: true },
      create: { email: u.email, name: u.name, role: u.role, mobile: u.mobile, designation: u.designation, officeId: offices[office], passwordHash },
    });
    users[u.key] = { id: user.id, name: user.name };
  }
  return users;
}

// ---------- cleanup of previous sample data ----------

async function removePreviousSample() {
  const clients = await prisma.client.findMany({
    where: { code: { in: SAMPLE_CODES } },
    include: {
      enquiries: { select: { id: true } },
      quotations: { select: { id: true } },
      orders: { select: { id: true } },
      invoices: { select: { id: true } },
      receipts: { select: { id: true } },
      tasks: { select: { id: true } },
    },
  });
  const ids = clients.flatMap((c) => [
    c.id,
    ...c.enquiries.map((x) => x.id),
    ...c.quotations.map((x) => x.id),
    ...c.orders.map((x) => x.id),
    ...c.invoices.map((x) => x.id),
    ...c.receipts.map((x) => x.id),
    ...c.tasks.map((x) => x.id),
  ]);

  // Notes, attachments and change-log rows point at records by id only, so remove them explicitly
  await prisma.directorComment.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.documentAttachment.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  // Everything else hangs off the client and is removed with it
  await prisma.client.deleteMany({ where: { id: { in: clients.map((c) => c.id) } } });

  await prisma.incentivePolicy.deleteMany({ where: { title: { in: [POLICY_TITLE, ...LEGACY_POLICY_TITLES] } } });
}

// ---------- builders that mirror the app's own create logic ----------

async function audit(entityType: string, entityId: string, action: AuditAction, actorId: string, when: Date, details: object) {
  await prisma.auditEvent.create({ data: { entityType, entityId, action, actorId, details, createdAt: when } });
}

interface ClientInput {
  code: string;
  name: string;
  industry: string;
  clientType: string;
  gst: string;
  city: string;
  state: string;
  address: string;
  owner: string;
  createdAt: Date;
  contacts: { name: string; designation: string; mobile: string; email: string }[];
  sites: { name: string; address: string; city: string; pincode: string }[];
}

async function createClient(c: ClientInput) {
  const client = await prisma.client.create({
    data: {
      code: c.code,
      name: c.name,
      industrySegment: c.industry,
      clientType: c.clientType,
      gstNumber: c.gst,
      city: c.city,
      state: c.state,
      address: c.address,
      assignedToId: c.owner,
      createdById: c.owner,
      createdAt: c.createdAt,
      contacts: {
        create: c.contacts.map((ct, i) => ({ ...ct, whatsappNumber: ct.mobile, isPrimary: i === 0, createdAt: c.createdAt })),
      },
      sites: {
        create: c.sites.map((s, i) => ({
          siteName: s.name,
          address: s.address,
          city: s.city,
          state: c.state,
          pincode: s.pincode,
          contactPerson: c.contacts[0].name,
          mobile: c.contacts[0].mobile,
          isPrimary: i === 0,
          createdAt: c.createdAt,
        })),
      },
    },
    include: { contacts: true, sites: true },
  });
  await audit('CLIENT', client.id, AuditAction.CREATE, c.owner, c.createdAt, { name: client.name, code: client.code });
  return client;
}

type Client = Awaited<ReturnType<typeof createClient>>;
type Requirement = { id: string; enquiryNumber: string; clientId: string; assignedToId: string; stage: EnquiryStage; title: string };

async function createRequirement(
  client: Client,
  r: {
    title: string;
    category: EnquiryCategory;
    summary: string;
    techSpecs?: string;
    value: number;
    contact: number;
    site?: number;
    source: string;
    expectedClose?: Date;
    createdAt: Date;
  }
): Promise<Requirement> {
  const enquiryNumber = await nextRequirementNumber(prisma, client.id);
  const enquiry = await prisma.enquiry.create({
    data: {
      enquiryNumber,
      clientId: client.id,
      contactId: client.contacts[r.contact].id,
      siteId: r.site !== undefined ? client.sites[r.site].id : null,
      assignedToId: client.assignedToId,
      title: r.title,
      category: r.category,
      categories: [r.category],
      requirementSummary: r.summary,
      techSpecs: r.techSpecs,
      estimatedValue: r.value,
      source: r.source,
      probability: STAGE_PROBABILITY.NEW,
      stage: EnquiryStage.NEW,
      expectedCloseDate: r.expectedClose,
      createdById: client.assignedToId,
      createdAt: r.createdAt,
    },
  });
  await prisma.enquiryStageHistory.create({
    data: {
      enquiryId: enquiry.id,
      fromStage: EnquiryStage.NEW,
      toStage: EnquiryStage.NEW,
      reason: 'Requirement created',
      changedById: client.assignedToId,
      createdAt: r.createdAt,
    },
  });
  await audit('ENQUIRY', enquiry.id, AuditAction.CREATE, client.assignedToId, r.createdAt, { enquiryNumber, title: r.title });
  return enquiry;
}

async function moveStage(
  req: Requirement,
  to: EnquiryStage,
  when: Date,
  reason: string,
  by: string,
  extra: { lostReason?: string; holdReason?: string; holdReviewDate?: Date } = {}
) {
  await prisma.enquiry.update({
    where: { id: req.id },
    data: { stage: to, probability: STAGE_PROBABILITY[to], ...extra },
  });
  await prisma.enquiryStageHistory.create({
    data: { enquiryId: req.id, fromStage: req.stage, toStage: to, reason, changedById: by, createdAt: when },
  });
  await audit('ENQUIRY', req.id, AuditAction.STAGE_CHANGE, by, when, { from: req.stage, to, reason });
  req.stage = to;
}

/** A conversation about a requirement; if it plans a next step, that follow-up is created too. */
async function logConversation(
  client: Client,
  req: Requirement,
  a: {
    type: ActivityType;
    discussion: DiscussionType;
    outcome: string;
    keyPoints: string;
    remarks?: string;
    when: Date;
    contact?: number;
  }
) {
  return prisma.activity.create({
    data: {
      clientId: client.id,
      enquiryId: req.id,
      contactId: client.contacts[a.contact ?? 0].id,
      salespersonId: req.assignedToId,
      activityType: a.type,
      discussionType: a.discussion,
      outcome: a.outcome,
      keyPoints: a.keyPoints,
      remarks: a.remarks ?? '',
      activityDate: a.when,
      createdAt: a.when,
    },
  });
}

async function followUp(
  client: Client,
  req: Requirement,
  t: {
    type: TaskType;
    description: string;
    due: Date;
    plannedAt: Date;
    plannedIn?: { id: string }; // the conversation that set this follow-up
    priority?: TaskPriority;
    done?: { outcome: string; at: Date };
    quotationId?: string;
    orderId?: string;
    invoiceId?: string;
  }
) {
  const task = await prisma.task.create({
    data: {
      taskNumber: await nextDocNumber(prisma, 'task'),
      clientId: client.id,
      enquiryId: req.id,
      quotationId: t.quotationId,
      orderId: t.orderId,
      invoiceId: t.invoiceId,
      assignedSalespersonId: req.assignedToId,
      createdById: req.assignedToId,
      actionType: t.type,
      description: t.description,
      priority: t.priority ?? TaskPriority.MEDIUM,
      dueDateTime: t.due,
      status: t.done ? TaskStatus.COMPLETED : TaskStatus.PENDING,
      completionOutcome: t.done?.outcome,
      completedAt: t.done?.at,
      reminderSettings: { remindMinutesBefore: [1440, 60] },
      createdAt: t.plannedAt,
    },
  });
  // Keep the conversation's "next action" in step with the follow-up it created
  if (t.plannedIn) {
    await prisma.activity.update({
      where: { id: t.plannedIn.id },
      data: { nextAction: t.description, nextActionDate: t.due },
    });
  }
  return task;
}

type Line = { item: string; qty: number; unit: string; unitRate: number };

function priceVersion(lines: Line[], discountPercent: number) {
  const lineItems = lines.map((l) => ({ ...l, total: l.qty * l.unitRate }));
  const originalValue = lineItems.reduce((s, l) => s + l.total, 0);
  const discountAmount = round2(originalValue * (discountPercent / 100));
  const taxAmount = round2((originalValue - discountAmount) * 0.18); // 18% GST, as in the app
  const finalValue = round2(originalValue - discountAmount + taxAmount);
  return { lineItems, originalValue, discountAmount, discountPercent, taxAmount, finalValue };
}

const DEFAULT_TERMS =
  'Payment: 30% advance with PO, 60% against proforma before dispatch, 10% after commissioning. Warranty: 12 months.';

/** Quotation with its revisions. Older versions are frozen; discounts over 3% wait for director approval. */
async function createQuotation(
  client: Client,
  req: Requirement,
  q: {
    versions: { date: Date; lines: Line[]; discountPercent: number; terms?: string; remarks?: string; approvalReason?: string }[];
    validityDays?: number;
    sent?: boolean; // shared with the client (no approval needed)
  }
) {
  const quotationNumber = await nextDocNumber(prisma, 'quotation');
  const first = q.versions[0];
  const quote = await prisma.quotation.create({
    data: {
      quotationNumber,
      clientId: client.id,
      enquiryId: req.id,
      salespersonId: req.assignedToId,
      validityDays: q.validityDays ?? 30,
      proposalDate: first.date,
      createdAt: first.date,
    },
  });
  await audit('QUOTATION', quote.id, AuditAction.CREATE, req.assignedToId, first.date, { quotationNumber });

  // Preparing a quotation moves a fresh requirement to the Quotation stage
  if (req.stage === EnquiryStage.NEW) {
    await moveStage(req, EnquiryStage.PROPOSAL, first.date, `Quotation ${quotationNumber} prepared`, req.assignedToId);
  }

  let lastVersion: { id: string } | null = null;
  let status: QuotationStatus = QuotationStatus.DRAFT;
  for (const [n, v] of q.versions.entries()) {
    const priced = priceVersion(v.lines, v.discountPercent);
    const isLatest = n === q.versions.length - 1;
    // A new revision supersedes any approval still pending on the previous one
    await prisma.quotationApproval.updateMany({
      where: { quotationId: quote.id, status: ApprovalStatus.PENDING },
      data: { status: ApprovalStatus.REJECTED, decisionNotes: `Superseded by revision R${n}` },
    });
    const version = await prisma.quotationVersion.create({
      data: {
        quotationId: quote.id,
        versionNumber: n,
        proposalDate: v.date,
        ...priced,
        commercialTerms: v.terms ?? DEFAULT_TERMS,
        remarks: v.remarks ?? (n === 0 ? 'Initial proposal' : `Revision R${n}`),
        isImmutable: !isLatest,
        createdById: req.assignedToId,
        createdAt: v.date,
      },
    });
    const needsApproval = v.discountPercent > 3;
    status = needsApproval ? QuotationStatus.PENDING_APPROVAL : q.sent ? QuotationStatus.SENT : QuotationStatus.DRAFT;
    if (needsApproval) {
      await prisma.quotationApproval.create({
        data: {
          quotationId: quote.id,
          quotationVersionId: version.id,
          requestedById: req.assignedToId,
          discountPercent: v.discountPercent,
          reason: v.approvalReason ?? `Discount of ${v.discountPercent}% exceeds default threshold (3%).`,
          status: ApprovalStatus.PENDING,
          createdAt: v.date,
        },
      });
    }
    await prisma.quotation.update({
      where: { id: quote.id },
      data: {
        currentVersionNumber: n,
        approvalStatus: status,
        proposalDate: v.date,
        sentAt: status === QuotationStatus.SENT ? v.date : null,
        originalValue: priced.originalValue,
        discountAmount: priced.discountAmount,
        discountPercent: priced.discountPercent,
        taxAmount: priced.taxAmount,
        finalValue: priced.finalValue,
        commercialTerms: v.terms ?? DEFAULT_TERMS,
        remarks: v.remarks ?? '',
      },
    });
    lastVersion = version;
  }

  // The requirement's value follows its latest quotation (before tax)
  const latest = priceVersion(q.versions[q.versions.length - 1].lines, q.versions[q.versions.length - 1].discountPercent);
  await prisma.enquiry.update({
    where: { id: req.id },
    data: { estimatedValue: latest.originalValue - latest.discountAmount },
  });

  return { ...quote, quotationNumber, latestVersionId: lastVersion!.id, status };
}

/** Order confirmed from the quotation's latest version; the quotation is accepted and the requirement won. */
async function confirmOrder(
  client: Client,
  req: Requirement,
  quote: { id: string; quotationNumber: string; latestVersionId: string },
  o: { date: Date; po: string; paymentTerms: string }
) {
  const version = await prisma.quotationVersion.findUniqueOrThrow({ where: { id: quote.latestVersionId } });
  const orderNumber = await nextDocNumber(prisma, 'order');
  const order = await prisma.order.create({
    data: {
      orderNumber,
      clientPoNumber: o.po,
      clientId: client.id,
      enquiryId: req.id,
      quotationId: quote.id,
      quotationVersionId: version.id,
      assignedSalespersonId: req.assignedToId,
      orderDate: o.date,
      items: version.lineItems as object,
      netValue: Number(version.originalValue) - Number(version.discountAmount),
      discountValue: version.discountAmount,
      taxValue: version.taxAmount,
      grossValue: version.finalValue,
      paymentTerms: o.paymentTerms,
      orderStatus: OrderStatus.CONFIRMED,
      createdAt: o.date,
    },
  });
  await createOrderPayments(prisma, order);
  await recalculateOrderPayments(prisma, order.id);
  await createExecutionSteps(prisma, order.id);
  await syncPaymentDues(prisma, order.id);
  await prisma.quotation.update({
    where: { id: quote.id },
    data: { approvalStatus: QuotationStatus.ACCEPTED, closedAt: o.date },
  });
  await audit('ORDER', order.id, AuditAction.CREATE, req.assignedToId, o.date, { orderNumber, grossValue: Number(order.grossValue) });
  await moveStage(req, EnquiryStage.WON, o.date, `Won via confirmed order ${orderNumber}`, req.assignedToId);
  return order;
}

async function raiseInvoice(
  order: { id: string; clientId: string; assignedSalespersonId: string },
  i: { date: Date; due: Date; netAmount: number; remarks: string }
) {
  const invoiceNumber = await nextDocNumber(prisma, 'invoice');
  const taxAmount = round2(i.netAmount * 0.18);
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      clientId: order.clientId,
      invoiceDate: i.date,
      dueDate: i.due,
      netAmount: i.netAmount,
      taxAmount,
      grossAmount: round2(i.netAmount + taxAmount),
      paymentStatus: InvoiceStatus.UNPAID,
      remarks: i.remarks,
      createdAt: i.date,
    },
  });
  await audit('INVOICE', invoice.id, AuditAction.CREATE, order.assignedSalespersonId, i.date, { invoiceNumber, grossAmount: Number(invoice.grossAmount) });
  return invoice;
}

/** Payment recorded by the salesperson against invoices; optionally verified by a director. */
async function recordPayment(
  client: Client,
  p: {
    date: Date;
    amount: number;
    mode: PaymentMode;
    ref: string;
    allocations: { invoiceId: string; amount: number }[];
    verified?: { by: string; at: Date };
  }
) {
  const receiptNumber = await nextDocNumber(prisma, 'receipt');
  const receipt = await prisma.receipt.create({
    data: {
      receiptNumber,
      clientId: client.id,
      receiptDate: p.date,
      amount: p.amount,
      paymentMode: p.mode,
      transactionRef: p.ref,
      recordedById: client.assignedToId,
      verificationStatus: p.verified ? VerificationStatus.VERIFIED : VerificationStatus.SUBMITTED,
      verifiedById: p.verified?.by,
      verifiedAt: p.verified?.at,
      createdAt: p.date,
      allocations: { create: p.allocations.map((a) => ({ invoiceId: a.invoiceId, allocatedAmount: a.amount, createdAt: p.date })) },
    },
  });
  await audit('RECEIPT', receipt.id, AuditAction.CREATE, client.assignedToId, p.date, { receiptNumber, amount: p.amount });

  if (p.verified) {
    await audit('RECEIPT', receipt.id, AuditAction.VERIFY, p.verified.by, p.verified.at, { receiptNumber, amount: p.amount, isVerified: true });
    // Only verified payments change an invoice's status
    for (const a of p.allocations) {
      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: a.invoiceId },
        include: { allocations: { where: { receipt: { verificationStatus: VerificationStatus.VERIFIED } } } },
      });
      const paid = invoice.allocations.reduce((s, x) => s + Number(x.allocatedAmount), 0);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paymentStatus:
            paid >= Number(invoice.grossAmount) ? InvoiceStatus.PAID : paid > 0 ? InvoiceStatus.PARTIALLY_PAID : InvoiceStatus.UNPAID,
        },
      });
    }
  }
  return receipt;
}

// ---------- sample story ----------

async function main() {
  console.log('Seeding Nirmaan WaterTech Solutions CRM sample data...');

  const u = await upsertUsers();
  await removePreviousSample();

  // ===== Tirth Water Solutions (Amit): an EDI quote awaiting discount approval + an AMC won and being billed =====
  const tirth = await createClient({
    code: 'TWSPL',
    name: 'Tirth Water Solutions Pvt Ltd',
    industry: 'Commercial & Municipal',
    clientType: 'OEM / EPC Contractor',
    gst: '27AABCT8899K1Z5',
    city: 'Pune',
    state: 'Maharashtra',
    address: 'Plot 45, Bhosari MIDC, Pune 411026',
    owner: u.amit.id,
    createdAt: at(-52, 10),
    contacts: [
      { name: 'Anil Khurana', designation: 'VP - Procurement', mobile: '+91 98220 33441', email: 'anil.khurana@tirthwater.in' },
      { name: 'Meera Joshi', designation: 'Plant Head', mobile: '+91 98220 77612', email: 'meera.joshi@tirthwater.in' },
    ],
    sites: [
      { name: 'Bhosari Assembly Plant', address: 'Plot 45, Bhosari MIDC', city: 'Pune', pincode: '411026' },
      { name: 'Chakan Site', address: 'Phase 2, Chakan Industrial Estate', city: 'Chakan', pincode: '410501' },
    ],
  });

  // TWSPL/001 - EDI system: R0 sent, R1 with 6% discount waiting for director approval
  const edi = await createRequirement(tirth, {
    title: 'Supply of 15 m3/hr Electrodeionization (EDI) System',
    category: EnquiryCategory.PLANT,
    summary: 'High purity water for boiler feed and process water, polishing after existing RO.',
    techSpecs: 'Feed: RO permeate, TDS < 20 ppm. Output resistivity > 15 MOhm-cm.',
    value: 2600000,
    contact: 0,
    site: 1,
    source: 'Direct Inbound',
    expectedClose: at(25),
    createdAt: at(-50, 10, 30),
  });
  const ediCall = await logConversation(tirth, edi, {
    type: ActivityType.CALL,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'Requirement understood, site visit agreed',
    keyPoints: 'Needs EDI polishing for new boiler at Chakan. Existing RO gives ~15 ppm permeate.',
    when: at(-50, 10, 30),
  });
  await followUp(tirth, edi, {
    type: TaskType.SITE_VISIT,
    description: 'Visit Chakan site to check RO permeate quality and space for EDI skid',
    due: at(-45, 11),
    plannedAt: at(-50, 10, 30),
    plannedIn: ediCall,
    done: { outcome: 'Permeate TDS 14 ppm, 4x3 m space available near boiler house', at: at(-45, 13) },
  });
  const ediVisit = await logConversation(tirth, edi, {
    type: ActivityType.SITE_VISIT,
    discussion: DiscussionType.TECHNICAL,
    outcome: 'Site survey completed',
    keyPoints: 'Permeate TDS 14 ppm, conductivity fluctuates in summer. Recommended SnowPure EDI with DC rectifier panel.',
    when: at(-45, 13),
  });
  await followUp(tirth, edi, {
    type: TaskType.QUOTATION_PREP,
    description: 'Prepare EDI quotation with skid and control panel',
    due: at(-40, 17),
    plannedAt: at(-45, 13),
    plannedIn: ediVisit,
    done: { outcome: 'Quotation R0 sent to Anil Khurana', at: at(-40, 16) },
  });
  const ediLines: Line[] = [
    { item: 'EDI Module 15 m3/hr (SnowPure Electropure)', qty: 1, unit: 'Set', unitRate: 1800000 },
    { item: 'SS316 skidded piping and valve assembly', qty: 1, unit: 'Lot', unitRate: 500000 },
    { item: 'DC rectifier power supply and control panel', qty: 1, unit: 'Set', unitRate: 300000 },
  ];
  const ediMeeting = await logConversation(tirth, edi, {
    type: ActivityType.MEETING,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Client asked for a better price',
    keyPoints: 'Competitor quoted ~6% lower. Anil willing to close this month if we match within reason.',
    when: at(-13, 15),
  });
  const ediQuote = await createQuotation(tirth, edi, {
    versions: [
      { date: at(-40, 16), lines: ediLines, discountPercent: 0 },
      {
        date: at(-12, 12),
        lines: ediLines,
        discountPercent: 6,
        remarks: 'Revised after commercial meeting',
        approvalReason: 'Competitor quoted lower. Repeat client with an active AMC with us.',
      },
    ],
  });
  await followUp(tirth, edi, {
    type: TaskType.QUOTATION_FOLLOWUP,
    description: 'Follow up with Anil on revised EDI quotation R1',
    due: at(0, 17),
    plannedAt: at(-13, 15),
    plannedIn: ediMeeting,
    priority: TaskPriority.HIGH,
    quotationId: ediQuote.id,
  });

  // TWSPL/002 - AMC: quoted, negotiated, PO received, order, first quarter billed, partly paid
  const amc = await createRequirement(tirth, {
    title: 'Comprehensive AMC for 50 m3/hr Industrial RO Plant',
    category: EnquiryCategory.AMC,
    summary: 'Quarterly membrane cleaning, antiscalant dosing checks, sensor calibration and cartridge replacement.',
    value: 480000,
    contact: 1,
    site: 0,
    source: 'Existing Client',
    createdAt: at(-35, 11),
  });
  const amcCall = await logConversation(tirth, amc, {
    type: ActivityType.CALL,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'AMC requirement for existing RO plant',
    keyPoints: 'Current service vendor not responsive. Wants quarterly preventive maintenance.',
    contact: 1,
    when: at(-35, 11),
  });
  await followUp(tirth, amc, {
    type: TaskType.SITE_VISIT,
    description: 'Inspect 50 m3/hr RO at Bhosari plant',
    due: at(-32, 11),
    plannedAt: at(-35, 11),
    plannedIn: amcCall,
    done: { outcome: 'Membranes fouled, recommended CIP plus quarterly service', at: at(-32, 14) },
  });
  const amcVisit = await logConversation(tirth, amc, {
    type: ActivityType.SITE_VISIT,
    discussion: DiscussionType.TECHNICAL,
    outcome: 'Plant inspected',
    keyPoints: 'Differential pressure high on stage 1. CIP due. Antiscalant dosing pump needs calibration.',
    contact: 1,
    when: at(-32, 14),
  });
  await followUp(tirth, amc, {
    type: TaskType.QUOTATION_PREP,
    description: 'Send AMC quotation',
    due: at(-28, 17),
    plannedAt: at(-32, 14),
    plannedIn: amcVisit,
    done: { outcome: 'AMC quotation sent to Meera Joshi', at: at(-28, 16) },
  });
  const amcQuote = await createQuotation(tirth, amc, {
    sent: true,
    versions: [
      {
        date: at(-28, 16),
        lines: [{ item: 'Comprehensive annual maintenance contract - 50 m3/hr RO', qty: 1, unit: 'Year', unitRate: 480000 }],
        discountPercent: 0,
        terms: 'Quarterly advance billing of Rs 1,41,600 (incl. GST) before each service quarter.',
      },
    ],
  });
  const amcMeeting = await logConversation(tirth, amc, {
    type: ActivityType.MEETING,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Terms agreed, PO to follow',
    keyPoints: 'Agreed quarterly advance billing. PO expected within a week.',
    contact: 1,
    when: at(-22, 12),
  });
  await moveStage(amc, EnquiryStage.NEGOTIATION, at(-22, 12), 'Commercial terms under discussion', u.amit.id);
  await followUp(tirth, amc, {
    type: TaskType.ORDER_CONFIRMATION,
    description: 'Collect PO for AMC',
    due: at(-17, 12),
    plannedAt: at(-22, 12),
    plannedIn: amcMeeting,
    done: { outcome: 'PO TWS/PO/2026/092 received', at: at(-16, 10) },
  });
  const amcOrder = await confirmOrder(tirth, amc, amcQuote, {
    date: at(-16, 10),
    po: 'TWS/PO/2026/092',
    paymentTerms: 'Quarterly advance billing of Rs 1,41,600 (incl. GST) each.',
  });
  const amcInvoice = await raiseInvoice(amcOrder, {
    date: at(-15, 11),
    due: at(-1, 18),
    netAmount: 120000,
    remarks: 'AMC quarter 1 advance billing',
  });
  await recordPayment(tirth, {
    date: at(-9, 12),
    amount: 100000,
    mode: PaymentMode.NEFT_RTGS,
    ref: 'HDFCR2026100912',
    allocations: [{ invoiceId: amcInvoice.id, amount: 100000 }],
    verified: { by: u.rajesh.id, at: at(-8, 10) },
  });
  await recordPayment(tirth, {
    date: at(-3, 15),
    amount: 41600,
    mode: PaymentMode.UPI,
    ref: 'UPI/2026101899120',
    allocations: [{ invoiceId: amcInvoice.id, amount: 41600 }],
  });
  await followUp(tirth, amc, {
    type: TaskType.PAYMENT_COLLECTION,
    description: 'Share UTR proof for Rs 41,600 balance so it can be verified',
    due: at(2, 12),
    plannedAt: at(-3, 15),
    orderId: amcOrder.id,
    invoiceId: amcInvoice.id,
  });

  await prisma.directorComment.create({
    data: {
      entityType: 'QUOTATION',
      entityId: ediQuote.id,
      directorId: u.rajesh.id,
      instruction: 'Amit, approve-able only if Tirth extends the AMC to 2 years. Check before we decide on the 6% discount.',
      targetSalespersonId: u.amit.id,
      createdAt: at(-11, 10),
    },
  });

  // ===== Cipla Laboratories (Sneha): one requirement in negotiation, one new with an overdue follow-up =====
  const cipla = await createClient({
    code: 'CLL',
    name: 'Cipla Laboratories Ltd',
    industry: 'Pharmaceutical',
    clientType: 'End User',
    gst: '23AAACC1450B1Z2',
    city: 'Pithampur',
    state: 'Madhya Pradesh',
    address: 'Sector 3, Pithampur Industrial Area, Dhar 454775',
    owner: u.sneha.id,
    createdAt: at(-31, 10),
    contacts: [
      { name: 'Dr. Vivek Joshi', designation: 'Head of Utilities & Water Treatment', mobile: '+91 98930 11223', email: 'vivek.joshi@cipla-example.com' },
    ],
    sites: [{ name: 'Pithampur Formulation Plant', address: 'Sector 3, Pithampur Industrial Area', city: 'Pithampur', pincode: '454775' }],
  });

  const dm = await createRequirement(cipla, {
    title: 'Demineralization & UF Membrane System Upgradation',
    category: EnquiryCategory.PLANT,
    summary: 'Upgrade DM plant and add UF pre-treatment to meet purified water specs.',
    value: 3800000,
    contact: 0,
    site: 0,
    source: 'Consultant Referral',
    expectedClose: at(30),
    createdAt: at(-30, 11),
  });
  const dmMeet = await logConversation(cipla, dm, {
    type: ActivityType.MEETING,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'Upgrade scope discussed',
    keyPoints: 'Frequent DM regeneration, silica breakthrough. Wants UF before DM.',
    when: at(-30, 11),
  });
  await followUp(cipla, dm, {
    type: TaskType.SITE_VISIT,
    description: 'Collect raw water samples and existing DM data',
    due: at(-24, 11),
    plannedAt: at(-30, 11),
    plannedIn: dmMeet,
    done: { outcome: 'Samples sent to lab, silica 28 ppm', at: at(-24, 15) },
  });
  const dmVisit = await logConversation(cipla, dm, {
    type: ActivityType.SITE_VISIT,
    discussion: DiscussionType.TECHNICAL,
    outcome: 'Raw water analysed',
    keyPoints: 'Silica 28 ppm, turbidity spikes in monsoon. Proposed UF + mixed bed polisher.',
    when: at(-24, 15),
  });
  await followUp(cipla, dm, {
    type: TaskType.QUOTATION_PREP,
    description: 'Send UF + DM upgrade quotation',
    due: at(-20, 17),
    plannedAt: at(-24, 15),
    plannedIn: dmVisit,
    done: { outcome: 'Quotation shared with Dr. Joshi', at: at(-20, 16) },
  });
  const dmQuote = await createQuotation(cipla, dm, {
    sent: true,
    versions: [
      {
        date: at(-20, 16),
        lines: [
          { item: 'Ultrafiltration skid 20 m3/hr', qty: 1, unit: 'Set', unitRate: 2200000 },
          { item: 'Mixed bed polisher with regeneration system', qty: 1, unit: 'Set', unitRate: 1200000 },
          { item: 'Installation and commissioning', qty: 1, unit: 'Lot', unitRate: 400000 },
        ],
        discountPercent: 2,
      },
    ],
  });
  const dmNegotiation = await logConversation(cipla, dm, {
    type: ActivityType.MEETING,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Price acceptable, delivery under discussion',
    keyPoints: 'Wants delivery in 10 weeks instead of 14. Purchase committee meets next week.',
    when: at(-8, 14),
  });
  await moveStage(dm, EnquiryStage.NEGOTIATION, at(-8, 14), 'Price accepted, negotiating delivery', u.sneha.id);
  await followUp(cipla, dm, {
    type: TaskType.MEETING,
    description: 'Meet purchase committee to finalise delivery schedule and PO',
    due: at(3, 11),
    plannedAt: at(-8, 14),
    plannedIn: dmNegotiation,
    priority: TaskPriority.HIGH,
    quotationId: dmQuote.id,
  });

  const chem = await createRequirement(cipla, {
    title: 'Antiscalant & membrane cleaning chemicals (annual)',
    category: EnquiryCategory.CHEMICALS,
    summary: 'Annual supply of antiscalant and CIP chemicals for existing RO.',
    value: 360000,
    contact: 0,
    site: 0,
    source: 'Existing Client',
    createdAt: at(-6, 12),
  });
  const chemCall = await logConversation(cipla, chem, {
    type: ActivityType.CALL,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'Chemical consumption details requested',
    keyPoints: 'Uses ~40 kg antiscalant per month. Wants annual rate contract.',
    when: at(-6, 12),
  });
  await followUp(cipla, chem, {
    type: TaskType.CALL,
    description: 'Send chemical consumption estimate and rate contract proposal',
    due: at(-2, 12),
    plannedAt: at(-6, 12),
    plannedIn: chemCall,
  });

  // ===== Raymond Textiles (Amit): one requirement with an overdue site visit, one lost =====
  const raymond = await createClient({
    code: 'RTM',
    name: 'Raymond Textiles Mills',
    industry: 'Textiles',
    clientType: 'End User',
    gst: '27AAACR4521M1Z9',
    city: 'Tarapur',
    state: 'Maharashtra',
    address: 'E-12, MIDC Tarapur, Boisar 401506',
    owner: u.amit.id,
    createdAt: at(-62, 10),
    contacts: [
      { name: 'Mahesh Singhal', designation: 'Engineering Manager', mobile: '+91 98205 66778', email: 'mahesh.singhal@raymond-example.com' },
    ],
    sites: [{ name: 'Tarapur Dyeing Unit', address: 'E-12, MIDC Tarapur', city: 'Tarapur', pincode: '401506' }],
  });

  const softener = await createRequirement(raymond, {
    title: 'Softener replacement for dyeing house',
    category: EnquiryCategory.PLANT,
    summary: 'Replace two old softeners feeding the dyeing house boilers.',
    value: 650000,
    contact: 0,
    site: 0,
    source: 'Cold Call',
    createdAt: at(-60, 11),
  });
  await logConversation(raymond, softener, {
    type: ActivityType.CALL,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'Requirement shared',
    keyPoints: 'Two softeners, 30 m3/hr each, resin exhausted.',
    when: at(-60, 11),
  });
  await logConversation(raymond, softener, {
    type: ActivityType.CALL,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Client chose existing vendor',
    keyPoints: 'Existing vendor offered resin replacement only, at much lower cost.',
    when: at(-40, 16),
  });
  await moveStage(softener, EnquiryStage.LOST, at(-40, 16), 'Client went with existing vendor', u.amit.id, {
    lostReason: 'Existing vendor offered resin replacement at lower cost',
  });

  const etp = await createRequirement(raymond, {
    title: 'ETP sludge reduction study',
    category: EnquiryCategory.EVALUATION,
    summary: 'Assess ETP sludge generation and propose reduction (filter press / dewatering).',
    value: 150000,
    contact: 0,
    site: 0,
    source: 'Existing Client',
    createdAt: at(-12, 12),
  });
  const etpCall = await logConversation(raymond, etp, {
    type: ActivityType.CALL,
    discussion: DiscussionType.TECHNICAL,
    outcome: 'Study requested',
    keyPoints: 'Sludge disposal cost rising. Wants assessment before monsoon.',
    when: at(-12, 12),
  });
  await followUp(raymond, etp, {
    type: TaskType.SITE_VISIT,
    description: 'Visit Tarapur site for ETP effluent and sludge analysis',
    due: at(-5, 11),
    plannedAt: at(-12, 12),
    plannedIn: etpCall,
    priority: TaskPriority.HIGH,
  });

  // ===== Shree Ganesh Auto Components (Rahul): one on hold, one spares order billed =====
  const ganesh = await createClient({
    code: 'SGACPL',
    name: 'Shree Ganesh Auto Components Pvt Ltd',
    industry: 'Automobile',
    clientType: 'End User',
    gst: '27AAKCS7781F1Z3',
    city: 'Chakan',
    state: 'Maharashtra',
    address: 'Gat No. 112, Mahalunge, Chakan 410501',
    owner: u.rahul.id,
    createdAt: at(-21, 10),
    contacts: [
      { name: 'Rohit Kulkarni', designation: 'Plant Maintenance Head', mobile: '+91 98500 44120', email: 'rohit.kulkarni@sgac-example.com' },
    ],
    sites: [{ name: 'Mahalunge Paint Shop', address: 'Gat No. 112, Mahalunge', city: 'Chakan', pincode: '410501' }],
  });

  const etp20 = await createRequirement(ganesh, {
    title: '20 KLD ETP for paint shop',
    category: EnquiryCategory.PLANT,
    summary: 'New effluent treatment plant for paint shop pre-treatment line.',
    value: 1800000,
    contact: 0,
    site: 0,
    source: 'Direct Inbound',
    createdAt: at(-20, 11),
  });
  const etp20Meet = await logConversation(ganesh, etp20, {
    type: ActivityType.MEETING,
    discussion: DiscussionType.INTRODUCTORY,
    outcome: 'ETP requirement discussed',
    keyPoints: 'Pollution board notice received. Needs ETP for phosphating effluent.',
    when: at(-20, 11),
  });
  await followUp(ganesh, etp20, {
    type: TaskType.SITE_VISIT,
    description: 'Site survey of paint shop drain lines',
    due: at(-15, 11),
    plannedAt: at(-20, 11),
    plannedIn: etp20Meet,
    done: { outcome: 'Effluent ~18 KLD, space behind scrap yard', at: at(-15, 14) },
  });
  await logConversation(ganesh, etp20, {
    type: ActivityType.SITE_VISIT,
    discussion: DiscussionType.TECHNICAL,
    outcome: 'Survey completed',
    keyPoints: 'Effluent ~18 KLD with high phosphate and zinc. Chemical treatment + filter press needed.',
    when: at(-15, 14),
  });
  const etp20Hold = await logConversation(ganesh, etp20, {
    type: ActivityType.CALL,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Capex approval deferred',
    keyPoints: 'Management deferred capex approval to next quarter.',
    when: at(-10, 16),
  });
  await moveStage(etp20, EnquiryStage.ON_HOLD, at(-10, 16), 'Capex approval deferred', u.rahul.id, {
    holdReason: 'Capex approval deferred to next quarter',
    holdReviewDate: at(12, 11),
  });
  await followUp(ganesh, etp20, {
    type: TaskType.CALL,
    description: 'Check capex approval status for ETP',
    due: at(12, 11),
    plannedAt: at(-10, 16),
    plannedIn: etp20Hold,
  });

  const spares = await createRequirement(ganesh, {
    title: 'RO membrane & cartridge spares',
    category: EnquiryCategory.SPARES,
    summary: 'Replacement membranes and cartridge filters for the canteen RO.',
    value: 215000,
    contact: 0,
    site: 0,
    source: 'Existing Client',
    createdAt: at(-10, 11),
  });
  await logConversation(ganesh, spares, {
    type: ActivityType.CALL,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'Spares list confirmed',
    keyPoints: '4 membranes (8040) and 50 cartridges (20 inch, 5 micron).',
    when: at(-10, 11),
  });
  const sparesQuote = await createQuotation(ganesh, spares, {
    sent: true,
    validityDays: 15,
    versions: [
      {
        date: at(-8, 12),
        lines: [
          { item: 'RO membrane 8040 BWRO', qty: 4, unit: 'Nos', unitRate: 45000 },
          { item: 'Cartridge filter 20 inch, 5 micron', qty: 50, unit: 'Nos', unitRate: 700 },
        ],
        discountPercent: 0,
        terms: '100% within 30 days of delivery. Delivery: 7 days.',
      },
    ],
  });
  const sparesPo = await logConversation(ganesh, spares, {
    type: ActivityType.CALL,
    discussion: DiscussionType.COMMERCIAL,
    outcome: 'PO confirmed on call',
    keyPoints: 'PO SGAC/PUR/2026/0417 issued for full quotation value.',
    when: at(-4, 15),
  });
  const sparesOrder = await confirmOrder(ganesh, spares, sparesQuote, {
    date: at(-3, 11),
    po: 'SGAC/PUR/2026/0417',
    paymentTerms: '100% within 30 days of delivery',
  });
  const sparesInvoice = await raiseInvoice(sparesOrder, {
    date: at(-2, 11),
    due: at(28, 18),
    netAmount: Number(sparesOrder.netValue),
    remarks: 'Spares supply - full invoice',
  });
  await followUp(ganesh, spares, {
    type: TaskType.PAYMENT_COLLECTION,
    description: 'Collect payment for spares invoice',
    due: at(28, 12),
    plannedAt: at(-4, 15),
    plannedIn: sparesPo,
    orderId: sparesOrder.id,
    invoiceId: sparesInvoice.id,
  });

  // ===== Targets for the current quarter and the incentive policy =====
  const fy = getIndianFYQuarter(new Date());
  // Order booking targets, with the incentive % per business type
  const rates = (plant: number, chem: number, spares: number, amc: number) => ({
    PLANT: { incentive: plant },
    BASIC_CHEMICALS: { incentive: chem },
    SPECIAL_CHEMICALS: { incentive: chem + 1 },
    SPARES: { incentive: spares },
    AMC: { incentive: amc },
    OTHER: { incentive: 1 },
  });
  const targets: { who: string; value: number; typeRates: ReturnType<typeof rates> }[] = [
    { who: u.amit.id, value: 2500000, typeRates: rates(1, 2, 2, 2) },
    { who: u.sneha.id, value: 3000000, typeRates: rates(1, 1.5, 2, 2) },
    { who: u.rahul.id, value: 1000000, typeRates: rates(1.5, 2, 2.5, 2) },
  ];
  for (const t of targets) {
    await prisma.target.upsert({
      where: {
        salespersonId_financialYear_periodKey_targetType_level: {
          salespersonId: t.who,
          financialYear: fy.financialYear,
          periodKey: fy.quarter,
          targetType: TargetType.ORDERS_BOOKED,
          level: 1,
        },
      },
      update: { targetValue: t.value, typeRates: t.typeRates, setById: u.rajesh.id },
      create: {
        salespersonId: t.who,
        financialYear: fy.financialYear,
        periodType: TargetPeriod.QUARTERLY,
        periodKey: fy.quarter,
        periodStart: fy.startDate,
        periodEnd: fy.endDate,
        targetType: TargetType.ORDERS_BOOKED,
        targetValue: t.value,
        typeRates: t.typeRates,
        monetaryBasis: MonetaryBasis.NET,
        setById: u.rajesh.id,
      },
    });
  }

  const fyStartYear = parseInt(fy.financialYear.slice(3, 7), 10);
  await prisma.incentivePolicy.create({
    data: {
      title: POLICY_TITLE,
      financialYear: fy.financialYear,
      effectiveFrom: new Date(Date.UTC(fyStartYear, 3, 1)),
      effectiveTo: new Date(Date.UTC(fyStartYear + 1, 2, 31, 23, 59, 59)),
      basis: 'BOOKED_ORDERS',
      baseRatePercent: 1.5,
      minThresholdPercent: 80,
      slabMode: SlabMode.MARGINAL_SLABS,
      slabs: [
        { minAchievementPercent: 80, maxAchievementPercent: 100, incentivePercent: 1.5 },
        { minAchievementPercent: 101, maxAchievementPercent: 120, incentivePercent: 2.0 },
        { minAchievementPercent: 121, maxAchievementPercent: 999, incentivePercent: 2.5 },
      ],
      isActive: true,
      createdById: u.rajesh.id,
    },
  });

  console.log('Seed completed. Sample clients:', SAMPLE_CODES.join(', '));
  console.log('Logins (password Nirmaan@2026 for new accounts):');
  for (const user of USERS) console.log(`  ${user.role.padEnd(11)} ${user.email}`);
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
