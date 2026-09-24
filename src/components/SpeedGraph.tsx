import { useMemo, useState } from 'react';
import { fmtSpeed } from '@/lib/format';
import type { SpeedSample } from '@/hooks/useSpeedHistory';
import { useLanguage } from '@/locale/LanguageContext';

const W = 600;
const H = 180;
const PAD_L = 52;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;

function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * base;
}

interface Pt {
  x: number;
  y: number;
  t: number;
  bps: number;
}

const GAP_MS = 2500;

function isHardEdge(p1: Pt, p2: Pt): boolean {
  if (p1.bps === 0 || p2.bps === 0) return true;
  return Math.abs(p2.x - p1.x) < 0.01;
}

function runSubpath(run: Pt[], minY: number, maxY: number): string {
  const cy = (v: number) => Math.min(maxY, Math.max(minY, v));
  if (run.length === 0) return '';
  let d = `M ${run[0].x.toFixed(1)} ${cy(run[0].y).toFixed(1)}`;
  for (let i = 0; i < run.length - 1; i++) {
    const p1 = run[i];
    const p2 = run[i + 1];
    if (isHardEdge(p1, p2)) {
      d += ` L ${p2.x.toFixed(1)} ${cy(p2.y).toFixed(1)}`;
      continue;
    }
    const p0 = run[Math.max(0, i - 1)];
    const p3 = run[Math.min(run.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = cy(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = cy(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${cy(p2.y).toFixed(1)}`;
  }
  return d;
}

// Flat at zero across pauses, no diagonal ramp.
function gapAwareLine(runs: Pt[][], minY: number, maxY: number, baseY: number): string {
  if (runs.length === 0) return '';
  let d = runSubpath(runs[0], minY, maxY);
  for (let r = 1; r < runs.length; r++) {
    const prev = runs[r - 1][runs[r - 1].length - 1];
    const next = runs[r][0];
    const tail = runSubpath(runs[r], minY, maxY).slice(1);
    if (prev.bps === 0 || next.bps === 0) {
      if (Math.abs(prev.y - baseY) > 0.01) d += ` L ${prev.x.toFixed(1)} ${baseY.toFixed(1)}`;
      d += ` L ${next.x.toFixed(1)} ${baseY.toFixed(1)}`;
      d += ` L${tail}`;
    } else {
      d += ` L${tail}`;
    }
  }
  return d;
}

function relLabel(t1: number, t: number, nowLabel = 'now'): string {
  const s = Math.max(0, Math.round((t1 - t) / 1000));
  if (s <= 0) return nowLabel;
  if (s < 60) return `-${s}s`;
  if (s < 3600) return `-${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `-${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

type SpeedRangeId = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | 'all';

const SPEED_RANGES: { id: SpeedRangeId; ms: number | null }[] = [
  { id: '1m', ms: 60_000 },
  { id: '5m', ms: 300_000 },
  { id: '15m', ms: 900_000 },
  { id: '30m', ms: 1_800_000 },
  { id: '1h', ms: 3_600_000 },
  { id: '2h', ms: 7_200_000 },
  { id: 'all', ms: null },
];

const RANGE_LABELS: Record<SpeedRangeId, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  'all': 'all',
};

export default function SpeedGraph({ samples, live }: { samples: SpeedSample[]; live: boolean }) {
  const { t } = useLanguage();
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<SpeedRangeId>('5m');
  const rangeLabel = (id: SpeedRangeId) => (id === 'all' ? t.analytics.rangeAll : RANGE_LABELS[id]);

  const firstT = samples.length ? samples[0].t : 0;
  const lastT = samples.length ? samples[samples.length - 1].t : 0;
  const lastBps = samples.length ? samples[samples.length - 1].bps : 0;

  const model = useMemo(() => {
    if (samples.length < 2) return null;
    const dataT1 = samples[samples.length - 1].t;
    const rangeMs = SPEED_RANGES.find((r) => r.id === range)?.ms ?? null;
    const t0 = rangeMs == null ? samples[0].t : Math.max(samples[0].t, dataT1 - rangeMs);
    const t1 = dataT1;
    const view = rangeMs == null ? samples : samples.filter((s) => s.t >= t0);
    if (view.length < 2) return null;
    const span = Math.max(1, t1 - t0);
    const peak = view.reduce((a, s) => Math.max(a, s.bps), 0);
    const max = niceCeil(peak * 1.15);
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const base = PAD_T + plotH;
    const clampY = (y: number) => Math.min(base, Math.max(PAD_T, y));
    const pts: Pt[] = view.map((s) => ({
      x: PAD_L + ((s.t - t0) / span) * plotW,
      y: clampY(PAD_T + (1 - Math.min(s.bps, max) / max) * plotH),
      t: s.t,
      bps: s.bps,
    }));
    // Split at pause gaps.
    const runs: Pt[][] = [];
    for (const p of pts) {
      const cur = runs[runs.length - 1];
      if (!cur || p.t - cur[cur.length - 1].t <= GAP_MS) {
        if (!cur) runs.push([p]);
        else cur.push(p);
      } else {
        runs.push([p]);
      }
    }
    const line = gapAwareLine(runs, PAD_T, base, base);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const area = `${line} L ${last.x.toFixed(1)} ${base} L ${first.x.toFixed(1)} ${base} Z`;
    const yTicks = [0, 1, 2, 3].map((k) => {
      const v = (max * k) / 3;
      return { v, y: PAD_T + (1 - k / 3) * plotH, label: fmtSpeed(Math.round(v)) };
    });
    const xTicks = [0, 1, 2, 3].map((k) => ({
      x: PAD_L + (k / 3) * plotW,
      label: relLabel(t1, t0 + (span * k) / 3, t.analytics.now),
    }));
    return { pts, line, area, base, max, yTicks, xTicks, t1, last };
  }, [samples, samples.length, firstT, lastT, lastBps, range, t]);

  const toolbar = (
    <div className="sg-toolbar" role="group" aria-label={t.analytics.graphRange}>
      {SPEED_RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          className={'sg-range-btn' + (range === r.id ? ' active' : '')}
          aria-pressed={range === r.id}
          onClick={() => {
            setRange(r.id);
            setHover(null);
          }}
        >
          {rangeLabel(r.id)}
        </button>
      ))}
    </div>
  );

  if (!model) {
    return (
      <>
        {toolbar}
        <div className="sg-empty">{live ? t.analytics.graphCollecting : t.analytics.graphEmpty}</div>
      </>
    );
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const sx = (e.clientX - rect.left) * (W / rect.width);
    let best = 0;
    let bd = Infinity;
    model.pts.forEach((p, i) => {
      const d = Math.abs(p.x - sx);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? model.pts[hover] : null;
  const tipW = 132;
  const tipH = 40;
  const tipX = hp ? Math.min(Math.max(hp.x + 12, PAD_L), W - tipW - 4) : 0;
  const tipY = hp ? Math.min(Math.max(hp.y - tipH - 8, 4), H - tipH - 4) : 0;

  return (
    <>
      {toolbar}
      <svg
        className="sg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t.analytics.graphLabel}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
      <defs>
        <linearGradient id="sg-fill-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="sg-stop-1" />
          <stop offset="100%" className="sg-stop-2" />
        </linearGradient>
      </defs>
      {model.yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} className="sg-grid" />
          <text x={PAD_L - 6} y={t.y + 3.5} textAnchor="end" className="sg-label">
            {t.label}
          </text>
        </g>
      ))}
      {model.xTicks.map((t, i) => (
        <text key={i} x={t.x} y={H - 6} textAnchor="middle" className="sg-label">
          {t.label}
        </text>
      ))}
      <path d={model.area} fill="url(#sg-fill-grad)" />
      <path d={model.line} className="sg-stroke" />
      {hp && (
        <g>
          <line x1={hp.x} y1={PAD_T} x2={hp.x} y2={model.base} className="sg-cross" />
          <circle cx={hp.x} cy={hp.y} r={4} className="sg-dot" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={8} className="sg-tip" />
          <text x={tipX + 10} y={tipY + 16} className="sg-tip-main">
            {fmtSpeed(hp.bps)}
          </text>
          <text x={tipX + 10} y={tipY + 31} className="sg-tip-sub">
            {relLabel(model.t1, hp.t, t.analytics.now)}
          </text>
        </g>
      )}
      {live && hover == null && <circle cx={model.last.x} cy={model.last.y} r={4} className="sg-live" />}
      </svg>
    </>
  );
}
