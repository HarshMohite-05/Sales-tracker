'use client';

import React, { useState, useEffect, useMemo } from 'react';
import AppShell from '@/components/layout/AppShell';
import { AlertTriangle, ChevronDown, IndianRupee, Plus, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import { formatDate, formatINR, formatINRCompact, getIndianFYQuarter, humanize } from '@/lib/utils';
import { cleanAmountInput, formatAmountInput } from '@/lib/quotation';
import { currentPeriodKey, PERIOD_TYPE_LABELS, periodOptions, type TargetPeriodType } from '@/lib/targetPeriods';
import { REQUIREMENT_TYPES } from '@/lib/requirementTypes';

type Tab = 'overview' | 'incentives' | 'orders' | 'splits' | 'targets' | 'history';

const TARGET_TYPE_LABELS: Record<string, string> = {
  ORDERS_BOOKED: 'Order bookings',
  VERIFIED_COLLECTIONS: 'Collections',
  NEW_ENQUIRIES: 'New requirements',
  MEETINGS: 'Meetings',
  QUOTATIONS_SENT: 'Quotations sent',
};

const STATUS_STYLE: Record<string, string> = {
  EARNED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-sky-100 text-sky-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  REVERSED: 'bg-slate-100 text-slate-500 line-through',
};
const STATUS_LABEL: Record<string, string> = { EARNED: 'Pending approval', APPROVED: 'Approved', PAID: 'Paid', REVERSED: 'Reversed' };

const today = () => new Date().toISOString().slice(0, 10);
const pct = (n: number) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/**
 * Targets & incentives. Targets: order bookings, for any period (month to year, or custom dates), several at
 * once (Target 1, Target 2, …), more once the last is achieved, each with an incentive % per business type.
 * Incentives: earned on each payment received (excluding GST) on an order, at its target's % for the type when
 * the order was booked under one (none otherwise); recorded in that payment's financial year, approved and
 * paid by a director.
 */
export default function TargetsPage() {
  const currentFY = getIndianFYQuarter();
  const [tab, setTab] = useState<Tab>('overview');
  const [financialYear, setFinancialYear] = useState(currentFY.financialYear);
  const [salespersonId, setSalespersonId] = useState('');
  // Directors: one office (Mumbai, Ahmedabad) or both
  const [officeId, setOfficeId] = useState('');
  const [data, setData] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Set target form (director)
  const [showSetTargetModal, setShowSetTargetModal] = useState(false);
  const [targetSalespersonId, setTargetSalespersonId] = useState('');
  // Target 1, Target 2, …: each higher than the one before
  const [levelValues, setLevelValues] = useState<string[]>(['']);
  // Per business type: incentive % for each target (on bookings from the previous target up to it)
  const [typeRates, setTypeRates] = useState<RatesForm>(blankRates);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [targetYear, setTargetYear] = useState(currentFY.financialYear);
  const [periodType, setPeriodType] = useState<TargetPeriodType>('QUARTERLY');
  const [periodKey, setPeriodKey] = useState(currentPeriodKey('QUARTERLY'));
  // The achieved target a higher one is being set after, for the same period
  const [nextAfter, setNextAfter] = useState<any>(null);
  // The targets of one salesperson and period being edited (Target 1, Target 2, …); salesperson and period stay fixed
  const [editingChain, setEditingChain] = useState<any[] | null>(null);
  const [targetError, setTargetError] = useState('');

  const isDirector = data?.role === 'DIRECTOR';

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const who = { ...(salespersonId ? { salespersonId } : {}), ...(officeId ? { officeId } : {}) };
      const params = new URLSearchParams({ financialYear, ...who });
      const [iRes, tRes] = await Promise.all([
        fetch(`/api/incentives?${params}`),
        fetch(`/api/targets?${new URLSearchParams({ allPeriods: '1', ...who })}`),
      ]);
      const iData = await iRes.json();
      if (!iRes.ok) throw new Error(iData.error || 'Could not load targets and incentives');
      setData(iData);
      if (tRes.ok) setTargets((await tRes.json()).targets || []);
      if (!targetSalespersonId && iData.salespeople?.length) setTargetSalespersonId(iData.salespeople.find((s: any) => s.isActive)?.id || iData.salespeople[0].id);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [financialYear, salespersonId, officeId]);

  async function act(body: Record<string, unknown>) {
    const res = await fetch('/api/incentives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not save');
    await loadData();
    return out;
  }

  function openSetTarget(after: any = null) {
    setEditingChain(null);
    setNextAfter(after);
    setLevelValues(['']);
    // A next target starts from the rates of the achieved one
    setTypeRates(after?.typeRates ? ratesForm(after.typeRates) : blankRates());
    setTargetError('');
    if (salespersonId) setTargetSalespersonId(salespersonId);
    setShowSetTargetModal(true);
  }

  // Edit a period's targets: the form opens with its targets and incentives; saving replaces them
  function openEditTargets(chain: any[]) {
    const first = chain[0];
    setNextAfter(null);
    setEditingChain(chain);
    setTargetSalespersonId(first.salespersonId);
    setTargetYear(first.financialYear);
    setPeriodType(first.periodType);
    setPeriodKey(first.periodKey);
    // Periods are stored as UTC day bounds
    setStartDate(new Date(first.periodStart).toISOString().slice(0, 10));
    setEndDate(new Date(first.periodEnd).toISOString().slice(0, 10));
    setLevelValues(chain.map((t) => String(Number(t.targetValue))));
    setTypeRates(
      Object.fromEntries(
        REQUIREMENT_TYPES.map((type) => [type.value, { incentive: chain.map((t) => (t.typeRates?.[type.value]?.incentive ? String(t.typeRates[type.value].incentive) : '')) }])
      )
    );
    setTargetError('');
    setShowSetTargetModal(true);
  }

  const firstLevel = nextAfter ? nextAfter.level + 1 : 1;
  function addLevel() {
    setLevelValues((l) => [...l, '']);
  }
  function removeLevel(i: number) {
    setLevelValues((l) => l.filter((_, j) => j !== i));
    setTypeRates((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, incentive: v.incentive.filter((_, j) => j !== i) }])));
  }

  async function handleSetTarget(e: React.FormEvent) {
    e.preventDefault();
    setTargetError('');
    try {
      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          nextAfter
            ? {
                salespersonId: nextAfter.salespersonId,
                financialYear: nextAfter.financialYear,
                periodType: nextAfter.periodType,
                periodKey: nextAfter.periodKey,
                next: true,
                levels: levelsBody(levelValues, typeRates),
              }
            : {
                salespersonId: targetSalespersonId,
                financialYear: targetYear,
                periodType,
                periodKey,
                ...(periodType === 'CUSTOM' ? { startDate, endDate } : {}),
                levels: levelsBody(levelValues, typeRates),
              }
        ),
      });
      if (res.ok) {
        setShowSetTargetModal(false);
        setNextAfter(null);
        setEditingChain(null);
        loadData();
      } else {
        setTargetError((await res.json().catch(() => ({}))).error || 'Could not save the target');
      }
    } catch {
      setTargetError('Could not save the target');
    }
  }

  const fyTargets = targets.filter((t) => t.financialYear === financialYear);
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'incentives', label: 'Incentives', badge: data?.entries?.filter((e: any) => e.status === 'EARNED').length || undefined },
    { key: 'orders', label: 'Orders & payments' },
    ...(isDirector
      ? [
          { key: 'splits' as Tab, label: 'Order splits', badge: data?.summary.needsSplit || undefined },
          { key: 'targets' as Tab, label: 'Targets set' },
          { key: 'history' as Tab, label: 'History' },
        ]
      : []),
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Targets & Incentives</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Incentive = payment received (excluding GST) on an order × its target&apos;s incentive % for the business type. Earned in the financial year the payment is received
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {isDirector && data.offices?.length > 0 && (
              <select
                aria-label="Office"
                value={officeId}
                onChange={(e) => {
                  setOfficeId(e.target.value);
                  setSalespersonId('');
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold"
              >
                <option value="">All offices</option>
                {data.offices.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.name} office
                  </option>
                ))}
              </select>
            )}
            {isDirector && (
              <select aria-label="Salesperson" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold">
                <option value="">{officeId ? 'Whole office' : 'Whole team'}</option>
                {data.salespeople.filter((s: any) => !officeId || s.officeId === officeId).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Financial year" value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold">
              {(data?.financialYears || [financialYear]).map((y: string) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {isDirector && (
              <button onClick={() => openSetTarget()} className="flex items-center gap-1 rounded-xl bg-sky-600 px-3.5 py-2 font-semibold text-white shadow-xs transition hover:bg-sky-700">
                <Plus className="h-4 w-4" />
                Set Target
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition ${
                tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {t.badge ? <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        {loading && !data ? (
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
        ) : data ? (
          <>
            {tab === 'overview' && (
              <Overview
                data={data}
                targets={fyTargets}
                allTargets={targets}
                isDirector={isDirector}
                showSalesperson={isDirector && !salespersonId}
                onTab={setTab}
                onNext={openSetTarget}
                onChanged={loadData}
                onOpenPerson={setSalespersonId}
              />
            )}
            {tab === 'incentives' && <IncentivesTab data={data} isDirector={isDirector} showSalesperson={isDirector && !salespersonId} act={act} />}
            {tab === 'orders' && <OrdersTab data={data} isDirector={isDirector} showSalesperson={isDirector && !salespersonId} act={act} />}
            {tab === 'splits' && isDirector && <SplitsTab data={data} act={act} />}
            {tab === 'targets' && isDirector && <TargetsSetTab targets={targets} showSalesperson={!salespersonId} onEdit={openEditTargets} onChanged={loadData} />}
            {tab === 'history' && isDirector && <HistoryTab audit={data.audit} />}
          </>
        ) : null}
      </div>

      {/* Director Set Target Modal */}
      {showSetTargetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 backdrop-blur-xs sm:p-4">
          <div className="max-h-[96vh] w-full max-w-[96vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <h3 className="mb-3 text-sm font-bold text-slate-900">{editingChain ? 'Edit Targets' : nextAfter ? 'Set Next Target' : 'Set Target'}</h3>
            <form onSubmit={handleSetTarget} className="space-y-3 text-xs">
              {editingChain ? (
                <div className="space-y-1 rounded-xl border border-sky-200 bg-sky-50 p-3 text-slate-700">
                  <p>
                    <strong>{editingChain[0].salesperson.name}</strong> · {editingChain[0].financialYear} · {editingChain[0].periodLabel} · booked so far{' '}
                    <strong>{targetAmount(editingChain[0].targetType, editingChain[0].achievedAmount)}</strong>
                  </p>
                  <p className="text-slate-500">
                    Change values or incentives, or add a target with +. Saving replaces this period&apos;s targets; incentives not yet approved are recalculated.
                  </p>
                </div>
              ) : nextAfter ? (
                <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-slate-700">
                  <p>
                    <strong>{nextAfter.salesperson.name}</strong> achieved {targetAmount(nextAfter.targetType, nextAfter.achievedAmount)} of{' '}
                    {targetAmount(nextAfter.targetType, nextAfter.targetValue)} ({targetTitle(nextAfter)}).
                  </p>
                  <p className="text-slate-500">
                    {nextAfter.financialYear} · {nextAfter.periodLabel}. Everything already achieved in this period counts toward the next target.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <TargetPeriodPicker
                    financialYear={targetYear}
                    periodType={periodType}
                    periodKey={periodKey}
                    onYearChange={setTargetYear}
                    onTypeChange={(type) => {
                      setPeriodType(type);
                      setPeriodKey(currentPeriodKey(type));
                    }}
                    onKeyChange={setPeriodKey}
                    startDate={startDate}
                    endDate={endDate}
                    onStartChange={setStartDate}
                    onEndChange={setEndDate}
                  />
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">Salesperson</label>
                    <select value={targetSalespersonId} onChange={(e) => setTargetSalespersonId(e.target.value)} className="w-full rounded border border-slate-300 px-2.5 py-1.5">
                      {(data?.salespeople || [])
                        .filter((sp: any) => sp.isActive)
                        .map((sp: any) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                    </select>
                    <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-600">Order booking target: net value of all orders booked in the period.</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left align-bottom text-[11px] text-slate-500">
                        <th className="pb-1.5 pr-2 font-bold uppercase tracking-wider">Target value (₹)</th>
                        {levelValues.map((v, i) => (
                          <th key={i} className="min-w-[110px] pb-1.5 pr-2 font-normal">
                            <span className="mb-1 flex items-center justify-between font-bold uppercase tracking-wider">
                              Target {firstLevel + i}
                              {levelValues.length > 1 && (
                                <button type="button" aria-label={`Remove target ${firstLevel + i}`} onClick={() => removeLevel(i)} className="text-slate-400 hover:text-rose-600">
                                  ×
                                </button>
                              )}
                            </span>
                            {/* Typed with Indian commas, e.g. 10,00,00,000, and shown short underneath */}
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={`Target ${firstLevel + i} value`}
                              value={formatAmountInput(v)}
                              onChange={(e) => setLevelValues((l) => l.map((x, j) => (j === i ? cleanAmountInput(e.target.value).split('.')[0] : x)))}
                              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-900"
                              placeholder={i ? 'higher' : 'e.g. 10,00,000'}
                              required
                            />
                            <span className="mt-0.5 block h-4 text-[10px] font-semibold normal-case tracking-normal text-sky-700">{Number(v) > 0 ? formatINRCompact(Number(v)) : ''}</span>
                          </th>
                        ))}
                        <th className="pb-1.5 pr-2 align-bottom">
                          <button
                            type="button"
                            onClick={addLevel}
                            className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-sky-300 bg-white px-2 py-1 font-semibold text-sky-700 hover:bg-sky-50"
                          >
                            <Plus className="h-3.5 w-3.5" /> Target {firstLevel + levelValues.length}
                          </button>
                        </th>
                      </tr>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="pb-1.5 pt-2 font-bold">Business type</th>
                        {levelValues.map((_, i) => (
                          <th key={i} className="pb-1.5 pt-2 font-bold">
                            Incentives for Target {firstLevel + i} (%)
                          </th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {REQUIREMENT_TYPES.map((t) => (
                        <tr key={t.value}>
                          <td className="whitespace-nowrap py-1 pr-2 font-semibold text-slate-700">{t.label}</td>
                          {levelValues.map((_, i) => (
                            <td key={i} className="py-1 pr-2">
                              {rateInput(`${t.label} target ${firstLevel + i} incentive %`, typeRates[t.value].incentive[i] ?? '', (value) =>
                                setTypeRates((r) => ({ ...r, [t.value]: { ...r[t.value], incentive: levelValues.map((__, j) => (j === i ? value : r[t.value].incentive[j] ?? '')) } }))
                              )}
                            </td>
                          ))}
                          <td />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-slate-500">
                  {nextAfter ? `Target ${nextAfter.level} (${targetAmountShort(nextAfter.targetType, nextAfter.targetValue)}) is achieved. ` : ''}
                  Each target&apos;s incentives apply to bookings from the previous target up to it; bookings beyond the last target keep its incentives. Each target must be higher than the one before.{' '}
                  Each order earns its business type&apos;s %, paid on the money received for it in the financial year it is received. Blank is 0%.
                </p>
              </div>

              {targetError && <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-700">{targetError}</p>}

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowSetTargetModal(false)} className="px-3 py-1.5 font-semibold text-slate-600">
                  Cancel
                </button>
                <button type="submit" className="rounded-lg bg-sky-600 px-4 py-1.5 font-semibold text-white shadow-xs">
                  Save Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/* ---------------------------------------------------------------- Overview */

/**
 * Everything at a glance: each target as a speedometer (filtered by period), the year's money, the
 * incentives by status as a ring, and each business type as bars.
 */
function Overview({
  data,
  targets,
  allTargets,
  isDirector,
  showSalesperson,
  onTab,
  onNext,
  onChanged,
  onOpenPerson,
}: {
  data: any;
  targets: any[];
  allTargets: any[];
  isDirector: boolean;
  showSalesperson: boolean;
  onTab: (t: Tab) => void;
  onNext: (t: any) => void;
  onChanged: () => void;
  onOpenPerson: (salespersonId: string) => void;
}) {
  const s = data.summary;
  const [period, setPeriod] = useState<TargetPeriodType | ''>('');
  const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-xs';
  // Only the target being worked toward; one raised after it was achieved replaces it
  const current = targets.filter((t) => t.isCurrent);
  const periods = (Object.keys(PERIOD_TYPE_LABELS) as TargetPeriodType[]).filter((p) => current.some((t) => t.periodType === p));
  const shown = current.filter((t) => !period || t.periodType === period).sort((a, b) => new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime());
  const tiles: { label: string; value: number; note: string; icon: React.ElementType; tone: string; tab: Tab }[] = [
    { label: 'Order bookings', value: s.bookings, note: `booked in ${data.financialYear}`, icon: ShoppingBag, tone: 'bg-sky-50 text-sky-600', tab: 'orders' },
    { label: 'Collections', value: s.collections, note: 'received, excl. GST', icon: Wallet, tone: 'bg-emerald-50 text-emerald-600', tab: 'incentives' },
    { label: 'Outstanding', value: s.outstanding, note: 'due, not received', icon: IndianRupee, tone: 'bg-amber-50 text-amber-600', tab: 'orders' },
    { label: 'Overdue', value: s.overdue, note: 'due before today', icon: AlertTriangle, tone: s.overdue > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500', tab: 'orders' },
  ];
  const active = data.byType.filter((t: any) => t.bookings || t.collections || t.incentive);
  const maxType = Math.max(1, ...active.map((t: any) => Math.max(t.bookings, t.collections)));
  const unsetTypes = data.byType.filter((t: any) => !t.bookings && !t.collections && !t.incentive);

  return (
    <div className="space-y-4">
      {s.unrated.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {s.unrated.map((u: any, i: number) => (
              <span key={u.businessType}>
                {i > 0 && '; '}
                <strong>{formatINR(u.eligible)}</strong> of {u.label} payments ({u.count})
              </span>
            ))}{' '}
            are on orders booked outside any target period, or on a type with 0% in the target, so they earn ₹0.{' '}
            {isDirector ? 'To cover them, set a target whose period includes those orders’ booking dates.' : 'Your director sets the targets.'}
          </span>
        </div>
      )}
      {isDirector && s.needsSplit > 0 && (
        <button onClick={() => onTab('splits')} className="flex w-full items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900 hover:bg-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{s.needsSplit}</strong> mixed-type order{s.needsSplit === 1 ? ' has' : 's have'} no split yet.{' '}
            <span className="font-semibold underline">Open Order splits</span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* Targets as speedometers */}
      <section className={`${card} flex flex-col xl:col-span-8`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Targets · {data.financialYear}</h2>
          {periods.length > 0 && (
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-xs">
              {[{ key: '' as const, label: `All (${current.length})` }, ...periods.map((p) => ({ key: p, label: PERIOD_TYPE_LABELS[p] }))].map((c) => (
                <button
                  key={c.key || 'all'}
                  onClick={() => setPeriod(c.key)}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${period === c.key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="flex flex-1 items-center justify-center py-8 text-center text-xs text-slate-500">
            {isDirector ? 'No targets yet for this year. Use Set Target to add one.' : 'No targets set for you this year yet.'}
          </p>
        ) : showSalesperson ? (
          // The whole team: a speedometer per money target type, then every salesperson's target ranked
          <TeamTargets targets={shown} onOpenPerson={onOpenPerson} />
        ) : (
          // One salesperson's few targets: a speedometer each; one target gets the whole panel
          <div className={`mt-3 grid flex-1 gap-3 ${shown.length === 1 ? 'grid-cols-1' : shown.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
            {shown.map((t) => (
              <TargetGaugeCard
                key={t.id}
                t={t}
                wide={shown.length === 1}
                allTargets={allTargets}
                isDirector={isDirector}
                showSalesperson={showSalesperson}
                onNext={onNext}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </section>

      {/* The year's money */}
      <div className="grid grid-cols-2 gap-3 xl:col-span-4">
        {tiles.map((m) => (
          <button key={m.label} onClick={() => onTab(m.tab)} className={`${card} flex flex-col justify-center gap-2 text-left transition hover:border-sky-300`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>
              <m.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-slate-500">{m.label}</span>
              <span className="block truncate text-xl font-bold text-slate-900">{formatINRCompact(m.value)}</span>
              <span className="block text-[10px] text-slate-500">{m.note}</span>
            </span>
          </button>
        ))}
      </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Incentives by status */}
        <section className={`${card} flex flex-col xl:col-span-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Incentives · {data.financialYear}</h2>
            <button onClick={() => onTab('incentives')} className="text-xs font-semibold text-sky-700 hover:text-sky-900">
              Details →
            </button>
          </div>
          <div className="flex flex-1 items-center">
            <IncentiveRing earned={s.earned} approved={s.approved} paid={s.paid} />
          </div>
        </section>

        {/* Business types as bars */}
        <section className={`${card} flex flex-col xl:col-span-7`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">By business type</h2>
            <span className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-sky-400" /> Bookings
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-emerald-500" /> Collections
              </span>
            </span>
          </div>
          {active.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">No bookings or collections this year yet.</p>
          ) : (
            <div className="mb-3 mt-3 space-y-3">
              {active.map((t: any) => (
                <div key={t.businessType} className="text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {t.label}
                    </span>
                    <span className="text-slate-500">
                      Incentive <strong className="text-slate-900">{formatINR(t.incentive)}</strong>
                    </span>
                  </div>
                  <Bar value={t.bookings} max={maxType} color="bg-sky-400" />
                  <Bar value={t.collections} max={maxType} color="bg-emerald-500" />
                </div>
              ))}
              {unsetTypes.length > 0 && <p className="text-[11px] text-slate-500">No sales yet: {unsetTypes.map((t: any) => t.label).join(', ')}</p>}
            </div>
          )}
          {/* Totals across every type */}
          <div className="mt-auto grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center text-xs">
            {[
              { label: 'Bookings', value: s.bookings, tone: 'text-sky-700' },
              { label: 'Collections', value: s.collections, tone: 'text-emerald-700' },
              { label: 'Incentive', value: s.earned + s.approved + s.paid, tone: 'text-slate-900' },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-slate-50 py-2">
                <p className={`text-sm font-bold ${x.tone}`}>{formatINRCompact(x.value)}</p>
                <p className="text-[11px] text-slate-500">{x.label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const PACE_STYLE: Record<string, string> = {
  Achieved: 'bg-emerald-100 text-emerald-800',
  'On track': 'bg-sky-100 text-sky-800',
  Behind: 'bg-amber-100 text-amber-800',
  Missed: 'bg-rose-100 text-rose-700',
};

// How a target is doing against the time gone by in its period (5% slack before it counts as behind)
function pace(t: any): string {
  const pct = t.achievementPercent || 0;
  if (pct >= 100) return 'Achieved';
  const start = new Date(t.periodStart).getTime();
  const end = new Date(t.periodEnd).getTime();
  if (Date.now() > end) return 'Missed';
  const gone = Math.min(1, Math.max(0, (Date.now() - start) / Math.max(1, end - start)));
  return pct / 100 >= gone - 0.05 ? 'On track' : 'Behind';
}

/**
 * The director's whole-team targets: one speedometer per money target type (everyone's achieved against
 * everyone's targets), then each salesperson's target as a ranked row. A row opens that salesperson's view.
 */
function TeamTargets({ targets, onOpenPerson }: { targets: any[]; onOpenPerson: (id: string) => void }) {
  const money = ['ORDERS_BOOKED', 'VERIFIED_COLLECTIONS']
    .map((type) => {
      const rows = targets.filter((t) => t.targetType === type);
      const target = rows.reduce((sum, t) => sum + Number(t.targetValue), 0);
      const achieved = rows.reduce((sum, t) => sum + Number(t.achievedAmount), 0);
      return { type, rows, target, achieved, people: new Set(rows.map((t) => t.salespersonId)).size };
    })
    .filter((g) => g.rows.length);
  const ranked = [...targets].sort((a, b) => (b.achievementPercent || 0) - (a.achievementPercent || 0) || a.salesperson.name.localeCompare(b.salesperson.name));
  const counts = ranked.reduce((m: Record<string, number>, t) => ((m[pace(t)] = (m[pace(t)] || 0) + 1), m), {});
  return (
    <div className="mt-3 flex flex-1 flex-col gap-4">
      {money.length > 0 && (
        <div className={`grid gap-3 ${money.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {money.map((g) => (
            <div key={g.type} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
              <div className="w-36 shrink-0">
                <SpeedGauge percent={g.target > 0 ? (g.achieved / g.target) * 100 : 0} />
              </div>
              <div className="min-w-0 text-xs">
                <p className="font-bold text-slate-900">Team {TARGET_TYPE_LABELS[g.type].toLowerCase()}</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{formatINRCompact(g.achieved)}</p>
                <p className="text-slate-500">of {formatINRCompact(g.target)} combined target</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {g.rows.length} target{g.rows.length === 1 ? '' : 's'} · {g.people} {g.people === 1 ? 'salesperson' : 'salespeople'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="font-bold uppercase tracking-wider text-slate-500">Salespeople · best first</span>
          <span className="flex gap-1.5">
            {['Achieved', 'On track', 'Behind', 'Missed']
              .filter((k) => counts[k])
              .map((k) => (
                <span key={k} className={`rounded px-1.5 py-0.5 font-bold ${PACE_STYLE[k]}`}>
                  {counts[k]} {k.toLowerCase()}
                </span>
              ))}
          </span>
        </div>
        <ul className="max-h-[300px] divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200">
          {ranked.map((t) => {
            const percent = t.achievementPercent || 0;
            const status = pace(t);
            const daysLeft = Math.ceil((new Date(t.periodEnd).getTime() - Date.now()) / 86400000);
            return (
              <li key={t.id}>
                <button onClick={() => onOpenPerson(t.salespersonId)} className="grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto] items-center gap-3 px-3 py-2 text-left text-xs hover:bg-slate-50">
                  <span className="min-w-0">
                    <strong className="block truncate text-slate-900">{t.salesperson.name}</strong>
                    <span className="block truncate text-[11px] text-slate-500">
                      {targetTitle(t)} · {t.periodLabel}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className={`block h-full rounded-full ${percent >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(100, percent)}%` }} />
                      </span>
                      <strong className="w-10 text-right text-slate-800">{Math.round(percent)}%</strong>
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {targetAmountShort(t.targetType, t.achievedAmount)} of {targetAmountShort(t.targetType, t.targetValue)}
                      {daysLeft > 0 ? ` · ${daysLeft}d left` : ''}
                    </span>
                  </span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${PACE_STYLE[status]}`}>{status}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[11px] text-slate-500">Click a salesperson to see their speedometers. On track: at least as far along as the time gone by in the period.</p>
      </div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${value > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="w-20 text-right tabular-nums text-slate-600">{formatINRCompact(value)}</span>
    </div>
  );
}

/** Incentives by status as a ring, the total in the middle. */
function IncentiveRing({ earned, approved, paid }: { earned: number; approved: number; paid: number }) {
  const parts = [
    { label: 'Pending approval', value: earned, color: '#f59e0b' },
    { label: 'Approved, to pay', value: approved, color: '#0ea5e9' },
    { label: 'Paid', value: paid, color: '#10b981' },
  ];
  const total = earned + approved + paid;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`Incentives total ${formatINR(total)}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f5f9" strokeWidth={16} />
        {total > 0 &&
          parts.map((p) => {
            if (p.value <= 0) return null;
            const len = (p.value / total) * c;
            const seg = <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
            offset += len;
            return seg;
          })}
        <text x="70" y="66" textAnchor="middle" fontSize="16" fontWeight="700" fill="#0f172a">
          {formatINRCompact(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="9" fill="#64748b">
          total earned
        </text>
      </svg>
      <ul className="min-w-[160px] flex-1 space-y-2 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <span className="flex-1 text-slate-600">{p.label}</span>
            <strong className="tabular-nums text-slate-900">{formatINR(p.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Speedometer from 0 to 100% with a needle on the achievement; past 100% the needle rests at the end and
 * the number shows the real value. Green once achieved.
 */
function SpeedGauge({ percent, large = false }: { percent: number; large?: boolean }) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const c = Math.PI * r;
  const shown = Math.max(0, Math.min(percent, 100));
  const color = percent >= 100 ? '#10b981' : '#0ea5e9';
  const at = (p: number, radius: number) => {
    const angle = Math.PI * (1 - p / 100);
    return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
  };
  return (
    <svg viewBox="0 0 200 128" className={`w-full ${large ? 'max-w-[270px]' : 'max-w-[210px]'}`} role="img" aria-label={`${Math.round(percent)}% of target achieved`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e2e8f0" strokeWidth={14} strokeLinecap="round" />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={`${(shown / 100) * c} ${c}`}
        style={{ transition: 'stroke-dasharray 0.8s ease-out' }}
      />
      {Array.from({ length: 11 }, (_, i) => i * 10).map((p) => {
        const a = at(p, r - 13);
        const b = at(p, r - (p % 50 === 0 ? 23 : 18));
        return <line key={p} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#94a3b8" strokeWidth={p % 50 === 0 ? 2 : 1} strokeLinecap="round" />;
      })}
      <text x={cx - r} y={cy + 16} textAnchor="middle" fill="#94a3b8" fontSize="9">
        0%
      </text>
      <text x={cx + r} y={cy + 16} textAnchor="middle" fill="#94a3b8" fontSize="9">
        100%
      </text>
      <g style={{ transform: `rotate(${shown * 1.8}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.8s ease-out' }}>
        <line x1={cx + 10} y1={cy} x2={cx - r + 18} y2={cy} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r={7} fill="#1e293b" />
      <circle cx={cx} cy={cy} r={3} fill={color} />
      <text x={cx} y={cy + 26} textAnchor="middle" fill="#0f172a" fontSize="20" fontWeight="700">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

/** One target: its speedometer, how much is done and left, the deadline, and the director's actions. */
function TargetGaugeCard({
  t,
  wide = false,
  allTargets,
  isDirector,
  showSalesperson,
  onNext,
  onChanged,
}: {
  t: any;
  wide?: boolean; // the only target: speedometer beside its figures
  allTargets: any[];
  isDirector: boolean;
  showSalesperson: boolean;
  onNext: (t: any) => void;
  onChanged: () => void;
}) {
  const percent = t.achievementPercent || 0;
  const isMet = percent >= 100;
  const daysLeft = Math.ceil((new Date(t.periodEnd).getTime() - Date.now()) / 86400000);
  const previous = allTargets.filter((o) => o.salespersonId === t.salespersonId && o.financialYear === t.financialYear && o.periodKey === t.periodKey && o.targetType === t.targetType && o.level < t.level);
  return (
    <div className={`flex flex-col rounded-2xl border p-4 ${isMet ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-slate-900">{targetTitle(t)}</p>
          <p className="truncate text-[11px] text-slate-500">
            {PERIOD_TYPE_LABELS[t.periodType as TargetPeriodType]} · {t.periodLabel}
            {showSalesperson ? ` · ${t.salesperson.name}` : ''}
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {(t.level > 1 || t.chainSize > 1) && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">Target {t.level}</span>}
          {isMet && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">Achieved</span>}
        </span>
      </div>
      <div className={`flex flex-1 ${wide ? 'flex-col items-center gap-6 sm:flex-row' : 'flex-col'}`}>
        <div className={`flex justify-center py-1 ${wide ? 'sm:w-1/2' : ''}`}>
          <SpeedGauge percent={percent} large={wide} />
        </div>
        <div className={`w-full ${wide ? 'sm:w-1/2' : ''}`}>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 py-1.5">
              <p className={`font-bold text-slate-900 ${wide ? 'text-lg' : 'text-[11px]'}`}>{targetAmountShort(t.targetType, t.achievedAmount)}</p>
              <p className={`text-slate-500 ${wide ? 'text-xs' : 'text-[11px]'}`}>achieved of {targetAmountShort(t.targetType, t.targetValue)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 py-1.5">
              <p className={`font-bold ${isMet ? 'text-emerald-700' : 'text-slate-900'} ${wide ? 'text-lg' : 'text-[11px]'}`}>
                {isMet ? 'Done' : targetAmountShort(t.targetType, t.remainingAmount)}
              </p>
              <p className={`text-slate-500 ${wide ? 'text-xs' : 'text-[11px]'}`}>{isMet ? 'target met' : 'left to go'}</p>
            </div>
          </div>
          <p className={`mt-2 text-center text-slate-500 ${wide ? 'text-xs' : 'text-[11px]'}`}>
            {daysLeft > 0 ? (
              <>
                <strong className="text-slate-700">{daysLeft}</strong> day{daysLeft === 1 ? '' : 's'} left · ends {periodDay(t.periodEnd)}
              </>
            ) : (
              `Ended ${periodDay(t.periodEnd)}`
            )}
            {previous.length > 0 && (
              <span className="block">
                Target {previous[previous.length - 1].level} ({targetAmountShort(t.targetType, previous[previous.length - 1].targetValue)}) achieved
              </span>
            )}
            {t.raisedTo !== null && (
              <span className="block">
                Then Target {t.level + 1}: {targetAmountShort(t.targetType, t.raisedTo)}
                {t.chainSize > t.level + 1 ? ` (${t.chainSize} targets in all)` : ''}
              </span>
            )}
          </p>
          {t.typeRates && <RatesList rates={t.typeRates} level={t.level} wide={wide} />}
          {isDirector && (
            <div className="mt-2 space-y-1.5">
              {isMet && (
                <button onClick={() => onNext(t)} className="w-full rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50">
                  Set next target
                </button>
              )}
              <DeleteTarget
                target={t}
                // Higher targets set after this one was achieved are deleted with it
                higherCount={
                  allTargets.filter((o) => o.salespersonId === t.salespersonId && o.financialYear === t.financialYear && o.periodKey === t.periodKey && o.targetType === t.targetType && o.level > t.level)
                    .length
                }
                onDeleted={onChanged}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Incentives */

function IncentivesTab({ data, isDirector, showSalesperson, act }: { data: any; isDirector: boolean; showSalesperson: boolean; act: (b: any) => Promise<any> }) {
  const [status, setStatus] = useState<string>('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const entries: any[] = data.entries;
  const rows = status ? entries.filter((e) => e.status === status) : entries;
  const total = (list: any[]) => list.reduce((t, e) => t + e.incentiveAmount, 0);
  const pickedRows = entries.filter((e) => picked.has(e.id));
  const canApprove = pickedRows.filter((e) => e.status === 'EARNED');
  const canPay = pickedRows.filter((e) => e.status === 'APPROVED');
  const selectable = (e: any) => e.status === 'EARNED' || e.status === 'APPROVED';

  async function run(body: any, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const out = await act(body);
      setPicked(new Set());
      setPaying(false);
      setMsg({ ok: true, text: `${done} ${out.count} incentive${out.count === 1 ? '' : 's'} · ${formatINR(out.amount)}` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  const chips = [
    { key: '', label: 'All' },
    { key: 'EARNED', label: 'Pending approval' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'PAID', label: 'Paid' },
    { key: 'REVERSED', label: 'Reversed' },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const n = c.key ? entries.filter((e) => e.status === c.key).length : entries.length;
            return (
              <button
                key={c.key}
                onClick={() => setStatus(c.key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${status === c.key ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 text-slate-600 hover:border-sky-300'}`}
              >
                {c.label} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {isDirector && (
          <div className="flex items-center gap-2 text-xs">
            <button
              disabled={!canApprove.length || busy}
              onClick={() => run({ action: 'APPROVE', entryIds: canApprove.map((e) => e.id) }, 'Approved')}
              className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
            >
              Approve{canApprove.length ? ` ${canApprove.length} · ${formatINR(total(canApprove))}` : ''}
            </button>
            <button
              disabled={!canPay.length || busy}
              onClick={() => setPaying(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Mark paid{canPay.length ? ` ${canPay.length} · ${formatINR(total(canPay))}` : ''}
            </button>
          </div>
        )}
      </div>

      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{msg.text}</p>}

      {paying && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: 'PAY', entryIds: canPay.map((x) => x.id), paymentRef: ref, paidAt: paidOn }, 'Paid');
          }}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs"
        >
          <p className="w-full font-semibold text-emerald-900">
            Pay {canPay.length} approved incentive{canPay.length === 1 ? '' : 's'}: {formatINR(total(canPay))}
          </p>
          <label className="space-y-1">
            <span className="block font-semibold text-slate-700">Paid on</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5" required />
          </label>
          <label className="flex-1 space-y-1">
            <span className="block font-semibold text-slate-700">Payment reference</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. salary credit / UTR no." className="w-full rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <button type="button" onClick={() => setPaying(false)} className="px-3 py-1.5 font-semibold text-slate-600">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-1.5 font-semibold text-white disabled:opacity-50">
            Confirm payment
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-200 text-left">
              {isDirector && (
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={rows.some(selectable) && rows.filter(selectable).every((e) => picked.has(e.id))}
                    onChange={(ev) => setPicked(ev.target.checked ? new Set(rows.filter(selectable).map((e) => e.id)) : new Set())}
                  />
                </th>
              )}
              <th className="py-2 pr-2 font-semibold">Received on</th>
              <th className="py-2 pr-2 font-semibold">Client</th>
              <th className="py-2 pr-2 font-semibold">PO No.</th>
              {showSalesperson && <th className="py-2 pr-2 font-semibold">Salesperson</th>}
              <th className="py-2 pr-2 font-semibold">Type</th>
              <th className="py-2 pr-2 text-right font-semibold">Payment</th>
              <th className="py-2 pr-2 text-right font-semibold">Eligible (ex-GST)</th>
              <th className="py-2 pr-2 text-right font-semibold">Rate</th>
              <th className="py-2 pr-2 text-right font-semibold">Incentive</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`border-b border-slate-50 ${picked.has(e.id) ? 'bg-sky-50' : ''}`}>
                {isDirector && (
                  <td className="py-2">
                    {selectable(e) && (
                      <input
                        type="checkbox"
                        aria-label="Select"
                        checked={picked.has(e.id)}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(e.id)) n.delete(e.id);
                            else n.add(e.id);
                            return n;
                          })
                        }
                      />
                    )}
                  </td>
                )}
                <td className="py-2 pr-2 whitespace-nowrap">{formatDate(e.receivedDate)}</td>
                <td className="py-2 pr-2 font-semibold text-slate-800">{e.clientName}</td>
                <td className="py-2 pr-2 font-semibold">{e.orderNumber}</td>
                {showSalesperson && <td className="py-2 pr-2">{e.salesperson}</td>}
                <td className="py-2 pr-2">
                  {e.label}
                  {e.kind === 'CLAWBACK' && <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700">Clawback</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatINR(e.receiptAmount)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatINR(e.eligibleAmount)}</td>
                <td className="py-2 pr-2 text-right">
                  {e.incentiveAmount ? pct(effectiveRate(e)) : <span className="text-amber-600">no target</span>}
                  {e.bonusEligible !== 0 && (
                    <span className="block text-[10px] font-semibold text-emerald-700" title="Part of this payment from bookings past Target 1, at the next targets' %">
                      {formatINR(e.bonusEligible)} past Target 1
                    </span>
                  )}
                </td>
                <td className={`py-2 pr-2 text-right font-bold tabular-nums ${e.incentiveAmount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatINR(e.incentiveAmount)}</td>
                <td className="py-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                  {e.status === 'PAID' && (e.paymentRef || e.paidAt) && (
                    <span className="ml-1 text-[10px] text-slate-500">
                      {formatDate(e.paidAt)}
                      {e.paymentRef ? ` · ${e.paymentRef}` : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-slate-500">
                  No incentives here for {data.financialYear}.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold text-slate-900">
                <td colSpan={(isDirector ? 1 : 0) + (showSalesperson ? 6 : 5)} className="py-2">
                  Total · {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatINR(rows.filter((e) => e.status !== 'REVERSED').reduce((t, e) => t + e.eligibleAmount, 0))}</td>
                <td />
                <td className="py-2 pr-2 text-right tabular-nums">{formatINR(total(rows.filter((e) => e.status !== 'REVERSED')))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        One entry per payment and business type, so a payment is never counted twice. Pending entries follow corrections (a new rate, an order split); approved and paid entries
        never change. A reversed payment cancels its unpaid incentive, or adds a clawback if it was already paid.
      </p>
    </section>
  );
}

/* -------------------------------------------------------- Orders & payments */

function OrdersTab({ data, isDirector, showSalesperson, act }: { data: any; isDirector: boolean; showSalesperson: boolean; act: (b: any) => Promise<any> }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<any>(null);
  const q = query.trim().toLowerCase();
  const orders: any[] = data.orders.filter(
    (o: any) => !q || [o.poNumber, o.orderNumber, o.clientName, o.salesperson, o.enquiryNumber, ...o.types.map((t: any) => t.label)].some((v) => String(v || '').toLowerCase().includes(q))
  );
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search PO No., client, type…"
        className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
      />
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {orders.length === 0 && <p className="p-6 text-center text-xs text-slate-500">No orders.</p>}
        {orders.map((o) => {
          const expanded = open === o.id;
          return (
            <div key={o.id}>
              <button onClick={() => setOpen(expanded ? null : o.id)} className="grid w-full grid-cols-2 gap-x-4 gap-y-1 p-3 text-left text-xs hover:bg-slate-50 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.2fr_auto]">
                <span>
                  <strong className="text-slate-900">{o.poNumber || o.orderNumber}</strong>
                  <span className="block text-slate-500">
                    {o.clientName} · {formatDate(o.orderDate)}
                    {showSalesperson ? ` · ${o.salesperson}` : ''}
                  </span>
                </span>
                <span>
                  {o.shares.map((s: any) => (
                    <span key={s.businessType} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                      {s.label}
                      {o.shares.length > 1 ? ` ${Math.round(s.share * 100)}%` : ''}
                    </span>
                  ))}
                  {o.splitMissing && <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">Split not set: {o.types.map((t: any) => t.label).join(' + ')}</span>}
                  {o.orderStatus === 'CANCELLED' && <span className="mt-0.5 block text-[10px] font-semibold text-rose-700">Cancelled</span>}
                </span>
                <span>
                  <span className="block text-slate-500">Order value</span>
                  <strong className="tabular-nums text-slate-800">{formatINR(o.netValue)}</strong>
                </span>
                <span>
                  <span className="block text-slate-500">Received</span>
                  <strong className="tabular-nums text-emerald-700">{formatINR(o.received)}</strong>
                </span>
                <span>
                  <span className="block text-slate-500">Outstanding</span>
                  <strong className={`tabular-nums ${o.outstanding > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{formatINR(o.outstanding)}</strong>
                  {o.overdue > 0 && <span className="block text-[10px] font-semibold text-rose-700">{formatINR(o.overdue)} overdue</span>}
                </span>
                <span>
                  <span className="block text-slate-500">Incentive</span>
                  <span className="tabular-nums">
                    <strong className="text-slate-900">{formatINR(o.incentive.earned + o.incentive.approved + o.incentive.paid)}</strong>
                    <span className="block text-[10px] text-slate-500">
                      {formatINR(o.incentive.paid)} paid · {formatINR(o.incentive.approved)} approved · {formatINR(o.incentive.earned)} pending
                    </span>
                  </span>
                </span>
                <ChevronDown className={`h-4 w-4 self-center text-slate-500 transition ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && (
                <div className="space-y-2 bg-slate-50/60 px-3 pb-3 text-xs">
                  {isDirector && o.types.length > 1 && (
                    <button onClick={() => setSplitting(o)} className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 font-semibold text-sky-700 hover:bg-sky-50">
                      {o.splits.length ? 'Change split by type' : 'Set split by type'}
                    </button>
                  )}
                  {o.payments.length === 0 ? (
                    <p className="py-2 text-slate-500">No payments received yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px]">
                        <thead className="text-slate-500">
                          <tr className="border-b border-slate-200 text-left">
                            <th className="py-1.5 pr-2 font-semibold">Received on</th>
                            <th className="py-1.5 pr-2 font-semibold">FY</th>
                            <th className="py-1.5 pr-2 font-semibold">Stage</th>
                            <th className="py-1.5 pr-2 text-right font-semibold">Amount</th>
                            <th className="py-1.5 pr-2 text-right font-semibold">Eligible (ex-GST)</th>
                            <th className="py-1.5 font-semibold">Incentive</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.payments.map((p: any) => (
                            <tr key={p.id} className={`border-b border-slate-100 align-top ${p.isReversed ? 'text-slate-500' : ''}`}>
                              <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(p.receivedDate)}</td>
                              <td className="py-1.5 pr-2 whitespace-nowrap">{p.financialYear}</td>
                              <td className="py-1.5 pr-2">
                                {p.stage}
                                {p.isReversed && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-bold">Reversed</span>}
                              </td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{formatINR(p.amount)}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{formatINR(p.eligible)}</td>
                              <td className="py-1.5">
                                {p.entries.length === 0
                                  ? '—'
                                  : p.entries.map((e: any) => (
                                      <span key={e.id} className="mr-2 inline-flex items-center gap-1 whitespace-nowrap">
                                        {e.label}: {formatINR(e.eligibleAmount)} × {pct(effectiveRate(e))}{' '}
                                        = <strong>{formatINR(e.incentiveAmount)}</strong>
                                        <span className={`rounded px-1.5 text-[10px] font-bold ${STATUS_STYLE[e.status]}`}>
                                          {e.kind === 'CLAWBACK' ? 'Clawback · ' : ''}
                                          {STATUS_LABEL[e.status]}
                                        </span>
                                      </span>
                                    ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {splitting && <SplitForm order={splitting} act={act} onClose={() => setSplitting(null)} />}
    </section>
  );
}

/** A mixed-type order's value by business type; the amounts must add up to the order value. */
function SplitForm({ order, act, onClose }: { order: any; act: (b: any) => Promise<any>; onClose: () => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.types.map((t: any) => [t.businessType, String(order.splits.find((s: any) => s.businessType === t.businessType)?.amount ?? '')]))
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const total = Object.values(amounts).reduce((t, v) => t + (Number(v) || 0), 0);
  const left = Math.round((order.netValue - total) * 100) / 100;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await act({ action: 'SET_SPLIT', orderId: order.id, splits: Object.entries(amounts).map(([businessType, amount]) => ({ businessType, amount: Number(amount) || 0 })) });
            onClose();
          } catch (x: any) {
            setErr(x.message);
          }
          setBusy(false);
        }}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 text-xs shadow-2xl"
      >
        <h3 className="text-sm font-bold text-slate-900">Split {order.poNumber || order.orderNumber} by business type</h3>
        <p className="text-slate-500">
          Order value {formatINR(order.netValue)}. Each payment on this order is shared in this ratio, and each share earns its type&apos;s rate.
        </p>
        {order.types.map((t: any) => (
          <label key={t.businessType} className="flex items-center justify-between gap-3">
            <span className="font-semibold text-slate-700">{t.label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={formatAmountInput(amounts[t.businessType] || '')}
              onChange={(e) => setAmounts((a) => ({ ...a, [t.businessType]: cleanAmountInput(e.target.value) }))}
              className="w-40 rounded border border-slate-300 px-2 py-1.5 text-right font-semibold"
              placeholder="₹"
            />
          </label>
        ))}
        <p className={`text-right font-semibold ${Math.abs(left) <= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
          {Math.abs(left) <= 1 ? 'Adds up to the order value' : `${formatINR(Math.abs(left))} ${left > 0 ? 'still to assign' : 'too much'}`}
        </p>
        {err && <p className="rounded bg-rose-50 px-2 py-1.5 text-rose-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 font-semibold text-slate-600">
            Cancel
          </button>
          <button type="submit" disabled={busy || Math.abs(left) > 1} className="rounded-lg bg-sky-600 px-4 py-1.5 font-semibold text-white disabled:opacity-40">
            Save split
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ Order splits */

/** Mixed-type orders: how much of each order is each business type, so each part earns its type's target %. */
function SplitsTab({ data, act }: { data: any; act: (b: any) => Promise<any> }) {
  const [splitting, setSplitting] = useState<any>(null);
  const mixed = useMemo(() => data.orders.filter((o: any) => o.types.length > 1 && o.orderStatus !== 'CANCELLED'), [data.orders]);
  const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-xs';
  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-sm font-bold text-slate-900">Mixed-type orders</h2>
        <p className="text-[11px] text-slate-500">
          Orders whose requirement has more than one business type. Set how much of the order value is each type, so each part earns its type&apos;s % from the target; until then the whole order counts as the first type.
        </p>
        {mixed.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No mixed-type orders.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {mixed.map((o: any) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong className="text-slate-900">{o.poNumber || o.orderNumber}</strong> · {o.clientName} · {formatINR(o.netValue)}
                  <span className="block text-slate-500">
                    {o.splits.length
                      ? o.splits.map((s: any) => `${o.types.find((t: any) => t.businessType === s.businessType)?.label} ${formatINR(s.amount)}`).join(' + ')
                      : `Not split · ${o.types.map((t: any) => t.label).join(' + ')}`}
                  </span>
                </span>
                <button onClick={() => setSplitting(o)} className={`rounded-lg px-2.5 py-1 font-semibold ${o.splits.length ? 'border border-sky-200 text-sky-700' : 'bg-amber-500 text-white'}`}>
                  {o.splits.length ? 'Change split' : 'Set split'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {splitting && <SplitForm order={splitting} act={act} onClose={() => setSplitting(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------- Targets set */

/**
 * Every target directors have set: one card per salesperson and period with Target 1, Target 2, …, how much
 * is booked, which are achieved, and the incentives. Edit opens the form with them; delete removes the set.
 */
function TargetsSetTab({ targets, showSalesperson, onEdit, onChanged }: { targets: any[]; showSalesperson: boolean; onEdit: (chain: any[]) => void; onChanged: () => void }) {
  const [show, setShow] = useState<'running' | 'all'>('running');
  const chains = useMemo(() => {
    const byKey = new Map<string, any[]>();
    for (const t of targets.filter((t) => t.targetType === 'ORDERS_BOOKED')) {
      const key = `${t.salespersonId}|${t.financialYear}|${t.periodKey}`;
      byKey.set(key, [...(byKey.get(key) || []), t]);
    }
    return [...byKey.values()]
      .map((c) => c.sort((a, b) => a.level - b.level))
      .sort((a, b) => new Date(b[0].periodEnd).getTime() - new Date(a[0].periodEnd).getTime() || a[0].salesperson.name.localeCompare(b[0].salesperson.name));
  }, [targets]);
  const running = chains.filter((c) => new Date(c[0].periodEnd).getTime() >= Date.now());
  const shown = show === 'running' ? running : chains;
  const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-xs';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Targets you have set. Edit to change values or incentives, or to add another target once the others are achieved.</p>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          {[
            { key: 'running' as const, label: `Running (${running.length})` },
            { key: 'all' as const, label: `All (${chains.length})` },
          ].map((c) => (
            <button key={c.key} onClick={() => setShow(c.key)} className={`rounded-lg px-2.5 py-1 font-semibold ${show === c.key ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className={`${card} py-8 text-center text-xs text-slate-500`}>{show === 'running' ? 'No running targets. Use Set Target to add one.' : 'No targets set yet.'}</p>
      ) : (
        shown.map((chain) => {
          const first = chain[0];
          const booked = Number(first.achievedAmount);
          const rateTypes = REQUIREMENT_TYPES.filter((type) => chain.some((t) => t.typeRates?.[type.value]?.incentive));
          const allMet = chain.every((t) => t.isAchieved);
          const ended = new Date(first.periodEnd).getTime() < Date.now();
          return (
            <section key={first.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {showSalesperson ? `${first.salesperson.name} · ` : ''}
                    {first.periodLabel}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {PERIOD_TYPE_LABELS[first.periodType as TargetPeriodType]} · {first.financialYear} · {periodDay(first.periodStart)} to {periodDay(first.periodEnd)}
                    {ended ? ' · ended' : ''} · booked <strong className="text-slate-800">{formatINR(booked)}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {allMet && !ended && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">All {chain.length} achieved · add Target {chain.length + 1}?</span>}
                  <button onClick={() => onEdit(chain)} className="rounded-lg border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50">
                    Edit
                  </button>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-slate-500">
                      <th className="py-1.5 pr-3 font-semibold" />
                      {chain.map((t) => (
                        <th key={t.id} className="min-w-[120px] py-1.5 pr-3 font-semibold">
                          <span className="block text-slate-800">Target {t.level}</span>
                          <span className="block text-sm font-bold text-slate-900">{formatINR(t.targetValue)}</span>
                          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${t.isAchieved ? 'bg-emerald-100 text-emerald-800' : t.isCurrent ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>
                            {t.isAchieved ? 'Achieved' : t.isCurrent ? `Working on · ${Math.round(t.achievementPercent)}%` : 'Next'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rateTypes.map((type) => (
                      <tr key={type.value} className="border-b border-slate-50">
                        <td className="whitespace-nowrap py-1 pr-3 font-semibold text-slate-700">{type.label}</td>
                        {chain.map((t) => (
                          <td key={t.id} className="py-1 pr-3 font-semibold text-slate-800">
                            {t.typeRates?.[type.value]?.incentive ? pct(t.typeRates[type.value].incentive) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 max-w-xs">
                {/* Deleting Target 1 removes the whole set (higher targets go with it) */}
                <DeleteTarget target={first} higherCount={chain.length - 1} onDeleted={onChanged} />
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- History */

function HistoryTab({ audit }: { audit: any[] }) {
  const kind: Record<string, string> = { TARGET: 'Target', INCENTIVE_RATE: 'Rate', ORDER_SPLIT: 'Order split', INCENTIVE_ENTRY: 'Incentive' };
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <h2 className="text-sm font-bold text-slate-900">Audit trail</h2>
      <p className="text-[11px] text-slate-500">Every change to targets, rates, order splits, approvals and payouts, newest first</p>
      {audit.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="w-36 shrink-0 text-slate-500">{new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="w-24 shrink-0 font-semibold text-slate-500">{kind[a.entityType] || a.entityType}</span>
              <span className="min-w-0 flex-1 text-slate-800">{a.details?.label || humanize(a.action)}</span>
              <span className="text-slate-500">by {a.actor}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ Shared */

/** Delete for one target (directors); it moves to the Recycle Bin with any higher targets set after it. */
function DeleteTarget({ target, higherCount, onDeleted }: { target: any; higherCount: number; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/targets/${target.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete');
      setConfirming(false);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
    }
    setDeleting(false);
  }

  if (!confirming) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className="flex items-center space-x-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-left text-xs">
      <p className="flex items-center space-x-1.5 font-bold text-rose-800">
        <AlertTriangle className="h-4 w-4" />
        <span>Delete this target?</span>
      </p>
      <p className="text-rose-700">
        {higherCount > 0 && `The ${higherCount === 1 ? 'higher target' : `${higherCount} higher targets`} set after it will be deleted too. `}
        {target.level > 1 && higherCount === 0 && 'The target before it becomes current again. '}
        It moves to the Recycle Bin, where you can restore it for 5 days.
      </p>
      {error && <p className="font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end space-x-2">
        <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700">
          No, keep it
        </button>
        <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
          {deleting ? 'Deleting...' : 'Yes, delete'}
        </button>
      </div>
    </div>
  );
}

// An incentive's overall %: its Target 1 part and the part past Target 1 together, e.g. 2.5% for half at 2% and half at 3%
const effectiveRate = (e: any) => (e.eligibleAmount ? Math.round((e.incentiveAmount / e.eligibleAmount) * 10000) / 100 : 0);

function targetTitle(t: any) {
  return TARGET_TYPE_LABELS[t.targetType] || humanize(t.targetType);
}

// Per business type: the incentive % for each target in the form
type RatesForm = Record<string, { incentive: string[] }>;
const blankRates = (): RatesForm => Object.fromEntries(REQUIREMENT_TYPES.map((t) => [t.value, { incentive: [] }]));
// A next target starts from the achieved one's rates in its first column
const ratesForm = (rates: Record<string, { incentive: number }>): RatesForm =>
  Object.fromEntries(REQUIREMENT_TYPES.map((t) => [t.value, { incentive: [rates[t.value]?.incentive ? String(rates[t.value].incentive) : ''] }]));

/** The targets as the API takes them: each value with its rates table. */
function levelsBody(values: string[], rates: RatesForm) {
  return values.map((v, i) => ({
    targetValue: parseFloat(v) || 0,
    typeRates: Object.fromEntries(REQUIREMENT_TYPES.map((t) => [t.value, { incentive: rates[t.value].incentive[i] ?? '' }])),
  }));
}

function rateInput(label: string, value: string, onChange: (value: string) => void) {
  return (
    <input
      type="number"
      min="0"
      max="100"
      step="0.01"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-[70px] rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold"
      placeholder="0"
    />
  );
}

/** A target's incentives by business type (only the types with a rate). */
function RatesList({ rates, level, wide }: { rates: Record<string, { incentive: number }>; level: number; wide: boolean }) {
  const rows = REQUIREMENT_TYPES.filter((t) => rates[t.value]?.incentive);
  if (!rows.length) return null;
  return (
    <table className={`mt-2 w-full ${wide ? 'text-xs' : 'text-[11px]'}`}>
      <thead>
        <tr className="text-left text-slate-500">
          <th className="font-semibold">Type</th>
          <th className="text-right font-semibold" title={level > 1 ? 'On bookings from the previous target up to this one' : 'On bookings up to this target'}>
            Incentives for Target {level}
          </th>
        </tr>
      </thead>
      <tbody className="text-slate-700">
        {rows.map((t) => (
          <tr key={t.value}>
            <td>{t.label}</td>
            <td className="text-right font-semibold">{pct(rates[t.value].incentive)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Rupee targets as ₹, count targets (meetings, quotations, requirements) as plain numbers
function targetAmount(targetType: string, value: unknown) {
  return targetType.includes('COLLECTIONS') || targetType.includes('ORDERS') ? formatINR(value as any) : Number(value);
}
// A period's first or last day as dd/mm/yyyy. Periods are stored as UTC day bounds, so they are read in
// UTC: in India time a period ending 31 Mar 23:59 UTC would show as 1 Apr
const periodDay = (d: string | Date) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(d));

// The same in short form for the gauge cards, e.g. ₹ 1.80 Cr
function targetAmountShort(targetType: string, value: unknown) {
  return targetType.includes('COLLECTIONS') || targetType.includes('ORDERS') ? formatINRCompact(value as any) : Number(value);
}

function financialYears() {
  const currentStartYear = Number(getIndianFYQuarter().financialYear.match(/\d{4}/)?.[0]);
  return Array.from({ length: 6 }, (_, index) => currentStartYear + 1 - index).map((year) => `FY ${year}-${String(year + 1).slice(-2)}`);
}

function TargetPeriodPicker({
  financialYear,
  periodType,
  periodKey,
  onYearChange,
  onTypeChange,
  onKeyChange,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  financialYear: string;
  periodType: TargetPeriodType;
  periodKey: string;
  onYearChange: (value: string) => void;
  onTypeChange: (value: TargetPeriodType) => void;
  onKeyChange: (value: string) => void;
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  const options = periodOptions(financialYear, periodType);
  const custom = periodType === 'CUSTOM';
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <label className={`space-y-1 font-semibold text-slate-700 ${custom ? 'hidden' : ''}`}>
        <span>Financial year</span>
        <select aria-label="Target financial year" value={financialYear} onChange={(event) => onYearChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2">
          {financialYears().map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 font-semibold text-slate-700">
        <span>Target period</span>
        <select aria-label="Target period type" value={periodType} onChange={(event) => onTypeChange(event.target.value as TargetPeriodType)} className="w-full rounded-lg border border-slate-300 px-2 py-2">
          {(Object.keys(PERIOD_TYPE_LABELS) as TargetPeriodType[]).map((type) => (
            <option key={type} value={type}>
              {PERIOD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {options.length > 1 && (
        <label className="col-span-2 space-y-1 font-semibold text-slate-700">
          <span>{periodType === 'MONTHLY' ? 'Month' : periodType === 'QUARTERLY' ? 'Quarter' : 'Half'}</span>
          <select aria-label="Target period" value={periodKey} onChange={(event) => onKeyChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2">
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {custom ? (
        <>
          <label className="space-y-1 font-semibold text-slate-700">
            <span>Start date</span>
            <input type="date" aria-label="Target start date" value={startDate} onChange={(e) => onStartChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" required />
          </label>
          <label className="space-y-1 font-semibold text-slate-700">
            <span>End date</span>
            <input type="date" aria-label="Target end date" value={endDate} min={startDate} onChange={(e) => onEndChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" required />
          </label>
        </>
      ) : null}
      <p className="col-span-2 -mt-1 text-[11px] font-normal text-slate-500">
        {custom ? 'The deadline is the end date. The target counts in the financial year it starts in.' : 'The deadline is the last day of the period.'}
      </p>
    </div>
  );
}
