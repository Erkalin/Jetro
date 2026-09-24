import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@/types';
import { loadStoredHistory, saveStoredHistory } from '@/lib/speedHistoryStore';

export interface SpeedSample {
  t: number;
  bps: number;
  done: number;
}

export interface SpeedStats {
  samples: SpeedSample[];
  avg: number;
  peak: number;
  etaBps: number;
  etaSec: number | null;
}

const MAX_SAMPLES = 10800;
const SAMPLE_MS = 1000;
const PERSIST_MIN_MS = 5000;
// Pause gap threshold for zero anchor.
const RESUME_ANCHOR_GAP_MS = 2000;
// Long stable + short responsive ETA windows.
const ETA_WINDOW_MS = 10000;
const ETA_MIN_SPAN_MS = 3000;
const ETA_SHORT_WINDOW_MS = 3500;
const ETA_SHORT_MIN_SPAN_MS = 1500;

function progressRate(arr: SpeedSample[], windowMs: number, minSpanMs: number): number {
  const n = arr.length;
  if (n < 2) return 0;
  const last = arr[n - 1];
  const cutoff = last.t - windowMs;
  let first = arr[0];
  for (const s of arr) {
    if (s.t >= cutoff) {
      first = s;
      break;
    }
  }
  const spanMs = last.t - first.t;
  if (spanMs < minSpanMs) return 0;
  const delta = last.done - first.done;
  if (delta <= 0) return 0;
  return delta / (spanMs / 1000);
}

// Samples live items at 1Hz, persists across restarts. ETA from byte
// progress (short + long window), smoothed.
export default function useSpeedHistory(items: Item[]) {
  const samplesRef = useRef(new Map<string, SpeedSample[]>());
  const peaksRef = useRef(new Map<string, number>());
  const etaBpsRef = useRef(new Map<string, number>());
  const etaSecRef = useRef(new Map<string, number>());
  const [, setTick] = useState(0);
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
    }
  }
  // Skip cleanup on first run (list resolves async).
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
        if (last && done < last.done - 1) {
          etaBpsRef.current.delete(it.id);
          etaSecRef.current.delete(it.id);
        }
        let next = [...arr];
        if (last && last.bps === 0 && bps > 0 && now - last.t > RESUME_ANCHOR_GAP_MS) {
          next.push({ t: now, bps: 0, done });
        }
        next.push({ t: now, bps, done });
        while (next.length > MAX_SAMPLES) next.shift();
        samplesRef.current.set(it.id, next);

        if (total > 0) {
          const remaining = Math.max(0, total - done);
          if (remaining <= 0) {
            etaSecRef.current.delete(it.id);
            etaBpsRef.current.delete(it.id);
          } else {
            const longRate = progressRate(next, ETA_WINDOW_MS, ETA_MIN_SPAN_MS);
            const shortRate = progressRate(next, ETA_SHORT_WINDOW_MS, ETA_SHORT_MIN_SPAN_MS);
            let rate = shortRate > 0 ? shortRate : longRate;
            if (!(rate > 0)) {
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
              let responsiveBps = smoothBps;
              if (shortRate > responsiveBps) responsiveBps = shortRate;
              const doneFrac = total > 0 ? done / total : 0;
              if ((doneFrac >= 0.92 || remaining / responsiveBps < 10) && bps > responsiveBps) {
                responsiveBps = bps;
              }
              const target = remaining / Math.max(1, responsiveBps);
              const prevSec = etaSecRef.current.get(it.id);
              let smoothSec: number;
              if (prevSec == null) {
                smoothSec = target;
              } else if (target < prevSec) {
                const downAlpha = target < 5 ? 1 : target < 10 ? 0.85 : 0.55;
                smoothSec = prevSec + (target - prevSec) * downAlpha;
                const ceiling = target + (target < 10 ? 2 : target * 0.3 + 2);
                if (smoothSec > ceiling) smoothSec = ceiling;
              } else {
                smoothSec = prevSec + (target - prevSec) * 0.15;
              }
              etaSecRef.current.set(it.id, Math.max(0, smoothSec));
            }
          }
        }
        dirty = true;
      }
    }
    if (dirty) {
      setTick((t) => t + 1);
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
