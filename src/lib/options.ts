// ---------- Settings dropdown options ----------
// Per-file connection presets (1–32). Shared by Settings, New Download and Batch.
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';
import { speedLimitLabel } from './format';

export const CONNECTION_OPTIONS = [1, 4, 8, 16, 32];
// Speed limit presets in KB/s (0 = unlimited).
export const SPEED_LIMIT_VALUES = [0, 100, 256, 512, 1024, 2048, 5120, 10240];

/** Localized speed-limit options for dropdowns (labels from the active language). */
export function speedLimitOptions(
  l: AppStrings['speedLimit'] = en.speedLimit,
): { value: number; label: string }[] {
  return SPEED_LIMIT_VALUES.map((value) => ({ value, label: speedLimitLabel(value, l) }));
}

/** Display value for the Connections dropdown; falls back to 8 for legacy garbage. */
export function normalizeConnectionOption(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 8;
}
