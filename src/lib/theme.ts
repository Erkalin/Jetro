import type { ThemeChoice } from '@/types';

export const THEME_KEY = 'jetro-theme';

export function normalizeTheme(v: any): ThemeChoice {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function readInitialTheme(): ThemeChoice {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {}
  return 'light';
}
