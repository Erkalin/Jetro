import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';
import { speedLimitLabel } from './format';

export const CONNECTION_OPTIONS = [1, 4, 8, 16, 32];
export const SPEED_LIMIT_VALUES = [0, 100, 256, 512, 1024, 2048, 5120, 10240];

export function speedLimitOptions(
  l: AppStrings['speedLimit'] = en.speedLimit,
): { value: number; label: string }[] {
  return SPEED_LIMIT_VALUES.map((value) => ({ value, label: speedLimitLabel(value, l) }));
}

export function normalizeConnectionOption(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 8;
}
