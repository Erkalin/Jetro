import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

export function guessNameFromUrl(url: string): string {
  const tryParse = (candidate: string) => {
    const u = new URL(candidate);
    const base = decodeURIComponent(u.pathname.split('/').pop() || '').split('?')[0];
    if (base && base.includes('.')) return base.replace(/[<>:"/\\|?*]/g, '_');
    return null;
  };
  try {
    const name = tryParse(url);
    if (name) return name;
  } catch {}
  try {
    const name = tryParse(`https://${url}`);
    if (name) return name;
  } catch {}
  return 'download.bin';
}

/**
 * Direct-file extensions: pasting one of these is a plain file download,
 * not a video/audio page (yt-dlp also handles direct media, but the
 * segmented engine is faster and needs no Detect step).
 */
const DIRECT_FILE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst',
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appx', 'msix',
  'iso', 'img', 'cab',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'srt', 'ass',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff',
  'psd', 'ai', 'eps', 'ttf', 'otf', 'woff', 'woff2', 'eot',
  'epub', 'mobi', 'azw', 'azw3', 'fb2',
  'mp4', 'webm', 'mkv', 'm4v', 'avi', 'mov',
  'mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'wav', 'flac',
  'torrent',
]);

export function isVideoPageUrl(raw: string): boolean {
  const s = String(raw || '').toLowerCase();
  return /(youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|dailymotion\.|twitch\.tv|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)\//.test(s)
    || /(youtube\.com|youtu\.be)/.test(s);
}

/**
 * Page-like links with no direct downloadable file (php/html/no extension/…
 * — anything not ending in a known file extension) that are not already known
 * video pages. These are treated as plain file downloads, but the dialog
 * offers an optional yt-dlp "Is this a video/audio page?" detect step — when
 * a video/audio is resolved the file name is renamed to the detected title.
 */
export function isPotentialVideoPageUrl(raw: string): boolean {
  const input = String(raw || '').trim();
  if (!input) return false;
  if (isVideoPageUrl(input)) return false;
  let pathname = '';
  try {
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)
      ? input
      : input.startsWith('//')
        ? `https:${input}`
        : `https://${input}`;
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    pathname = u.pathname || '';
  } catch {
    return false;
  }
  const last = pathname.split('/').pop() || '';
  const m = /\.([a-z0-9]{2,5})$/i.exec(last);
  if (m && DIRECT_FILE_EXTS.has(m[1].toLowerCase())) return false;
  return true;
}

export function sanitizeVideoFilename(title: string, ext: string): string {
  const clean = String(title || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'video';
  const e = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  return clean.toLowerCase().endsWith('.' + e.toLowerCase()) ? clean : `${clean}.${e}`;
}

export function isValidDownloadHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');
  if (!h || h.length > 253) return false;
  if (h === 'localhost') return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    return h.split('.').every((p) => {
      if (!p || p.length > 3 || !/^\d+$/.test(p)) return false;
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
  if (h.includes(':')) {
    return /^[0-9a-f:]+$/i.test(h) && h.includes(':');
  }
  if (!h.includes('.')) return false;
  if (h.includes('_') || h.includes(' ') || h.includes('/')) return false;
  const labels = h.split('.');
  if (labels.some((l) => !l || l.length > 63)) return false;
  const labelRe = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => labelRe.test(l))) return false;
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/[a-z]/.test(tld)) return false;
  return true;
}

/**
 * Accept bare domains (e.g. `abcdef.xyz/file.zip`) as well as full URLs.
 * Missing scheme defaults to https://. Throws a user-facing error otherwise.
 */
export function normalizeDownloadUrl(raw: string, m: AppStrings['urlError'] = en.urlError): string {
  const input = String(raw || '').trim();
  if (!input) throw new Error(m.empty);
  if (input.length > 2048 || /\s/.test(input)) {
    throw new Error(m.invalid);
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
  if (!hasScheme) {
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(input);
    if (schemeMatch) {
      const scheme = schemeMatch[1];
      const after = input.slice(schemeMatch[0].length);
      // Don't mistake host:port for a scheme (localhost:3000/x, example.com:8080/x).
      const looksLikeHostPort =
        /^\d+(\/|$|\?|#)/.test(after) || scheme.includes('.') || scheme.toLowerCase() === 'localhost';
      if (!looksLikeHostPort) {
        throw new Error(m.scheme);
      }
    }
  }
  const candidate = hasScheme ? input : input.startsWith('//') ? `https:${input}` : `https://${input}`;
  // Guard against WHATWG URL parsing all-numeric hosts as IPv4
  // (e.g. "123.456" becomes 123.0.1.200): reject numeric hosts that
  // aren't valid 4-part IPv4 before parsing.
  let rawHost = candidate.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  if (rawHost.startsWith('[')) {
    const end = rawHost.indexOf(']');
    rawHost = end === -1 ? rawHost : rawHost.slice(1, end);
  } else if (!rawHost.includes(':') || /:\d*$/.test(rawHost)) {
    rawHost = rawHost.replace(/:\d*$/, '');
  }
  if (!rawHost.includes(':') && /^[\d.]+$/.test(rawHost)) {
    const parts = rawHost.split('.');
    const validIpv4 =
      parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    if (!validIpv4) {
      throw new Error(m.invalid);
    }
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new Error(m.invalid);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(m.scheme);
  }
  if (!u.hostname || !isValidDownloadHost(u.hostname)) {
    throw new Error(m.invalid);
  }
  return candidate;
}

export const FILENAME_FALLBACK = 'download.bin';

/** Extension (format) of a file name, lowercased and without the dot. '' if none. */
export function extOf(name: string): string {
  const base = (name.split(/[\\/]/).pop() || '').trim();
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

// Chrome Web Store plugin used to export a fresh cookies.txt while logged in.
export const COOKIE_EXPORTER_URL = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
// Full list of video/audio sites downloadable via yt-dlp (linked from New Download).
export const SUPPORTED_SITES_URL = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md';
