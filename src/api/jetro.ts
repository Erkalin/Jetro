export const hasBackend = () => typeof window !== 'undefined' && !!window.jetro;

export async function openExternalUrl(url: string) {
  try {
    if (window.jetro?.openExternal) {
      await window.jetro.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener');
  } catch {
    try { window.open(url, '_blank', 'noopener'); } catch {}
  }
}

// Extension-keyed icon cache.
export const iconCache = new Map<string, string | null>();

export function iconCacheKey(savePath: string, filename: string): string {
  const base = (savePath || filename || 'file.bin').toLowerCase();
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i) : '.bin';
}
