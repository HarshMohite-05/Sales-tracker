'use client';

import React, { useState, useEffect, useMemo } from 'react';
import LoadError from '@/components/ui/LoadError';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import {
  Users,
  Building,
  Phone,
  MapPin,
  Clock,
  AlertTriangle,
  CalendarCheck,
  MessageCircle,
  ArrowUpDown,
  Plus,
} from 'lucide-react';
import AddClientModal from '@/components/modals/AddClientModal';
import { formatINRCompact, formatDateTime, stageLabel, TIMEZONE } from '@/lib/utils';
import { Avatar, Skeleton, cn } from '@/components/ui/dashboard';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';

type Urgency = 'overdue' | 'today' | 'upcoming' | 'nostep' | 'closed';

const STAGE_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  PROPOSAL: 'bg-sky-100 text-sky-800',
  NEGOTIATION: 'bg-violet-100 text-violet-800',
  WON: 'bg-emerald-100 text-emerald-800',
  LOST: 'bg-rose-100 text-rose-700',
  ON_HOLD: 'bg-amber-100 text-amber-800',
};

function dayKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
}

function urgencyOf(client: any): Urgency {
  const next = client.tasks?.[0];
  const open = (client.enquiries || []).filter((e: any) => e.stage !== 'WON' && e.stage !== 'LOST');
  if (!next) return open.length > 0 ? 'nostep' : 'closed';
  const due = new Date(next.dueDateTime);
  if (due.getTime() < Date.now()) return 'overdue';
  if (dayKey(due) === dayKey(new Date())) return 'today';
  return 'upcoming';
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, today: 1, nostep: 2, upcoming: 3, closed: 4 };

/** Digits only, with India's 91 prefix for 10-digit numbers, for wa.me links. */
function whatsappNumber(mobile: string) {
  const digits = (mobile || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'attention' | 'recent'>('attention');
  const [showAddModal, setShowAddModal] = useState(false);
  const [userRole, setUserRole] = useState<'DIRECTOR' | 'SALESPERSON'>('SALESPERSON');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setUserRole(data.user.role);
          setUserId(data.user.id);
        }
      })
      .catch(() => {});
  }, []);

  async function loadClients() {
    setLoadError(null);
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
      }
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  useEffect(() => { loadClients(); }, []);

  // Reload when a client is added from the top bar
  useEffect(() => {
    const reload = () => {
      loadClients();
    };
    window.addEventListener('crm:data-changed', reload);
    return () => window.removeEventListener('crm:data-changed', reload);
  });

  const withUrgency = useMemo(() => clients.map((c) => ({ ...c, urgency: urgencyOf(c) as Urgency })), [clients]);
  const clientFilter = useRecordFilters(withUrgency);

  const visible = useMemo(() => {
    let list = clientFilter.rows;
    if (sortBy === 'attention') {
      list = [...list].sort((a, b) => {
        const r = URGENCY_RANK[a.urgency as Urgency] - URGENCY_RANK[b.urgency as Urgency];
        if (r !== 0) return r;
        const da = a.tasks?.[0] ? new Date(a.tasks[0].dueDateTime).getTime() : Infinity;
        const db = b.tasks?.[0] ? new Date(b.tasks[0].dueDateTime).getTime() : Infinity;
        return da - db;
      });
    }
    return list;
  }, [clientFilter.rows, sortBy]);

  return (
    <AppShell>
      <div className="space-y-5">
        <LoadError message={loadError} onRetry={loadClients} />
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Clients</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {loadError ? 'Client records unavailable' : loading ? 'Loading…' : `${clients.length} client${clients.length === 1 ? '' : 's'}${userRole === 'SALESPERSON' ? ' assigned to you' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-600/30 transition hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" />
            Add client
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={() => setSortBy(sortBy === 'attention' ? 'recent' : 'attention')} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100">
            <ArrowUpDown className="h-3.5 w-3.5" />{sortBy === 'attention' ? 'Needs attention first' : 'Recently updated'}
          </button>
        </div>

        {/* List */}
        <RecordSearch {...clientFilter} />
        {loadError ? null : loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <Building className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <h3 className="text-sm font-bold text-slate-800">
              {clients.length ? 'No clients match these filters' : 'No clients yet'}
            </h3>
            {clients.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
              >
                Add client
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((client) => {
              const primaryContact = client.contacts && client.contacts[0];
              const next = client.tasks?.[0];
              const urgency: Urgency = client.urgency;
              const open = (client.enquiries || []).filter((e: any) => e.stage !== 'WON' && e.stage !== 'LOST');
              const openValue = open.reduce((sum: number, e: any) => sum + Number(e.estimatedValue || 0), 0);
              const shown = (open.length > 0 ? open : client.enquiries || []).slice(0, 2);
              const more = (client.enquiries?.length || 0) - shown.length;

              return (
                <div
                  key={client.id}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md',
                    urgency === 'overdue' ? 'border-rose-200' : 'border-slate-200 hover:border-sky-300'
                  )}
                >
                  <Link href={`/clients/${client.id}`} className="flex-1 p-5">
                    <div className="flex items-start gap-3">
                      <Avatar name={client.name} className="h-10 w-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900 group-hover:text-sky-700">{client.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {client.code && <span className="text-[11px] font-bold tracking-wider text-sky-700">{client.code}</span>}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{client.industrySegment}</span>
                        </div>
                      </div>
                      {openValue > 0 && (
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-slate-900">{formatINRCompact(openValue)}</p>
                          <p className="text-[10px] text-slate-500">{open.length} open</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      {primaryContact && (
                        <div className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">
                            {primaryContact.name}
                            {primaryContact.designation ? <span className="text-slate-500"> · {primaryContact.designation}</span> : null}
                          </span>
                        </div>
                      )}
                      {client.city && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">
                            {client.city}
                            {client.state ? `, ${client.state}` : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Next step */}
                    <div
                      className={cn(
                        'mt-3 rounded-xl border px-3 py-2 text-xs',
                        urgency === 'overdue' && 'border-rose-200 bg-rose-50',
                        urgency === 'today' && 'border-amber-200 bg-amber-50',
                        urgency === 'upcoming' && 'border-slate-100 bg-slate-50',
                        urgency === 'nostep' && 'border-dashed border-amber-300 bg-white',
                        urgency === 'closed' && 'border-slate-100 bg-slate-50'
                      )}
                    >
                      {next ? (
                        <>
                          <p
                            className={cn(
                              'text-[11px] font-semibold',
                              urgency === 'overdue' ? 'text-rose-700' : urgency === 'today' ? 'text-amber-800' : 'text-slate-500'
                            )}
                          >
                            {urgency === 'overdue' ? 'Overdue · ' : urgency === 'today' ? 'Today · ' : 'Next · '}
                            {formatDateTime(next.dueDateTime)}
                          </p>
                          <p className="mt-0.5 line-clamp-1 font-medium text-slate-800">{next.description}</p>
                        </>
                      ) : urgency === 'nostep' ? (
                        <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          No next step planned — open to add one
                        </p>
                      ) : (
                        <p className="text-slate-500">No open requirements</p>
                      )}
                    </div>

                    {shown.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {shown.map((enq: any) => (
                          <div key={enq.id} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-slate-700">{enq.title}</span>
                            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', STAGE_STYLE[enq.stage] || STAGE_STYLE.NEW)}>
                              {stageLabel(enq.stage)}
                            </span>
                          </div>
                        ))}
                        {more > 0 && <p className="text-[11px] text-slate-500">+{more} more</p>}
                      </div>
                    )}
                  </Link>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2">
                    {primaryContact?.mobile && primaryContact.mobile.replace(/\D/g, '').length >= 7 ? (
                      <>
                        <a
                          href={`tel:${primaryContact.mobile.replace(/\s/g, '')}`}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
                          title={primaryContact.mobile}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Call
                        </a>
                        <a
                          href={`https://wa.me/${whatsappNumber(primaryContact.mobile)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </a>
                      </>
                    ) : (
                      <span className="px-2.5 py-1.5 text-xs text-slate-500">No mobile saved</span>
                    )}
                    <span className="ml-auto truncate pr-1 text-[11px] text-slate-500">{client.assignedTo?.name || 'Unassigned'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddClientModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadClients();
                  }}
          currentUserRole={userRole}
          currentUserId={userId}
        />
      )}
    </AppShell>
  );
}
