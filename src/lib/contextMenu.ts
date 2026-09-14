// ---------- Context-menu viewport clamping ----------
// Menus are positioned at the click point, but near the right/bottom edge that
// would push them outside the window. Clamp the anchor so the menu (at its
// tallest scrollable size) always fits, then CSS max-height + overflow-y keeps
// any taller content scrollable instead of clipped.
export const CTX_MARGIN = 8;

export function ctxCssMaxHeight(itemMenu: boolean): number {
  if (typeof window === 'undefined') return 560;
  const vhCap = window.innerHeight - CTX_MARGIN * 2;
  if (itemMenu) return Math.max(120, Math.min(560, window.innerHeight * 0.7, vhCap));
  return Math.max(120, Math.min(560, vhCap));
}

export function clampCtxPos(clientX: number, clientY: number, w: number, h: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(w, Math.max(120, vw - CTX_MARGIN * 2));
  const ch = Math.min(h, Math.max(120, vh - CTX_MARGIN * 2));
  return {
    x: Math.max(CTX_MARGIN, Math.min(clientX, vw - cw - CTX_MARGIN)),
    y: Math.max(CTX_MARGIN, Math.min(clientY, vh - ch - CTX_MARGIN)),
  };
}

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

// Estimated menu widths (px), matching styles/menus.css: the queue menu sizes
// to content (~230px); the item menu has min-width 264px (.ctx-menu-item).
const CTX_QUEUE_MENU_W = 230;
const CTX_ITEM_MENU_W = 264;

/** Clamped viewport position for opening a menu at a right-click event. */
export function menuAnchor(e: { clientX: number; clientY: number }, itemMenu: boolean): { x: number; y: number } {
  return clampCtxPos(e.clientX, e.clientY, itemMenu ? CTX_ITEM_MENU_W : CTX_QUEUE_MENU_W, ctxCssMaxHeight(itemMenu));
}
