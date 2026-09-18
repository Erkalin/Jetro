import { useEffect, useRef, type RefObject } from 'react';

/**
 * App-wide "only one dropdown open" coordination.
 *
 * Custom dropdowns (ThemePicker, LanguagePicker, …) each keep their own local
 * `open` state, so without coordination two of them can be visible at once.
 * This hook wires them together via a window CustomEvent:
 * - call `notifyDropdownOpened(id)` *before* setting your own `open=true`
 *   so the previously open dropdown closes first, then yours opens.
 * - while open, listen for other dropdowns opening and close yourself.
 */

const EXCLUSIVE_DROPDOWN_EVENT = 'jetro:dropdown-open';

export function notifyDropdownOpened(id: string) {
  window.dispatchEvent(new CustomEvent(EXCLUSIVE_DROPDOWN_EVENT, { detail: id }));
}

/**
 * Close this dropdown when any *other* exclusive dropdown opens.
 * `onClose` is stored in a ref so the listener stays stable.
 */
export default function useExclusiveDropdown(id: string, open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) {
        onCloseRef.current();
      }
    };
    window.addEventListener(EXCLUSIVE_DROPDOWN_EVENT, handler);
    return () => window.removeEventListener(EXCLUSIVE_DROPDOWN_EVENT, handler);
  }, [open, id]);
}

/**
 * Close an open dropdown when the user clicks/taps anywhere outside its root
 * element. Uses a document-level `pointerdown` listener so it works regardless
 * of stacking contexts (unlike a fixed-position backdrop div, which breaks
 * inside ancestors with backdrop-filter/transform and also swallows the click
 * needed to switch directly from one dropdown to another).
 */
export function useDismissOnOutsideClick(
  rootRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open, rootRef]);
}
