// ---------- Context-menu viewport clamping ----------
// Menus open exactly at the right-click point. The anchor itself is clamped so
// it always stays inside the viewport, then keepCtxMenuInViewport (measured
// after mount via useContextMenuNudge) shifts the real menu back inside when
// it would overflow near the right/bottom edge. CSS max-height + overflow-y
// keeps any taller content scrollable instead of clipped.
//
// NOTE: do NOT pre-clamp against the tallest scrollable size (e.g. 560px):
// the queue menu is small (~150-200px), so that pushed it far above/left of
// the cursor even with plenty of space below.
const CTX_MARGIN = 8;

/** After mount, nudge the rendered menu back inside the viewport (covers font
 *  scaling / dynamic content taller than the estimate). Mutates style only. */
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

/** Clamped viewport position for opening a menu at a right-click event. */
export function menuAnchor(e: { clientX: number; clientY: number }, _itemMenu?: boolean): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: e.clientX, y: e.clientY };
  return {
    x: Math.max(CTX_MARGIN, Math.min(e.clientX, window.innerWidth - CTX_MARGIN)),
    y: Math.max(CTX_MARGIN, Math.min(e.clientY, window.innerHeight - CTX_MARGIN)),
  };
}
