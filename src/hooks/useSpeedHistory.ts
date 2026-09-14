import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@/types';
import { loadStoredHistory, saveStoredHistory } from '@/lib/speedHistoryStore';

export interface SpeedSample {
  t: number;
  bps: number;
  /** Cumulative downloaded bytes at sample time (for progress-based ETA rate). */
  done: number;
}

export interface SpeedStats {
  samples: SpeedSample[];
  /** Mean of the non-zero samples (0 when nothing recorded yet). */
  avg: number;
  /** Highest speed seen this session. */
  peak: number;
  /** Stabilized progress-based rate used for ETA (B/s, 0 when unknown). */
  etaBps: number;
  /** Stabilized seconds remaining (null = unknown). */
  etaSec: number | null;
}

// Ring-buffer per download: up to 3 hours at one sample per second.
// The graph offers 1m / 5m / 15m / 30m / 1h / 2h / All timeline filters over
// this window, so logging stays bounded instead of growing forever.
const MAX_SAMPLES = 10800;
const SAMPLE_MS = 1000;
// localStorage writes are throttled: broadcasts arrive up to 10Hz, but a
// snapshot every few seconds + a flush on hide/quit loses nothing visible.
const PERSIST_MIN_MS = 5000;
// Gap longer than this between the trailing stop-zero and the next live sample
// means the download was paused in between: insert a zero anchor at resume time
// so the graph stays flat at zero across the pause and then jumps vertically,
// instead of drawing a diagonal ramp from stop time to resume time.
const RESUME_ANCHOR_GAP_MS = 2000;
// ETA uses a much longer delay window than the 1s speed display so brief
// stalls/surges barely move it: rate = bytes progressed over up to 20s.
const ETA_WINDOW_MS = 20000;
const ETA_MIN_SPAN_MS = 4000;

/** Bytes progressed per second over the trailing ETA window (0 if unusable). */
function progressRate(arr: SpeedSample[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  const last = arr[n - 1];
  const cutoff = last.t - ETA_WINDOW_MS;
  let first = arr[0];
  for (const s of arr) {
    if (s.t >= cutoff) {
      first = s;
      break;
    }
  }
  const spanMs = last.t - first.t;
  if (spanMs < ETA_MIN_SPAN_MS) return 0;
  const delta = last.done - first.done;
  if (delta <= 0) return 0;
  return delta / (spanMs / 1000);
}

/**
 * Session speed history for every active download. Samples are taken from the
 * live `items` array (fed by backend `dl:update` broadcasts), throttled to one
 * sample per second per download.
 *
 * History survives quit → relaunch: samples + peaks persist to localStorage
 * (throttled + flushed on hide) and hydrate on mount, so the analytics view
 * keeps average / peak / graph across restarts. ETA smoothing reconverges
 * live within seconds and is intentionally not stored.
 *
 * ETA state is derived from actual byte progress over a long (~20s) window —
 * not from the instantaneous speed — then smoothed asymmetrically (fast to
 * follow speed-ups, slow to follow slow-downs) so the countdown glides
 * instead of jumping. Smoothing steps are gated to sample pushes (1Hz), so
 * the 10Hz broadcast rate can't accelerate convergence.
 *
 * Sampling notes:
 * - Sample arrays are replaced (never mutated in place) so consumers memoizing
 *   on the `samples` reference (e.g. SpeedGraph) reliably recompute.
 * - When a download leaves the active state (paused / stopped / completed /
 *   error) a trailing zero-speed sample is appended immediately so the graph
 *   drops straight to zero instead of freezing at the last live speed.
 *   History is kept — the line just sits flat at zero.
 * - When it resumes after a pause, a zero anchor is inserted at resume time
 *   first, so the graph jumps straight up from 0 instead of ramping
 *   diagonally across the paused gap.
 */
export default function useSpeedHistory(items: Item[]) {
  const samplesRef = useRef(new Map<string, SpeedSample[]>());
  const peaksRef = useRef(new Map<string, number>());
  const etaBpsRef = useRef(new Map<string, number>());
  const etaSecRef = useRef(new Map<string, number>());
  // Bumped whenever samples change so the graph re-renders even if the
  // backend sends no further `dl:update` broadcasts after a stop.
  const [, setTick] = useState(0);
  // Hydrate pre-restart history exactly once (before the first effect run).
  const hydratedRef = useRef(false);
  if (!hydratedRef.current) {
    hydratedRef.current = true;
    try {
      const stored = loadStoredHistory(localStorage, MAX_SAMPLES);
      for (const [id, entry] of stored) {
        samplesRef.current.set(id, entry.samples);
        peaksRef.current.set(id, entry.peak);
      }
    } catch {
      // Storage unavailable: session-only history, same as before.
    }
  }
  // Run counter: run #1 always sees the initial empty list (list() resolves
  // async), so stale-id cleanup + persistence only kick in from run #2 —
  // otherwise a fresh launch would wipe hydrated history before the real
  // download list arrives.
  const runRef = useRef(0);
  const aliveIdsRef = useRef<Set<string>>(new Set());
  aliveIdsRef.current = new Set(items.map((i) => i.id));
  const lastPersistRef = useRef(0);

  const persistNow = useCallback(() => {
    if (runRef.current < 2) return;
    try {
      saveStoredHistory(localStorage, samplesRef.current, peaksRef.current, aliveIdsRef.current);
      lastPersistRef.current = Date.now();
    } catch {
      // Quota / privacy mode: keep running with memory-only history.
    }
  }, []);

  // Flush the latest history when the page hides or the app quits
  // (synchronous localStorage write — survives window close).
  useEffect(() => {
    const flush = () => persistNow();
    const onVis = () => {
      if (document.visibilityState === 'hidden') persistNow();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [persistNow]);

  useEffect(() => {
    runRef.current += 1;
    const firstRun = runRef.current === 1;
    const now = Date.now();
    const alive = aliveIdsRef.current;
    if (!firstRun) {
      for (const id of [...samplesRef.current.keys()]) {
        if (!alive.has(id)) {
          samplesRef.current.delete(id);
          peaksRef.current.delete(id);
          etaBpsRef.current.delete(id);
          etaSecRef.current.delete(id);
        }
      }
    }
    let dirty = false;
    for (const it of items) {
      const isActive = it.status === 'downloading' || it.status === 'merging';
      if (!isActive) {
        // Trailing zero so a stopped/paused/completed download visibly drops
        // to zero. Pushed immediately (no 1Hz throttle) and only once — after
        // the first zero, last.bps === 0 so nothing more is appended.
        const prev = samplesRef.current.get(it.id);
        if (prev && prev.length > 0) {
          const plast = prev[prev.length - 1];
          if (plast.bps !== 0) {
            const done = Math.max(0, Number(it.downloadedBytes) || 0);
            const next = [...prev, { t: now, bps: 0, done }];
            while (next.length > MAX_SAMPLES) next.shift();
            samplesRef.current.set(it.id, next);
            dirty = true;
          }
        }
        continue;
      }
      const bps = Math.max(0, Number(it.speedBps) || 0);
      const done = Math.max(0, Number(it.downloadedBytes) || 0);
      const total = Math.max(0, Number(it.totalBytes) || 0);
      const arr = samplesRef.current.get(it.id) || [];
      const last = arr[arr.length - 1];
      peaksRef.current.set(it.id, Math.max(peaksRef.current.get(it.id) || 0, bps));
      if (!last || now - last.t >= SAMPLE_MS) {
        // Progress counter reset (redownload/retry from zero): old smoothing
        // describes a different transfer — drop it so ETA snaps fresh.
        if (last && done < last.done - 1) {
          etaBpsRef.current.delete(it.id);
          etaSecRef.current.delete(it.id);
        }
        let next = [...arr];
        // Resume after a pause: hold the flat zero line up to right now, then
        // the live sample below draws the straight vertical jump from 0.
        if (last && last.bps === 0 && bps > 0 && now - last.t > RESUME_ANCHOR_GAP_MS) {
          next.push({ t: now, bps: 0, done });
        }
        next.push({ t: now, bps, done });
        while (next.length > MAX_SAMPLES) next.shift();
        samplesRef.current.set(it.id, next);

        // --- stabilized ETA update (1Hz) ---
        if (total > 0) {
          const remaining = Math.max(0, total - done);
          if (remaining <= 0) {
            etaSecRef.current.delete(it.id);
          } else {
            let rate = progressRate(next);
            if (!(rate > 0)) {
              // Warm-up (<4s of history): fall back to live speed, then session avg.
              if (bps > 0) {
                rate = bps;
              } else {
                let sum = 0;
                let cnt = 0;
                for (const s of next) {
                  if (s.bps > 0) {
                    sum += s.bps;
                    cnt++;
                  }
                }
                rate = cnt > 0 ? sum / cnt : 0;
              }
            }
            if (rate > 0) {
              const prevBps = etaBpsRef.current.get(it.id);
              const smoothBps =
                prevBps == null ? rate : prevBps + (rate - prevBps) * (rate >= prevBps ? 0.4 : 0.12);
              etaBpsRef.current.set(it.id, smoothBps);
              const target = remaining / smoothBps;
              const prevSec = etaSecRef.current.get(it.id);
              const smoothSec =
                prevSec == null
                  ? target
                  : prevSec + (target - prevSec) * (target < prevSec ? 0.5 : 0.15);
              etaSecRef.current.set(it.id, Math.max(0, smoothSec));
            }
          }
        }
        dirty = true;
      }
    }
    if (dirty) {
      setTick((t) => t + 1);
      // Persist at most every few seconds — broadcasts arrive up to 10Hz.
      if (now - lastPersistRef.current >= PERSIST_MIN_MS) persistNow();
    }
  }, [items, persistNow]);

  const getStats = useCallback((id: string): SpeedStats => {
    const samples = samplesRef.current.get(id) || [];
    const peak = peaksRef.current.get(id) || 0;
    const nz = samples.filter((s) => s.bps > 0);
    const avg = nz.length ? Math.round(nz.reduce((a, s) => a + s.bps, 0) / nz.length) : 0;
    return {
      samples,
      avg,
      peak,
      etaBps: Math.round(etaBpsRef.current.get(id) || 0),
      etaSec: etaSecRef.current.has(id) ? etaSecRef.current.get(id)! : null,
    };
  }, []);

  return getStats;
}
