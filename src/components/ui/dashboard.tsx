'use client';

import React from 'react';
import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tone = 'rose' | 'sky' | 'amber' | 'emerald' | 'teal' | 'slate';

const TONES: Record<Tone, { bar: string; icon: string; glow: string; value: string; ring: string }> = {
  rose: { bar: 'from-rose-500 to-rose-400', icon: 'bg-rose-500 text-white shadow-rose-500/30', glow: 'bg-rose-400/20', value: 'text-rose-600', ring: 'hover:border-rose-300' },
  sky: { bar: 'from-sky-500 to-cyan-400', icon: 'bg-sky-50 text-sky-600 ring-1 ring-sky-100', glow: 'bg-sky-400/15', value: 'text-slate-900', ring: 'hover:border-sky-300' },
  amber: { bar: 'from-amber-500 to-orange-400', icon: 'bg-amber-50 text-amber-600 ring-1 ring-amber-100', glow: 'bg-amber-400/15', value: 'text-slate-900', ring: 'hover:border-amber-300' },
  emerald: { bar: 'from-emerald-500 to-teal-400', icon: 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100', glow: 'bg-emerald-400/15', value: 'text-emerald-700', ring: 'hover:border-emerald-300' },
  teal: { bar: 'from-teal-500 to-cyan-400', icon: 'bg-teal-50 text-teal-600 ring-1 ring-teal-100', glow: 'bg-teal-400/15', value: 'text-teal-700', ring: 'hover:border-teal-300' },
  slate: { bar: 'from-slate-300 to-slate-200', icon: 'bg-slate-100 text-slate-500', glow: 'bg-slate-300/10', value: 'text-slate-800', ring: 'hover:border-slate-300' },
};

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

/** Clickable alert tile for the "needs action" row. */
export function AlertTile({
  href,
  label,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
  pulse,
  display,
  className,
}: {
  href: string;
  label: string;
  value: number;
  display?: string; // shown instead of the number, e.g. an amount
  className?: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
  loading?: boolean;
  pulse?: boolean;
}) {
  const t = TONES[tone];
  return (
    <Link
      href={href}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200',
        'hover:border-slate-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
        t.ring,
        pulse && 'border-rose-200 bg-rose-50/40',
        className
      )}
    >
      <span className={cn('absolute inset-y-4 left-0 w-0.5 rounded-full bg-gradient-to-b', t.bar)} />
      <span className={cn('hidden', t.glow)} />
      <div className="relative flex items-start justify-between">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className={cn('relative flex h-8 w-8 items-center justify-center rounded-lg', t.icon)}>
          <Icon className="h-4 w-4" />
          {pulse && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />
            </span>
          )}
        </span>
      </div>
      <div className="relative mt-4 flex items-end justify-between">
        <div>
          {loading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <p className={cn('font-semibold tabular-nums tracking-tight', display ? 'text-2xl' : 'text-3xl', t.value)}>
              {display ?? value}
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
        </div>
        <ArrowUpRight className="h-4 w-4 -translate-x-1 translate-y-1 text-slate-300 opacity-0 transition-all group-hover:translate-x-0 group-hover:translate-y-0 group-hover:text-slate-500 group-hover:opacity-100" />
      </div>
    </Link>
  );
}

/** Money metric card with compact headline, exact figure and optional progress bar. */
export function MetricCard({
  label,
  icon: Icon,
  tone,
  compact,
  exact,
  loading,
  progress,
  footer,
  onClick,
  active,
  controls,
}: {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  compact: string;
  exact: string;
  loading?: boolean;
  progress?: { value: number; label: string };
  footer?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  controls?: string;
}) {
  const t = TONES[tone];
  const pct = progress ? Math.max(0, Math.min(100, progress.value)) : 0;
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md', onClick && t.ring, active && 'border-sky-400 ring-2 ring-sky-100')}>
      <span className={cn('hidden', t.glow)} />
      <div className="relative flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', t.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="relative mt-4">
        {loading ? (
          <>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-24" />
          </>
        ) : (
          <>
            <p className={cn('text-[28px] font-semibold leading-none tabular-nums tracking-tight', t.value)}>{compact}</p>
            <p className="mt-1.5 text-xs tabular-nums text-slate-500">{exact}</p>
          </>
        )}
      </div>
      {progress && (
        <div className="relative mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out', t.bar)}
              style={{ width: loading ? '0%' : `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">{progress.label}</p>
        </div>
      )}
      {footer && <div className="relative mt-4 border-t border-slate-100 pt-3 text-xs">{footer}</div>}
      {onClick && (
        <>
          <p aria-hidden="true" className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-sky-600">
            {active ? 'Hide breakdown' : 'View breakdown'} <ArrowUpRight className="h-3.5 w-3.5" />
          </p>
          <button
            type="button"
            onClick={onClick}
            disabled={loading}
            aria-label={`${active ? 'Hide' : 'View'} ${label.toLowerCase()} breakdown`}
            aria-expanded={!!active}
            aria-controls={controls}
            className="absolute inset-0 z-10 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 disabled:cursor-wait"
          />
        </>
      )}
    </div>
  );
}

/** Card wrapper for list queues. */
export function Panel({
  title,
  icon: Icon,
  iconClass,
  count,
  countTone = 'slate',
  action,
  children,
  id,
}: {
  id?: string;
  title: string;
  icon: LucideIcon;
  iconClass?: string;
  count?: number;
  countTone?: Tone;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const badge: Record<Tone, string> = {
    rose: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    sky: 'bg-sky-100 text-sky-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    teal: 'bg-teal-100 text-teal-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <section id={id} className="flex scroll-mt-24 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', iconClass)} />
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {typeof count === 'number' && count > 0 && (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums', badge[countTone])}>{count}</span>
          )}
        </div>
        {action && (
          <Link href={action.href} className="group inline-flex items-center gap-0.5 text-xs font-semibold text-sky-600 hover:text-sky-800">
            {action.label}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>
      <div className="max-h-96 flex-1 divide-y divide-slate-100 overflow-y-auto">{children}</div>
    </section>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 ring-1 ring-emerald-100">
        <Icon className="h-5 w-5 text-emerald-500" />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const AVATAR_COLORS = ['bg-sky-100 text-sky-700', 'bg-teal-100 text-teal-700', 'bg-amber-100 text-amber-700', 'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-emerald-100 text-emerald-700'];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold', AVATAR_COLORS[hash % AVATAR_COLORS.length], className)}>
      {initials}
    </span>
  );
}

/** Pill-styled select used in filter bars. */
export function FilterSelect({
  value,
  onChange,
  children,
  active,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  active?: boolean;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'cursor-pointer appearance-none rounded-full border bg-white bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat py-1.5 pl-3.5 pr-8 text-xs font-semibold transition-colors',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        'focus:outline-none focus:ring-2 focus:ring-sky-500/40',
        active ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'
      )}
    >
      {children}
    </select>
  );
}
