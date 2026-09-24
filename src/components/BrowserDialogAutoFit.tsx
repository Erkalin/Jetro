import { useEffect } from 'react';

// Auto-height for the standalone browser-download window.
export default function BrowserDialogAutoFit() {
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!window.location.hash.startsWith('#browser-download')) return;
      if (typeof window.jetro?.resizeBrowserDialog !== 'function') return;
    } catch {
      return;
    }

    let raf = 0;
    let lastSent = 0;
    let disposed = false;

    const send = (h: number) => {
      const v = Math.ceil(h);
      if (!v || v < 50 || v > 3000) return;
      if (Math.abs(v - lastSent) < 1.5) return;
      lastSent = v;
      try {
        window.jetro?.resizeBrowserDialog?.(v);
      } catch {}
    };

    const measure = () => {
      if (disposed) return;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (disposed) return;
        try {
          const modal = document.querySelector('.browser-modal.bare');
          const fit =
            document.querySelector('.browser-modal.bare .bd-fit') ||
            document.querySelector('.browser-standalone');
          if (!modal || !fit) return;
          const cs = window.getComputedStyle(modal);
          const pad =
            (parseFloat((cs as CSSStyleDeclaration).paddingTop || '0') || 0) +
            (parseFloat((cs as CSSStyleDeclaration).paddingBottom || '0') || 0);
          const h = (fit as HTMLElement).getBoundingClientRect().height + pad;
          send(h);
        } catch {}
      });
    };

    measure();
    const ro: ResizeObserver | null =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    try {
      if (ro && document.body) ro.observe(document.body);
    } catch {}
    const t1 = window.setTimeout(measure, 120);
    const t2 = window.setTimeout(measure, 500);
    try {
      (document as any)?.fonts?.ready?.then(() => measure()).catch(() => {});
    } catch {}
    window.addEventListener('resize', measure);
    return () => {
      disposed = true;
      if (raf) {
        try {
          window.cancelAnimationFrame(raf);
        } catch {}
        raf = 0;
      }
      try {
        ro?.disconnect();
      } catch {}
      try {
        window.clearTimeout(t1);
      } catch {}
      try {
        window.clearTimeout(t2);
      } catch {}
      try {
        window.removeEventListener('resize', measure);
      } catch {}
    };
  }, []);
  return null;
}
