import { useLayoutEffect, useRef, type DependencyList } from 'react';
import { keepCtxMenuInViewport } from '@/lib/contextMenu';

/**
 * Ref + auto-nudge for a right-click menu: after the menu mounts (or `extra`
 * deps change, e.g. queue count changing the menu height), measure the real
 * size and nudge it back inside the viewport. The menu stays scrollable via
 * CSS so bottom options are always reachable.
 */
export default function useContextMenuNudge<T>(menu: T | null, extra: DependencyList = []) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (menu) keepCtxMenuInViewport(ref.current);
    // `extra` lets callers re-nudge when content height changes without
    // the menu identity changing (e.g. queues list growing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, ...extra]);
  return ref;
}
