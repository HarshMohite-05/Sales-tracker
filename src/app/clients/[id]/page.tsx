'use client';

import React, { useState, useEffect, use } from 'react';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building,
  Users,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileSpreadsheet,
  ShoppingCart,
  MessageSquare,
  History,
  Plus,
  ArrowLeft,
  CheckCircle,
  Clock,
  ShieldAlert,
  FileText,
  DollarSign,
  MessageCircle,
  ChevronRight,
  XCircle,
} from 'lucide-react';
import { formatINR, formatDate, formatDateTime, humanize, stageLabel } from '@/lib/utils';
import { normalizeClientCode } from '@/lib/clientCode';
import { reconcileOrder } from '@/lib/deductions';
import { formatQuotationNumber } from '@/lib/quotation';
import QuotationTerms from '@/components/quotations/QuotationTerms';
import QuotationActions from '@/components/quotations/QuotationActions';
import OrderDetails from '@/components/orders/OrderDetails';
import OrderPayments from '@/components/orders/OrderPayments';
import OrderExecution from '@/components/orders/OrderExecution';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import QuotationRevisions from '@/components/quotations/QuotationRevisions';
import LogActivityModal from '@/components/modals/LogActivityModal';
import CreateQuotationModal from '@/components/modals/CreateQuotationModal';
import ConvertOrderModal from '@/components/modals/ConvertOrderModal';
import OrderLostModal from '@/components/modals/OrderLostModal';
import LostOrders from '@/components/orders/LostOrders';
import ClientNotes, { NoteItem, noteEnquiryId } from '@/components/clients/ClientNotes';
import RequirementCard from '@/components/clients/RequirementCard';
import AddRequirementModal from '@/components/modals/AddRequirementModal';
import CompleteTaskModal from '@/components/modals/CompleteTaskModal';
import RescheduleTaskModal from '@/components/modals/RescheduleTaskModal';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';

const CLIENT_TABS = ['overview', 'enquiries', 'activities', 'tasks', 'proposals', 'orders', 'payments', 'execution', 'comments', 'audit'] as const;
type ClientTab = typeof CLIENT_TABS[number];

export default function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // ?followup=<enquiryId> opens that requirement's add-follow-up form (from the Follow-ups page)
  const searchParams = useSearchParams();
  const router = useRouter();
  const followUpEnquiryId = searchParams.get('followup');
  // ?tab=payments opens that tab, e.g. right after an order is confirmed from the Quotations page
  const tabParam = searchParams.get('tab');
  const initialTab: ClientTab = CLIENT_TABS.includes(tabParam as ClientTab) ? tabParam as ClientTab : 'overview';
  const [clientData, setClient] = useState<any>(null);
  const [allDirectorComments, setDirectorComments] = useState<any[]>([]);
  const [allAuditEvents, setAuditEvents] = useState<any[]>([]);
  const profileGroups: [string, string, any[]][] = [
    ['enquiries', 'Requirement', clientData?.enquiries || []],
    ['orders', 'Order', clientData?.orders || []],
    ['quotations', 'Quotation', clientData?.quotations || []],
    ['tasks', 'Follow-up', clientData?.tasks || []],
    ['activities', 'Activity', clientData?.activities || []],
    ['comments', 'Note', allDirectorComments],
    ['audit', 'Change log', allAuditEvents],
    ['sites', 'Site', clientData?.sites || []],
  ];
  const profileClient = clientData ? { name: clientData.name, code: clientData.code, city: clientData.city, state: clientData.state, industrySegment: clientData.industrySegment, clientType: clientData.clientType, gstNumber: clientData.gstNumber, contacts: clientData.contacts } : undefined;
  const profileRecords = profileGroups.flatMap(([, recordType, records]) => records.map((record) => ({ ...record, recordType, clientName: clientData?.name, client: profileClient })));
  const profileFilter = useRecordFilters(profileRecords);
  const matchingRecords = new Set(profileFilter.rows.map((record) => `${record.recordType}:${record.id}`));
  const filteredGroups = Object.fromEntries(profileGroups.map(([key, recordType, records]) => [key, records.filter((record) => matchingRecords.has(`${recordType}:${record.id}`))]));
  const client = clientData ? { ...clientData, ...filteredGroups } : null;
  const directorComments: any[] = filteredGroups.comments;
  const auditEvents: any[] = filteredGroups.audit;
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab);
  const recordId = searchParams.get('record');
  const [taskAction, setTaskAction] = useState<{ task: any; action: 'complete' | 'reschedule' } | null>(null);

  function openTab(tab: ClientTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    params.delete('record');
    router.push(`/clients/${id}?${params}`, { scroll: false });
  }

  // An order opened from a link (e.g. a PO No on the dashboard) is shown on its own until "All orders"
  const focusedOrder = recordId ? (clientData?.orders || []).find((o: any) => o.id === recordId) : null;
  const isOrderFocused = !!focusedOrder;
  function showAllOrders() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('record');
    router.push(`/clients/${id}?${params}`, { scroll: false });
  }
  const allOrdersBar = focusedOrder && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs">
      <span className="text-slate-600">
        Showing order <strong className="text-slate-900">{focusedOrder.orderNumber}</strong> only
      </span>
      <button type="button" onClick={showAllOrders} className="font-semibold text-sky-700 hover:text-sky-900">
        ← All orders ({clientData?.orders?.length || 0})
      </button>
    </div>
  );

  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => {
    if (loading || !recordId) return;
    // A single order opens at the top, so its details come first; any other record is brought into view
    if (isOrderFocused) window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.getElementById(`record-${recordId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, activeTab, recordId, isOrderFocused]);

  // Modals
  const [showLogActivity, setShowLogActivity] = useState(false);
  // New quotation (optionally for a given requirement) or a revision of an existing one
  // editVersionNumber set: edit that version in place instead of revising
  const [quoteModal, setQuoteModal] = useState<{ enquiryId?: string; quotation?: any; editVersionNumber?: number } | null>(
    null
  );
  const editQuotation = (quotation: any, editVersionNumber: number) => setQuoteModal({ quotation, editVersionNumber });
  // Requirement whose quotation is being confirmed as an order
  const [orderFor, setOrderFor] = useState<{ quotation: any; enquiry: any } | null>(null);
  const [lostFor, setLostFor] = useState<any>(null);
  const [showNewEnquiryModal, setShowNewEnquiryModal] = useState(false);

  // Client code editing (allowed until a requirement is numbered with it)
  const [editingCode, setEditingCode] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  // Notes: only directors add them; a requirement card can open Notes at its own notes
  const [isDirector, setIsDirector] = useState(false);
  const [notesFocus, setNotesFocus] = useState<string | null>(null);

  async function loadClientData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${id}`);
      if (res.ok) {
        const data = await res.json();
        setClient(data.client);
        setDirectorComments(data.directorComments || []);
        setAuditEvents(data.auditEvents || []);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    loadClientData();
  }, [id]);

  // Reload when a requirement is added for this client from the top bar
  useEffect(() => {
    const reload = () => {
      loadClientData();
    };
    window.addEventListener('crm:data-changed', reload);
    return () => window.removeEventListener('crm:data-changed', reload);
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsDirector(data?.user?.role === 'DIRECTOR'))
      .catch(() => {});
  }, []);

  async function saveClientCode() {
    setCodeError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save code');
      setEditingCode(false);
      loadClientData();
    } catch (err: any) {
      setCodeError(err.message);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="p-12 text-center text-xs text-slate-500">Loading client profile...</div>
      </AppShell>
    );
  }

  if (!client) {
    return (
      <AppShell>
        <div className="p-12 text-center">
          <p className="text-slate-600 text-sm">Client not found or unauthorized access.</p>
          <Link href="/clients" className="mt-3 inline-block text-sky-600 font-semibold text-xs">
            Back to Clients Directory
          </Link>
        </div>
      </AppShell>
    );
  }

  const primaryContact = client.contacts && client.contacts[0];
  const activeOrders = (client.orders || []).filter((order: any) => order.orderStatus !== 'CANCELLED');
  const paymentSummary = activeOrders.reduce((sum: { outstanding: number; notYetDue: number }, order: any) => {
    const payment = reconcileOrder(order.payments || [], order.receipts || [], order);
    return { outstanding: sum.outstanding + payment.outstanding, notYetDue: sum.notYetDue + payment.notYetDue };
  }, { outstanding: 0, notYetDue: 0 });
  const paymentPending = paymentSummary.outstanding;
  const pendingTasks = (client.tasks || []).filter((task: any) => task.status === 'PENDING')
    .sort((a: any, b: any) => new Date(a.dueDateTime).getTime() - new Date(b.dueDateTime).getTime());
  const overdueTasks = pendingTasks.filter((task: any) => new Date(task.dueDateTime).getTime() < Date.now());

  // Readable change-log line, e.g. "Requirement TWSPL/002 moved Quotation → Negotiation"
  const requirementNumbers: Record<string, string> = Object.fromEntries(
    (clientData.enquiries || []).map((e: any) => [e.id, e.enquiryNumber])
  );
  function describeChange(ae: any): string {
    const labels: Record<string, string> = {
      CLIENT: 'Client',
      ENQUIRY: 'Requirement',
      QUOTATION: 'Quotation',
      ORDER: 'Order',
      INVOICE: 'Invoice',
      RECEIPT: 'Payment',
      TASK: 'Follow-up',
    };
    const d = ae.details || {};
    const label = labels[ae.entityType] || humanize(ae.entityType);
    const ref =
      d.enquiryNumber || d.quotationNumber || d.orderNumber || d.invoiceNumber || d.receiptNumber ||
      (ae.entityType === 'ENQUIRY' ? requirementNumbers[ae.entityId] : '') ||
      (ae.entityType === 'CLIENT' ? d.code || d.name : '') || '';
    const subject = `${label}${ref ? ` ${ref}` : ''}`;
    switch (ae.action) {
      case 'CREATE':
        return `${subject} created`;
      case 'STAGE_CHANGE':
        return `${subject} moved ${stageLabel(d.from)} → ${stageLabel(d.to)}`;
      case 'VERIFY':
        return `${subject} verified`;
      case 'APPROVE':
        return `${subject} approved`;
      case 'REJECT':
        return `${subject} rejected`;
      case 'DELETE':
        return `${subject}${d.title ? ` (${d.title})` : ''} deleted`;
      case 'REASSIGN':
        return `${subject} reassigned`;
      default:
        return `${subject} ${humanize(ae.action).toLowerCase()}`;
    }
  }
  const codeInUse =
    !!client.code && (clientData.enquiries || []).some((e: any) => e.enquiryNumber.startsWith(`${client.code}/`));

  // Open requirements first (most recently started on top), then Won/Lost
  const enquiries = client.enquiries || [];
  const openEnquiries = enquiries.filter((e: any) => e.stage !== 'WON' && e.stage !== 'LOST');
  const closedEnquiries = enquiries.filter((e: any) => e.stage === 'WON' || e.stage === 'LOST');

  function renderRequirements(expanded: boolean) {
    if (enquiries.length === 0) {
      return <p className="text-xs text-slate-500 italic">{clientData.enquiries?.length ? 'No requirements match the current filters.' : 'No requirements yet.'}</p>;
    }
    return (
      <div className="space-y-5">
        {[
          { label: 'Open', items: openEnquiries },
          { label: 'Closed', items: closedEnquiries },
        ]
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.label} className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {group.label} ({group.items.length})
              </h4>
              {group.items.map((enq: any) => (
                <div key={enq.id} id={`record-${enq.id}`} className="scroll-mt-24">
                <RequirementCard
                  enquiry={enq}
                  notes={directorComments.filter((n) => noteEnquiryId(n, clientData.quotations || []) === enq.id)}
                  onOpenNotes={() => {
                    setNotesFocus(enq.id);
                    openTab('comments');
                  }}
                  clientName={client.name}
                  activities={clientData.activities || []}
                  defaultExpanded={expanded}
                  openFollowUp={enq.id === followUpEnquiryId}
                  onChanged={loadClientData}
                  onCreateQuotation={() => setQuoteModal({ enquiryId: enq.id })}
                  onReviseQuotation={(quotation) => setQuoteModal({ quotation })}
                  onEditQuotation={editQuotation}
                />
                </div>
              ))}
            </div>
          ))}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Breadcrumb & Navigation */}
        <div className="flex min-w-0 items-center space-x-2 text-xs text-slate-500">
          <Link href="/clients" className="hover:text-sky-600 flex shrink-0 items-center space-x-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Clients</span>
          </Link>
          <span>/</span>
          <span className="min-w-0 font-semibold text-slate-800 truncate">{client.name}</span>
        </div>

        {/* Profile Hero Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex min-w-0 items-start space-x-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center space-x-2">
                  <h1 className="min-w-0 break-words [overflow-wrap:anywhere] text-xl font-bold text-navy-950 tracking-tight">{client.name}</h1>
                  {editingCode ? (
                    <span className="flex items-center space-x-1.5 text-xs">
                      <input
                        type="text"
                        value={codeDraft}
                        onChange={(e) => setCodeDraft(normalizeClientCode(e.target.value).slice(0, 10))}
                        className="w-24 border border-slate-300 rounded-lg px-2 py-0.5 font-bold tracking-wider"
                        autoFocus
                      />
                      <button onClick={saveClientCode} className="font-semibold text-sky-700">Save</button>
                      <button onClick={() => { setEditingCode(false); setCodeError(null); }} className="font-semibold text-slate-500">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider bg-navy-900 text-white">
                      {client.code || 'No code'}
                      {!codeInUse && (
                        <button
                          onClick={() => {
                            setCodeDraft(client.code || '');
                            setEditingCode(true);
                          }}
                          className="ml-2 font-semibold text-sky-300 hover:text-white"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                    {client.industrySegment}
                  </span>
                </div>
                {codeError && <p className="text-xs text-rose-600 mt-1">{codeError}</p>}
                <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-600">
                  {primaryContact && (
                    <span className="flex items-center space-x-1">
                      <Users className="h-3.5 w-3.5 text-slate-500" />
                      <span>{primaryContact.name}</span>
                    </span>
                  )}
                  {primaryContact?.mobile && (
                    <span className="flex items-center space-x-1">
                      <Phone className="h-3.5 w-3.5 text-slate-500" />
                      <a href={`tel:${primaryContact.mobile.replace(/\s/g, '')}`} className="hover:underline">{primaryContact.mobile}</a>
                      <a
                        href={`https://wa.me/${(() => {
                          const d = primaryContact.mobile.replace(/\D/g, '');
                          return d.length === 10 ? `91${d}` : d;
                        })()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-3 w-3" />
                        WhatsApp
                      </a>
                    </span>
                  )}
                  {client.city && (
                    <span className="flex items-center space-x-1">
                      <MapPin className="h-3.5 w-3.5 text-slate-500" />
                      <span>{client.city}{client.state ? `, ${client.state}` : ''}</span>
                    </span>
                  )}
                  <span>Owner: <strong>{client.assignedTo?.name}</strong></span>
                </div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowLogActivity(true)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3 py-1.5 rounded-xl transition"
              >
                Log Call/Visit
              </button>
              <button
                onClick={() => setShowNewEnquiryModal(true)}
                className="bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold px-3 py-1.5 rounded-xl border border-sky-200 transition"
              >
                New Requirement
              </button>
              <button
                onClick={() => setQuoteModal({})}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition"
              >
                New Quotation
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Tab Navigation */}
        <div className="border-b border-slate-200 flex space-x-6 text-xs font-bold overflow-x-auto">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'enquiries', label: `Requirements (${client.enquiries?.length || 0})` },
            { key: 'activities', label: `Activities (${client.activities?.length || 0})` },
            { key: 'tasks', label: `Follow-ups (${client.tasks?.length || 0})` },
            { key: 'proposals', label: `Quotations (${client.quotations?.length || 0})` },
            { key: 'orders', label: `Orders (${client.orders?.length || 0})` },
            { key: 'execution', label: 'Execution' },
            { key: 'payments', label: 'Payments' },
            { key: 'comments', label: `Notes (${directorComments.length})` },
            { key: 'audit', label: 'Change Log' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => openTab(tab.key as ClientTab)}
              aria-current={activeTab === tab.key ? 'page' : undefined}
              className={`pb-3 border-b-2 whitespace-nowrap transition ${
                activeTab === tab.key
                  ? 'border-sky-600 text-sky-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Overview */}
        <RecordSearch {...profileFilter} label="Search records" />
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* General notes about the client, pinned on top */}
            {directorComments.some((n) => n.entityType === 'CLIENT') && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-amber-900">General notes</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setNotesFocus(null);
                      openTab('comments');
                    }}
                    className="text-xs font-semibold text-sky-700 hover:underline"
                  >
                    View all notes
                  </button>
                </div>
                {directorComments
                  .filter((n) => n.entityType === 'CLIENT')
                  .slice(0, 2)
                  .map((n) => (
                    <NoteItem key={n.id} note={n} tone="amber" compact />
                  ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              {[
                { tab: 'enquiries', label: 'Open requirements', value: String(openEnquiries.length), hint: 'View requirements', icon: FileText },
                { tab: 'tasks', label: 'Follow-ups', value: String(pendingTasks.length), hint: overdueTasks.length ? `${overdueTasks.length} overdue` : 'View scheduled work', icon: Clock },
                { tab: 'proposals', label: 'Quotations', value: String(client.quotations?.length || 0), hint: 'View quotations', icon: FileSpreadsheet },
                { tab: 'orders', label: 'Confirmed orders', value: String(activeOrders.length), hint: 'View order details', icon: ShoppingCart },
                { tab: 'execution', label: 'In progress', value: String(activeOrders.filter((order: any) => order.orderStatus !== 'COMPLETED').length), hint: 'Open execution', icon: CheckCircle },
                { tab: 'payments', label: 'Payment pending', value: formatINR(paymentPending), hint: `${formatINR(paymentSummary.notYetDue)} not raised yet`, icon: DollarSign },
              ].map((item) => (
                <button key={item.tab} type="button" onClick={() => openTab(item.tab as ClientTab)} className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md focus-visible:outline-sky-500">
                  <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500"><span>{item.label}</span><item.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-600" /></span>
                  <span className="mt-3 block break-words text-xl font-bold tabular-nums text-slate-900">{item.value}</span>
                  <span className="mt-2 flex items-center justify-between gap-1 text-[11px] text-sky-700">{item.hint}<ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></span>
                </button>
              ))}
            </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {/* Requirements: each one tracked separately */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm text-slate-900">Requirements</h3>
                  <button
                    onClick={() => setShowNewEnquiryModal(true)}
                    className="text-xs text-sky-600 hover:text-sky-800 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>New Requirement</span>
                  </button>
                </div>
                {renderRequirements(false)}
              </div>

              {/* Recent Activities */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-bold text-sm text-slate-900">Recent Activity</h3>
                  <button type="button" onClick={() => openTab('activities')} className="text-xs font-semibold text-sky-700 hover:underline">View all</button>
                </div>
                <div className="space-y-3">
                  {!client.activities?.length && <p className="text-xs text-slate-500">No activity recorded yet.</p>}
                  {client.activities?.slice(0, 3).map((act: any) => (
                    <div key={act.id} className="p-3 border-l-2 border-sky-500 bg-slate-50/50 rounded-r-xl text-xs">
                      <div className="flex items-center justify-between text-slate-500 text-[11px]">
                        <span>
                          {formatDateTime(act.activityDate)} · {humanize(act.activityType)}
                          {act.enquiry && <> · <strong className="text-slate-600">{act.enquiry.title}</strong></>}
                        </span>
                        <span>{act.salesperson.name}</span>
                      </div>
                      <p className="font-semibold text-slate-900 mt-1">{act.outcome}</p>
                      <p className="text-slate-600 mt-0.5">{act.keyPoints}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Commercial & Sites */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Next follow-up</h3>
                  <button type="button" onClick={() => openTab('tasks')} className="text-xs font-semibold text-sky-700 hover:underline">View all</button>
                </div>
                {pendingTasks[0] ? (
                  <div className="space-y-3 text-xs">
                    <p className="font-semibold text-slate-800">{pendingTasks[0].description}</p>
                    <p className={overdueTasks.length ? 'font-semibold text-rose-700' : 'text-slate-500'}>{formatDateTime(pendingTasks[0].dueDateTime)}{overdueTasks.length ? ' · Overdue' : ''}</p>
                    <div className="flex flex-wrap gap-2">
                      {!isDirector && (<button type="button" onClick={() => setTaskAction({ task: pendingTasks[0], action: 'complete' })} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700">Mark done</button>)}
                      <button type="button" onClick={() => setTaskAction({ task: pendingTasks[0], action: 'reschedule' })} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">Reschedule</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No follow-up scheduled. {client.enquiries?.length
                    ? <button type="button" onClick={() => openTab('enquiries')} className="font-semibold text-sky-700 hover:underline">Schedule from a requirement</button>
                    : <button type="button" onClick={() => setShowLogActivity(true)} className="font-semibold text-sky-700 hover:underline">Log activity &amp; schedule one</button>}</p>
                )}
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs space-y-3">
                <h3 className="font-bold text-sm text-slate-900">Details</h3>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">GSTIN:</span>
                  <span className="font-bold text-slate-800">{client.gstNumber || 'Not provided'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Client Type:</span>
                  <span className="font-semibold text-slate-800">{client.clientType || 'End User'}</span>
                </div>
                <button type="button" onClick={() => openTab('orders')} className="flex w-full items-center justify-between rounded-lg py-2 text-left hover:bg-sky-50 focus-visible:outline-sky-500">
                  <span className="text-slate-500">Total Confirmed Orders:</span>
                  <span className="flex items-center gap-2 font-bold text-emerald-700">{activeOrders.length}<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></span>
                </button>
                <button type="button" onClick={() => openTab('payments')} className="flex w-full items-center justify-between rounded-lg py-2 text-left hover:bg-sky-50 focus-visible:outline-sky-500">
                  <span className="text-slate-500">Payment Pending:</span>
                  <span className="flex items-center gap-2 font-bold text-amber-700">
                    {formatINR(paymentPending)}<ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                </button>
              </div>

              {/* Sites & Locations */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs">
                <h3 className="font-bold text-sm text-slate-900 mb-2">Sites</h3>
                <div className="space-y-2">
                  {client.sites?.map((site: any) => (
                    <div key={site.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="font-semibold text-slate-800 [overflow-wrap:anywhere]">{site.siteName}</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">{site.address}, {site.city}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>
        )}

        {/* Tab 2: Requirements with full history */}
        {activeTab === 'enquiries' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">Requirements</h3>
              <button
                onClick={() => setShowNewEnquiryModal(true)}
                className="bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs"
              >
                New Requirement
              </button>
            </div>
            {renderRequirements(true)}
          </div>
        )}

        {/* Tab 3: Activities History */}
        {activeTab === 'activities' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">Activities</h3>
              <button
                onClick={() => setShowLogActivity(true)}
                className="bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs"
              >
                Log Call/Visit
              </button>
            </div>

            <div className="space-y-3">
              {client.activities?.map((act: any) => (
                <div key={act.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span className="font-bold text-navy-900">
                      {humanize(act.activityType)} · {humanize(act.discussionType)}
                      {act.enquiry && <span className="font-semibold text-slate-500"> · {act.enquiry.title}</span>}
                    </span>
                    <span>{formatDateTime(act.activityDate)} | By {act.salesperson.name}</span>
                  </div>
                  <p className="font-semibold text-slate-900 mt-1">{act.outcome}</p>
                  <p className="text-slate-700 mt-1 leading-relaxed">{act.keyPoints}</p>
                  {act.nextAction && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-sky-800">
                      <strong>Next Action Scheduled:</strong> {act.nextAction} ({formatDate(act.nextActionDate)})
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Follow-up Tasks */}
        {activeTab === 'tasks' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h3 className="font-bold text-sm text-slate-900">Follow-ups</h3>
            <div className="space-y-2">
              {client.tasks?.map((t: any) => (
                <div key={t.id} id={`record-${t.id}`} className="scroll-mt-24 p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{t.taskNumber} - {t.description}</span>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Due <strong>{formatDateTime(t.dueDateTime)}</strong> · {t.assignedSalesperson.name}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      t.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {humanize(t.status)}
                  </span>
                  {t.status === 'PENDING' && (
                    <div className="flex flex-wrap gap-2">
                      {!isDirector && (<button type="button" onClick={() => setTaskAction({ task: t, action: 'complete' })} className="font-semibold text-emerald-700 hover:underline">Mark done</button>)}
                      <button type="button" onClick={() => setTaskAction({ task: t, action: 'reschedule' })} className="font-semibold text-sky-700 hover:underline">Reschedule</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 5: Proposals */}
        {activeTab === 'proposals' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">Quotations</h3>
              <button
                onClick={() => setQuoteModal({})}
                className="bg-sky-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs"
              >
                + New Quotation
              </button>
            </div>

            <div className="space-y-3">
              {client.quotations?.map((q: any) => (
                <div key={q.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-start justify-between gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900">{formatQuotationNumber(q.quotationNumber, q.currentVersionNumber)}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        {humanize(q.approvalStatus)}
                      </span>
                    </div>
                    {q.enquiry && (
                      <p className="text-slate-500 mt-1">
                        For {q.enquiry.enquiryNumber} - {q.enquiry.title}
                      </p>
                    )}
                    <div className="mt-1">
                      <QuotationTerms quotation={q} />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">Date: {formatDate(q.proposalDate)}</p>
                    <div className="mt-1.5">
                      <QuotationActions
                        quotation={q}
                        onEdit={editQuotation}
                        onRevise={(quotation) => setQuoteModal({ quotation })}
                        onChanged={loadClientData}
                      />
                    </div>
                    <QuotationRevisions quotation={q} onEdit={editQuotation} onChanged={loadClientData} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 6: Orders */}
        {activeTab === 'orders' && focusedOrder && (
          // The whole order on one screen: details, execution and payments
          <div className="space-y-4">
            {allOrdersBar}
            <div id={`record-${focusedOrder.id}`} className="scroll-mt-24 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h3 className="font-bold text-sm text-slate-900">Order {focusedOrder.orderNumber}</h3>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <OrderDetails order={focusedOrder} />
              </div>
              <OrderExecution order={focusedOrder} defaultExpanded onChanged={loadClientData} />
              <OrderPayments order={focusedOrder} defaultExpanded onChanged={loadClientData} />
            </div>
          </div>
        )}

        {activeTab === 'orders' && !focusedOrder && (() => {
          // Open requirements and where each stands on the way to an order
          const open = (client.enquiries || []).filter((e: any) => e.stage !== 'WON' && e.stage !== 'LOST');
          const ready = open.filter((e: any) => {
            const q = e.quotations?.[0];
            return q && !['ACCEPTED', 'PENDING_APPROVAL', 'REJECTED'].includes(q.approvalStatus);
          });
          const notReady = open.filter((e: any) => !ready.includes(e));

          return (
            <div className="space-y-6">
              {/* Requirements ready to confirm */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-bold text-sm text-slate-900">Confirm an Order</h3>
                {ready.length === 0 && (
                  <p className="text-xs text-slate-500">No quoted requirement is waiting for an order.</p>
                )}
                {ready.map((enq: any) => {
                  const q = enq.quotations[0];
                  return (
                    <div key={enq.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-[11px] font-bold tracking-wider text-sky-700">{enq.enquiryNumber}</span>
                          <h4 className="font-bold text-sm text-slate-900">{enq.title}</h4>
                          <p className="text-slate-500 mt-0.5">
                            {requirementTypeLabel(enq)} · {stageLabel(enq.stage)} · {enq.assignedTo?.name}
                            {Number(enq.approxValue) > 0 && <> · approx. {formatINR(enq.approxValue)}</>}
                          </p>
                          {enq.requirementSummary && enq.requirementSummary !== enq.title && (
                            <p className="text-slate-600 mt-0.5">{enq.requirementSummary}</p>
                          )}
                        </div>
                        <div className="shrink-0 self-start flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setOrderFor({ quotation: q, enquiry: enq })}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3.5 py-1.5 rounded-xl shadow-xs flex items-center gap-1"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" />
                            <span>Confirm Order</span>
                          </button>
                          <button
                            onClick={() => setLostFor(enq)}
                            className="border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 font-semibold px-3.5 py-1.5 rounded-xl shadow-xs flex items-center gap-1"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Order Lost</span>
                          </button>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-200">
                        <p className="font-semibold text-slate-800">
                          Quotation {formatQuotationNumber(q.quotationNumber, q.currentVersionNumber)}
                        </p>
                        <QuotationTerms quotation={q} />
                      </div>
                    </div>
                  );
                })}

                {notReady.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Not ready for an order yet</p>
                    {notReady.map((enq: any) => {
                      const q = enq.quotations?.[0];
                      return (
                        <p key={enq.id} className="text-xs text-slate-500">
                          <strong className="text-slate-700">{enq.enquiryNumber}</strong> {enq.title} ·{' '}
                          {!q
                            ? 'make a quotation first'
                            : q.approvalStatus === 'PENDING_APPROVAL'
                            ? 'quotation waiting for director approval'
                            : 'quotation was rejected; revise it first'}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Confirmed orders */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-bold text-sm text-slate-900">Confirmed Orders</h3>
                {(client.orders || []).length === 0 && <p className="text-xs text-slate-500">{clientData.orders?.length ? 'No orders match these filters.' : 'No orders yet.'}</p>}
                {client.orders?.map((ord: any) => (
                  <div key={ord.id} id={`record-${ord.id}`} className="scroll-mt-24 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <OrderDetails order={ord} />
                  </div>
                ))}
              </div>

              {/* Lost orders: requirements the client did not place an order for */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="font-bold text-sm text-slate-900">Lost Orders</h3>
                <LostOrders enquiries={(client.enquiries || []).filter((e: any) => e.stage === 'LOST')} />
              </div>
            </div>
          );
        })()}

        {/* Tab 7: Execution */}
        {activeTab === 'execution' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h3 className="font-bold text-sm text-slate-900">Order Execution</h3>
            {allOrdersBar}
            {!focusedOrder && (client.orders || []).length === 0 && (
              <p className="text-xs text-slate-500">{clientData.orders?.length ? 'No orders match these filters.' : 'No orders yet. Execution steps appear here once an order is confirmed.'}</p>
            )}
            {(focusedOrder ? [focusedOrder] : client.orders)?.map((ord: any) => (
              <div key={ord.id} id={`record-${ord.id}`} className="scroll-mt-24">
                <OrderExecution order={ord} defaultExpanded={recordId === ord.id} onChanged={loadClientData} />
              </div>
            ))}
          </div>
        )}

        {/* Tab 8: Payments */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            {/* Payments due on each order, from its quoted payment stages */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h3 className="font-bold text-sm text-slate-900">Order Payments</h3>
              {allOrdersBar}
              {!focusedOrder && (client.orders || []).length === 0 && (
                <p className="text-xs text-slate-500">{clientData.orders?.length ? 'No orders match these filters.' : 'No orders yet. Payments appear here once an order is confirmed.'}</p>
              )}
              {(focusedOrder ? [focusedOrder] : client.orders)?.map((ord: any) => (
                <div key={ord.id} id={`record-${ord.id}`} className="scroll-mt-24">
                  <OrderPayments order={ord} defaultExpanded={recordId === ord.id} onChanged={loadClientData} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes: general (client-wide) on top, then each requirement's notes */}
        {activeTab === 'comments' && (
          <ClientNotes
            key={notesFocus || 'all'}
            clientId={id}
            clientAssignedToId={client.assignedToId}
            notes={directorComments}
            enquiries={clientData.enquiries || []}
            quotations={clientData.quotations || []}
            isDirector={isDirector}
            focusEnquiryId={notesFocus}
            onPosted={loadClientData}
          />
        )}

        {/* Tab 8: Audit Trail */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
            <h3 className="font-bold text-sm text-slate-900">Change Log</h3>
            <div className="divide-y divide-slate-100">
              {auditEvents.map((ae) => (
                <div key={ae.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="text-slate-800 font-medium">{describeChange(ae)}</span>
                    <span className="text-slate-500 ml-2">by {ae.actor?.name}</span>
                  </div>
                  <span className="text-slate-500 text-[11px]">{formatDateTime(ae.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Log Activity Modal */}
      {taskAction?.action === 'complete' && (
        <CompleteTaskModal isOpen task={taskAction.task} onClose={() => setTaskAction(null)} onSuccess={() => { setTaskAction(null); loadClientData(); }} />
      )}
      {taskAction?.action === 'reschedule' && (
        <RescheduleTaskModal isOpen task={taskAction.task} onClose={() => setTaskAction(null)} onSuccess={() => { setTaskAction(null); loadClientData(); }} />
      )}
      {showLogActivity && (
        <LogActivityModal
          isOpen={showLogActivity}
          onClose={() => setShowLogActivity(false)}
          onSuccess={() => {
            setShowLogActivity(false);
            loadClientData();
          }}
          clientId={id}
          clientName={client.name}
          enquiries={clientData.enquiries}
          contacts={clientData.contacts}
        />
      )}

      {/* Create Quotation Modal */}
      {quoteModal && (
        <CreateQuotationModal
          isOpen={!!quoteModal}
          onClose={() => setQuoteModal(null)}
          onSuccess={() => {
            setQuoteModal(null);
            loadClientData();
          }}
          clientId={id}
          clientName={client.name}
          enquiries={clientData.enquiries}
          defaultEnquiryId={quoteModal.enquiryId}
          existingQuotation={quoteModal.quotation}
          editVersionNumber={quoteModal.editVersionNumber}
        />
      )}

      {orderFor && (
        <ConvertOrderModal
          isOpen={!!orderFor}
          onClose={() => setOrderFor(null)}
          onSuccess={() => {
            setOrderFor(null);
            loadClientData();
            // Next step after confirming: carry out the order
            setActiveTab('execution');
          }}
          quotation={orderFor.quotation}
          enquiry={orderFor.enquiry}
          clientName={client.name}
        />
      )}

      {lostFor && (
        <OrderLostModal
          enquiry={lostFor}
          clientName={client.name}
          onClose={() => setLostFor(null)}
          onSuccess={() => {
            setLostFor(null);
            loadClientData();
          }}
        />
      )}

      {/* New Requirement Modal */}
      {showNewEnquiryModal && (
        <AddRequirementModal
          onClose={() => setShowNewEnquiryModal(false)}
          onSuccess={() => {
            setShowNewEnquiryModal(false);
            loadClientData();
          }}
          clientId={id}
          clientName={client.name}
          contactId={primaryContact?.id}
        />
      )}
    </AppShell>
  );
}
