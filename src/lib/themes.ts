import type { ThemeId } from '@/types';

export type ThemeBase = 'light' | 'dark';

export interface ThemeDef {
  id: ThemeId;
  base: ThemeBase;
  palette: [string, string, string];
  themeColor: string;
}

/** Picker order. */
export const THEME_IDS: ThemeId[] = [
  'jetro',
  'midnight',
  'system',
  'gray',
  'silver',
  'crimson',
  'coral',
  'amber',
  'teal',
  'navy',
  'turquoise',
  'indigo',
  'aqua',
  'nord',
  'dracula',
  'solarized',
  'forest',
  'blossom',
  'espresso',
  'lavender',
  'ember',
  'pistachio',
  'ruby',
  'scarlet',
  'gold',
  'hunter',
  'clover',
];

const DEFS: Record<ThemeId, ThemeDef> = {
  jetro: { id: 'jetro', base: 'light', palette: ['#ffffff', '#1976d2', '#42a5f5'], themeColor: '#f2f7fd' },
  midnight: { id: 'midnight', base: 'dark', palette: ['#080f20', '#60a5fa', '#93c5fd'], themeColor: '#080f20' },
  system: { id: 'system', base: 'light', palette: ['#ffffff', '#080f20', '#1976d2'], themeColor: '#f2f7fd' },
  gray: { id: 'gray', base: 'dark', palette: ['#1f2430', '#9aa4b2', '#5b6472'], themeColor: '#1f2430' },
  silver: { id: 'silver', base: 'light', palette: ['#f4f6f9', '#8a94a6', '#c3cad6'], themeColor: '#eef1f6' },
  crimson: { id: 'crimson', base: 'dark', palette: ['#160a12', '#f43f5e', '#fb7185'], themeColor: '#160a12' },
  coral: { id: 'coral', base: 'light', palette: ['#fff7f2', '#f97362', '#fb7185'], themeColor: '#fff1ea' },
  amber: { id: 'amber', base: 'light', palette: ['#fffbf0', '#b45309', '#fbbf24'], themeColor: '#fef3c7' },
  teal: { id: 'teal', base: 'dark', palette: ['#062a2a', '#2dd4bf', '#5eead4'], themeColor: '#062a2a' },
  navy: { id: 'navy', base: 'dark', palette: ['#0a1633', '#3b82f6', '#60a5fa'], themeColor: '#0a1633' },
  turquoise: { id: 'turquoise', base: 'light', palette: ['#f0fdfa', '#0d9488', '#2dd4bf'], themeColor: '#ccfbf1' },
  indigo: { id: 'indigo', base: 'dark', palette: ['#12102e', '#818cf8', '#a5b4fc'], themeColor: '#12102e' },
  aqua: { id: 'aqua', base: 'light', palette: ['#f0f9ff', '#0284c7', '#38bdf8'], themeColor: '#e0f2fe' },
  nord: { id: 'nord', base: 'dark', palette: ['#2e3440', '#88c0d0', '#81a1c1'], themeColor: '#2e3440' },
  dracula: { id: 'dracula', base: 'dark', palette: ['#282a36', '#bd93f9', '#ff79c6'], themeColor: '#282a36' },
  solarized: { id: 'solarized', base: 'light', palette: ['#fdf6e3', '#268bd2', '#2aa198'], themeColor: '#fdf6e3' },
  forest: { id: 'forest', base: 'dark', palette: ['#0b1f16', '#22c55e', '#4ade80'], themeColor: '#0b1f16' },
  blossom: { id: 'blossom', base: 'light', palette: ['#fff5f7', '#ec4899', '#f472b6'], themeColor: '#ffe4ec' },
  espresso: { id: 'espresso', base: 'dark', palette: ['#1a130e', '#d29a5b', '#b07a3f'], themeColor: '#1a130e' },
  lavender: { id: 'lavender', base: 'light', palette: ['#f5f3ff', '#8b5cf6', '#a78bfa'], themeColor: '#ede9fe' },
  ember: { id: 'ember', base: 'dark', palette: ['#220f06', '#fb923c', '#f97316'], themeColor: '#220f06' },
  pistachio: { id: 'pistachio', base: 'light', palette: ['#f7fee7', '#65a30d', '#84cc16'], themeColor: '#ecfccb' },
  ruby: { id: 'ruby', base: 'dark', palette: ['#1d0808', '#ef4444', '#f87171'], themeColor: '#1d0808' },
  scarlet: { id: 'scarlet', base: 'light', palette: ['#fff5f5', '#dc2626', '#ef4444'], themeColor: '#fee2e2' },
  gold: { id: 'gold', base: 'light', palette: ['#fefce8', '#ca8a04', '#facc15'], themeColor: '#fef9c7' },
  hunter: { id: 'hunter', base: 'dark', palette: ['#060f0a', '#15803d', '#22c55e'], themeColor: '#060f0a' },
  clover: { id: 'clover', base: 'light', palette: ['#f0fdf4', '#15803d', '#22c55e'], themeColor: '#dcfce7' },
};

const ID_SET = new Set<string>(THEME_IDS);

const LEGACY_IDS: Record<string, ThemeId> = { light: 'jetro', dark: 'midnight' };

export function normalizeThemeId(v: unknown): ThemeId {
  if (typeof v === 'string') {
    if (ID_SET.has(v)) return v as ThemeId;
    if (v in LEGACY_IDS) return LEGACY_IDS[v];
  }
  return 'system';
}

export function getThemeDef(id: ThemeId): ThemeDef {
  return DEFS[id] ?? DEFS.system;
}

export function themeBaseOf(id: ThemeId): ThemeBase {
  return getThemeDef(id).base;
}

export function isDarkThemeId(id: ThemeId): boolean {
  return id !== 'system' && themeBaseOf(id) === 'dark';
}
