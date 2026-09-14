import type { QueuePowerAction } from '@/types';
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

// ---------- Queue schedules: strict 24-hour HH:MM ----------
export const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const QUEUE_SCHED_DEFAULT_START = '22:00';
export const QUEUE_SCHED_DEFAULT_STOP = '07:00';

export const QUEUE_POWER_OPTIONS: { value: QueuePowerAction; label: string }[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'hibernate', label: 'Hibernate' },
  { value: 'shutdown', label: 'Shutdown' },
  { value: 'restart', label: 'Restart' },
];

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
