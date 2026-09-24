const CTX_MARGIN = 8;

// Nudge menu back inside viewport after mount.
export function keepCtxMenuInViewport(el: HTMLElement | null) {
  if (!el || typeof window === 'undefined') return;
  const r = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.right > window.innerWidth - CTX_MARGIN) dx = window.innerWidth - CTX_MARGIN - r.right;
  if (r.bottom > window.innerHeight - CTX_MARGIN) dy = window.innerHeight - CTX_MARGIN - r.bottom;
  if (r.left < CTX_MARGIN) dx = CTX_MARGIN - r.left;
  if (r.top < CTX_MARGIN) dy = CTX_MARGIN - r.top;
  if (dx) el.style.left = `${r.left + dx}px`;
  if (dy) el.style.top = `${r.top + dy}px`;
  if (el.getBoundingClientRect().height > window.innerHeight - CTX_MARGIN * 2) {
    el.style.maxHeight = `${window.innerHeight - CTX_MARGIN * 2}px`;
  }
}

export function menuAnchor(e: { clientX: number; clientY: number }, _itemMenu?: boolean): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: e.clientX, y: e.clientY };
  return {
    x: Math.max(CTX_MARGIN, Math.min(e.clientX, window.innerWidth - CTX_MARGIN)),
    y: Math.max(CTX_MARGIN, Math.min(e.clientY, window.innerHeight - CTX_MARGIN)),
  };
}
