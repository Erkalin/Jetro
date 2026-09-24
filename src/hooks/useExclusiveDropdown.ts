import { useEffect, useRef, type RefObject } from 'react';

// Only one dropdown open at a time.
const EXCLUSIVE_DROPDOWN_EVENT = 'jetro:dropdown-open';

export function notifyDropdownOpened(id: string) {
  window.dispatchEvent(new CustomEvent(EXCLUSIVE_DROPDOWN_EVENT, { detail: id }));
}

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

// Close on outside click.
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
