'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Droplets,
  Filter,
  Funnel as FunnelIcon,
  IndianRupee,
  Layers,
  Percent,
  ReceiptText,
  ShoppingBag,
  Truck,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { formatINR, formatINRCompact, getIndianFYQuarter, humanize, stageLabel, TIMEZONE } from '@/lib/utils';
import { formatQuotationNumber } from '@/lib/quotation';
import { stateCode } from '@/lib/indianStates';
import { PAYMENT_STATUS_LABELS } from '@/lib/deductions';
import DirectorQuoteApproveModal from '@/components/modals/DirectorQuoteApproveModal';
import RecordSearch from '@/components/ui/RecordSearch';
import { EMPTY_FILTERS, RecordFilters } from '@/lib/recordFilters';
import { Funnel, Gauge, Sparkline, StatusDonut, TrendChart } from '@/components/dashboard/Charts';
import RegisterTable, { EMPTY_REGISTER_STATE, RegisterColumn, RegisterConfig, RegisterState } from '@/components/dashboard/RegisterTable';

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      hour12: false,
      timeZone: TIMEZONE,
    }).format(new Date())
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// Change against the previous period; null when there is nothing to compare with
function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

const card = 'rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_8px_30px_rgba(0,0,0,0.25)]';

export default function DashboardPage() {
  const currentFY = getIndianFYQuarter();
  const { financialYear, quarter } = currentFY;
  const [recordFilters, setRecordFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [filterError, setFilterError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAppliedFilters(recordFilters), 250);
    return () => clearTimeout(timer);
  }, [recordFilters]);

  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const dashboardRequest = useRef(0);
  const [userName, setUserName] = useState('');
  const [selectedQuoteForApproval, setSelectedQuoteForApproval] = useState<any>(null);
  // What the table below shows: a card's register (optionally narrowed by a chart click), else recent
  // orders. Kept for the session, so coming back from a record restores the same view and filters.
  const [view, setView] = useState<{ key: DetailKey; preset?: Preset } | null>(null);
  const [register, setRegister] = useState<RegisterState>(EMPTY_REGISTER_STATE);
  const [restored, setRestored] = useState(false);
  // Directors: whose dashboard is shown, '' for the whole team
  const [viewAs, setViewAs] = useState('');
  // Directors: one office (Mumbai, Ahmedabad) or both
  const [officeId, setOfficeId] = useState('');
  const detail = view?.key ?? null;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(VIEW_STORE) || 'null');
      if (saved) {
        setView(saved.view ?? null);
        setViewAs(saved.viewAs || '');
        setOfficeId(saved.officeId || '');
        setRegister({ ...EMPTY_REGISTER_STATE, ...saved.register });
        if (saved.recordFilters) {
          setRecordFilters(saved.recordFilters);
          setAppliedFilters(saved.recordFilters);
        }
      }
    } catch {}
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(VIEW_STORE, JSON.stringify({ view, register, recordFilters, viewAs, officeId }));
    } catch {}
  }, [restored, view, register, recordFilters, viewAs, officeId]);
  function showDetail(key: DetailKey, preset?: Preset) {
    const same = view?.key === key && JSON.stringify(view?.preset) === JSON.stringify(preset);
    setView(same ? null : { key, preset });
    setRegister(EMPTY_REGISTER_STATE);
    requestAnimationFrame(() => document.getElementById('details-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUserName(data?.user?.name || ''))
      .catch(() => {});
  }, []);

  async function loadDashboard() {
    const requestId = ++dashboardRequest.current;
    setLoading(true);
    setFilterError('');
    try {
      const params = new URLSearchParams({
        financialYear,
        quarter,
        filters: JSON.stringify(appliedFilters),
      });
      if (viewAs) params.set('salespersonId', viewAs);
      if (officeId) params.set('officeId', officeId);
      const res = await fetch(`/api/dashboard/stats?${params.toString()}`);
      const data = await res.json();
      if (requestId !== dashboardRequest.current) return;
      if (res.ok) setStats(data);
      else setFilterError(data.error || 'Could not apply these filters.');
    } catch {
      if (requestId === dashboardRequest.current) setFilterError('Could not update the dashboard. Please try again.');
    }
    if (requestId === dashboardRequest.current) setLoading(false);
  }

  useEffect(() => {
    loadDashboard();
    // Reload when a client is added from the sidebar
    window.addEventListener('crm:data-changed', loadDashboard);
    return () => window.removeEventListener('crm:data-changed', loadDashboard);
  }, [financialYear, quarter, appliedFilters, viewAs, officeId]);

  const isDirector = stats?.role === 'DIRECTOR';
  // A director looking at one salesperson's dashboard, or at the whole team
  const viewing: { id: string; name: string } | null = stats?.viewing ?? null;
  const teamView = isDirector && !viewing;
  const summary = stats?.summary || {};
  const visual = stats?.visual;
  const kpis = visual?.kpis;
  const monthly: any[] = visual?.monthly || [];
  const last6 = (key: string) => monthly.slice(-6).map((m) => Number(m[key]) || 0);
  const firstLoad = loading && !stats;

  const target = visual?.target;
  const targetPct = target?.target > 0 ? (target.achieved / target.target) * 100 : null;
  const conversion = kpis ? pct(kpis.conversion.won, kpis.conversion.total) : 0;
  const outstanding = Number(summary.totalOutstanding || 0);
  const delivery = summary.delivery;
  const firstName = userName.split(' ')[0];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: TIMEZONE,
    }).format(d);
  // The range's start without the year, which the end already shows
  const fmtDayShort = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: TIMEZONE,
    }).format(d);

  return (
    <AppShell theme="dark">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          {isDirector && (stats?.salespeople?.length || stats?.offices?.length) ? (
            // Directors: the office and person switchers sit beside the title, so the cards still fit on one screen
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Director Dashboard</h1>
              {stats?.offices?.length > 0 && (
                <select
                  aria-label="Office"
                  value={officeId}
                  onChange={(e) => {
                    setOfficeId(e.target.value);
                    setViewAs('');
                  }}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)]"
                >
                  <option value="">All offices</option>
                  {stats.offices.map((o: any) => (
                    <option key={o.id} value={o.id}>
                      {o.name} office
                    </option>
                  ))}
                </select>
              )}
              {stats?.salespeople?.length > 0 && <PersonSwitcher people={stats.salespeople} value={viewAs} onChange={setViewAs} />}
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{isDirector ? 'Director Dashboard' : 'Sales Dashboard'}</h1>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Track sales performance, follow-ups and orders</p>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-[var(--text-primary)]">
              <CalendarDays className="h-4 w-4 text-[var(--text-secondary)]" />
              {fmtDayShort(monthStart)} – {fmtDay(now)}
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-2 text-[var(--text-secondary)]">
              {financialYear} · {quarter}
            </span>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className={`inline-flex items-center gap-2 rounded-xl border px-2.5 py-2 font-semibold transition ${
                showFilters
                  ? 'border-[#5598e7] bg-[#5598e7]/15 text-white'
                  : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filters
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-2xl bg-white p-1">
            <RecordSearch
              filters={recordFilters}
              onChange={setRecordFilters}
              fields={stats?.filterFields || [{ key: '__all', label: 'Any field', kind: 'text' }]}
              total={stats?.filterTotal}
              count={stats?.filterCount}
              label="Search dashboard"
            />
          </div>
        )}
        {filterError && (
          <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {filterError}
          </p>
        )}

        {/* Greeting + target */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <section className="relative overflow-hidden rounded-2xl border border-[#2a78d6]/30 bg-gradient-to-br from-[#0f2b5c] via-[#0d3c8a] to-[#0a64b8] p-4 xl:col-span-5">
            <Waves />
            <div className="relative flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur">
                <Droplets className="h-6 w-6 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-white">
                  {viewing ? (
                    <>{viewing.name}&apos;s dashboard</>
                  ) : (
                    <>
                      {greeting()}
                      {firstName ? `, ${firstName}!` : '!'} <span aria-hidden="true">👋</span>
                    </>
                  )}
                </h2>
                <p className="mt-1 text-sm text-sky-100/90">
                  {firstLoad ? (
                    'Loading your overview…'
                  ) : (
                    <>
                      {viewing ? `${viewing.name.split(' ')[0]} has ` : teamView ? 'Your team has ' : 'You have '}
                      <strong className="text-white">
                        {summary.dueTodayCount || 0} follow-up
                        {summary.dueTodayCount === 1 ? '' : 's'}
                      </strong>{' '}
                      today
                      {summary.overdueTasksCount > 0 && (
                        <>
                          {' '}
                          and <strong className="text-white">{summary.overdueTasksCount} overdue</strong>
                        </>
                      )}
                      .
                      {targetPct !== null ? (
                        <>
                          {' '}
                          {viewing ? 'At' : teamView ? 'The team is at' : 'Overall, you are at'}{' '}
                          <strong className="text-white">{Math.round(targetPct)}%</strong> of {viewing ? 'the' : teamView ? 'its' : 'your'} order target.
                        </>
                      ) : (
                        <> {formatINRCompact(summary.totalPipelineValue)} is open in the pipeline.</>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
            {!firstLoad &&
              (teamView ? (
                <Attention
                  items={[
                    {
                      label: 'quotations waiting for your approval',
                      count: summary.pendingQuotesCount || 0,
                      tone: 'amber',
                      onClick: () =>
                        document.getElementById('approvals')?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        }),
                    },
                    {
                      label: 'follow-ups overdue across the team',
                      count: summary.overdueTasksCount || 0,
                      tone: 'rose',
                      onClick: () => showDetail('dueFollowUps'),
                    },
                    {
                      label: 'payments due now',
                      count: summary.collectionsCount || 0,
                      value: outstanding,
                      tone: 'rose',
                      onClick: () => showDetail('outstanding'),
                    },
                    {
                      label: 'open requirements with no next follow-up',
                      count: summary.missingActionCount || 0,
                      tone: 'amber',
                      onClick: () => showDetail('pipeline'),
                    },
                  ]}
                />
              ) : (
                <TodayPlan overdue={stats?.details?.overdueTasks || []} today={stats?.details?.todayTasks || []} onViewAll={showDetail} />
              ))}
          </section>

          <section className={`${card} px-5 py-4 xl:col-span-7`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                Target Achievement
                {target?.label && <span className="font-normal text-[var(--text-muted)]"> · {target.label}</span>}
              </h3>
              <Link href="/targets" className="flex items-center gap-1 text-xs font-semibold text-[#86b6ef] hover:text-white">
                View details <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mt-1 grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex justify-center">
                {targetPct !== null ? (
                  <Gauge percent={targetPct} />
                ) : (
                  <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                    No order target set
                    <br />
                    for {target?.label || 'this period'}
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Stat label="Achieved (this period)" value={formatINRCompact(target?.achieved)} />
                <Stat label="Target (this period)" value={target?.target > 0 ? formatINRCompact(target.target) : '—'} />
                <Stat label="Remaining" value={target?.target > 0 ? formatINRCompact(Math.max(target.target - target.achieved, 0)) : '—'} />
                <Stat label="Days left" value={String(target?.daysLeft ?? '—')} icon />
                {target?.target > 0 && (
                  <div className="col-span-2">
                  <dt className="sr-only">Pace</dt>
                  <dd className="text-[var(--text-secondary)]">
                    {target.achieved >= target.target ? (
                      <span className="font-semibold text-[var(--delta-up)]">Target achieved. Well done!</span>
                    ) : target.daysLeft > 0 ? (
                      <>
                        Book about{' '}
                        <strong className="text-[var(--text-primary)]">{formatINRCompact((target.target - target.achieved) / target.daysLeft)}</strong> a day to
                        reach it
                      </>
                    ) : (
                      'This target period has ended'
                    )}
                  </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>
        </div>

        {/* Row 1: leads to orders */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi
            onClick={() => showDetail('leads')}
            active={detail === 'leads'}
            icon={Users}
            label="Total Leads"
            value={String(kpis?.leads.total ?? 0)}
            note={kpis ? `+${kpis.leads.thisMonth} this month` : ''}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('enquiryValue')}
            active={detail === 'enquiryValue'}
            icon={BarChart3}
            label="Total Enquiry Generated"
            value={formatINRCompact(kpis?.enquiryValue.total)}
            note={kpis ? `${formatINRCompact(kpis.enquiryValue.thisMonth)} this month` : ''}
            loading={firstLoad}
          />
          <Kpi
            icon={Layers}
            label="Avg Enquiry Value"
            value={formatINRCompact(kpis?.leads.total ? kpis.enquiryValue.total / kpis.leads.total : 0)}
            note="per lead"
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('pipeline')}
            active={detail === 'pipeline'}
            icon={FunnelIcon}
            label="Pipeline"
            value={formatINRCompact(summary.totalPipelineValue)}
            note={plural(summary.openEnquiriesCount || 0, 'open lead')}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('ordersBooked')}
            active={detail === 'ordersBooked'}
            icon={ShoppingBag}
            label="Orders Booked"
            value={formatINRCompact(kpis?.orders.value)}
            second={`${kpis?.orders.count ?? 0} orders`}
            note={kpis ? `+${kpis.orders.thisMonth} this month` : ''}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('ordersLost')}
            active={detail === 'ordersLost'}
            icon={XCircle}
            tone="rose"
            label="Orders Lost"
            value={formatINRCompact(kpis?.lost.value)}
            second={`${kpis?.lost.count ?? 0} lost`}
            note="marked Order Lost"
            loading={firstLoad}
          />
          <Kpi
            icon={Percent}
            tone="green"
            label="Conversion Rate"
            value={`${kpis ? pct(kpis.won.value, kpis.enquiryValue.total) : 0}%`}
            unit="by value"
            second={`${conversion}% by no.`}
            note={kpis ? `${kpis.won.count} of ${kpis.leads.total} leads won` : ''}
            loading={firstLoad}
          />
        </div>

        {/* Row 2: follow-ups and money */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi
            onClick={() => showDetail('dueFollowUps')}
            active={detail === 'dueFollowUps'}
            icon={AlertTriangle}
            tone={summary.overdueTasksCount > 0 ? 'rose' : 'default'}
            label="Due Follow-ups"
            value={String(summary.overdueTasksCount || 0)}
            note={summary.overdueTasksCount > 0 ? 'past their due time, need attention now' : 'nothing overdue'}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('todayFollowUps')}
            active={detail === 'todayFollowUps'}
            icon={CalendarCheck}
            label="Today's Follow-ups"
            value={String(kpis?.followUpsToday.now ?? 0)}
            delta={kpis && change(kpis.followUpsToday.now, kpis.followUpsToday.before)}
            vs="vs yesterday"
            note="due today"
            neutral
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('futureFollowUps')}
            active={detail === 'futureFollowUps'}
            icon={CalendarClock}
            label="Future Follow-ups"
            value={String(summary.upcomingTasksCount || 0)}
            note="scheduled after today"
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('received')}
            active={detail === 'received'}
            icon={Wallet}
            tone="green"
            label="Payment Received"
            value={formatINRCompact(summary.totalPaymentsReceived)}
            note={kpis ? `${formatINRCompact(kpis.received.now)} this month` : ''}
            spark={last6('received')}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('outstanding')}
            active={detail === 'outstanding'}
            icon={IndianRupee}
            tone={outstanding > 0 ? 'amber' : 'default'}
            label="Outstanding Payment"
            value={formatINRCompact(outstanding)}
            note={outstanding > 0 ? `${plural(summary.collectionsCount || 0, 'milestone')} due now` : 'nothing due now'}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('futureDue')}
            active={detail === 'futureDue'}
            icon={Clock}
            label="Future Due"
            value={formatINRCompact(summary.totalPaymentsNotYetDue)}
            note={`${plural(summary.futureDueCount || 0, 'milestone')} not due yet`}
            loading={firstLoad}
          />
          <Kpi
            onClick={() => showDetail('delivery')}
            active={detail === 'delivery'}
            icon={Truck}
            tone={delivery?.overdue > 0 ? 'rose' : delivery?.dueToday > 0 ? 'amber' : 'default'}
            label="Ongoing Execution Summary"
            value={String(delivery?.overdue ?? 0)}
            unit="overdue"
            second={`${delivery?.dueToday ?? 0} due today · ${delivery?.upcoming ?? 0} upcoming`}
            note={`${plural(delivery?.ongoing ?? 0, 'order')} in execution`}
            loading={firstLoad}
          />
        </div>

        {/* Directors: every salesperson side by side; a row opens that salesperson's dashboard */}
        {teamView && stats?.team && <TeamPerformance team={stats.team} onOpen={setViewAs} />}

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <section className={`${card} p-5 xl:col-span-4`}>
            <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">
              Requirements &amp; Orders Trend <span className="font-normal text-[var(--text-muted)]">· last 10 months</span>
            </h3>
            {firstLoad ? (
              <ChartSkeleton />
            ) : (
              <TrendChart
                months={monthly}
                onSelect={(m) =>
                  showDetail('leads', {
                    kind: 'month',
                    month: m.key,
                    label: `Created in ${m.label}`,
                  })
                }
              />
            )}
          </section>
          <section className={`${card} p-5 xl:col-span-4`}>
            <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">
              Requirement to Order Funnel <span className="font-normal text-[var(--text-muted)]">· click a stage for its requirements</span>
            </h3>
            {firstLoad ? (
              <ChartSkeleton />
            ) : (
              <Funnel
                stages={visual?.funnel || []}
                onSelect={(stage) =>
                  showDetail('leads', {
                    kind: 'funnel',
                    stage,
                    label: (visual?.funnel || []).find((f: any) => f.key === stage)?.label || stage,
                  })
                }
              />
            )}
          </section>
          <section className={`${card} p-5 xl:col-span-4`}>
            <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">
              Order Status <span className="font-normal text-[var(--text-muted)]">· count and net value</span>
            </h3>
            {firstLoad ? (
              <ChartSkeleton />
            ) : (
              <StatusDonut
                items={visual?.orderStatus || []}
                onSelect={(status) =>
                  showDetail('ordersBooked', {
                    kind: 'status',
                    status,
                    label: (visual?.orderStatus || []).find((o: any) => o.key === status)?.label || status,
                  })
                }
              />
            )}
          </section>
        </div>

        {/* Details of the tile clicked (recent orders until one is); each row opens its record */}
        <DetailsPanel
          stats={stats}
          view={view}
          register={register}
          onRegister={setRegister}
          onClose={() => {
            setView(null);
            setRegister(EMPTY_REGISTER_STATE);
          }}
          loading={firstLoad}
        />

        {isDirector && (stats?.pendingQuotes || []).length > 0 && (
          <section id="approvals" className={`${card} scroll-mt-24 p-5`}>
            <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">Waiting for your approval</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {stats.pendingQuotes.map((q: any) => (
                <div key={q.id} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--text-primary)]">{q.client.name}</p>
                    <p className="text-[var(--text-muted)]">
                      {formatQuotationNumber(q.quotationNumber, q.currentVersionNumber)} · {formatINR(q.finalValue)}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedQuoteForApproval(q)}
                    className="rounded-lg bg-[#fab219] px-2.5 py-1 font-semibold text-[#0b0b0b] hover:bg-[#ffc23d]"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      {selectedQuoteForApproval && (
        <DirectorQuoteApproveModal
          isOpen={!!selectedQuoteForApproval}
          onClose={() => setSelectedQuoteForApproval(null)}
          onSuccess={() => {
            setSelectedQuoteForApproval(null);
            loadDashboard();
          }}
          quotation={selectedQuoteForApproval}
        />
      )}
    </AppShell>
  );
}

function Stat({ label, value, icon = false }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="border-b border-[var(--border)] pb-1.5">
      <dd className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
        {icon && <CalendarDays className="h-4 w-4 text-[#86b6ef]" />}
        {value}
      </dd>
      <dt className="text-[var(--text-secondary)]">{label}</dt>
    </div>
  );
}

const TONE: Record<string, { icon: string; ring: string }> = {
  default: {
    icon: 'bg-[#2a78d6]/20 text-[#86b6ef]',
    ring: 'hover:border-[#5598e7]/50',
  },
  rose: {
    icon: 'bg-[#d03b3b]/20 text-[#ff9b9b]',
    ring: 'border-[#d03b3b]/30 hover:border-[#d03b3b]/60',
  },
  amber: {
    icon: 'bg-[#fab219]/15 text-[#ffcf7a]',
    ring: 'border-[#c98500]/35 hover:border-[#c98500]/70',
  },
  green: {
    icon: 'bg-[#0ca30c]/15 text-[#7ee08a]',
    ring: 'hover:border-[#0ca30c]/50',
  },
};

function Kpi({
  href,
  onClick,
  icon: Icon,
  label,
  value,
  unit,
  second,
  delta,
  vs,
  note,
  spark,
  neutral = false,
  tone = 'default',
  size = 'md',
  active = false,
  loading,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ElementType;
  label: string;
  value: string;
  unit?: string; // small word after the value, e.g. "orders"
  second?: string; // a second figure, e.g. the value beside a count
  delta?: number | null;
  vs?: string;
  note?: string;
  spark?: number[];
  neutral?: boolean; // more is not better or worse (e.g. follow-ups today)
  tone?: keyof typeof TONE;
  size?: 'md' | 'lg';
  active?: boolean; // its details are showing in the table below
  loading?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const deltaColor = neutral ? 'text-[var(--text-secondary)]' : up ? 'text-[var(--delta-up)]' : 'text-[var(--delta-down)]';
  const t = TONE[tone];
  const className = `${card} ${t.ring} group flex w-full flex-col gap-1 text-left transition ${size === 'lg' ? 'p-5' : 'p-3'} ${
    active ? '!border-[#5598e7] ring-2 ring-[#5598e7]/40' : ''
  }`;
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={`flex shrink-0 items-center justify-center rounded-xl ${t.icon} ${size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'}`}>
          <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
        </span>
        <span className={`font-semibold leading-tight text-[var(--text-secondary)] ${size === 'lg' ? 'text-sm' : 'text-[11px]'}`}>{label}</span>
      </div>
      {loading ? (
        <span className="mt-1 h-7 w-20 animate-pulse rounded bg-white/10" />
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
          <span className={`font-bold text-[var(--text-primary)] ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}>{value}</span>
          {unit && <span className="text-[11px] text-[var(--text-muted)]">{unit}</span>}
        </div>
      )}
      {second && !loading && <span className="text-sm font-semibold text-[var(--text-primary)]/85">{second}</span>}
      <div className="mt-auto flex items-end justify-between gap-2">
        <span className="text-[11px] leading-tight text-[var(--text-muted)]">
          {delta !== undefined && delta !== null ? (
            <span className={`mr-1 inline-flex items-center font-bold ${deltaColor}`}>
              {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(delta)}%
            </span>
          ) : null}
          {delta !== undefined && delta !== null ? vs : note || (vs ? `no data ${vs.replace('vs ', 'for ')}` : '')}
        </span>
        {spark && <Sparkline values={spark} label={label} />}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} aria-controls="details-table" className={className}>
        {body}
      </button>
    );
  }
  // Display-only figures (Avg Enquiry Value, Conversion Rate) are not clickable
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className.replace(/hover:\S+/g, '')}>{body}</div>
  );
}

// Short payment status for the table
const STATUS_SHORT: Record<string, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Part paid',
  FULLY_PAID: 'Paid',
  OVERPAID: 'Overpaid',
  NOT_RAISED: 'Not raised',
};

const STATUS_PILL: Record<string, string> = {
  UNPAID: 'bg-[#d03b3b]/20 text-[#ff9b9b] ring-[#d03b3b]/40',
  PARTIALLY_PAID: 'bg-[#fab219]/15 text-[#ffcf7a] ring-[#fab219]/40',
  FULLY_PAID: 'bg-[#0ca30c]/15 text-[#7ee08a] ring-[#0ca30c]/40',
  OVERPAID: 'bg-[#9085e9]/15 text-[#c4bdf6] ring-[#9085e9]/40',
  NOT_RAISED: 'bg-white/5 text-[var(--text-secondary)] ring-white/10',
};

type DetailKey =
  | 'leads'
  | 'enquiryValue'
  | 'pipeline'
  | 'ordersBooked'
  | 'ordersLost'
  | 'dueFollowUps'
  | 'todayFollowUps'
  | 'futureFollowUps'
  | 'received'
  | 'outstanding'
  | 'futureDue'
  | 'delivery';

// What a chart click narrowed a register to
type Preset =
  { kind: 'funnel'; stage: string; label: string } | { kind: 'status'; status: string; label: string } | { kind: 'month'; month: string; label: string };

const VIEW_STORE = 'crm-dashboard-view';

// Dates as DD MMM YYYY, India time
const day = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: TIMEZONE,
      }).format(new Date(d))
    : '—';
const time = (d: string | Date) => new Date(d).getTime();
const sumOf = (rows: any[], f: (r: any) => number) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const strong = (text: React.ReactNode) => <span className="font-semibold text-[var(--text-primary)]">{text}</span>;
const clip = (text: React.ReactNode, w = 'max-w-[200px]') => <span className={`block truncate ${w}`}>{text || '—'}</span>;
// Colours: green won / completed / received, amber not started / upcoming, red lost / overdue / cancelled
const GREEN = 'bg-[#0ca30c]/15 text-[#7ee08a] ring-[#0ca30c]/40';
const AMBER = 'bg-[#fab219]/15 text-[#ffcf7a] ring-[#fab219]/40';
const RED = 'bg-[#d03b3b]/20 text-[#ff9b9b] ring-[#d03b3b]/40';
const BLUE = 'bg-[#2a78d6]/20 text-[#9ec5f4] ring-[#2a78d6]/40';
const STAGE_PILL: Record<string, string> = {
  WON: GREEN,
  LOST: RED,
  ON_HOLD: AMBER,
};
const ORDER_STATUS: Record<string, { label: string; style: string }> = {
  COMPLETED: { label: 'Completed', style: GREEN },
  IN_EXECUTION: { label: 'In execution', style: BLUE },
  DISPATCHED: { label: 'In execution', style: BLUE },
  CONFIRMED: { label: 'Not started', style: AMBER },
  CANCELLED: { label: 'Cancelled', style: RED },
};
const pill = (text: string, style = 'bg-white/5 text-[var(--text-secondary)] ring-white/10') => (
  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ${style}`}>{text}</span>
);
const money = (n: number) => formatINR(n);

const col = {
  enquiryNo: {
    key: 'enquiryNumber',
    label: 'Enquiry No.',
    cell: (e: any) => strong(e.enquiryNumber || '—'),
    sort: (e: any) => e.enquiryNumber,
    search: (e: any) => e.enquiryNumber,
  },
  created: {
    key: 'createdAt',
    label: 'Date Created',
    cell: (e: any) => day(e.createdAt),
    filterValue: (e) => day(e.createdAt),
    sort: (e: any) => time(e.createdAt),
  },
  requirement: {
    key: 'title',
    label: 'Requirement',
    cell: (e: any) => clip(e.title, 'max-w-[180px]'),
    sort: (e: any) => e.title,
    search: (e: any) => e.title,
  },
  client: {
    key: 'clientName',
    label: 'Client',
    cell: (e: any) => strong(e.clientName),
    sort: (e: any) => e.clientName,
    search: (e: any) => e.clientName,
  },
  industry: {
    key: 'industry',
    label: 'Industry',
    cell: (e: any) => e.industry || '—',
    sort: (e: any) => e.industry,
    search: (e: any) => e.industry,
  },
  city: {
    key: 'city',
    label: 'City',
    cell: (e: any) => e.city || '—',
    sort: (e: any) => e.city,
    search: (e: any) => e.city,
  },
  // Short code (Maharashtra → MH); the full name still matches a search
  state: {
    key: 'state',
    label: 'State',
    cell: (e: any) => (e.state ? <span title={e.state}>{stateCode(e.state)}</span> : '—'),
    sort: (e: any) => stateCode(e.state),
    search: (e: any) => `${e.state || ''} ${stateCode(e.state)}`,
    filterValue: (e: any) => stateCode(e.state),
  },
  productType: {
    key: 'productType',
    label: 'Product Type',
    cell: (e: any) => e.productType || '—',
    sort: (e: any) => e.productType,
    search: (e: any) => e.productType,
  },
  stage: {
    key: 'stage',
    label: 'Stage',
    cell: (e: any) => pill(stageLabel(e.stage), STAGE_PILL[e.stage]),
    sort: (e: any) => stageLabel(e.stage),
    search: (e: any) => stageLabel(e.stage),
  },
  value: {
    key: 'value',
    label: 'Enquiry Value',
    right: true,
    cell: (e: any) => strong(money(e.value)),
    sort: (e: any) => e.value,
  },
  // The order's PO number, which is its order number; a search by order number (ORD-…) still finds it
  po: {
    key: 'poNumber',
    label: 'PO No.',
    cell: (o: any) => strong(o.poNumber || o.orderNumber),
    sort: (o: any) => o.poNumber || o.orderNumber,
    search: (o: any) => `${o.poNumber || ''} ${o.orderNumber || ''}`,
    filterValue: (o: any) => o.poNumber || o.orderNumber,
  },
  salesperson: {
    key: 'salesperson',
    label: 'Salesperson',
    cell: (e: any) => e.salesperson,
    sort: (e: any) => e.salesperson,
    search: (e: any) => e.salesperson,
  },
} satisfies Record<string, RegisterColumn>;

const leadGroups = [
  {
    key: 'industry',
    label: 'Industry',
    value: (e: any) => e.industry || 'Not set',
  },
  {
    key: 'state',
    label: 'State',
    value: (e: any) => stateCode(e.state) || 'Not set',
  },
  {
    key: 'productType',
    label: 'Product Type',
    value: (e: any) => e.productType || 'Not set',
  },
];
const summarizeLeads = (rows: any[]) => `${plural(rows.length, 'lead')} · ${money(sumOf(rows, (e) => e.value))}`;

const followUpRegister = (id: string, title: string, hint: string, rows: any[], empty: string): RegisterConfig => ({
  id,
  title,
  hint,
  rows,
  empty,
  href: (t) => `/clients/${t.clientId}?tab=tasks&record=${t.id}`,
  summarize: (r) => plural(r.length, 'follow-up'),
  defaultSort: {
    key: 'dueDateTime',
    dir: id === 'futureFollowUps' ? 'asc' : 'asc',
  },
  columns: [
    {
      key: 'enquiryNumber',
      label: 'Enquiry No.',
      cell: (t) => strong(t.enquiryNumber || '—'),
      sort: (t) => t.enquiryNumber,
      search: (t) => t.enquiryNumber,
    },
    col.client,
    {
      key: 'requirement',
      label: 'Requirement',
      cell: (t) => clip(t.requirement, 'max-w-[180px]'),
      sort: (t) => t.requirement,
      search: (t) => t.requirement,
    },
    {
      key: 'type',
      label: 'Follow-up Type',
      cell: (t) => pill(humanize(t.actionType)),
      sort: (t) => t.actionType,
      search: (t) => humanize(t.actionType),
    },
    {
      key: 'dueDateTime',
      label: 'Follow-up Date',
      cell: (t) => day(t.dueDateTime),
      filterValue: (t) => day(t.dueDateTime),
      sort: (t) => time(t.dueDateTime),
    },
    {
      key: 'description',
      label: 'Description / Notes',
      cell: (t) => clip(t.description, 'max-w-[240px]'),
      search: (t) => t.description,
    },
    {
      key: 'status',
      label: 'Status',
      cell: (t) => pill(t.status === 'RESCHEDULED' ? 'Rescheduled' : 'Pending', id === 'dueFollowUps' ? RED : id === 'futureFollowUps' ? AMBER : BLUE),
      sort: (t) => t.status,
    },
    {
      key: 'next',
      label: 'Next Follow-up',
      cell: (t) => day(t.nextDueDateTime),
      filterValue: (t) => day(t.nextDueDateTime),
      sort: (t) => (t.nextDueDateTime ? time(t.nextDueDateTime) : null),
    },
    col.salesperson,
  ],
});

/** The register a card or chart opens; rows link to the record. Null view = recent orders. */
function registerFor(view: { key: DetailKey; preset?: Preset } | null, stats: any): RegisterConfig {
  const d = stats?.details || {};
  const s = stats?.summary || {};
  const leads: any[] = d.leads || [];
  const allOrders: any[] = d.orders || [];
  const leadHref = (e: any) => `/clients/${e.clientId}?tab=enquiries&record=${e.id}`;
  const preset = view?.preset;

  // Order book: every column left-aligned
  const orderColumns: RegisterColumn[] = [
    {
      key: 'enquiryNumber',
      label: 'Enquiry No.',
      cell: (o) => o.enquiryNumber || '—',
      sort: (o) => o.enquiryNumber,
      search: (o) => o.enquiryNumber,
    },
    // The client's PO number identifies the order here; a search by order number (ORD-…) still finds it
    {
      key: 'poNumber',
      label: 'PO No.',
      cell: (o) => strong(o.poNumber || o.orderNumber),
      sort: (o) => o.poNumber || o.orderNumber,
      search: (o) => `${o.poNumber || ''} ${o.orderNumber}`,
      filterValue: (o) => o.poNumber || o.orderNumber,
    },
    {
      key: 'poDate',
      label: 'PO Date',
      cell: (o) => day(o.poDate),
      filterValue: (o) => day(o.poDate),
      sort: (o) => (o.poDate ? time(o.poDate) : null),
    },
    col.client,
    col.industry,
    col.city,
    col.state,
    {
      key: 'product',
      label: 'Product',
      cell: (o) => clip(o.product, 'max-w-[140px]'),
      sort: (o) => o.product,
      search: (o) => o.product,
    },
    col.productType,
    {
      key: 'netValue',
      label: 'Order Value',
      cell: (o) => strong(money(o.netValue)),
      sort: (o) => o.netValue,
    },
    {
      key: 'orderStatus',
      label: 'Order Status',
      cell: (o) => pill(ORDER_STATUS[o.orderStatus]?.label || humanize(o.orderStatus), ORDER_STATUS[o.orderStatus]?.style),
      sort: (o) => ORDER_STATUS[o.orderStatus]?.label,
      search: (o) => ORDER_STATUS[o.orderStatus]?.label,
    },
    col.salesperson,
  ];
  // Each order counted once, whatever its payment milestones
  const summarizeOrders = (rows: any[]) => `${plural(rows.length, 'order')} · ${money(sumOf(rows, (o) => o.netValue))}`;

  switch (view?.key) {
    case 'leads':
    case 'enquiryValue': {
      let rows = leads;
      if (preset?.kind === 'funnel') {
        rows =
          preset.stage === 'quoted'
            ? leads.filter((e) => e.quoted)
            : preset.stage === 'negotiated'
              ? leads.filter((e) => e.negotiated)
              : preset.stage === 'won'
                ? leads.filter((e) => e.stage === 'WON')
                : leads;
      } else if (preset?.kind === 'month') rows = leads.filter((e) => e.month === preset.month);
      return {
        id: view.key,
        title: view.key === 'leads' ? 'Total Leads' : 'Total Enquiry Generated',
        hint: view.key === 'leads' ? 'Every enquiry, whatever its stage' : 'Every enquiry by value, highest first',
        preset: preset?.label,
        rows,
        empty: 'No leads in these filters.',
        href: leadHref,
        summarize: summarizeLeads,
        groupBy: leadGroups,
        dateFilter: { label: 'Created', value: (e) => e.createdAt },
        defaultSort: view.key === 'leads' ? { key: 'createdAt', dir: 'desc' } : { key: 'value', dir: 'desc' },
        columns: [
          col.enquiryNo,
          col.created,
          col.client,
          col.industry,
          col.city,
          col.state,
          col.requirement,
          col.productType,
          col.value,
          col.stage,
          col.salesperson,
        ],
      };
    }
    case 'pipeline':
      return {
        id: 'pipeline',
        title: 'Pipeline',
        hint: 'Active opportunities: open leads not yet won or lost',
        rows: leads.filter((e) => e.stage !== 'WON' && e.stage !== 'LOST'),
        empty: 'No open leads: every lead is won or lost.',
        href: leadHref,
        summarize: summarizeLeads,
        groupBy: leadGroups,
        defaultSort: { key: 'value', dir: 'desc' },
        columns: [
          col.enquiryNo,
          col.created,
          col.requirement,
          col.client,
          col.industry,
          col.city,
          col.state,
          col.productType,
          col.stage,
          col.value,
          col.salesperson,
        ],
      };
    case 'ordersBooked': {
      const statusMatch: Record<string, string[]> = {
        COMPLETED: ['COMPLETED'],
        IN_PROGRESS: ['IN_EXECUTION', 'DISPATCHED'],
        CONFIRMED: ['CONFIRMED'],
        CANCELLED: ['CANCELLED'],
      };
      const rows =
        preset?.kind === 'status'
          ? allOrders.filter((o) => statusMatch[preset.status]?.includes(o.orderStatus))
          : allOrders.filter((o) => o.orderStatus !== 'CANCELLED');
      return {
        id: 'ordersBooked',
        title: 'Orders Booked',
        hint: 'Confirmed orders with their purchase order details',
        preset: preset?.label,
        rows,
        empty: preset ? 'No orders with this status.' : 'No orders booked yet.',
        href: (o) => `/clients/${o.clientId}?tab=orders&record=${o.id}`,
        summarize: summarizeOrders,
        dateFilter: { label: 'PO date', value: (o) => o.poDate || o.orderDate },
        defaultSort: { key: 'poDate', dir: 'desc' },
        columns: orderColumns,
      };
    }
    case 'ordersLost':
      return {
        id: 'ordersLost',
        title: 'Orders Lost',
        hint: 'Lost enquiries and why they were not converted',
        rows: leads.filter((e) => e.stage === 'LOST'),
        empty: 'No orders lost.',
        href: (e) => `/clients/${e.clientId}?tab=orders&record=${e.id}`,
        summarize: (rows) => `${plural(rows.length, 'lost enquiry', 'lost enquiries')} · ${money(sumOf(rows, (e) => e.value))}`,
        groupBy: leadGroups,
        dateFilter: { label: 'Lost', value: (e) => e.lostDate },
        defaultSort: { key: 'lostDate', dir: 'desc' },
        columns: [
          { ...col.enquiryNo, label: 'Enquiry No.' },
          col.requirement,
          col.client,
          col.industry,
          col.state,
          col.productType,
          col.value,
          {
            key: 'reason',
            label: 'Reason',
            cell: (e) => <span className="block max-w-[240px] truncate text-[#ff9b9b]">{e.lostReason || 'Not given'}</span>,
            search: (e) => e.lostReason,
          },
          col.salesperson,
          {
            key: 'lostDate',
            label: 'Lost Date',
            cell: (e) => day(e.lostDate),
            filterValue: (e) => day(e.lostDate),
            sort: (e) => (e.lostDate ? time(e.lostDate) : null),
          },
        ],
      };
    case 'dueFollowUps':
      return followUpRegister(
        'dueFollowUps',
        'Due Follow-ups',
        'Pending follow-ups dated before today, oldest first',
        d.overdueTasks || [],
        'Nothing overdue: every follow-up is on schedule.'
      );
    case 'todayFollowUps':
      return followUpRegister('todayFollowUps', "Today's Follow-ups", 'Pending follow-ups scheduled for today', d.todayTasks || [], 'No follow-ups due today.');
    case 'futureFollowUps':
      return followUpRegister(
        'futureFollowUps',
        'Future Follow-ups',
        'Pending follow-ups scheduled after today, soonest first',
        d.futureTasks || [],
        'No follow-ups scheduled after today.'
      );
    case 'received':
      return {
        id: 'received',
        title: 'Payments Received',
        hint: 'Every payment as a separate transaction, against its order and milestone',
        rows: d.receipts || [],
        empty: 'No payments received yet.',
        href: (rc) => `/clients/${rc.clientId}?tab=payments&record=${rc.orderId}`,
        summarize: (rows) => `${plural(rows.length, 'payment')} · ${money(sumOf(rows, (rc) => rc.amount))} received`,
        dateFilter: { label: 'Paid', value: (rc) => rc.receivedDate },
        defaultSort: { key: 'receivedDate', dir: 'desc' },
        columns: [
          {
            key: 'receivedDate',
            label: 'Payment Date',
            cell: (rc) => day(rc.receivedDate),
            filterValue: (rc) => day(rc.receivedDate),
            sort: (rc) => time(rc.receivedDate),
          },
          {
            key: 'enquiryNumber',
            label: 'Enquiry No.',
            cell: (rc) => rc.enquiryNumber || '—',
            sort: (rc) => rc.enquiryNumber,
            search: (rc) => rc.enquiryNumber,
          },
          // PO No. identifies the order; a search by order or payment reference number still finds the payment
          {
            key: 'poNumber',
            label: 'PO No.',
            cell: (rc) => strong(rc.poNumber || rc.orderNumber),
            sort: (rc) => rc.poNumber || rc.orderNumber,
            search: (rc) => `${rc.poNumber || ''} ${rc.orderNumber} ${rc.reference || ''}`,
            filterValue: (rc) => rc.poNumber || rc.orderNumber,
          },
          col.client,
          {
            key: 'requirement',
            label: 'Requirement',
            cell: (rc) => clip(rc.requirement, 'max-w-[160px]'),
            sort: (rc) => rc.requirement,
            search: (rc) => rc.requirement,
          },
          {
            key: 'stage',
            label: 'Payment Stage',
            cell: (rc) => rc.stage,
            sort: (rc) => rc.stage,
            search: (rc) => rc.stage,
          },
          {
            key: 'mode',
            label: 'Payment Mode',
            cell: (rc) => (rc.paymentMode ? humanize(rc.paymentMode) : '—'),
            sort: (rc) => rc.paymentMode,
            search: (rc) => (rc.paymentMode ? humanize(rc.paymentMode) : null),
          },
          {
            key: 'amount',
            label: 'Amount Received',
            right: true,
            cell: (rc) => <span className="font-semibold text-[#7ee08a]">{money(rc.amount)}</span>,
            sort: (rc) => rc.amount,
          },
          col.salesperson,
        ],
      };
    case 'outstanding':
      return {
        id: 'outstanding',
        title: 'Outstanding Payments & Ageing',
        hint: 'Milestones raised as due and not fully received, oldest overdue first',
        rows: d.outstanding || [],
        empty: 'Nothing outstanding: every milestone raised as due has been received.',
        href: (c) => `/clients/${c.clientId}?tab=payments&record=${c.orderId}`,
        summarize: (rows) => `${plural(rows.length, 'milestone')} · ${money(sumOf(rows, (c) => c.outstanding))} to collect now`,
        dateFilter: { label: 'Due', value: (c) => c.dueDate },
        columns: [
          col.client,
          col.po,
          {
            key: 'stage',
            label: 'Payment Stage',
            cell: (c) => c.stage,
            sort: (c) => c.stage,
            search: (c) => c.stage,
          },
          {
            key: 'dueDate',
            label: 'Due Date',
            cell: (c) => day(c.dueDate),
            filterValue: (c) => day(c.dueDate),
            sort: (c) => time(c.dueDate),
          },
          {
            key: 'asked',
            label: 'Amount Asked',
            right: true,
            cell: (c) => money(c.asked),
            sort: (c) => c.asked,
          },
          {
            key: 'received',
            label: 'Amount Received',
            right: true,
            cell: (c) => money(c.received),
            sort: (c) => c.received,
          },
          {
            key: 'outstanding',
            label: 'To Collect',
            right: true,
            cell: (c) => <span className="font-bold text-[#ff9b9b]">{money(c.outstanding)}</span>,
            sort: (c) => c.outstanding,
          },
          {
            key: 'days',
            label: 'Days O/S',
            right: true,
            cell: (c) => (c.daysOverdue > 0 ? c.daysOverdue : '—'),
            sort: (c) => c.daysOverdue,
            number: (c) => c.daysOverdue,
            unit: 'days',
            presets: [10, 30, 45, 60, 90],
          },
          {
            key: 'bucket',
            label: 'Ageing Bucket',
            cell: (c) => pill(c.bucket === 'Current' ? 'Current' : `${c.bucket} days`, c.bucket === 'Current' ? BLUE : RED),
            sort: (c) => c.daysOverdue,
            search: (c) => c.bucket,
          },
          col.salesperson,
        ],
      };
    case 'futureDue':
      return {
        id: 'futureDue',
        title: 'Future Due Payments',
        hint: 'Milestones not due yet, soonest first; ones waiting on execution have no due date yet',
        rows: d.futureDue || [],
        empty: 'Nothing future due: every milestone still owed money has been raised.',
        href: (c) => `/clients/${c.clientId}?tab=payments&record=${c.orderId}`,
        summarize: (rows) => `${plural(rows.length, 'milestone')} · ${money(sumOf(rows, (c) => c.notYetDue))} not due yet`,
        dateFilter: { label: 'Due', value: (c) => c.dueDate },
        columns: [
          col.client,
          col.po,
          {
            key: 'stage',
            label: 'Payment Stage',
            cell: (c) => c.stage,
            sort: (c) => c.stage,
            search: (c) => c.stage,
          },
          {
            key: 'dueDate',
            label: 'Due Date',
            cell: (c) => (c.dueDate ? day(c.dueDate) : 'Awaiting execution'),
            excel: (c) => (c.dueDate ? day(c.dueDate) : 'Awaiting execution'),
            sort: (c) => (c.dueDate ? time(c.dueDate) : Infinity),
          },
          {
            key: 'asked',
            label: 'Amount Asked',
            right: true,
            cell: (c) => money(c.asked),
            sort: (c) => c.asked,
          },
          {
            key: 'received',
            label: 'Amount Received',
            right: true,
            cell: (c) => money(c.received),
            sort: (c) => c.received,
          },
          {
            key: 'notYetDue',
            label: 'Not Due Yet',
            right: true,
            cell: (c) => <span className="font-bold text-[#ffcf7a]">{money(c.notYetDue)}</span>,
            sort: (c) => c.notYetDue,
          },
          {
            key: 'status',
            label: 'Status',
            cell: () => pill('Not yet due', AMBER),
            search: () => 'Not yet due',
          },
          col.salesperson,
        ],
      };
    case 'delivery':
      return {
        id: 'delivery',
        title: 'Ongoing Execution Summary',
        hint: "Orders still in execution (last stage not done), against their targeted completion date: most overdue first",
        rows: d.delivery || [],
        empty: 'No orders in execution.',
        href: (r) => `/clients/${r.clientId}?tab=orders&record=${r.orderId}`,
        summarize: (rows) => `${plural(rows.length, 'order')} · ${money(sumOf(rows, (r) => r.netValue))}`,
        groupBy: [
          { key: 'dayStatus', label: 'Status', value: (r) => r.dayStatus },
          { key: 'salesperson', label: 'Salesperson', value: (r) => r.salesperson },
        ],
        dateFilter: { label: 'Targeted completion', value: (r) => r.targetDate },
        columns: [
          col.po,
          col.client,
          {
            key: 'requirement',
            label: 'Requirement',
            cell: (r) => clip(r.requirement, 'max-w-[160px]'),
            sort: (r) => r.requirement,
            search: (r) => `${r.requirement || ''} ${r.enquiryNumber || ''}`,
            filterValue: (r) => r.requirement,
          },
          {
            key: 'netValue',
            label: 'Order Value',
            right: true,
            cell: (r) => strong(money(r.netValue)),
            sort: (r) => r.netValue,
          },
          {
            key: 'targetDate',
            label: 'Targeted Completion',
            cell: (r) => (
              <span title={r.lastReason ? `Last change: ${r.lastReason}` : undefined}>
                {day(r.targetDate)}
                {r.revisions > 0 && r.originalDate && (
                  <span className="block text-[10px] text-[var(--text-muted)]">
                    was {day(r.originalDate)} · revised {r.revisions}×
                  </span>
                )}
              </span>
            ),
            filterValue: (r) => day(r.targetDate),
            sort: (r) => (r.targetDate ? time(r.targetDate) : null),
          },
          {
            key: 'currentStep',
            label: 'Execution',
            cell: (r) => (
              <span>
                {clip(r.currentStep ? `Waiting: ${r.currentStep}` : 'No steps', 'max-w-[180px]')}
                <span className="block text-[10px] text-[var(--text-muted)]">
                  {r.stepsDone} of {r.stepsTotal} steps done
                </span>
              </span>
            ),
            sort: (r) => (r.stepsTotal ? r.stepsDone / r.stepsTotal : 0),
            search: (r) => r.currentStep,
            filterValue: (r) => r.currentStep,
          },
          // Days overdue or left, as a plain count; the filter picks Left, Overdue or Due today first
          {
            key: 'days',
            label: 'Days',
            right: true,
            cell: (r) =>
              r.daysLeft === null ? (
                '—'
              ) : r.daysLeft < 0 ? (
                <span className="font-bold text-[#ff9b9b]">{plural(-r.daysLeft, 'day')} overdue</span>
              ) : r.daysLeft === 0 ? (
                <span className="font-bold text-[#ffcf7a]">0 days</span>
              ) : (
                `${plural(r.daysLeft, 'day')} left`
              ),
            sort: (r) => r.daysLeft,
            number: (r) => (r.daysLeft === null ? null : Math.abs(r.daysLeft)),
            unit: 'days',
            // e.g. Left, less than 3: orders with under 3 days left to their targeted completion
            kinds: [
              { key: 'left', label: 'Left', match: (r) => r.daysLeft !== null && r.daysLeft > 0 },
              { key: 'overdue', label: 'Overdue', match: (r) => r.daysLeft !== null && r.daysLeft < 0 },
              { key: 'due', label: 'Due today', match: (r) => r.daysLeft === 0, noValue: true },
            ],
          },
          {
            key: 'dayStatus',
            label: 'Status',
            cell: (r) => pill(r.dayStatus, r.dayStatus === 'Overdue' ? RED : r.dayStatus === 'Due Today' ? AMBER : r.dayStatus === 'Upcoming' ? BLUE : undefined),
            sort: (r) => ['Overdue', 'Due Today', 'Upcoming', 'No date'].indexOf(r.dayStatus),
            search: (r) => r.dayStatus,
          },
          col.salesperson,
        ],
      };
    default:
      return {
        id: 'recent',
        title: 'Recent Orders / Payments',
        hint: 'Click a card or chart above to open its records here',
        rows: allOrders.filter((o) => o.orderStatus !== 'CANCELLED'),
        empty: 'No orders yet.',
        href: (o) => `/clients/${o.clientId}?tab=payments&record=${o.id}`,
        summarize: (rows) =>
          `${summarizeOrders(rows)} · ${money(sumOf(rows, (o) => o.received))} received · ${money(sumOf(rows, (o) => o.outstanding))} outstanding`,
        defaultSort: { key: 'orderDate', dir: 'desc' },
        columns: [
          col.po,
          {
            key: 'orderDate',
            label: 'Order Date',
            cell: (o) => day(o.orderDate),
            filterValue: (o) => day(o.orderDate),
            sort: (o) => time(o.orderDate),
          },
          col.client,
          {
            key: 'product',
            label: 'Product',
            cell: (o) => clip(o.product, 'max-w-[140px]'),
            sort: (o) => o.product,
            search: (o) => o.product,
          },
          {
            key: 'netValue',
            label: 'Order Value',
            right: true,
            cell: (o) => strong(money(o.netValue)),
            sort: (o) => o.netValue,
          },
          {
            key: 'received',
            label: 'Received',
            right: true,
            cell: (o) => money(o.received),
            sort: (o) => o.received,
          },
          {
            key: 'outstanding',
            label: 'Outstanding',
            right: true,
            cell: (o) => money(o.outstanding),
            sort: (o) => o.outstanding,
          },
          {
            key: 'paymentStatus',
            label: 'Payment Status',
            cell: (o) => (
              <span title={PAYMENT_STATUS_LABELS[o.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS]}>
                {pill(STATUS_SHORT[o.paymentStatus] || '—', STATUS_PILL[o.paymentStatus])}
              </span>
            ),
            sort: (o) => o.paymentStatus,
          },
        ],
      };
  }
}

function DetailsPanel({
  stats,
  view,
  register,
  onRegister,
  onClose,
  loading,
}: {
  stats: any;
  view: { key: DetailKey; preset?: Preset } | null;
  register: RegisterState;
  onRegister: (next: RegisterState) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const router = useRouter();
  const built = registerFor(view, stats);
  // Salespeople only see their own records, so the salesperson column and filter are for directors
  const isSalesperson = (item: { key: string }) => item.key === 'salesperson';
  const config: RegisterConfig =
    // Shown to directors on the team view; one salesperson's records need no salesperson column
    stats?.role === 'DIRECTOR' && !stats?.viewing
      ? built
      : {
          ...built,
          columns: built.columns.filter((c) => !isSalesperson(c)),
          groupBy: built.groupBy?.filter((g) => !isSalesperson(g)),
        };
  const heading = (
    <>
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
        <ReceiptText className="h-4 w-4 text-[#86b6ef]" />
        {config.title}
        {config.preset && <span className="rounded-full bg-[#2a78d6]/25 px-2 py-0.5 text-[11px] font-semibold text-[#9ec5f4]">{config.preset}</span>}
      </h3>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
        {config.hint}
        {config.rows.length > 0 && ' · click a row to open the record'}
      </p>
    </>
  );
  return (
    <section id="details-table" className={`${card} scroll-mt-24 overflow-hidden`} aria-live="polite">
      {loading ? (
        <>
          <div className="px-5 pb-3 pt-4">{heading}</div>
          <div className="mx-5 mb-5 h-40 animate-pulse rounded-xl bg-white/5" />
        </>
      ) : (
        <RegisterTable
          key={`${config.id}-${config.preset || ''}`}
          config={config}
          state={register}
          onState={onRegister}
          onOpen={(href) => router.push(href)}
          heading={heading}
          actions={
            view && (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-white/5 hover:text-white"
              >
                <X className="h-3 w-3" /> Back to recent
              </button>
            )
          }
        />
      )}
    </section>
  );
}

function ChartSkeleton() {
  return <div className="h-48 animate-pulse rounded-xl bg-white/5" />;
}

// Decorative water waves behind the greeting
const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Director's choice of dashboard: the whole team, or one salesperson's (exactly what they see), picked
 * from a searchable list so the header stays one line however big the team is.
 */
function PersonSwitcher({ people, value, onChange }: { people: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const chip = (on: boolean) =>
    `rounded-lg px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-[#2a78d6] text-white shadow' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white'}`;
  const selected = people.find((p) => p.id === value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };
  const matches = people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div
      ref={box}
      role="group"
      aria-label="Whose dashboard"
      className="relative inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-1"
    >
      <button type="button" onClick={() => pick('')} aria-pressed={!value} className={chip(!value)}>
        <Users className="mr-1 inline h-3.5 w-3.5" />
        Team
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${chip(!!selected)} inline-flex items-center gap-1.5`}
      >
        {selected ? selected.name : `Salesperson (${people.length})`}
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-2xl">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && matches.length === 1 && pick(matches[0].id)}
            placeholder="Search salesperson"
            aria-label="Search salesperson"
            autoFocus
            className="mb-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#5598e7]/50"
          />
          <ul role="listbox" aria-label="Salespeople" className="max-h-64 overflow-auto">
            {matches.map((p) => (
              <li key={p.id} role="option" aria-selected={value === p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${value === p.id ? 'bg-[#2a78d6]/25 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-white'}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2a78d6]/25 text-[10px] font-bold text-[#9ec5f4]">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  {value === p.id && <Check className="h-3.5 w-3.5 text-[#86b6ef]" />}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2 py-1.5 text-xs text-[var(--text-muted)]">No salesperson found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The director's to-do list on the team view: what needs a decision or a push, each opening its list. */
function Attention({
  items,
}: {
  items: {
    label: string;
    count: number;
    value?: number;
    tone: 'rose' | 'amber';
    onClick: () => void;
  }[];
}) {
  const open = items.filter((i) => i.count > 0);
  return (
    <div className="relative mt-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-100/70">Needs your attention</p>
      {open.length === 0 ? (
        <p className="rounded-lg bg-white/10 px-3 py-2 text-xs text-sky-50">All clear: no approvals, overdue follow-ups or payments due.</p>
      ) : (
        <ul className="space-y-1">
          {open.map((i) => (
            <li key={i.label}>
              <button
                type="button"
                onClick={i.onClick}
                className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-left text-xs text-white backdrop-blur transition hover:bg-white/20"
              >
                <span
                  className={`min-w-[1.75rem] rounded-md px-1.5 py-0.5 text-center font-bold ${i.tone === 'rose' ? 'bg-[#d03b3b]/40 text-[#ffd0d0]' : 'bg-[#fab219]/30 text-[#ffe2a3]'}`}
                >
                  {i.count}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {i.label}
                  {i.value ? <strong> · {formatINRCompact(i.value)}</strong> : null}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-sky-100/80" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type TeamRow = {
  id: string;
  name: string;
  target: { value: number; achieved: number; label: string } | null;
  leads: number;
  openLeads: number;
  pipeline: number;
  won: number;
  conversion: number;
  orders: number;
  orderValue: number;
  received: number;
  outstanding: number;
  overdueFollowUps: number;
  todayFollowUps: number;
  pendingApprovals: number;
};

/**
 * Every salesperson side by side, highest order value first: target progress, pipeline, orders, conversion,
 * money collected and owed, and follow-ups. A row opens that salesperson's dashboard.
 */
function TeamPerformance({ team, onOpen }: { team: TeamRow[]; onOpen: (id: string) => void }) {
  const rows = [...team].sort((a, b) => b.orderValue - a.orderValue || b.pipeline - a.pipeline || a.name.localeCompare(b.name));
  const top = rows[0]?.orderValue > 0 ? rows[0].id : null;
  const sum = (f: (r: TeamRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const totalTarget = sum((r) => r.target?.value || 0);
  const totalAchieved = sum((r) => (r.target ? r.target.achieved : 0));
  const totalLeads = sum((r) => r.leads);
  const th = 'px-3 py-2.5 text-left font-semibold';
  const td = 'px-3 py-2.5';
  const progress = (achieved: number, target: number) => {
    const pct = target > 0 ? Math.round((achieved / target) * 100) : 0;
    return (
      <div className="min-w-[150px]">
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-[var(--text-primary)]">{pct}%</strong>
          <span className="text-[10px] text-[var(--text-muted)]">
            {formatINRCompact(achieved)} / {formatINRCompact(target)}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--grid)]">
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--good)]' : 'bg-[var(--series-1)]'}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          <Users className="h-4 w-4 text-[#86b6ef]" />
          Team performance
          <span className="font-normal text-[var(--text-muted)]">· click a salesperson to open their dashboard</span>
        </h3>
        <span className="text-[11px] text-[var(--text-muted)]">{plural(rows.length, 'salesperson', 'salespeople')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] whitespace-nowrap text-xs">
          <thead className="text-[var(--text-secondary)]">
            <tr className="border-b border-[var(--border)]">
              <th className={`${th} pl-5`}>Salesperson</th>
              <th className={th}>Order target</th>
              <th className={th}>Pipeline</th>
              <th className={th}>Orders booked</th>
              <th className={th}>Conversion</th>
              <th className={th}>Collected</th>
              <th className={th}>Outstanding</th>
              <th className={`${th} pr-5`}>Follow-ups</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
                tabIndex={0}
                role="link"
                title={`Open ${r.name}'s dashboard`}
                className="cursor-pointer border-b border-[var(--border)] text-[var(--text-secondary)] transition hover:bg-white/[0.04] focus:outline-none focus-visible:bg-white/[0.06]"
              >
                <td className={`${td} pl-5`}>
                  <span className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2a78d6]/25 text-[11px] font-bold text-[#9ec5f4]">
                      {initials(r.name)}
                    </span>
                    <span>
                      <strong className="block text-sm text-[var(--text-primary)]">{r.name}</strong>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {plural(r.leads, 'lead')}
                        {r.pendingApprovals > 0 && <span className="ml-1.5 text-[#ffcf7a]">· {r.pendingApprovals} awaiting approval</span>}
                      </span>
                    </span>
                    {top === r.id && <span className="rounded-md bg-[#fab219]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#ffcf7a]">Top</span>}
                  </span>
                </td>
                <td className={td}>
                  {r.target ? (
                    <>
                      {progress(r.target.achieved, r.target.value)}
                      <span className="text-[10px] text-[var(--text-muted)]">{r.target.label}</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">No target set</span>
                  )}
                </td>
                <td className={td}>
                  <strong className="block text-[var(--text-primary)]">{formatINRCompact(r.pipeline)}</strong>
                  <span className="text-[10px] text-[var(--text-muted)]">{plural(r.openLeads, 'open lead')}</span>
                </td>
                <td className={td}>
                  <strong className="block text-[var(--text-primary)]">{formatINRCompact(r.orderValue)}</strong>
                  <span className="text-[10px] text-[var(--text-muted)]">{plural(r.orders, 'order')}</span>
                </td>
                <td className={td}>
                  <strong className="block text-[var(--text-primary)]">{r.conversion}%</strong>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {r.won} of {r.leads} won
                  </span>
                </td>
                <td className={`${td} font-semibold text-[#7ee08a]`}>{formatINRCompact(r.received)}</td>
                <td className={`${td} font-semibold ${r.outstanding > 0 ? 'text-[#ff9b9b]' : 'text-[var(--text-muted)]'}`}>
                  {formatINRCompact(r.outstanding)}
                </td>
                <td className={`${td} pr-5`}>
                  <span className="flex items-center gap-1.5">
                    {r.overdueFollowUps > 0 && (
                      <span className="rounded-md bg-[#d03b3b]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#ff9b9b]">{r.overdueFollowUps} overdue</span>
                    )}
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold">{r.todayFollowUps} today</span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-[var(--text-muted)]" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-[var(--surface-2)] text-[var(--text-primary)]">
            <tr>
              <td className={`${td} pl-5 font-bold`}>Team total</td>
              <td className={td}>{totalTarget > 0 ? progress(totalAchieved, totalTarget) : <span className="text-[var(--text-muted)]">—</span>}</td>
              <td className={`${td} font-bold`}>{formatINRCompact(sum((r) => r.pipeline))}</td>
              <td className={`${td} font-bold`}>
                {formatINRCompact(sum((r) => r.orderValue))}{' '}
                <span className="font-normal text-[var(--text-muted)]">
                  ·{' '}
                  {plural(
                    sum((r) => r.orders),
                    'order'
                  )}
                </span>
              </td>
              <td className={`${td} font-bold`}>{totalLeads ? Math.round((sum((r) => r.won) / totalLeads) * 100) : 0}%</td>
              <td className={`${td} font-bold text-[#7ee08a]`}>{formatINRCompact(sum((r) => r.received))}</td>
              <td className={`${td} font-bold text-[#ff9b9b]`}>{formatINRCompact(sum((r) => r.outstanding))}</td>
              <td className={`${td} pr-5 text-[11px]`}>
                {sum((r) => r.overdueFollowUps)} overdue · {sum((r) => r.todayFollowUps)} today
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// Follow-up time in India time, e.g. "3:30 pm"
const clock = (d: string | Date) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIMEZONE,
  }).format(new Date(d));

/**
 * The greeting card's to-do list: overdue follow-ups first (oldest first), then today's by time. Each
 * opens its follow-up on the client; the rest are a click away in the table below.
 */
function TodayPlan({ overdue, today, onViewAll }: { overdue: any[]; today: any[]; onViewAll: (key: DetailKey) => void }) {
  const items = [
    ...[...overdue].sort((a, b) => time(a.dueDateTime) - time(b.dueDateTime)).map((t) => ({ ...t, late: true })),
    ...[...today].sort((a, b) => time(a.dueDateTime) - time(b.dueDateTime)).map((t) => ({ ...t, late: false })),
  ];
  const shown = items.slice(0, 3);
  return (
    <div className="relative mt-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-sky-100/70">
        <span>Today&apos;s plan</span>
        {items.length > shown.length && (
          <button
            type="button"
            onClick={() => onViewAll(overdue.length ? 'dueFollowUps' : 'todayFollowUps')}
            className="normal-case tracking-normal text-sky-100 hover:text-white"
          >
            View all {items.length} <ArrowRight className="inline h-3 w-3" />
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg bg-white/10 px-3 py-2 text-xs text-sky-50">Nothing due today. A good time to plan follow-ups for your open leads.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((t) => (
            <li key={t.id}>
              <Link
                href={`/clients/${t.clientId}?tab=tasks&record=${t.id}`}
                className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white backdrop-blur transition hover:bg-white/20"
              >
                <span className={`w-16 shrink-0 font-semibold ${t.late ? 'text-[#ffb4b4]' : 'text-sky-100'}`}>
                  {t.late ? `${Math.max(1, Math.round((Date.now() - time(t.dueDateTime)) / 86400000))}d late` : clock(t.dueDateTime)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <strong>{t.clientName}</strong>
                  <span className="text-sky-100/80"> · {t.requirement || t.description || humanize(t.actionType)}</span>
                </span>
                {t.actionType && (
                  <span className="hidden shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-sky-50 sm:inline">{humanize(t.actionType)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Waves() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full" viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0,60 C100,30 200,90 300,60 C400,30 500,85 600,55 L600,100 L0,100 Z" fill="rgba(134,182,239,0.18)" />
      <path d="M0,75 C120,50 220,100 330,72 C430,48 520,92 600,70 L600,100 L0,100 Z" fill="rgba(85,152,231,0.22)" />
      <path d="M0,88 C140,72 260,104 380,86 C470,74 540,96 600,86 L600,100 L0,100 Z" fill="rgba(255,255,255,0.10)" />
    </svg>
  );
}
