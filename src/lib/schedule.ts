import type { QueuePowerAction } from '@/types';
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

// ---------- Queue schedules: strict 24-hour HH:MM ----------
const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const QUEUE_SCHED_DEFAULT_START = '22:00';
export const QUEUE_SCHED_DEFAULT_STOP = '07:00';

/** Localized power-action options for dropdowns (labels from the active language). */
export function queuePowerOptions(p: AppStrings['power'] = en.power): { value: QueuePowerAction; label: string }[] {
  return [
    { value: 'nothing', label: p.nothing },
    { value: 'sleep', label: p.sleep },
    { value: 'hibernate', label: p.hibernate },
    { value: 'shutdown', label: p.shutdown },
    { value: 'restart', label: p.restart },
  ];
}

export function normalizeQueuePowerAction(v: any): QueuePowerAction {
  return v === 'sleep' || v === 'hibernate' || v === 'shutdown' || v === 'restart' ? v : 'nothing';
}

export function queuePowerLabel(v: any, p: AppStrings['power'] = en.power): string {
  const a = normalizeQueuePowerAction(v);
  return queuePowerOptions(p).find((o) => o.value === a)?.label || p.nothing;
}

/** Normalize user input to HH:MM 24h ("2:5" → "02:05"). Returns '' when invalid. */
export function normalizeTime24h(v: unknown): string {
  const s = String(v ?? '').trim();
  if (TIME_24H_RE.test(s)) return s;
  const m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isInteger(h) && Number.isInteger(min) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  return '';
}

/** Drop the removed global-scheduler keys so old settings files never mark the form dirty. */
export function stripGlobalScheduler(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const c: any = { ...s };
  delete c.schedulerEnabled;
  delete c.schedulerStart;
  delete c.schedulerStop;
  return c;
}

// ---------- Scheduler window helpers ----------
export const QUEUE_CONCURRENT_MIN = 1;
export const QUEUE_CONCURRENT_MAX = 10;
export const QUEUE_CONCURRENT_DEFAULT = 1;

export function normalizeQueueMaxConcurrent(v: unknown, fallback = QUEUE_CONCURRENT_DEFAULT): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(QUEUE_CONCURRENT_MAX, Math.max(QUEUE_CONCURRENT_MIN, n));
}

export function normalizeScheduleMode(v: unknown): 'once' | 'daily' {
  return v === 'once' ? 'once' : 'daily';
}

export function normalizeWeekdays(v: unknown): boolean[] {
  if (Array.isArray(v) && v.length === 7) return v.map((x) => !!x);
  return [true, true, true, true, true, true, true];
}

const ONCE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function normalizeOnceDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!ONCE_DATE_RE.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return s;
}

export function defaultOnceDate(): string {
  try {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return '';
  }
}

export function formatOnceDateLong(iso: string, locale?: string): string {
  if (!ONCE_DATE_RE.test(String(iso || ''))) return String(iso || '');
  try {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function normalizeRetriesPerFile(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 10) return null;
  return n;
}

/** Sort queue files: explicit queueOrder first, then batch order, then oldest first. */
export function compareQueueFiles(a: any, b: any): number {
  const ao = Number(a?.queueOrder);
  const bo = Number(b?.queueOrder);
  const aHas = Number.isFinite(ao);
  const bHas = Number.isFinite(bo);
  if (aHas && bHas && ao !== bo) return ao - bo;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  const bi = (Number(a?.batchIndex ?? 0) - Number(b?.batchIndex ?? 0));
  if (bi !== 0) return bi;
  return (Number(a?.createdAt ?? 0) - Number(b?.createdAt ?? 0));
}
