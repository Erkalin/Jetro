export const hasBackend = () => typeof window !== 'undefined' && !!window.jetro;

/** Open an https URL in the OS browser (Electron) or a new tab (web preview). */
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

// OS file icon — same icon File Explorer shows, via Electron app.getFileIcon.
// Module-level cache by extension: backend already caches by ext, this avoids
// N IPC round-trips per list paint for files sharing an extension.
export const iconCache = new Map<string, string | null>();

export function iconCacheKey(savePath: string, filename: string): string {
  const base = (savePath || filename || 'file.bin').toLowerCase();
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i) : '.bin';
}
