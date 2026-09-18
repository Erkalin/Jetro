import type { DetailColId, ViewMode } from '@/types';

// ---------- Downloads list viewing mode (cards vs explorer-like details) ----------
export const DETAIL_COLS_DEFAULT: DetailColId[] = ['name', 'status', 'size', 'speed', 'eta', 'lastTry', 'queue'];

// Previous default order (before the reorder to Progress … Queue). Used for a
// one-time migration of untouched layouts in readDetailLayout below.
const DETAIL_COLS_PREVIOUS_DEFAULT: DetailColId[] = ['name', 'queue', 'status', 'size', 'speed', 'eta', 'lastTry'];

export const DETAIL_WIDTHS_DEFAULT: Record<DetailColId, number> = {
  name: 260,
  queue: 180,
  status: 110,
  size: 160,
  speed: 90,
  eta: 90,
  lastTry: 140,
};

// Previous default speed width (before it was slimmed down). Used for migration.
const SPEED_WIDTH_PREVIOUS_DEFAULT = 110;

export const DETAIL_MIN_WIDTH: Record<DetailColId, number> = {
  name: 140,
  queue: 120,
  status: 80,
  size: 110,
  speed: 70,
  eta: 70,
  lastTry: 110,
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
    // Keep every column exactly once, appending any missing (forward-compat).
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
    // One-time migration: layouts the user never customized (still exactly
    // the previous default order + speed width) are upgraded to the new
    // defaults so the new order (Queue last) and slimmer speed column apply.
    // Any user-customized layout (reordered / resized) is left untouched.
    if (
      clean.join('|') === DETAIL_COLS_PREVIOUS_DEFAULT.join('|') &&
      (storedSpeed === undefined || storedSpeed === SPEED_WIDTH_PREVIOUS_DEFAULT)
    ) {
      return fallback;
    }
    // One-time upgrade: the queue column default widened 140 → 180 so the
    // queue dropdown fits in both English and Persian. Only stored layouts
    // still on the old 140 default are bumped; resized columns are kept.
    try {
      const rawQueue = Number((parsed.widths as Record<string, unknown>)?.queue);
      if (rawQueue === 140) widths.queue = 180;
    } catch {}
    return { order: clean, widths };
  } catch {
    return fallback;
  }
}
