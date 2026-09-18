import type { ThemeChoice } from '@/types';
import { getThemeDef, normalizeThemeId, themeBaseOf } from '@/lib/themes';

export const THEME_KEY = 'jetro-theme';

export function normalizeTheme(v: any): ThemeChoice {
  return normalizeThemeId(v);
}

export function readInitialTheme(): ThemeChoice {
  try {
    return normalizeThemeId(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** Effective light/dark mode for a theme choice (system follows the OS). */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') {
    try {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch {}
    return 'light';
  }
  return themeBaseOf(choice);
}

/** Resolved <html data-theme> value: custom themes use their own id, system resolves to jetro/midnight. */
export function resolveDataTheme(choice: ThemeChoice): string {
  if (choice === 'system') return resolveTheme(choice) === 'dark' ? 'midnight' : 'jetro';
  return choice;
}

/** Meta theme-color for a choice (system resolves via OS like resolveTheme). */
export function themeColorOf(choice: ThemeChoice): string {
  if (choice === 'system') return getThemeDef(resolveDataTheme(choice) as ThemeChoice).themeColor;
  return getThemeDef(choice).themeColor;
}
