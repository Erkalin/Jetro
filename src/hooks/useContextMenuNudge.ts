import { useLayoutEffect, useRef, type DependencyList } from 'react';
import { keepCtxMenuInViewport } from '@/lib/contextMenu';

// Keep mounted menu inside the viewport.
export default function useContextMenuNudge<T>(menu: T | null, extra: DependencyList = []) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (menu) keepCtxMenuInViewport(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, ...extra]);
  return ref;
}
