import { useCallback, useEffect, useRef, useState } from 'react';

// List zoom factor, persisted.
export const ZOOM_KEY = 'jetro.zoom';
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1;

export function clampZoom(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
}

function readInitialZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    if (raw != null) return clampZoom(Number(raw));
  } catch {}
  return ZOOM_DEFAULT;
}

function persistZoom(factor: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(clampZoom(factor)));
  } catch {}
}

export default function useZoom() {
  const [zoom, setZoomState] = useState<number>(() => readInitialZoom());
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const setZoom = useCallback(async (factor: number) => {
    const next = clampZoom(factor);
    zoomRef.current = next;
    setZoomState(next);
    persistZoom(next);
    return next;
  }, []);

  const zoomIn = useCallback(async () => {
    const next = clampZoom(Math.round((zoomRef.current + ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoomState(next);
    persistZoom(next);
    return next;
  }, []);

  const zoomOut = useCallback(async () => {
    const next = clampZoom(Math.round((zoomRef.current - ZOOM_STEP) * 100) / 100);
    zoomRef.current = next;
    setZoomState(next);
    persistZoom(next);
    return next;
  }, []);

  const resetZoom = useCallback(async () => {
    zoomRef.current = ZOOM_DEFAULT;
    setZoomState(ZOOM_DEFAULT);
    persistZoom(ZOOM_DEFAULT);
    return ZOOM_DEFAULT;
  }, []);

  return { zoom, setZoom, zoomIn, zoomOut, resetZoom, zoomPct: Math.round(zoom * 100) };
}
