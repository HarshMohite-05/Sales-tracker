'use client';

// Charts for the dark sales dashboard, drawn as plain SVG. Colours come from the .crm-dark tokens
// in globals.css (series, status and ordinal steps validated against the dark card surface).
import React, { useEffect, useRef, useState } from 'react';
import { formatINRCompact } from '@/lib/utils';

const FUNNEL_STEPS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab']; // one blue hue, ordered light → dark

/** Tiny trend line for a KPI tile; the title names the series, so it needs no legend. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 72;
  const h = 26;
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return null;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: last ${values.length} months`} className="shrink-0">
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill="var(--series-1)" />
    </svg>
  );
}

/**
 * Speedometer for the target achievement: a dial from 0 to 100% with a needle on the achievement. Past
 * 100% the needle rests at the end of the dial and the number below carries the real value.
 */
export function Gauge({ percent }: { percent: number }) {
  const cx = 100;
  const cy = 100;
  const r = 80;
  const c = Math.PI * r;
  const shown = Math.max(0, Math.min(percent, 100));
  // A point on the dial: 0% on the left, 100% on the right
  const at = (p: number, radius: number) => {
    const angle = Math.PI * (1 - p / 100);
    return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
  };
  return (
    <svg viewBox="0 0 200 128" className="w-full max-w-[250px]" role="img" aria-label={`${Math.round(percent)}% of target achieved`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--grid)" strokeWidth={12} strokeLinecap="round" />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${(shown / 100) * c} ${c}`}
      />
      {/* Ticks every 10%, longer at 0, 50 and 100 */}
      {Array.from({ length: 11 }, (_, i) => i * 10).map((p) => {
        const major = p % 50 === 0;
        const a = at(p, r - 12);
        const b = at(p, r - (major ? 22 : 17));
        return <line key={p} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text-muted)" strokeWidth={major ? 2 : 1} strokeLinecap="round" />;
      })}
      {/* 0% and 100% under the ends of the dial, clear of the needle; 50% inside the top */}
      {[
        { p: 0, x: cx - r, y: cy + 16 },
        { p: 50, x: cx, y: cy - r + 36 },
        { p: 100, x: cx + r, y: cy + 16 },
      ].map(({ p, x, y }) => (
        <text key={p} x={x} y={y} textAnchor="middle" fill="var(--text-secondary)" fontSize="9">
          {p}%
        </text>
      ))}
      {/* Needle, drawn pointing at 0% and turned to the achievement */}
      <g style={{ transform: `rotate(${shown * 1.8}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.8s ease-out' }}>
        <line x1={cx + 10} y1={cy} x2={cx - r + 16} y2={cy} stroke="var(--text-primary)" strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r={7} fill="var(--text-primary)" />
      <circle cx={cx} cy={cy} r={3} fill="var(--series-1)" />
      <text x={cx} y={cy + 26} textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight="700">
        {Math.round(percent)}%
        <tspan fill="var(--text-secondary)" fontSize="10" fontWeight="400" dx="5">achieved</tspan>
      </text>
    </svg>
  );
}

type Month = { key: string; label: string; enquiries: number; orders: number };

/**
 * Requirements (bars) and orders booked (line) per month. Both are counts, so they share one axis.
 */
export function TrendChart({ months, onSelect }: { months: Month[]; onSelect?: (month: Month) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width with a fixed height, so text stays the same size at any width
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(520);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 30, r: 10, t: 12, b: 26 };
  const max = Math.max(1, ...months.map((m) => Math.max(m.enquiries, m.orders)));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / months.length;
  const barW = Math.min(22, slot * 0.5);
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;
  const line = months.map((m, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(m.orders).toFixed(1)}`).join(' ');
  const h = hover !== null ? months[hover] : null;

  return (
    <div ref={box} className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--series-1)]" /> Requirements
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[var(--series-2)]" />
          <span className="-ml-3 mr-1 h-2 w-2 rounded-full border-2 border-[var(--series-2)] bg-[var(--surface-1)]" /> Orders booked
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label="Requirements and orders booked per month" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const bh = (m.enquiries / top) * plotH;
          const x0 = cx(i) - barW / 2;
          const yb = pad.t + plotH;
          const rr = Math.min(4, bh / 2, barW / 2);
          return (
            <g key={m.key}>
              {hover === i && <rect x={cx(i) - slot / 2} y={pad.t} width={slot} height={plotH} fill="rgba(255,255,255,0.04)" />}
              {bh > 0 && (
                // Rounded data end at the top, square at the baseline
                <path
                  d={`M${x0},${yb} V${yb - bh + rr} Q${x0},${yb - bh} ${x0 + rr},${yb - bh} H${x0 + barW - rr} Q${x0 + barW},${yb - bh} ${x0 + barW},${yb - bh + rr} V${yb} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                {m.label}
              </text>
              {/* Hit target: the whole month column */}
              <rect
                x={cx(i) - slot / 2}
                y={pad.t}
                width={slot}
                height={plotH + pad.b}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => onSelect?.(m)}
                style={{ cursor: onSelect ? 'pointer' : undefined }}
              />
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" pointerEvents="none" />
        {months.map((m, i) => (
          <circle key={m.key} cx={cx(i)} cy={y(m.orders)} r={hover === i ? 5 : 4} fill="var(--surface-1)" stroke="var(--series-2)" strokeWidth={2} pointerEvents="none" />
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] shadow-xl"
          style={{ left: `${(cx(hover) / W) * 100}%` }}
        >
          <p className="font-semibold text-[var(--text-primary)]">{h.label}</p>
          <p className="text-[var(--text-secondary)]">Requirements <strong className="text-[var(--text-primary)]">{h.enquiries}</strong></p>
          <p className="text-[var(--text-secondary)]">Orders booked <strong className="text-[var(--text-primary)]">{h.orders}</strong></p>
          {onSelect && <p className="mt-1 text-[var(--text-muted)]">Click to see these requirements</p>}
        </div>
      )}
    </div>
  );
}

// Text on each funnel band: dark on the two light blues, white on the two dark ones
const FUNNEL_TEXT = ['#0b1f3a', '#0b1f3a', '#ffffff', '#ffffff'];

/**
 * Requirement to order funnel: one band per stage, its width the share of all requirements, narrowing
 * into the next stage. Beside each band: the stage's estimated value and share.
 */
export function Funnel({ stages, onSelect }: { stages: { key: string; label: string; count: number; value?: number }[]; onSelect?: (key: string) => void }) {
  const total = stages[0]?.count || 0;
  const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
  // Narrow stages still leave room for their name
  const width = (n: number) => (total ? Math.max(38, (n / total) * 100) : 38);
  const last = stages[stages.length - 1];
  return (
    <div>
      <div className="space-y-1">
        {stages.map((s, i) => {
          const w = width(s.count);
          const next = stages[i + 1] ? width(stages[i + 1].count) : w * 0.9;
          // Each side moves in by half the difference to the next band, as a share of this band's width
          const inset = Math.max(0, ((w - next) / 2 / w) * 100);
          const prev = stages[i - 1];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect?.(s.key)}
              disabled={!onSelect}
              title={prev ? `${share(s.count, prev.count)}% of ${prev.label.toLowerCase()} moved on` : undefined}
              className="group grid w-full grid-cols-[minmax(0,1fr)_76px] items-center gap-3 text-left focus-visible:outline-none"
            >
              <span className="flex justify-center">
                <span
                  className="flex h-10 items-center justify-center gap-1.5 px-[12%] text-xs font-semibold transition group-hover:brightness-110 group-focus-visible:brightness-125"
                  style={{
                    width: `${w}%`,
                    background: FUNNEL_STEPS[i],
                    color: FUNNEL_TEXT[i],
                    clipPath: `polygon(0 0, 100% 0, ${100 - inset}% 100%, ${inset}% 100%)`,
                  }}
                >
                  <span className="truncate">{s.label}</span>
                  <span className="font-bold tabular-nums">{s.count}</span>
                </span>
              </span>
              <span className="text-right text-[11px] leading-tight tabular-nums">
                {s.value !== undefined && <span className="block font-semibold text-[var(--text-primary)]">{formatINRCompact(s.value)}</span>}
                <span className="text-[var(--text-muted)]">{share(s.count, total)}%</span>
              </span>
            </button>
          );
        })}
      </div>
      {last && total > 0 && (
        <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">{share(last.count, total)}%</strong> of requirements became orders
          {last.value !== undefined && stages[0].value ? (
            <>
              {' '}
              · <strong className="text-[var(--text-primary)]">{share(last.value, stages[0].value)}%</strong> by value
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'var(--good)',
  IN_PROGRESS: 'var(--series-1)',
  CONFIRMED: 'var(--warning)',
  CANCELLED: 'var(--critical)',
};

/** Orders by status; every slice is labelled in the legend with its count and share. */
export function StatusDonut({ items, onSelect }: { items: { key: string; label: string; count: number; value?: number }[]; onSelect?: (key: string) => void }) {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  // Value of the orders that stand: cancelled ones are left out
  const totalValue = items.some((i) => i.value !== undefined)
    ? items.filter((i) => i.key !== 'CANCELLED').reduce((sum, i) => sum + (i.value || 0), 0)
    : undefined;
  const [hover, setHover] = useState<string | null>(null);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && items.filter((i) => i.count > 0).length > 1 ? 3 : 0; // surface gap between slices
  let offset = 0;
  const focus = items.find((i) => i.key === hover);
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3">
      <svg viewBox="0 0 140 140" className="w-full max-w-[170px]" role="img" aria-label={`${total} orders by status`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--grid)" strokeWidth={18} />
        {total > 0 &&
          items.map((i) => {
            if (!i.count) return null;
            const len = (i.count / total) * c;
            const seg = (
              <circle
                key={i.key}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={STATUS_COLOR[i.key]}
                strokeWidth={hover === i.key ? 22 : 18}
                strokeDasharray={`${Math.max(len - gap, 0.1)} ${c}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
                opacity={hover === null || hover === i.key ? 1 : 0.5}
                onMouseEnter={() => setHover(i.key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(i.key)}
                style={{ cursor: onSelect ? 'pointer' : undefined }}
              >
                <title>{`${i.label}: ${i.count}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        <text x="70" y="64" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--text-primary)">
          {focus ? focus.count : total}
        </text>
        <text x="70" y="79" textAnchor="middle" fontSize="9" fill="var(--text-secondary)">
          {focus ? focus.label : 'orders'}
        </text>
        {(focus ? focus.value : totalValue) !== undefined && (
          <text x="70" y="93" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-primary)">
            {formatINRCompact(focus ? focus.value : totalValue)}
          </text>
        )}
      </svg>
      <ul className="space-y-1 text-xs">
        {items.map((i) => (
          <li key={i.key}>
            <button
              type="button"
              onMouseEnter={() => setHover(i.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i.key)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(i.key)}
              disabled={!onSelect}
              className={`w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5598e7] ${hover && hover !== i.key ? 'opacity-60' : ''}`}
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[i.key] }} />
                <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{i.label}</span>
                <strong className="tabular-nums text-[var(--text-primary)]">{i.count}</strong>
              </span>
              <span className="mt-0.5 flex justify-between pl-[18px] text-[11px] tabular-nums text-[var(--text-muted)]">
                <span>{i.value !== undefined ? formatINRCompact(i.value) : ''}</span>
                <span>{total ? Math.round((i.count / total) * 100) : 0}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
