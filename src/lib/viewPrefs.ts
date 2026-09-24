import type { DetailColId, ViewMode } from '@/types';

export const DETAIL_COLS_DEFAULT: DetailColId[] = ['name', 'status', 'size', 'speed', 'eta', 'lastTry', 'queue'];

const DETAIL_COLS_PREVIOUS_DEFAULT: DetailColId[] = ['name', 'queue', 'status', 'size', 'speed', 'eta', 'lastTry'];

export const DETAIL_WIDTHS_DEFAULT: Record<DetailColId, number> = {
  name: 260,
  queue: 180,
  status: 130,
  size: 160,
  speed: 150,
  eta: 110,
  lastTry: 170,
};

// Previous speed width, for migration.
const SPEED_WIDTH_PREVIOUS_DEFAULT = 110;

export const DETAIL_MIN_WIDTH: Record<DetailColId, number> = {
  name: 140,
  queue: 120,
  status: 90,
  size: 110,
  speed: 90,
  eta: 80,
  lastTry: 130,
};

export const VIEW_MODE_KEY = 'jetro-view-mode';
export const DETAIL_LAYOUT_KEY = 'jetro-details-cols';

export function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'details' ? 'details' : 'cards';
  } catch {
    return 'cards';
  }
}

export function readDetailLayout(): { order: DetailColId[]; widths: Record<DetailColId, number> } {
  const fallback = { order: [...DETAIL_COLS_DEFAULT], widths: { ...DETAIL_WIDTHS_DEFAULT } };
  try {
    const raw = localStorage.getItem(DETAIL_LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { order?: unknown; widths?: unknown };
    const order = Array.isArray(parsed.order)
      ? (parsed.order.filter((c): c is DetailColId => (DETAIL_COLS_DEFAULT as string[]).includes(String(c))) as DetailColId[])
      : [];
    const seen = new Set<DetailColId>();
    const clean: DetailColId[] = [];
    for (const c of order) {
      if (!seen.has(c)) {
        seen.add(c);
        clean.push(c);
      }
    }
    for (const c of DETAIL_COLS_DEFAULT) {
      if (!seen.has(c)) clean.push(c);
    }
    const widths = { ...DETAIL_WIDTHS_DEFAULT };
    let storedSpeed: number | undefined;
    if (parsed.widths && typeof parsed.widths === 'object') {
      for (const c of DETAIL_COLS_DEFAULT) {
        const w = Number((parsed.widths as Record<string, unknown>)[c]);
        if (Number.isFinite(w)) {
          widths[c] = Math.min(600, Math.max(DETAIL_MIN_WIDTH[c], Math.round(w)));
        }
      }
      const rawSpeed = Number((parsed.widths as Record<string, unknown>).speed);
      if (Number.isFinite(rawSpeed)) storedSpeed = Math.round(rawSpeed);
    }
    // Migrate untouched layouts to new defaults.
    if (
      clean.join('|') === DETAIL_COLS_PREVIOUS_DEFAULT.join('|') &&
      (storedSpeed === undefined || storedSpeed === SPEED_WIDTH_PREVIOUS_DEFAULT)
    ) {
      return fallback;
    }
    // Bump old stored widths to new defaults.
    try {
      const w = parsed.widths as Record<string, unknown> | undefined;
      if (Number(w?.queue) === 140) widths.queue = 180;
      if (Number(w?.status) === 110) widths.status = 130;
      if (Number(w?.speed) === 90) widths.speed = 150;
      if (Number(w?.eta) === 90) widths.eta = 110;
      if (Number(w?.lastTry) === 140) widths.lastTry = 170;
    } catch {}
    return { order: clean, widths };
  } catch {
    return fallback;
  }
}
