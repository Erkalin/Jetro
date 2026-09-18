import type { SpeedSample } from '@/hooks/useSpeedHistory';

/**
 * Cross-restart persistence for the session speed history sampled in
 * useSpeedHistory. Without this, quit → relaunch wipes every download's
 * analytics (average / peak / speed graph) because the hook only held them
 * in memory.
 *
 * On disk the history is a compact strided subset (timestamps stay exact, so
 * pause gaps still render flat) plus the peak. ETA smoothing state is NOT
 * stored — it reconverges within seconds of live sampling.
 *
 * Pure module (no React imports) so the round-trip can be unit-tested in Node.
 */

export const SPEED_HISTORY_KEY = 'jetro-speed-history-v1';
// Persisted resolution cap per download: full 1Hz samples stay in memory
// (up to 3h), disk keeps a strided subset covering the same window.
const SPEED_HISTORY_STORE_CAP = 1500;

interface StoredEntry {
  /** [t, bps, done] triples — compact for localStorage. */
  s: Array<[number, number, number]>;
  /** Peak speed seen (B/s). */
  p: number;
}

interface StoredPayload {
  v: number;
  data: Record<string, StoredEntry>;
}

export function downsampleForStore(arr: SpeedSample[]): Array<[number, number, number]> {
  if (arr.length <= SPEED_HISTORY_STORE_CAP) {
    return arr.map((s) => [s.t, Math.round(s.bps), s.done]);
  }
  const out: Array<[number, number, number]> = [];
  const stride = arr.length / (SPEED_HISTORY_STORE_CAP - 1);
  for (let i = 0; i < SPEED_HISTORY_STORE_CAP - 1; i++) {
    const s = arr[Math.min(arr.length - 1, Math.floor(i * stride))];
    out.push([s.t, Math.round(s.bps), s.done]);
  }
  const last = arr[arr.length - 1];
  out.push([last.t, Math.round(last.bps), last.done]);
  return out;
}

export function loadStoredHistory(
  storage: Pick<Storage, 'getItem'>,
  maxSamples: number,
): Map<string, { samples: SpeedSample[]; peak: number }> {
  const out = new Map<string, { samples: SpeedSample[]; peak: number }>();
  try {
    const raw = storage.getItem(SPEED_HISTORY_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    if (!parsed || typeof parsed !== 'object' || parsed.data == null || typeof parsed.data !== 'object') {
      return out;
    }
    for (const [id, entry] of Object.entries(parsed.data)) {
      if (typeof id !== 'string' || !id || entry == null || typeof entry !== 'object') continue;
      const rec = entry as Partial<StoredEntry>;
      if (!Array.isArray(rec.s)) continue;
      const samples: SpeedSample[] = [];
      for (const pt of rec.s) {
        if (!Array.isArray(pt) || pt.length < 3) continue;
        const t = Number(pt[0]);
        const bps = Number(pt[1]);
        const done = Number(pt[2]);
        if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(bps) || !Number.isFinite(done)) continue;
        samples.push({ t: Math.round(t), bps: Math.max(0, Math.round(bps)), done: Math.max(0, done) });
      }
      if (samples.length === 0) continue;
      samples.sort((a, b) => a.t - b.t);
      const storedPeak = Number(rec.p);
      const peak = Math.max(
        Number.isFinite(storedPeak) ? Math.max(0, Math.round(storedPeak)) : 0,
        samples.reduce((a, s) => Math.max(a, s.bps), 0),
      );
      out.set(id, { samples: samples.slice(-Math.max(1, maxSamples)), peak });
    }
  } catch {
    // Corrupt / unavailable storage: start fresh, never crash the app.
  }
  return out;
}

export function saveStoredHistory(
  storage: Pick<Storage, 'setItem'>,
  samples: ReadonlyMap<string, SpeedSample[]>,
  peaks: ReadonlyMap<string, number>,
  /** Only ids in this set are written — stale ids (removed downloads) die here. */
  aliveIds: ReadonlySet<string>,
): void {
  const data: Record<string, StoredEntry> = {};
  for (const [id, arr] of samples) {
    if (!aliveIds.has(id) || arr.length === 0) continue;
    data[id] = { s: downsampleForStore(arr), p: Math.round(peaks.get(id) || 0) };
  }
  storage.setItem(SPEED_HISTORY_KEY, JSON.stringify({ v: 1, data } satisfies StoredPayload));
}
