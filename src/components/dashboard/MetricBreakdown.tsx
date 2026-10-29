'use client';

import Link from 'next/link';
import { ChevronRight, X } from 'lucide-react';
import { formatDate, formatINR, humanize, stageLabel } from '@/lib/utils';

export type DashboardMetric = 'pipeline' | 'orders' | 'received' | 'outstanding';

export interface PipelineEntry {
  id: string;
  clientId: string;
  clientName: string;
  enquiryNumber: string;
  title: string;
  stage: string;
  value: number;
  salesperson: string;
}

export interface OrderEntry {
  id: string;
  clientId: string;
  clientName: string;
  orderNumber: string;
  orderStatus: string;
  orderDate: string;
  salesperson: string;
  netValue: number;
  grossValue: number;
  received: number;
  outstanding: number;
  dueNow: number;
}

const TITLES: Record<DashboardMetric, string> = {
  pipeline: 'Open pipeline',
  orders: 'Orders booked',
  received: 'Payments received',
  outstanding: 'Outstanding payments',
};

export default function MetricBreakdown({ metric, pipeline, orders, isDirector, loading = false, onClose }: {
  metric: DashboardMetric;
  pipeline: PipelineEntry[];
  orders: OrderEntry[];
  isDirector: boolean;
  loading?: boolean;
  onClose: () => void;
}) {
  const records = metric === 'pipeline'
    ? pipeline.map((e) => ({
      id: e.id,
      client: e.clientName,
      description: `${e.enquiryNumber} · ${e.title}`,
      detail: stageLabel(e.stage),
      salesperson: e.salesperson,
      amount: e.value,
      due: 0,
      href: `/clients/${e.clientId}?tab=enquiries&record=${e.id}`,
    }))
    : orders
      .filter((o) => metric === 'orders' || (metric === 'received' ? o.received > 0 : o.outstanding > 0))
      .map((o) => ({
        id: o.id,
        client: o.clientName,
        description: `${o.orderNumber} · ${formatDate(o.orderDate)}`,
        detail: metric === 'orders' ? `${humanize(o.orderStatus)} · With tax ${formatINR(o.grossValue)}`
          : metric === 'received' ? `Still to receive ${formatINR(o.outstanding)}` : `Due now ${formatINR(o.dueNow)}`,
        salesperson: o.salesperson,
        amount: metric === 'orders' ? o.netValue : metric === 'received' ? o.received : o.outstanding,
        due: o.dueNow,
        href: `/clients/${o.clientId}?tab=${metric === 'orders' ? 'orders' : 'payments'}&record=${o.id}`,
      }));
  const total = records.reduce((sum, record) => sum + record.amount, 0);

  return (
    <section id="metric-breakdown" aria-busy={loading} aria-label={`${TITLES[metric]} breakdown`} className="scroll-mt-24 overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{TITLES[metric]}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {metric === 'pipeline' ? 'Open requirements matching your filters.' : 'Non-cancelled orders matching your filters.'} Select a row to open its details.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close breakdown" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-sky-500">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <p aria-live="polite" className="text-xs text-slate-500">{loading ? 'Updating…' : <>{records.length} records · <strong className="text-slate-900">{formatINR(total)}</strong></>}</p>
      </div>
      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        {loading ? <p className="px-5 py-8 text-center text-xs text-slate-500">Loading matching records…</p> : records.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">No records to show for this total.</p>
        ) : records.map((record) => (
          <Link key={record.id} href={record.href} className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-sky-50 focus-visible:outline-sky-500">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{record.client}</p>
              <p className="mt-0.5 text-xs text-slate-500">{record.description}</p>
              <p className="mt-1 text-[11px] text-slate-500">{record.detail}{isDirector ? ` · ${record.salesperson}` : ''}</p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{formatINR(record.amount)}</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-sky-600" />
          </Link>
        ))}
      </div>
    </section>
  );
}
