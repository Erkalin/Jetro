import type { Item } from '@/types';
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

export function fmtBytes(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

export function fmtSpeed(bps: number) {
  if (!bps) return '0 KB/s';
  return fmtBytes(bps) + '/s';
}

export function fmtSize(n: number, estimated?: boolean) {
  const s = fmtBytes(n);
  return estimated && n ? `~${s}` : s;
}

export function itemPct(it: Item): number {
  if (!it.totalBytes) return 0;
  return Math.min(100, (it.downloadedBytes / it.totalBytes) * 100);
}

export function fmtDetailStatus(it: Item, completedLabel: string = en.status.completed): string {
  if (it.status === 'completed') return completedLabel;
  return `${itemPct(it).toFixed(2)}%`;
}

export function fmtDetailSize(it: Item): string {
  if (it.status === 'completed') {
    const total = it.totalBytes || it.downloadedBytes;
    return total ? fmtBytes(total) : '—';
  }
  const total = it.totalBytes || 0;
  const done = it.downloadedBytes || 0;
  if (!total) return done ? `${fmtBytes(done)} / —` : '—';
  return `${done ? fmtBytes(done) : '0 B'} / ${fmtSize(total, !!it.totalBytesIsEstimate)}`;
}

export function lastTryOf(it: Item): number {
  const t = Number((it as any)?.lastTryAt) || Number((it as any)?.createdAt) || 0;
  return t > 0 ? t : 0;
}

// fa locale uses Jalali calendar.
export function fmtLastTry(ts: number, months: readonly string[] = en.months.short, locale?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (locale?.toLowerCase().startsWith('fa')) {
    try {
      const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      }).formatToParts(d);
      const val = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const jMonth = val('month');
      const jDay = val('day');
      if (jMonth >= 1 && jMonth <= 12 && jDay >= 1 && jDay <= 31) {
        return `${months[jMonth - 1] ?? jMonth} ${toFaDigits(jDay)} ${toFaDigits(time)}`;
      }
    } catch {
    }
  }
  return `${months[d.getMonth()]} ${pad(d.getDate())} ${time}`;
}

function toFaDigits(v: string | number): string {
  return String(v).replace(/[0-9]/g, (ch) => '۰۱۲۳۴۵۶۷۸۹'[Number(ch)]);
}

export function fmtLastTryTitle(
  ts: number,
  neverLabel: string = en.months.neverTried,
  locale?: string,
): string {
  if (!ts) return neverLabel;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return neverLabel;
  return locale ? d.toLocaleString(locale) : d.toLocaleString();
}

export function statusLabel(status: string, s: AppStrings['status'] = en.status) {
  switch (status) {
    case 'downloading': return s.downloading;
    case 'completed': return s.completed;
    case 'error': return s.error;
    case 'paused': return s.paused;
    case 'queued': return s.queued;
    case 'merging': return s.merging;
    default: return status;
  }
}

export function statusColor(status: string) {
  switch (status) {
    case 'downloading': return 'var(--green)';
    case 'completed': return 'var(--accent)';
    case 'error': return 'var(--red)';
    case 'paused': return 'var(--amber)';
    default: return 'var(--muted)';
  }
}

// Quantized ETA, stable on large values.
export function formatEtaSec(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const v = Number(sec);
  if (!Number.isFinite(v) || v < 0) return '—';
  let s = Math.max(0, Math.round(v));
  if (s >= 20) s = Math.round(s / 5) * 5;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

export function fmtEta(it: Item, fallbackBps?: number): string {
  if (it.status === 'completed') return '—';
  const raw = Number(it.speedBps || 0);
  const fb = Math.max(0, Math.round(Number(fallbackBps) || 0));
  const sp = raw > 0 ? raw : fb;
  if (sp <= 0 || !it.totalBytes) return '—';
  return formatEtaSec(Math.max(0, (it.totalBytes - it.downloadedBytes) / sp));
}

export function speedLimitLabel(kbps: number, l: AppStrings['speedLimit'] = en.speedLimit): string {
  const v = Math.max(0, Math.round(Number(kbps) || 0));
  if (!v) return l.unlimited;
  if (v >= 1024 && v % 1024 === 0) return l.megabytesPerSec(v / 1024);
  return l.kilobytesPerSec(v);
}
