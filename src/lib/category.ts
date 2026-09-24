export type CategoryDirKey = 'video' | 'music' | 'documents' | 'archives' | 'software' | 'others';

export const CATEGORY_DIR_KEYS: CategoryDirKey[] = [
  'video',
  'music',
  'documents',
  'archives',
  'software',
  'others',
];

export function isCategoryDirKey(v: unknown): v is CategoryDirKey {
  return (
    v === 'video' ||
    v === 'music' ||
    v === 'documents' ||
    v === 'archives' ||
    v === 'software' ||
    v === 'others'
  );
}

function extOfFilename(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

export function categoryDirKeyForFilename(filename: string): CategoryDirKey {
  const ext = extOfFilename(filename).toLowerCase();
  const dot = ext ? `.${ext}` : '';
  if (['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m3u8', '.mpd'].includes(dot)) return 'video';
  if (['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.opus', '.wma'].includes(dot)) return 'music';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(dot)) return 'archives';
  if (['.pdf', '.doc', '.docx', '.txt', '.epub'].includes(dot)) return 'documents';
  if (['.exe', '.msi', '.dmg', '.apk'].includes(dot)) return 'software';
  return 'others';
}

export function normalizeCategoryDirs(raw: unknown): Record<CategoryDirKey, string> {
  const out = {} as Record<CategoryDirKey, string>;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of CATEGORY_DIR_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) {
        const s = v.trim();
        out[k] = /^[a-zA-Z]:$/.test(s) ? `${s}\\` : s;
      }
    }
  }
  return out;
}

export function getCategoryDir(
  settings: unknown,
  key: CategoryDirKey,
): string {
  try {
    const dirs = (settings as { categoryDirs?: Record<string, unknown> })?.categoryDirs;
    const v = dirs?.[key];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
