import { useEffect } from 'react';

/**
 * Runs `onEscape` when the user presses Escape while `active` is true.
 *
 * Behavior-preserving replacement for the repeated
 * `useEffect + window.addEventListener('keydown')` blocks: the listener is
 * only subscribed while `active`, and it always sees the latest state because
 * the effect re-subscribes on every render (same as an effect without a dep
 * array). Call sites stay in the same order so overlapping dialogs keep their
 * existing Escape priority.
 */
export default function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
