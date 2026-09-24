export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'checkbox', 'range', 'color', 'file'].includes(el.type);
  }
  return true;
}

export interface ShortcutDef {
  id: string;
  keys: string;
  label: string;
  hint: string;
}

export function resolveShortcut(
  items: Record<string, { label: string; hint: string } | undefined> | undefined,
  fallback: ShortcutDef,
): ShortcutDef {
  const localized = items?.[fallback.id];
  if (!localized) return fallback;
  return {
    ...fallback,
    label: localized.label || fallback.label,
    hint: localized.hint || fallback.hint,
  };
}

export const APP_SHORTCUTS: ShortcutDef[] = [
  { id: 'new-download', keys: 'Ctrl + N', label: 'New download', hint: 'Open the New Download dialog' },
  { id: 'new-batch', keys: 'Ctrl + Shift + N', label: 'New batch download', hint: 'Open the batch dialog (* pattern)' },
  { id: 'search', keys: 'Ctrl + F', label: 'Search downloads', hint: 'Focus the search box' },
  { id: 'settings', keys: 'Ctrl + ,', label: 'Settings', hint: 'Open app settings' },
  { id: 'select-all', keys: 'Ctrl + A', label: 'Select all', hint: 'Select every download in the current filter' },
  { id: 'multiselect', keys: 'Ctrl + Click / Shift + Click', label: 'Multi-select', hint: 'Toggle one / select a visible range' },
  { id: 'delete', keys: 'Delete', label: 'Remove selected', hint: 'Ask to remove the selected download(s) (Backspace works too)' },
  { id: 'delete-file', keys: 'Shift + Delete', label: 'Delete file(s)', hint: 'Ask to remove + delete the file(s) from disk' },
  { id: 'pause-resume', keys: 'Space', label: 'Pause / Resume', hint: 'Pause or resume each selected download' },
  { id: 'pause-resume-all', keys: 'Ctrl + P', label: 'Pause / Resume selection', hint: 'Same as Space; with nothing selected, pauses whatever is downloading' },
  { id: 'rename', keys: 'F2', label: 'Rename', hint: 'Rename the focused download' },
  { id: 'properties', keys: 'Enter', label: 'Properties', hint: 'Show properties of the focused download' },
  { id: 'analytics', keys: 'A / Shift + Enter', label: 'Analytics', hint: 'Open download analytics for the focused download' },
  { id: 'refresh', keys: 'F5', label: 'Refresh', hint: 'Re-check the focused download' },
  { id: 'navigate', keys: '↑ / ↓ (+ Shift)', label: 'Select', hint: 'Move selection (Shift extends it) through the list' },
  { id: 'zoom-in', keys: 'Ctrl + +', label: 'Zoom list in', hint: 'Enlarge the downloads list only' },
  { id: 'zoom-out', keys: 'Ctrl + −', label: 'Zoom list out', hint: 'Shrink the downloads list only' },
  { id: 'zoom-reset', keys: 'Ctrl + 0', label: 'Reset list zoom', hint: 'Downloads list back to 100%' },
  { id: 'close', keys: 'Esc', label: 'Close / Deselect', hint: 'Close dialog, menu, or clear selection' },
  { id: 'help', keys: '?', label: 'Shortcuts', hint: 'Show this list' },
];
