import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FiArchive, FiArrowDown, FiBox, FiCheckCircle, FiChevronDown, FiClipboard,
  FiClock, FiCpu, FiDisc, FiDownloadCloud, FiEdit2, FiExternalLink, FiFileText, FiFilm,
  FiFolder, FiGlobe, FiGrid, FiHardDrive, FiInbox, FiInfo, FiLayers, FiList, FiMonitor, FiMoon, FiMusic, FiPause, FiPlay,
  FiPlus, FiRefreshCw, FiRotateCcw, FiSettings, FiSquare, FiSun, FiTool, FiTrash2, FiX, FiXCircle, FiZap,
} from 'react-icons/fi';
import { MdExtension } from 'react-icons/md';

// Served from public/ (single copy in dist) instead of bundling a duplicate.
const jetroLogo = './Jetro-notext.png';

interface Item {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: string;
  speedBps: number;
  connections: number;
  supportsRange: boolean;
  error?: string;
  category: string;
  queueId?: string | null;
  via?: string;
  videoHeight?: number;
  audioOnly?: boolean;
  totalBytesIsEstimate?: boolean;
  createdAt?: number;
  /** Last attempt timestamp (backend). Falls back to createdAt for old rows. */
  lastTryAt?: number;
  attempts?: number;
  nextRetryAt?: number | null;
  subtitles?: boolean;
}
function fmtSize(n: number, estimated?: boolean) {
  const s = fmtBytes(n);
  return estimated && n ? `~${s}` : s;
}

type QueuePowerAction = 'nothing' | 'sleep' | 'hibernate' | 'shutdown' | 'restart';
const QUEUE_POWER_OPTIONS: { value: QueuePowerAction; label: string }[] = [
  { value: 'nothing', label: 'Do nothing' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'hibernate', label: 'Hibernate' },
  { value: 'shutdown', label: 'Shutdown' },
  { value: 'restart', label: 'Restart' },
];
function normalizeQueuePowerAction(v: any): QueuePowerAction {
  return v === 'sleep' || v === 'hibernate' || v === 'shutdown' || v === 'restart' ? v : 'nothing';
}
function queuePowerLabel(v: any): string {
  const a = normalizeQueuePowerAction(v);
  return QUEUE_POWER_OPTIONS.find((o) => o.value === a)?.label || 'Do nothing';
}

interface Queue {
  id: string;
  name: string;
  running: boolean;
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
  afterComplete?: QueuePowerAction;
  powerFiredAt?: number | null;
}

function fmtBytes(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
function fmtSpeed(bps: number) {
  if (!bps) return '0 KB/s';
  return fmtBytes(bps) + '/s';
}
/** 0–100 progress of an item (same math as the card progress bar). */
function itemPct(it: Item): number {
  if (!it.totalBytes) return 0;
  return Math.min(100, (it.downloadedBytes / it.totalBytes) * 100);
}
/** Details-view Status column: "Completed" or a 2-decimal percentage. */
function fmtDetailStatus(it: Item): string {
  if (it.status === 'completed') return 'Completed';
  return `${itemPct(it).toFixed(2)}%`;
}
/** Details-view Size column: downloaded + overall size ("12.5 MB / 100 MB"). */
function fmtDetailSize(it: Item): string {
  if (it.status === 'completed') {
    const total = it.totalBytes || it.downloadedBytes;
    return total ? fmtBytes(total) : '—';
  }
  const total = it.totalBytes || 0;
  const done = it.downloadedBytes || 0;
  if (!total) return done ? `${fmtBytes(done)} / —` : '—';
  return `${done ? fmtBytes(done) : '0 B'} / ${fmtSize(total, !!it.totalBytesIsEstimate)}`;
}
/** Effective "last try" timestamp (backend field, createdAt fallback). */
function lastTryOf(it: Item): number {
  const t = Number((it as any)?.lastTryAt) || Number((it as any)?.createdAt) || 0;
  return t > 0 ? t : 0;
}
/** Details-view Last Try column: month + day + 24h time ("Sep 11 14:05:09"). */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtLastTry(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTH_SHORT[d.getMonth()]} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtLastTryTitle(ts: number): string {
  if (!ts) return 'Never tried yet';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'Never tried yet';
  return d.toLocaleString();
}
function statusLabel(status: string) {
  switch (status) {
    case 'downloading': return 'Downloading';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'paused': return 'Paused';
    case 'queued': return 'Queued';
    case 'merging': return 'Merging';
    default: return status;
  }
}
function statusColor(status: string) {
  // Theme-aware via CSS vars so statuses stay readable on light + dark glass.
  switch (status) {
    case 'downloading': return 'var(--green)';
    case 'completed': return 'var(--accent)';
    case 'error': return 'var(--red)';
    case 'paused': return 'var(--amber)';
    default: return 'var(--muted)';
  }
}

// ---------- Queue schedules: strict 24-hour HH:MM ----------
const TIME_24H_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const QUEUE_SCHED_DEFAULT_START = '22:00';
const QUEUE_SCHED_DEFAULT_STOP = '07:00';
/** Normalize user input to HH:MM 24h ("2:5" → "02:05"). Returns '' when invalid. */
function normalizeTime24h(v: unknown): string {
  const s = String(v ?? '').trim();
  if (TIME_24H_RE.test(s)) return s;
  const m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isInteger(h) && Number.isInteger(min) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  return '';
}
/** Drop the removed global-scheduler keys so old settings files never mark the form dirty. */
function stripGlobalScheduler(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const c: any = { ...s };
  delete c.schedulerEnabled;
  delete c.schedulerStart;
  delete c.schedulerStop;
  return c;
}

// ---------- Settings dropdown options ----------
// Per-file connection presets (1–32). Shared by Settings, New Download and Batch.
const CONNECTION_OPTIONS = [1, 4, 8, 16, 32];
// Speed limit presets in KB/s (0 = unlimited).
const SPEED_LIMIT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Unlimited' },
  { value: 100, label: '100 KB/s' },
  { value: 256, label: '256 KB/s' },
  { value: 512, label: '512 KB/s' },
  { value: 1024, label: '1 MB/s' },
  { value: 2048, label: '2 MB/s' },
  { value: 5120, label: '5 MB/s' },
  { value: 10240, label: '10 MB/s' },
];
function speedLimitLabel(kbps: number): string {
  const v = Math.max(0, Math.round(Number(kbps) || 0));
  if (!v) return 'Unlimited';
  if (v >= 1024 && v % 1024 === 0) return `${v / 1024} MB/s`;
  return `${v} KB/s`;
}
/** Display value for the Connections dropdown; falls back to 8 for legacy garbage. */
function normalizeConnectionOption(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 8;
}

type ThemeChoice = 'light' | 'dark' | 'system';
const THEME_KEY = 'jetro-theme';
function normalizeTheme(v: any): ThemeChoice {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}
function readInitialTheme(): ThemeChoice {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}
function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {}
  return 'light';
}

// ---------- Downloads list viewing mode (cards vs explorer-like details) ----------
type ViewMode = 'cards' | 'details';
type DetailColId = 'name' | 'queue' | 'status' | 'size' | 'speed' | 'eta' | 'lastTry';
const DETAIL_COLS_DEFAULT: DetailColId[] = ['name', 'queue', 'status', 'size', 'speed', 'eta', 'lastTry'];
const DETAIL_COL_LABELS: Record<DetailColId, string> = {
  name: 'File Name',
  queue: 'Queue',
  status: 'Status',
  size: 'Size',
  speed: 'Download Speed',
  eta: 'ETA',
  lastTry: 'Last Try',
};
const DETAIL_WIDTHS_DEFAULT: Record<DetailColId, number> = {
  name: 260,
  queue: 140,
  status: 110,
  size: 160,
  speed: 110,
  eta: 90,
  lastTry: 140,
};
const DETAIL_MIN_WIDTH: Record<DetailColId, number> = {
  name: 140,
  queue: 90,
  status: 80,
  size: 110,
  speed: 90,
  eta: 70,
  lastTry: 110,
};
function fmtEta(it: Item): string {
  if (it.status === 'completed') return '—';
  const sp = Number(it.speedBps || 0);
  if (sp <= 0 || !it.totalBytes) return '—';
  const sec = Math.max(0, Math.round((it.totalBytes - it.downloadedBytes) / sp));
  if (!Number.isFinite(sec)) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}
const VIEW_MODE_KEY = 'jetro-view-mode';
const DETAIL_LAYOUT_KEY = 'jetro-details-cols';
function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'details' ? 'details' : 'cards';
  } catch {
    return 'cards';
  }
}
function readDetailLayout(): { order: DetailColId[]; widths: Record<DetailColId, number> } {
  const fallback = { order: [...DETAIL_COLS_DEFAULT], widths: { ...DETAIL_WIDTHS_DEFAULT } };
  try {
    const raw = localStorage.getItem(DETAIL_LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { order?: unknown; widths?: unknown };
    const order = Array.isArray(parsed.order)
      ? (parsed.order.filter((c): c is DetailColId => (DETAIL_COLS_DEFAULT as string[]).includes(String(c))) as DetailColId[])
      : [];
    // Keep every column exactly once, appending any missing (forward-compat).
    const seen = new Set<DetailColId>();
    const clean: DetailColId[] = [];
    for (const c of order) {
      if (!seen.has(c)) {
        seen.add(c);
        clean.push(c);
      }
    }
    for (const c of DETAIL_COLS_DEFAULT) {
      if (!seen.has(c)) clean.push(c);
    }
    const widths = { ...DETAIL_WIDTHS_DEFAULT };
    if (parsed.widths && typeof parsed.widths === 'object') {
      for (const c of DETAIL_COLS_DEFAULT) {
        const w = Number((parsed.widths as Record<string, unknown>)[c]);
        if (Number.isFinite(w)) {
          widths[c] = Math.min(600, Math.max(DETAIL_MIN_WIDTH[c], Math.round(w)));
        }
      }
    }
    return { order: clean, widths };
  } catch {
    return fallback;
  }
}
function CategoryIcon({ cat, size = 20 }: { cat: string; size?: number }) {
  const map: Record<string, typeof FiBox> = {
    video: FiFilm,
    audio: FiMusic,
    compressed: FiArchive,
    document: FiFileText,
    program: FiCpu,
    other: FiBox,
  };
  const Icon = map[cat] || FiBox;
  return <Icon size={size} className="file-fallback-icon" />;
}
function guessNameFromUrl(url: string): string {
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

function isVideoPageUrl(raw: string): boolean {
  const s = String(raw || '').toLowerCase();
  return /(youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|dailymotion\.|twitch\.tv|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)\//.test(s)
    || /(youtube\.com|youtu\.be)/.test(s);
}

function sanitizeVideoFilename(title: string, ext: string): string {
  const clean = String(title || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'video';
  const e = String(ext || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  return clean.toLowerCase().endsWith('.' + e.toLowerCase()) ? clean : `${clean}.${e}`;
}

function isValidDownloadHost(hostname: string): boolean {
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
function normalizeDownloadUrl(raw: string): string {
  const input = String(raw || '').trim();
  if (!input) throw new Error('Please enter a download link.');
  if (input.length > 2048 || /\s/.test(input)) {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
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
        throw new Error('Only http:// and https:// links are supported.');
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
      throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
    }
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are supported.');
  }
  if (!u.hostname || !isValidDownloadHost(u.hostname)) {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
  }
  return candidate;
}

const FILENAME_FALLBACK = 'download.bin';

/** Extension (format) of a file name, lowercased and without the dot. '' if none. */
function extOf(name: string): string {
  const base = (name.split(/[\\/]/).pop() || '').trim();
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

const hasBackend = () => typeof window !== 'undefined' && !!window.jetro;

// ---------- New Batch Download helpers (pattern with * → many URLs) ----------
const BATCH_MAX_FILES = 200;
type BatchMode = 'numbers' | 'letters';

function padBatchNum(n: number, size: number): string {
  const s = String(n);
  if (s.length >= size) return s;
  return '0'.repeat(size - s.length) + s;
}

function expandBatchUrls(
  pattern: string,
  mode: BatchMode,
  fromNum: number,
  toNum: number,
  wildcardSize: number,
  fromLetter: string,
  toLetter: string,
): string[] {
  const out: string[] = [];
  if (!pattern.includes('*')) return out;
  if (mode === 'numbers') {
    for (let i = fromNum; i <= toNum; i++) {
      out.push(pattern.split('*').join(padBatchNum(i, wildcardSize)));
    }
  } else {
    const a = String(fromLetter || '').charCodeAt(0);
    const b = String(toLetter || '').charCodeAt(0);
    for (let c = a; c <= b; c++) {
      out.push(pattern.split('*').join(String.fromCharCode(c)));
    }
  }
  return out;
}

function isSingleLetter(s: string): boolean {
  return /^[A-Za-z]$/.test(String(s || ''));
}

/** Validate batch inputs. Returns expanded URLs or an error message. */
function validateBatchInput(
  pattern: string,
  mode: BatchMode,
  fromNumRaw: string,
  toNumRaw: string,
  wildcardRaw: string,
  fromLetterRaw: string,
  toLetterRaw: string,
): { urls?: string[]; error?: string } {
  const p = String(pattern || '').trim();
  if (!p) return { error: 'Please paste the address link.' };
  if (!p.includes('*')) return { error: 'The address must contain an asterisk (*) where the part number/letter goes.' };
  if (p.length > 2048 || /\s/.test(p)) return { error: 'Please enter a valid link (e.g. example.com/files/part_*.zip).' };
  if (mode === 'numbers') {
    if (!/^-?\d+$/.test(String(fromNumRaw).trim()) || !/^-?\d+$/.test(String(toNumRaw).trim())) {
      return { error: 'From and To accept numbers only.' };
    }
    if (!/^\d+$/.test(String(wildcardRaw).trim())) {
      return { error: 'Wildcard size accepts numbers only (1–10).' };
    }
    const from = parseInt(String(fromNumRaw).trim(), 10);
    const to = parseInt(String(toNumRaw).trim(), 10);
    const size = parseInt(String(wildcardRaw).trim(), 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'From and To accept numbers only.' };
    if (!Number.isFinite(size) || size < 1 || size > 10) return { error: 'Wildcard size must be between 1 and 10.' };
    if (from < 0 || to < 0) return { error: 'From and To must be 0 or higher.' };
    if (from > 999999 || to > 999999) return { error: 'From and To must be 999999 or lower.' };
    if (from > to) return { error: 'From must be less than or equal to To.' };
    const count = to - from + 1;
    if (count > BATCH_MAX_FILES) return { error: `Too many files (${count}). Narrow the range (max ${BATCH_MAX_FILES}).` };
    return { urls: expandBatchUrls(p, mode, from, to, size, '', '') };
  }
  const fl = String(fromLetterRaw || '').trim();
  const tl = String(toLetterRaw || '').trim();
  if (!isSingleLetter(fl) || !isSingleLetter(tl)) {
    return { error: 'From and To accept a single English letter (a–z).' };
  }
  const lowerFl = fl.toLowerCase() === fl;
  const lowerTl = tl.toLowerCase() === tl;
  if (lowerFl !== lowerTl) return { error: 'From and To must use the same case (a–z or A–Z).' };
  const a = fl.charCodeAt(0);
  const b = tl.charCodeAt(0);
  if (a > b) return { error: 'From must come before To in the alphabet.' };
  const count = b - a + 1;
  if (count > BATCH_MAX_FILES) return { error: `Too many files (${count}). Narrow the range (max ${BATCH_MAX_FILES}).` };
  return { urls: expandBatchUrls(p, mode, 0, 0, 1, fl, tl) };
}

function stepLetter(value: string, dir: 1 | -1): string {
  const s = String(value || '').trim();
  if (!isSingleLetter(s)) return dir > 0 ? 'a' : 'z';
  const isLower = s.toLowerCase() === s;
  const base = isLower ? 97 : 65;
  const top = base + 25;
  let c = s.charCodeAt(0) + dir;
  if (c < base) c = base;
  if (c > top) c = top;
  return String.fromCharCode(c);
}

// Chrome Web Store plugin used to export a fresh cookies.txt while logged in.
const COOKIE_EXPORTER_URL = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
// Full list of video/audio sites downloadable via yt-dlp (linked from New Download).
const SUPPORTED_SITES_URL = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md';
/** Open an https URL in the OS browser (Electron) or a new tab (web preview). */
async function openExternalUrl(url: string) {
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
const iconCache = new Map<string, string | null>();
function iconCacheKey(savePath: string, filename: string): string {
  const base = (savePath || filename || 'file.bin').toLowerCase();
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i) : '.bin';
}
function OsFileIcon({ item }: { item: Item }) {
  const key = iconCacheKey(item.savePath, item.filename);
  const [src, setSrc] = useState<string | null>(() => iconCache.get(key) ?? null);
  const [miss, setMiss] = useState(() => !iconCache.has(key));
  useEffect(() => {
    if (!miss) return;
    let alive = true;
    if (!hasBackend()) return;
    window
      .jetro!.getFileIcon(item.savePath, item.filename)
      .then((d) => {
        iconCache.set(key, d);
        if (alive) {
          setSrc(d);
          setMiss(false);
        }
      })
      .catch(() => {
        iconCache.set(key, null);
        if (alive) setMiss(false);
      });
    return () => {
      alive = false;
    };
  }, [key, miss, item.savePath, item.filename]);
  if (src) {
    return (
      <div className="file-icon">
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  return <div className="file-icon"><CategoryIcon cat={item.category} /></div>;
}

// ---------- Context-menu viewport clamping ----------
// Menus are positioned at the click point, but near the right/bottom edge that
// would push them outside the window. Clamp the anchor so the menu (at its
// tallest scrollable size) always fits, then CSS max-height + overflow-y keeps
// any taller content scrollable instead of clipped.
const CTX_MARGIN = 8;
function ctxCssMaxHeight(itemMenu: boolean): number {
  if (typeof window === 'undefined') return 560;
  const vhCap = window.innerHeight - CTX_MARGIN * 2;
  if (itemMenu) return Math.max(120, Math.min(560, window.innerHeight * 0.7, vhCap));
  return Math.max(120, Math.min(560, vhCap));
}
function clampCtxPos(clientX: number, clientY: number, w: number, h: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = Math.min(w, Math.max(120, vw - CTX_MARGIN * 2));
  const ch = Math.min(h, Math.max(120, vh - CTX_MARGIN * 2));
  return {
    x: Math.max(CTX_MARGIN, Math.min(clientX, vw - cw - CTX_MARGIN)),
    y: Math.max(CTX_MARGIN, Math.min(clientY, vh - ch - CTX_MARGIN)),
  };
}
/** After mount, nudge the rendered menu back inside the viewport (covers font
 *  scaling / dynamic content taller than the estimate). Mutates style only. */
function keepCtxMenuInViewport(el: HTMLElement | null) {
  if (!el || typeof window === 'undefined') return;
  const r = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.right > window.innerWidth - CTX_MARGIN) dx = window.innerWidth - CTX_MARGIN - r.right;
  if (r.bottom > window.innerHeight - CTX_MARGIN) dy = window.innerHeight - CTX_MARGIN - r.bottom;
  if (r.left < CTX_MARGIN) dx = CTX_MARGIN - r.left;
  if (r.top < CTX_MARGIN) dy = CTX_MARGIN - r.top;
  if (dx) el.style.left = `${r.left + dx}px`;
  if (dy) el.style.top = `${r.top + dy}px`;
  if (el.getBoundingClientRect().height > window.innerHeight - CTX_MARGIN * 2) {
    el.style.maxHeight = `${window.innerHeight - CTX_MARGIN * 2}px`;
  }
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // Downloads list viewing mode + explorer-like details column layout (persisted).
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode());
  const [detailLayout, setDetailLayout] = useState(() => readDetailLayout());
  const detailOrder = detailLayout.order;
  const detailWidths = detailLayout.widths;
  const dragColRef = useRef<DetailColId | null>(null);
  const [dropCol, setDropCol] = useState<DetailColId | null>(null);
  const resizeRef = useRef<{ col: DetailColId; startX: number; startW: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [filenameError, setFilenameError] = useState('');
  // Authoritative file name detected for the current link (via backend probe).
  const [probedFilename, setProbedFilename] = useState('');
  const [probedOk, setProbedOk] = useState(false);
  // Set when the user's file name changes the format vs. the detected one.
  const [pendingFormatConfirm, setPendingFormatConfirm] = useState<null | {
    url: string; finalName: string; detectedName: string; detExt: string; finalExt: string;
  }>(null);
  // True once the user manually edits the file name box (stops auto-fill).
  const filenameTouchedRef = useRef(false);
  // Mirror of showSettings for the tray-settings subscription (mounted once).
  const showSettingsRef = useRef(false);
  // Refs for the clipboard listener (registered once) + fill-on-open logic.
  const showAddRef = useRef(false);
  const newUrlRef = useRef('');
  const settingsRef = useRef<any>(null);
  const pendingClipboardRef = useRef('');
  const [newConns, setNewConns] = useState(8);
  const [savePath, setSavePath] = useState('');
  const [newQueueId, setNewQueueId] = useState('');
  const [adding, setAdding] = useState(false);
  // ---------- New Batch Download ----------
  const [showBatch, setShowBatch] = useState(false);
  const [batchUrl, setBatchUrl] = useState('');
  const [batchError, setBatchError] = useState('');
  const [batchMode, setBatchMode] = useState<BatchMode>('numbers');
  const [batchFromNum, setBatchFromNum] = useState('0');
  const [batchToNum, setBatchToNum] = useState('10');
  const [batchWildcard, setBatchWildcard] = useState('1');
  const [batchFromLetter, setBatchFromLetter] = useState('a');
  const [batchToLetter, setBatchToLetter] = useState('z');
  const [batchSavePath, setBatchSavePath] = useState('');
  const [batchConns, setBatchConns] = useState(8);
  const [batchStep, setBatchStep] = useState<1 | 2>(1);
  const [batchUrls, setBatchUrls] = useState<string[]>([]);
  const [batchRows, setBatchRows] = useState<BatchResolveRow[]>([]);
  const [batchResolving, setBatchResolving] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  // Video + audio (yt-dlp + ffmpeg, no quality cap): detected options for a page URL.
  // Progressive video entries carry a direct URL (segmented engine); split video
  // entries and all audio entries are downloaded by yt-dlp (needsMerge).
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoHint, setVideoHint] = useState('');
  const [videoDetail, setVideoDetail] = useState('');
  // Raw error log is hidden behind a "Show details" toggle (not pasted inline).
  const [showVideoDetail, setShowVideoDetail] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const [selectedVideoHeight, setSelectedVideoHeight] = useState(0);
  const [selectedVideoNeedsMerge, setSelectedVideoNeedsMerge] = useState(false);
  const [selectedVideoKind, setSelectedVideoKind] = useState<'video' | 'audio' | ''>('');
  const [selectedVideoExt, setSelectedVideoExt] = useState('');
  const [selectedVideoEstimatedBytes, setSelectedVideoEstimatedBytes] = useState(0);
  const [videoSubtitles, setVideoSubtitles] = useState(false);
  const [videoQueueId, setVideoQueueId] = useState('');
  const [playlist, setPlaylist] = useState<{ title: string; count: number; entries: PlaylistEntry[] } | null>(null);
  const [playlistSelected, setPlaylistSelected] = useState<Set<string>>(new Set());
  const [playlistAdding, setPlaylistAdding] = useState(false);
  // Manual cookies.txt (shown only after yt-dlp reports a login/cookie error).
  // Auto-resolve first: probe/download try without cookies; paste or pick a file to retry.
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesFile, setCookiesFile] = useState('');
  const [needsCookies, setNeedsCookies] = useState(false);
  const [cookieError, setCookieError] = useState('');
  const [binStatus, setBinStatus] = useState<BinaryStatus | null>(null);
  const [binRefreshing, setBinRefreshing] = useState(false);
  const [settings, setSettings] = useState<any>({ maxConnections: 8, maxConcurrentDownloads: 3, downloadDir: '', speedLimitKBps: 0, proxyMode: 'none', proxyType: 'http', proxyHost: '', proxyPort: 8080, proxyUser: '', proxyPass: '', proxyBypass: 'localhost,127.0.0.1,::1', closeAction: 'ask', theme: 'system', autoCaptureClipboard: true, autoRetryEnabled: true, maxRetries: 3, retryDelaySec: 5, checkUpdatesOnStart: true });
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string; updateAvailable: boolean; url: string; error?: string } | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  // Per-session dismissal for the update banner (reset when a newer tag appears).
  const [updateDismissed, setUpdateDismissed] = useState<string | null>(null);
  const showUpdateBanner = !!updateInfo?.updateAvailable && updateDismissed !== updateInfo.latest;

  // ---- dark mode (glass-blended): light / dark / system ----
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => readInitialTheme());
  const resolvedTheme = useMemo(() => resolveTheme(themeChoice), [themeChoice]);
  // Apply to <html data-theme> + persist locally (instant, no FOUC on next launch via index.html bootstrap).
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', resolvedTheme);
      localStorage.setItem(THEME_KEY, themeChoice);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolvedTheme === 'dark' ? '#080f20' : '#f2f7fd');
      else {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = resolvedTheme === 'dark' ? '#080f20' : '#f2f7fd';
        document.head.appendChild(m);
      }
    } catch {}
  }, [resolvedTheme, themeChoice]);
  // Follow the OS while in "system" mode.
  useEffect(() => {
    if (themeChoice !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      try {
        document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
      } catch {}
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeChoice]);
  const applyThemeChoice = (next: ThemeChoice) => {
    const clean = normalizeTheme(next);
    setThemeChoice(clean);
    try { localStorage.setItem(THEME_KEY, clean); } catch {}
    // Keep backend settings in sync so the choice survives reinstalls/profiles
    // and the native window can match. Fire-and-forget for the topbar toggle.
    setSettings((prev: any) => ({ ...prev, theme: clean }));
    setDraftSettings((prev: any) => (prev ? { ...prev, theme: clean } : prev));
    try { window.jetro?.saveSettings({ theme: clean })?.catch(() => {}); } catch {}
  };
  const toggleTheme = () => applyThemeChoice(resolvedTheme === 'dark' ? 'light' : 'dark');

  // Persist viewing mode + details column layout (order + widths).
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);
  useEffect(() => {
    try { localStorage.setItem(DETAIL_LAYOUT_KEY, JSON.stringify(detailLayout)); } catch {}
  }, [detailLayout]);
  const setViewModeAndPersist = (m: ViewMode) => setViewMode(m);
  const moveDetailCol = (from: DetailColId, to: DetailColId) => {
    if (from === to) return;
    setDetailLayout((prev) => {
      const order = [...prev.order];
      const fi = order.indexOf(from);
      const ti = order.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      order.splice(fi, 1);
      order.splice(ti, 0, from);
      return { ...prev, order };
    });
  };
  const beginColResize = (e: React.MouseEvent, col: DetailColId) => {
    e.preventDefault();
    e.stopPropagation();
    // Disable header dragging while resizing so the two gestures never fight.
    dragColRef.current = null;
    setDropCol(null);
    const startX = e.clientX;
    const startW = detailWidths[col] ?? DETAIL_WIDTHS_DEFAULT[col];
    resizeRef.current = { col, startX, startW };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.min(600, Math.max(DETAIL_MIN_WIDTH[r.col], Math.round(r.startW + (ev.clientX - r.startX))));
      setDetailLayout((prev) => (prev.widths[r.col] === next ? prev : { ...prev, widths: { ...prev.widths, [r.col]: next } }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const detailGridTemplate = useMemo(
    () => `${detailOrder.map((c) => `${detailWidths[c] ?? DETAIL_WIDTHS_DEFAULT[c]}px`).join(' ')} 96px`,
    [detailOrder, detailWidths],
  );

  // settings draft + unsaved-changes guard (draft is edited, `settings` stays saved until Save)
  const [draftSettings, setDraftSettings] = useState<any | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // queue context menu + modals
  const [ctx, setCtx] = useState<{ x: number; y: number; queueId: string | null } | null>(null);
  // download item right-click menu
  const [itemCtx, setItemCtx] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const itemMenuRef = useRef<HTMLDivElement | null>(null);
  const [renameState, setRenameState] = useState<{ id: string; name: string; error: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [propsId, setPropsId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [pendingQueueMove, setPendingQueueMove] = useState<string | null>(null);
  const [showQueueModal, setShowQueueModal] = useState<null | { mode: 'create' | 'edit'; queueId?: string }>(null);
  const [qName, setQName] = useState('');
  const [qNameError, setQNameError] = useState('');
  const [qSchedOn, setQSchedOn] = useState(false);
  const [qStart, setQStart] = useState(QUEUE_SCHED_DEFAULT_START);
  const [qStop, setQStop] = useState(QUEUE_SCHED_DEFAULT_STOP);
  const [qSchedError, setQSchedError] = useState('');
  const [qPower, setQPower] = useState<QueuePowerAction>('nothing');
  // Per-queue power countdown (60s, cancellable) after a queue fully completes.
  const [powerDialog, setPowerDialog] = useState<{ queueId: string; queueName: string; action: QueuePowerAction; secondsLeft: number } | null>(null);

  // toolbar selection + queue dropdowns
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueMenu, setQueueMenu] = useState<null | 'start' | 'stop'>(null);

  // remove / delete confirmation ({ id, deleteFile }: deleteFile removes the file from disk)
  const [pendingRemove, setPendingRemove] = useState<{ id: string; deleteFile: boolean } | null>(null);

  // file-exists collision: target file already on disk, ask replace / rename / cancel
  const [pendingCollision, setPendingCollision] = useState<null | {
    kind: 'file' | 'video'; url: string; filename: string; dir: string; queueId: string; height: number; videoKind?: 'video' | 'audio'; estimatedBytes?: number;
  }>(null);

  // X-button close prompt (styled in-app dialog; main process asked via IPC).
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [closeRemember, setCloseRemember] = useState(false);

  // download-complete popup queue (shows newest completions one at a time)
  const [completedQueue, setCompletedQueue] = useState<Item[]>([]);
  const seenCompletedRef = useRef<Set<string>>(new Set());
  // Becomes true once the initial download list has been seeded into
  // seenCompletedRef, so pre-existing completions never trigger a popup.
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (!hasBackend()) {
      initialLoadDoneRef.current = true;
      return;
    }
    const seedSeen = (list: Item[]) => {
      list.forEach((i) => {
        if (i.status === 'completed') seenCompletedRef.current.add(i.id);
      });
    };
    window.jetro!.list().then((initial) => {
      seedSeen(initial);
      initialLoadDoneRef.current = true;
      setItems(initial);
    }).catch(() => {
      initialLoadDoneRef.current = true;
    });
    window.jetro!.getSettings().then((s) => {
      setSettings(stripGlobalScheduler(s));
      // Backend wins on first load when it has an explicit theme;
      // otherwise keep the localStorage / OS choice already applied.
      const t = (s as any)?.theme;
      if (t === 'light' || t === 'dark' || t === 'system') {
        setThemeChoice(t);
        try { localStorage.setItem(THEME_KEY, t); } catch {}
      }
      // Update check on startup (default ON).
      if ((s as any)?.checkUpdatesOnStart !== false) {
        setUpdateChecking(true);
        window.jetro!.checkUpdate?.().then((r) => {
          if (r) setUpdateInfo(r);
        }).catch(() => {}).finally(() => setUpdateChecking(false));
      }
    }).catch(() => {});
    window.jetro!.listQueues().then(setQueues).catch(() => {});
    const off1 = window.jetro!.onUpdate((incoming) => {
      if (!initialLoadDoneRef.current) {
        // First live payload arrived before list() resolved — its completed
        // items are pre-existing, so seed them instead of popping up.
        seedSeen(incoming);
        initialLoadDoneRef.current = true;
      }
      setItems(incoming);
    });
    const off2 = window.jetro!.onQueues(setQueues);
    const off3 = window.jetro!.onClipboardUrl?.((url) => {
      // Autofill only when the New Download dialog is already open — never auto-open.
      // Buffer the latest push so opening the dialog later can still use it as fallback.
      pendingClipboardRef.current = url;
      if (!showAddRef.current) return;
      if (settingsRef.current && settingsRef.current.autoCaptureClipboard === false) return;
      if (newUrlRef.current.trim()) return; // don't clobber what the user is editing
      setNewUrl(url);
      setUrlError('');
      filenameTouchedRef.current = false;
    });
    // Tray menu can change settings (close button) — stay in sync.
    const off4 = window.jetro!.onSettingsChanged?.((s) => {
      const clean = stripGlobalScheduler(s);
      setSettings(clean);
      setDraftSettings((prev: any) => (showSettingsRef.current && prev ? stripGlobalScheduler({ ...prev, ...clean }) : prev));
      const t = (s as any)?.theme;
      if (t === 'light' || t === 'dark' || t === 'system') setThemeChoice(t);
    });
    // Main process X-button request — show the styled close dialog.
    const off5 = window.jetro!.onCloseRequest?.(() => {
      setCloseRemember(false);
      setShowClosePrompt(true);
    });
    // Per-queue power action fired (all items completed) — 60s countdown.
    const off6 = window.jetro!.onQueuePower?.((info) => {
      const action = normalizeQueuePowerAction((info as any)?.action);
      if (action === 'nothing') return;
      setPowerDialog({
        queueId: String((info as any)?.queueId || ''),
        queueName: String((info as any)?.queueName || 'Queue'),
        action,
        secondsLeft: 60,
      });
    });
    return () => {
      off1();
      off2();
      off3?.();
      off4?.();
      off5?.();
      off6?.();
    };
  }, []);
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    showAddRef.current = showAdd;
  }, [showAdd]);
  useEffect(() => {
    newUrlRef.current = newUrl;
  }, [newUrl]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);
  useEffect(() => {
    if (!itemCtx && !renameState && !propsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (renameState || propsId) return; // modals handle their own Escape
      setItemCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [itemCtx, renameState, propsId]);
  // Close the item menu if its download disappears.
  useEffect(() => {
    if (!itemCtx) return;
    if (!items.some((i) => i.id === itemCtx.itemId)) setItemCtx(null);
  }, [items, itemCtx]);
  // Keep both right-click menus fully inside the window: after mount, measure
  // the real height and nudge up/left when the click was near an edge. The
  // menus stay scrollable via CSS so bottom options are always reachable.
  useLayoutEffect(() => {
    if (ctx) keepCtxMenuInViewport(ctxMenuRef.current);
  }, [ctx]);
  useLayoutEffect(() => {
    if (itemCtx) keepCtxMenuInViewport(itemMenuRef.current);
  }, [itemCtx, queues.length]);

  // Detect newly completed downloads and queue a popup.
  // Downloads already completed before this session was loaded are seeded
  // into seenCompletedRef above, so only fresh completions pop up.
  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    const newly = items.filter((i) => i.status === 'completed' && !seenCompletedRef.current.has(i.id));
    if (newly.length) {
      newly.forEach((i) => seenCompletedRef.current.add(i.id));
      setCompletedQueue((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        return [...prev, ...newly.filter((n) => !prevIds.has(n.id))];
      });
    }
    // prune ids for removed items
    if (seenCompletedRef.current.size > 500) {
      const alive = new Set(items.map((i) => i.id));
      seenCompletedRef.current.forEach((id) => {
        if (!alive.has(id)) seenCompletedRef.current.delete(id);
      });
    }
  }, [items]);

  // 60s countdown for per-queue power actions; fires once at zero.
  useEffect(() => {
    if (!powerDialog) return;
    if (powerDialog.secondsLeft <= 0) {
      const qid = powerDialog.queueId;
      setPowerDialog(null);
      try { window.jetro?.powerExecute?.(qid)?.catch(() => {}); } catch {}
      return;
    }
    const t = setTimeout(() => {
      setPowerDialog((prev) => (prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : prev));
    }, 1000);
    return () => clearTimeout(t);
  }, [powerDialog]);

  // Escape dismisses the complete popup
  useEffect(() => {
    if (completedQueue.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompletedQueue((prev) => prev.slice(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [completedQueue.length]);

  const queueMap = useMemo(() => new Map(queues.map((q) => [q.id, q])), [queues]);
  const queueById = (id: string | null | undefined) => (id ? queueMap.get(id) : undefined);

  // Details sorting (header click toggles). Null = list order.
  const [sort, setSort] = useState<{ col: DetailColId | 'eta'; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const isQueue = filter.startsWith('queue:');
    const qid = isQueue ? filter.slice(6) : '';
    const list = items.filter((i) => {
      if (isQueue) {
        if ((i.queueId || null) !== qid) return false;
      } else {
        // Status filters
        if (filter === 'downloading' && i.status !== 'downloading') return false;
        if (filter === 'completed' && i.status !== 'completed') return false;
        if (filter === 'failed' && i.status !== 'error') return false;
        if (filter === 'paused' && i.status !== 'paused') return false;
        if (filter === 'queued' && i.status !== 'queued') return false;
        // Category filters
        if (filter === 'cat-video' && i.category !== 'video') return false;
        if (filter === 'cat-documents' && i.category !== 'document') return false;
        if (filter === 'cat-archives' && i.category !== 'compressed') return false;
        if (filter === 'cat-software' && i.category !== 'program') return false;
        if (filter === 'cat-others' && !(i.category === 'other' || i.category === 'audio')) return false;
      }
      if (q && !(i.filename + i.url).toLowerCase().includes(q)) return false;
      return true;
    });
    if (!sort) return list;
    const dir = sort.dir;
    const etaOf = (it: Item): number => {
      if (it.status === 'completed') return 0;
      const sp = Number(it.speedBps || 0);
      if (sp <= 0 || !it.totalBytes) return Number.POSITIVE_INFINITY;
      return Math.max(0, (it.totalBytes - it.downloadedBytes) / sp);
    };
    const val = (it: Item): number | string => {
      switch (sort.col) {
        case 'name': return (it.filename || '').toLowerCase();
        case 'queue': return (queueById(it.queueId)?.name || '').toLowerCase();
        case 'status': return itemPct(it);
        case 'size': return Number(it.totalBytes || it.downloadedBytes || 0);
        case 'speed': return Number(it.speedBps || 0);
        case 'lastTry': return lastTryOf(it);
        case 'eta': return etaOf(it);
        default: return 0;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
  }, [items, filter, query, sort, queues]);

  // Single-select: click selects one download, clicking it again deselects.
  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const totalSpeed = useMemo(
    () => items.reduce((a, b) => a + ((b.status === 'downloading' || b.status === 'merging') ? b.speedBps || 0 : 0), 0),
    [items]
  );
  const countMap = useMemo(() => {
    const m: Record<string, number> = {
      all: items.length,
      downloading: 0, completed: 0, failed: 0, paused: 0, queued: 0,
      'cat-video': 0, 'cat-documents': 0, 'cat-archives': 0, 'cat-software': 0, 'cat-others': 0,
    };
    const perQueue = new Map<string, number>();
    for (const i of items) {
      if (i.status === 'downloading' || i.status === 'merging') m.downloading++;
      else if (i.status === 'completed') m.completed++;
      else if (i.status === 'error') m.failed++;
      else if (i.status === 'paused') m.paused++;
      else if (i.status === 'queued') m.queued++;
      if (i.category === 'video') m['cat-video']++;
      else if (i.category === 'document') m['cat-documents']++;
      else if (i.category === 'compressed') m['cat-archives']++;
      else if (i.category === 'program') m['cat-software']++;
      else m['cat-others']++;
      const qk = `queue:${i.queueId || null}`;
      perQueue.set(qk, (perQueue.get(qk) || 0) + 1);
    }
    return { m, perQueue };
  }, [items]);
  const counts = (k: string) => {
    if (k in countMap.m) return countMap.m[k];
    if (k.startsWith('queue:')) {
      const qid = k.slice(6);
      // items with null queue are stored under "queue:null" but never queried as such
      if (!qid || qid === 'null') return items.filter((i) => !(i.queueId || null)).length;
      return countMap.perQueue.get(k) || 0;
    }
    return 0;
  };

  const chooseSaveFolder = async () => {
    if (!hasBackend()) return null;
    const picked = await window.jetro!.pickFolder(savePath || settings.downloadDir);
    if (picked) setSavePath(picked);
    return picked;
  };

  // ---------- New Batch Download logic ----------
  const batchValidation = useMemo(
    () => validateBatchInput(batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter),
    [batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter],
  );
  const batchPreviewUrls = useMemo(() => batchValidation.urls || [], [batchValidation]);
  const batchFirst = batchPreviewUrls[0] || '';
  const batchSecond = batchPreviewUrls[1] || batchPreviewUrls[0] || '';
  const batchLast = batchPreviewUrls.length ? batchPreviewUrls[batchPreviewUrls.length - 1] : '';
  const batchOkCount = useMemo(() => batchRows.filter((r) => r.ok).length, [batchRows]);
  const batchFailCount = useMemo(() => batchRows.filter((r) => !r.ok).length, [batchRows]);

  const openBatch = () => {
    setBatchUrl('');
    setBatchError('');
    setBatchMode('numbers');
    setBatchFromNum('0');
    setBatchToNum('10');
    setBatchWildcard('1');
    setBatchFromLetter('a');
    setBatchToLetter('z');
    setBatchSavePath(settings.downloadDir || '');
    setBatchConns(Math.min(32, Math.max(1, Number(settings.maxConnections) || 8)));
    setBatchStep(1);
    setBatchUrls([]);
    setBatchRows([]);
    setBatchResolving(false);
    setBatchAdding(false);
    setShowBatch(true);
  };

  const closeBatch = () => {
    if (batchResolving || batchAdding) return;
    setShowBatch(false);
    setBatchStep(1);
    setBatchError('');
    setBatchUrls([]);
    setBatchRows([]);
  };

  const runBatchResolve = async (urls: string[]) => {
    setBatchRows([]);
    if (!urls.length) return;
    setBatchResolving(true);
    try {
      if (hasBackend() && typeof (window.jetro as any)?.resolveBatch === 'function') {
        const rows = await (window.jetro as any).resolveBatch(urls);
        setBatchRows(Array.isArray(rows) ? rows : []);
      } else {
        // Web preview fallback: no probe, show URLs as pending rows.
        setBatchRows(
          urls.map((u) => ({
            url: u, ok: true, filename: guessNameFromUrl(u),
            totalBytes: 0, supportsRange: false, contentType: '',
          })),
        );
      }
    } catch (e: any) {
      setBatchError(e?.message || 'Could not resolve these links.');
    } finally {
      setBatchResolving(false);
    }
  };

  const handleBatchOk = async () => {
    const v = validateBatchInput(batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter);
    if (v.error || !v.urls || !v.urls.length) {
      setBatchError(v.error || 'Nothing to download.');
      return;
    }
    setBatchError('');
    setBatchUrls(v.urls);
    setBatchStep(2);
    await runBatchResolve(v.urls);
  };

  const handleBatchDownload = async () => {
    const valid = batchRows.filter((r) => r.ok).map((r) => r.url);
    const toAdd = valid.length ? valid : batchUrls;
    if (!toAdd.length) {
      setBatchError('Nothing to download.');
      return;
    }
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    setBatchAdding(true);
    setBatchError('');
    try {
      const folder = (batchSavePath || settings.downloadDir || '').trim();
      if (typeof (window.jetro as any)?.addBatch === 'function') {
        const res = await (window.jetro as any).addBatch(toAdd, { dir: folder || undefined, connections: batchConns });
        // Jump to the new batch queue so its files aren't mixed with the rest.
        if (res?.queueId) setFilter(`queue:${res.queueId}`);
      } else {
        // Fallback for old preload: own queue, then add one by one, lowest first.
        const host = (() => {
          try { return new URL(toAdd[0]).hostname.replace(/^www\./i, ''); } catch { return ''; }
        })();
        const q = await window.jetro!.createQueue(
          host ? `Batch – ${host} (${toAdd.length} files)`.slice(0, 60) : `Batch (${toAdd.length} files)`,
        );
        for (const u of toAdd) {
          await window.jetro!.addDownload(u, {
            connections: batchConns,
            dir: folder || undefined,
            queueId: q?.id || null,
          });
        }
        if (q?.id) {
          try { await window.jetro!.startQueue(q.id); } catch {}
          setFilter(`queue:${q.id}`);
        }
      }
      setShowBatch(false);
      setBatchStep(1);
      setBatchUrls([]);
      setBatchRows([]);
    } catch (e: any) {
      setBatchError(e?.message || 'Could not add batch downloads.');
    } finally {
      setBatchAdding(false);
    }
  };

  // Best-known original file name for the link in the box (probe result wins,
  // otherwise the name guessed from the URL). '' when unknown.
  const getDetectedName = (): string => {
    if (probedOk && probedFilename) return probedFilename;
    const g = guessNameFromUrl(newUrl.trim());
    return g === FILENAME_FALLBACK ? '' : g;
  };

  // Returns the validated name, or null (after setting filenameError).
  const validateFilename = (name: string): string | null => {
    name = (name || '').trim();
    if (!name) {
      setFilenameError('Please enter a file name.');
      return null;
    }
    if (name.length > 255) {
      setFilenameError('File name is too long (max 255 characters).');
      return null;
    }
    if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name)) {
      setFilenameError('File name can\'t contain any of these characters: < > : " / \\ | ? *');
      return null;
    }
    if (/[. ]$/.test(name)) {
      setFilenameError('File name can\'t end with a space or dot.');
      return null;
    }
    if (/^\.+$/.test(name)) {
      setFilenameError('Please enter a valid file name.');
      return null;
    }
    setFilenameError('');
    return name;
  };

  const resetAddDialog = () => {
    setPendingCollision(null);
    setNewUrl('');
    setUrlError('');
    setNewFilename('');
    setFilenameError('');
    setProbedFilename('');
    setProbedOk(false);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoSubtitles(false);
    setVideoQueueId('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    setVideoLoading(false);
    filenameTouchedRef.current = false;
    setCookiesText('');
    setCookiesFile('');
    setNeedsCookies(false);
    setCookieError('');
    setSavePath('');
    setNewQueueId('');
    setShowAdd(false);
  };

  const doAdd = async (u: string, finalName: string, presetSavePath?: string, presetQueueId?: string, replace = false) => {
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    setAdding(true);
    setUrlError('');
    try {
      // savePath is now a folder — the file name comes from the name box.
      const folder = (presetSavePath || savePath || settings.downloadDir || '').trim();
      const qid = presetQueueId !== undefined ? presetQueueId : newQueueId;
      await window.jetro!.addDownload(u, {
        connections: newConns,
        dir: folder || undefined,
        queueId: qid || null,
        filename: finalName,
        replace: replace || undefined,
      });
      resetAddDialog();
    } catch (e: any) {
      setUrlError(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).');
    } finally {
      setAdding(false);
    }
  };

  const startVideoDownload = async (pageUrl: string, filename: string, folder: string, height: number, kind: 'video' | 'audio' = 'video', replace = false, estimatedBytes?: number, queueId?: string) => {
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    setAdding(true);
    setUrlError('');
    try {
      await window.jetro!.downloadVideo({
        pageUrl,
        height: kind === 'audio' ? 0 : height || 0,
        kind,
        filename,
        dir: folder || undefined,
        queueId: queueId || videoQueueId || undefined,
        replace: replace || undefined,
        estimatedBytes: Math.max(0, Math.round(Number(estimatedBytes ?? selectedVideoEstimatedBytes ?? 0))) || undefined,
        subtitles: videoSubtitles || undefined,
        ...getCookieOpts(),
      });
      resetAddDialog();
    } catch (e: any) {
      const msg = String(e?.message || 'Video download failed.');
      setUrlError(msg);
      // Cookie import problems at download time keep the cookie box open.
      if (/cookie/i.test(msg)) {
        setNeedsCookies(true);
        setCookieError(msg);
      }
    } finally {
      setAdding(false);
    }
  };

  const startPlaylistDownload = async () => {
    if (!playlist || playlistSelected.size === 0) {
      setUrlError('Select at least one playlist entry.');
      return;
    }
    if (!selectedVideoKind) {
      setUrlError('Detect the video and select a quality first — it applies to every entry.');
      return;
    }
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    if (!cookiesReady()) return;
    setPlaylistAdding(true);
    setUrlError('');
    try {
      const folder = (savePath || settings.downloadDir || '').trim();
      const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const entries = playlist.entries.filter((en) => playlistSelected.has(String(en.url))).slice(0, 50);
      const isAudio = selectedVideoKind === 'audio';
      let added = 0;
      for (let idx = 0; idx < entries.length; idx++) {
        const en = entries[idx];
        const base = sanitizeVideoFilename(en.title || videoTitle || `video ${idx + 1}`, selectedVideoExt || (isAudio ? 'mp3' : 'mp4'));
        try {
          await window.jetro!.downloadVideo({
            pageUrl: en.url,
            height: isAudio ? 0 : selectedVideoHeight || 0,
            kind: isAudio ? 'audio' : 'video',
            filename: base,
            dir: folder || undefined,
            queueId: videoQueueId || undefined,
            batchId,
            batchIndex: idx,
            estimatedBytes: undefined,
            subtitles: videoSubtitles || undefined,
            ...getCookieOpts(),
          });
          added++;
        } catch {}
      }
      if (!added) {
        setUrlError('Could not add playlist entries.');
        return;
      }
      resetAddDialog();
    } finally {
      setPlaylistAdding(false);
    }
  };

  const findUniqueFilename = async (dir: string, name: string): Promise<string | null> => {
    const folder = (dir || settings.downloadDir || '').trim();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 100; i++) {
      const cand = `${base} (${i})${ext}`;
      try {
        const ex = await window.jetro!.fileExists(folder || undefined, cand);
        if (!ex?.exists) return cand;
      } catch {
        return cand;
      }
    }
    return null;
  };

  // Checks for an on-disk collision first; shows the replace/rename prompt
  // instead of silently overwriting. For videos url = page URL + height/kind.
  const requestAdd = async (u: string, finalName: string, presetSavePath?: string, presetQueueId?: string, extra?: { isVideo?: boolean; height?: number; videoKind?: 'video' | 'audio'; estimatedBytes?: number }) => {
    const folder = (presetSavePath || savePath || settings.downloadDir || '').trim();
    if (hasBackend() && finalName) {
      try {
        const ex = await window.jetro!.fileExists(folder || undefined, finalName);
        if (ex?.exists) {
          setPendingCollision({
            kind: extra?.isVideo ? 'video' : 'file',
            url: u,
            filename: finalName,
            dir: folder,
            queueId: presetQueueId !== undefined ? presetQueueId : newQueueId,
            height: extra?.height || 0,
            videoKind: extra?.videoKind || 'video',
            estimatedBytes: extra?.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0,
          });
          return;
        }
      } catch {}
    }
    if (extra?.isVideo) await startVideoDownload(u, finalName, folder, extra.height || 0, extra.videoKind || 'video', false, extra.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0);
    else await doAdd(u, finalName, presetSavePath, presetQueueId);
  };

  const resolveCollision = async (mode: 'replace' | 'rename') => {
    const c = pendingCollision;
    if (!c) return;
    setPendingCollision(null);
    let name = c.filename;
    if (mode === 'rename') {
      const unique = await findUniqueFilename(c.dir, c.filename);
      if (!unique) {
        setUrlError('Could not find a free file name in that folder.');
        return;
      }
      name = unique;
    }
    if (c.kind === 'video') await startVideoDownload(c.url, name, c.dir, c.height, c.videoKind || 'video', mode === 'replace', c.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0);
    else await doAdd(c.url, name, c.dir || undefined, c.queueId, mode === 'replace');
  };

  const addDl = async (url?: string, presetSavePath?: string, presetQueueId?: string) => {
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    // Video/audio path: a quality was picked from probeVideo.
    // - Progressive video: direct media URL via the segmented engine (fast).
    // - Split video or any audio: page URL via yt-dlp (download+merge/extract).
    if (!url && isVideoPageUrl(newUrl)) {
      if (!selectedVideoKind && !selectedVideoHeight && !selectedVideoUrl) {
        setUrlError('Detect the video and select a quality below first.');
        return;
      }
      if (!cookiesReady()) return;
      const isAudio = selectedVideoKind === 'audio';
      const defaultExt = isAudio ? 'm4a' : 'mp4';
      const fallback = videoTitle ? sanitizeVideoFilename(videoTitle, extOf(newFilename) || defaultExt) : '';
      const checkedV = validateFilename((newFilename || '').trim() || fallback || (isAudio ? 'audio.m4a' : 'video.mp4'));
      if (!checkedV) return;
      if (isAudio || selectedVideoNeedsMerge || !selectedVideoUrl) {
        const folderV = (savePath || settings.downloadDir || '').trim();
        await requestAdd(newUrl.trim(), checkedV, folderV || undefined, undefined, { isVideo: true, height: selectedVideoHeight || 0, videoKind: isAudio ? 'audio' : 'video', estimatedBytes: selectedVideoEstimatedBytes || 0 });
        return;
      }
      let direct: string;
      try {
        direct = normalizeDownloadUrl(selectedVideoUrl);
      } catch (e: any) {
        setUrlError(e?.message || 'Video link expired — detect again.');
        return;
      }
      await requestAdd(direct, checkedV, presetSavePath, presetQueueId);
      return;
    }
    const raw = (url || newUrl).trim();
    if (!raw) {
      setUrlError('Please enter a download link.');
      return;
    }
    let u: string;
    try {
      u = normalizeDownloadUrl(raw);
    } catch (e: any) {
      setUrlError(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).');
      return;
    }
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
    // Make sure we know the original format before comparing: probe now if the
    // background probe hasn't answered yet (e.g. user clicked Download fast).
    // Untouched auto-fill follows the fresh probe result so a fast click on an
    // unedited name never triggers a bogus format warning.
    let wanted = (newFilename || '').trim();
    let detected = getDetectedName();
    if (!probedOk) {
      setAdding(true);
      try {
        const p = await window.jetro!.probe(u);
        if (p?.filename) {
          detected = p.filename;
          setProbedFilename(p.filename);
          setProbedOk(true);
          if (!filenameTouchedRef.current) {
            wanted = p.filename;
            setNewFilename(p.filename);
          }
        }
      } catch {}
      setAdding(false);
    }
    if (!wanted) {
      wanted = detected && detected !== FILENAME_FALLBACK ? detected : guessNameFromUrl(u);
    }
    const checked = validateFilename(wanted);
    if (!checked) return;
    const detExt = detected && detected !== FILENAME_FALLBACK ? extOf(detected) : '';
    const finalExt = extOf(checked);
    if (detExt && finalExt !== detExt) {
      // User is changing the format — ask for confirmation first.
      setPendingFormatConfirm({ url: u, finalName: checked, detectedName: detected, detExt, finalExt });
      return;
    }
    await requestAdd(u, checked, presetSavePath, presetQueueId);
  };

  const confirmFormatAnyway = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    await requestAdd(p.url, p.finalName);
  };

  const useOriginalFilename = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    setNewFilename(p.detectedName);
    setFilenameError('');
    filenameTouchedRef.current = true;
    await requestAdd(p.url, p.detectedName);
  };

  // Fresh file-name state every time the New Download dialog opens.
  useEffect(() => {
    if (!showAdd) return;
    setPendingCollision(null);
    setUrlError('');
    setFilenameError('');
    setNewFilename('');
    setProbedFilename('');
    setProbedOk(false);
    setPendingFormatConfirm(null);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setVideoLoading(false);
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoSubtitles(false);
    setVideoQueueId('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    filenameTouchedRef.current = false;
    setNeedsCookies(false);
    setCookieError('');
    setShowVideoDetail(false);
  }, [showAdd]);

  // Collapse the raw error log whenever a new resolve produces different
  // output (covers resetAddDialog, URL changes, and re-detects).
  useEffect(() => {
    setShowVideoDetail(false);
  }, [videoDetail]);

  // Autofill the address from clipboard only when the New Download dialog opens.
  // Never auto-opens the dialog on startup/copy — the dialog is opened manually,
  // then the current clipboard URL (if valid) fills the address box.
  useEffect(() => {
    if (!showAdd) return;
    if (settingsRef.current && settingsRef.current.autoCaptureClipboard === false) return;
    let cancelled = false;
    const isValidUrl = (t: string): boolean => {
      if (!t || t.length > 2048 || /\s/.test(t)) return false;
      try {
        normalizeDownloadUrl(t);
        return true;
      } catch {
        return false;
      }
    };
    const fill = (t: string) => {
      if (cancelled || !isValidUrl(t)) return false;
      setNewUrl(t);
      setUrlError('');
      filenameTouchedRef.current = false;
      return true;
    };
    (async () => {
      // Prefer a fresh read so a cleared/changed clipboard doesn't resurrect a stale URL.
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          const t = String(await navigator.clipboard.readText() || '').trim();
          if (!cancelled) {
            if (t) {
              fill(t);
              return;
            }
            // Clipboard readable but empty/non-URL: leave the box as-is.
            return;
          }
        } else {
          throw new Error('no clipboard api');
        }
      } catch {
        // Clipboard API blocked (permissions) — fall back to the last push from main.
        const buffered = String(pendingClipboardRef.current || '').trim();
        if (buffered) fill(buffered);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd]);

  // Clear a previously picked video quality when the URL changes.
  // A new URL gets a fresh auto-resolve attempt, so hide the cookie box until
  // yt-dlp reports a login/cookie error for this URL (pasted cookies are kept).
  useEffect(() => {
    if (!showAdd) return;
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setNeedsCookies(false);
    setCookieError('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUrl]);

  const detectVideo = async () => {
    const raw = newUrl.trim();
    if (!raw || !hasBackend()) return;
    if (!cookiesReady()) return;
    setVideoLoading(true);
    setVideoHint('');
    setVideoDetail('');
    setCookieError('');
    setVideoFormats([]);
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    try {
      const r = await window.jetro!.probeVideo(raw, { ...getCookieOpts(), allowPlaylist: true });
      const fmts = Array.isArray(r?.formats) ? r.formats : [];
      const wantsCookies = !!(r as any)?.needsCookies;
      setNeedsCookies(wantsCookies);
      setCookieError(String((r as any)?.cookieError || ''));
      const pl = (r as any)?.playlist || null;
      if (pl && Array.isArray(pl.entries) && pl.entries.length > 1) {
        const entries = pl.entries.slice(0, 50);
        setPlaylist({ title: String(pl.title || ''), count: Number(pl.count || entries.length), entries });
        setPlaylistSelected(new Set(entries.map((en: any) => String(en.url))));
      }
      setVideoFormats(fmts);
      setVideoHint(String(r?.hint || ''));
      setVideoDetail(String((r as any)?.detail || ''));
      setVideoTitle(String((r as any)?.title || (pl as any)?.title || fmts[0]?.title || ''));
      if (fmts.length === 1) {
        const f = fmts[0];
        setSelectedVideoUrl(f.url || '');
        setSelectedVideoHeight(f.height || 0);
        setSelectedVideoNeedsMerge(!!f.needsMerge);
        setSelectedVideoKind(f.kind === 'audio' ? 'audio' : 'video');
        setSelectedVideoExt(String(f.ext || '').toLowerCase());
        setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
        if (!filenameTouchedRef.current) {
          const t = String((r as any)?.title || fmts[0]?.title || '');
          if (t) setNewFilename(sanitizeVideoFilename(t, f.ext));
        }
      } else if (!fmts.length && r?.hint) {
        setUrlError('');
      }
    } catch (e: any) {
      setVideoHint('Could not detect video — check your internet connection and click Detect again.');
      setVideoDetail('');
    } finally {
      setVideoLoading(false);
    }
  };

  // Video qualities are only detected when the Detect button is clicked (no auto-detect).

  // Manual login cookies (cookies.txt): only used after yt-dlp reports a login/
  // cookie error. Probe/download otherwise resolve automatically with no cookies.
  const getCookieOpts = (): { cookiesText?: string; cookiesFile?: string } => {
    const out: { cookiesText?: string; cookiesFile?: string } = {};
    const t = cookiesText.trim();
    if (t) out.cookiesText = t;
    const f = cookiesFile.trim();
    if (f) out.cookiesFile = f;
    return out;
  };

  // False (after showing an error) when the cookie box is open but empty.
  const cookiesReady = (): boolean => {
    if (needsCookies && !cookiesText.trim() && !cookiesFile.trim()) {
      setUrlError('Paste your cookies.txt content below or pick the cookies.txt file, then Detect again.');
      return false;
    }
    return true;
  };

  // Auto-fill the file name box from the link: instant client-side guess first,
  // then the authoritative name from the backend probe (debounced). Never
  // overwrites a name the user typed themselves. Skipped for video pages —
  // the file name comes from the selected quality instead.
  useEffect(() => {
    if (!showAdd) return;
    const raw = newUrl.trim();
    if (!raw) {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    if (isVideoPageUrl(raw)) {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    if (!filenameTouchedRef.current) setNewFilename(guessNameFromUrl(raw));
    let candidate: string;
    try {
      candidate = normalizeDownloadUrl(raw);
    } catch {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!hasBackend()) return;
      try {
        const p = await window.jetro!.probe(candidate);
        if (cancelled || !p?.filename) return;
        setProbedFilename(p.filename);
        setProbedOk(true);
        if (!filenameTouchedRef.current) setNewFilename(p.filename);
      } catch {
        if (!cancelled) setProbedOk(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [newUrl, showAdd]);

  // Escape dismisses the format-confirm dialog (back to the New Download dialog).
  useEffect(() => {
    if (!pendingFormatConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingFormatConfirm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingFormatConfirm]);

  // Answer the main-process X-button request (styled close dialog).
  const decideClose = async (decision: 'minimize' | 'exit' | 'cancel') => {
    const remember = closeRemember;
    setShowClosePrompt(false);
    setCloseRemember(false);
    if (!hasBackend()) return;
    try {
      await window.jetro!.decideClose?.({ decision, remember });
    } catch {}
  };

  // Escape cancels the close dialog (stays open, same as Cancel).
  useEffect(() => {
    if (!showClosePrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decideClose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClosePrompt, closeRemember]);

  // ---------- queue actions (backend + web-preview fallback) ----------
  const refreshQueues = async () => {
    if (!hasBackend()) return;
    try {
      setQueues(await window.jetro!.listQueues());
    } catch {}
  };

  const handleCreateQueue = async (name: string) => {
    const clean = name.trim();
    if (!clean) {
      setQNameError('Queue name cannot be empty');
      throw new Error('Queue name cannot be empty');
    }
    if (hasBackend()) {
      const q = await window.jetro!.createQueue(clean);
      await refreshQueues();
      return q;
    }
    const q: Queue = {
      id: 'q' + Date.now().toString(36),
      name: clean,
      running: false,
      maxConcurrent: Math.min(10, Math.max(1, Math.round(Number(settings.maxConcurrentDownloads) || 3))),
      schedulerEnabled: false,
      scheduleStart: '22:00',
      scheduleStop: '07:00',
      createdAt: Date.now(),
      afterComplete: qPower,
      powerFiredAt: null,
    };
    setQueues((p) => [...p, q]);
    return q;
  };

  const handleStartStopQueue = async (q: Queue) => {
    if (hasBackend()) {
      if (q.running) await window.jetro!.stopQueue(q.id);
      else await window.jetro!.startQueue(q.id);
      await refreshQueues();
      return;
    }
    setQueues((p) => p.map((x) => (x.id === q.id ? { ...x, running: !x.running } : x)));
  };

  const handleDeleteQueue = async (q: Queue) => {
    if (!confirm(`Delete queue "${q.name}"?\nIts files will be kept under No queue (paused).`)) return;
    if (hasBackend()) {
      await window.jetro!.deleteQueue(q.id);
      await refreshQueues();
    } else {
      setQueues((p) => p.filter((x) => x.id !== q.id));
      setItems((p) => p.map((it) => ((it.queueId || null) === q.id ? { ...it, queueId: null } : it)));
    }
    if (filter === `queue:${q.id}`) setFilter('all');
    setCtx(null);
  };

  const openCreateModal = () => {
    setQName('');
    setQNameError('');
    setQSchedOn(false);
    setQStart(QUEUE_SCHED_DEFAULT_START);
    setQStop(QUEUE_SCHED_DEFAULT_STOP);
    setQSchedError('');
    setQPower('nothing');
    setPendingQueueMove(null);
    setShowQueueModal({ mode: 'create' });
    setCtx(null);
  };

  const openEditModal = (q: Queue) => {
    setQName(q.name);
    setQNameError('');
    setQSchedOn(!!q.schedulerEnabled);
    setQStart(normalizeTime24h(q.scheduleStart) || QUEUE_SCHED_DEFAULT_START);
    setQStop(normalizeTime24h(q.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP);
    setQSchedError('');
    setQPower(normalizeQueuePowerAction((q as any).afterComplete));
    setShowQueueModal({ mode: 'edit', queueId: q.id });
    setCtx(null);
  };

  const validateQueueSchedule = (enabled: boolean, startRaw: string, stopRaw: string): { start: string; stop: string; error: string } => {
    if (!enabled) return { start: QUEUE_SCHED_DEFAULT_START, stop: QUEUE_SCHED_DEFAULT_STOP, error: '' };
    const start = normalizeTime24h(startRaw);
    const stop = normalizeTime24h(stopRaw);
    if (!start || !stop) return { start: start || '', stop: stop || '', error: 'Enter start and stop as HH:MM from 00:00 to 23:59.' };
    return { start, stop, error: '' };
  };

  const saveQueueModal = async () => {
    const clean = qName.trim();
    if (!clean) {
      setQNameError('Queue name cannot be empty');
      return;
    }
    setQNameError('');
    const sched = validateQueueSchedule(qSchedOn, qStart, qStop);
    if (sched.error) {
      setQSchedError(sched.error);
      return;
    }
    setQSchedError('');
    try {
      if (showQueueModal?.mode === 'create') {
        const q = await handleCreateQueue(clean);
        // apply extra fields if user changed them
        if (hasBackend() && q) {
          await window.jetro!.updateQueue(q.id, {
            schedulerEnabled: qSchedOn,
            scheduleStart: sched.start,
            scheduleStop: sched.stop,
            afterComplete: qPower,
          });
          await refreshQueues();
        } else if (q) {
          setQueues((p) => p.map((x) => (x.id === q.id ? { ...x, schedulerEnabled: qSchedOn, scheduleStart: sched.start, scheduleStop: sched.stop, afterComplete: qPower } : x)));
        }
        // Created from a download's right-click menu: move that download in.
        if (q && pendingQueueMove) {
          await moveItemToQueue(pendingQueueMove, q.id);
          setPendingQueueMove(null);
        } else if (q && !pendingQueueMove) {
          setFilter(`queue:${q.id}`);
        }
      } else if (showQueueModal?.mode === 'edit' && showQueueModal.queueId) {
        const id = showQueueModal.queueId;
        if (hasBackend()) {
          await window.jetro!.updateQueue(id, {
            name: clean,
            schedulerEnabled: qSchedOn,
            scheduleStart: sched.start,
            scheduleStop: sched.stop,
            afterComplete: qPower,
          });
          await refreshQueues();
        } else {
          setQueues((p) => p.map((x) => (x.id === id ? { ...x, name: clean, schedulerEnabled: qSchedOn, scheduleStart: sched.start, scheduleStop: sched.stop, afterComplete: qPower, powerFiredAt: null } : x)));
        }
      }
      setShowQueueModal(null);
    } catch (e: any) {
      const msg = e?.message || 'Could not save queue';
      if (/HH:MM|24-hour|Start|Stop/i.test(msg)) setQSchedError(msg);
      else setQNameError(msg);
    }
  };

  const moveItemToQueue = async (itemId: string, queueId: string | null) => {
    if (hasBackend()) {
      try {
        await window.jetro!.moveToQueue(itemId, queueId);
      } catch (e: any) {
        alert(e?.message || 'Could not move (maybe downloading). Pause it first.');
      }
      return;
    }
    setItems((p) => p.map((it) => (it.id === itemId ? { ...it, queueId } : it)));
  };

  const openCtx = (e: React.MouseEvent, queueId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setItemCtx(null);
    // Clamp against the tallest the menu can be (scrollable), so a click near
    // the bottom edge still leaves the whole menu reachable.
    const { x, y } = clampCtxPos(e.clientX, e.clientY, 230, ctxCssMaxHeight(false));
    setCtx({ x, y, queueId });
  };

  // ---------- download item right-click menu ----------
  const openItemCtx = (e: React.MouseEvent, it: Item) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(it.id);
    setCtx(null);
    const { x, y } = clampCtxPos(e.clientX, e.clientY, 264, ctxCssMaxHeight(true));
    setItemCtx({ x, y, itemId: it.id });
  };

  const itemCtxItem = itemCtx ? items.find((i) => i.id === itemCtx.itemId) || null : null;

  const handleOpenItem = async (mode: 'open' | 'open-with' | 'folder') => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    try {
      if (mode === 'open') await window.jetro!.openFile(it.savePath);
      else if (mode === 'open-with') {
        const api: any = window.jetro as any;
        if (typeof api?.openWith === 'function') await api.openWith(it.savePath);
        else await window.jetro!.openFile(it.savePath);
      } else await window.jetro!.revealInFolder(it.savePath);
    } catch (e: any) {
      alert(e?.message || 'Could not open file');
    }
  };

  const openRenameModal = () => {
    const it = itemCtxItem;
    if (!it) return;
    setRenameState({ id: it.id, name: it.filename, error: '' });
    setItemCtx(null);
  };

  const saveRenameModal = async () => {
    if (!renameState || renaming) return;
    const name = (renameState.name || '').trim();
    if (!name) {
      setRenameState({ ...renameState, error: 'Please enter a file name.' });
      return;
    }
    if (name.length > 255) {
      setRenameState({ ...renameState, error: 'File name is too long (max 255 characters).' });
      return;
    }
    if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name)) {
      setRenameState({ ...renameState, error: 'File name can\'t contain any of these characters: < > : " / \\ | ? *' });
      return;
    }
    if (/[. ]$/.test(name)) {
      setRenameState({ ...renameState, error: 'File name can\'t end with a space or dot.' });
      return;
    }
    if (/^\.+$/.test(name)) {
      setRenameState({ ...renameState, error: 'Please enter a valid file name.' });
      return;
    }
    if (!hasBackend()) {
      setRenameState({ ...renameState, error: 'Run via Electron (npm run app:dev) to rename files.' });
      return;
    }
    setRenaming(true);
    try {
      await window.jetro!.renameDownload(renameState.id, name);
      setRenameState(null);
    } catch (e: any) {
      setRenameState({ ...renameState, error: e?.message || 'Could not rename file.' });
    } finally {
      setRenaming(false);
    }
  };

  const handleRedownloadItem = async () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    try {
      await window.jetro!.redownload(it.id);
    } catch (e: any) {
      alert(e?.message || 'Could not restart download.');
    }
  };

  const handleRefreshItem = async () => {
    const it = itemCtxItem;
    if (!it || !hasBackend()) return;
    setRefreshingId(it.id);
    try {
      await window.jetro!.refreshDownload(it.id);
    } catch (e: any) {
      alert(e?.message || 'Could not refresh download.');
    } finally {
      setRefreshingId(null);
      setItemCtx(null);
    }
  };

  const handleRemoveItem = () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it) return;
    setSelectedId(it.id);
    setPendingRemove({ id: it.id, deleteFile: it.status === 'completed' });
  };

  const handleItemResumeStop = () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    if (it.status === 'downloading' || it.status === 'merging' || it.status === 'queued') {
      window.jetro!.pause(it.id);
    } else if (it.status !== 'completed') {
      window.jetro!.resume(it.id);
    }
  };

  // ---------- external tools status in Settings ----------
  const refreshBinStatus = async () => {
    if (!hasBackend()) return;
    setBinRefreshing(true);
    try {
      setBinStatus(await window.jetro!.getBinaryStatus());
    } catch {}
    setBinRefreshing(false);
  };

  useEffect(() => {
    if (!showSettings || !hasBackend()) return;
    refreshBinStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // ---------- settings open / save / cancel with unsaved-changes guard ----------
  const openSettings = () => {
    const copy = stripGlobalScheduler(JSON.parse(JSON.stringify(settings)));
    copy.theme = normalizeTheme(copy.theme);
    setDraftSettings(copy);
    setShowDiscardConfirm(false);
    setShowSettings(true);
  };

  const isSettingsDirty = useMemo(() => {
    if (!showSettings || !draftSettings) return false;
    try {
      return JSON.stringify(draftSettings) !== JSON.stringify(settings);
    } catch {
      return true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, draftSettings]);

  const attemptCloseSettings = () => {
    if (isSettingsDirty) {
      setShowDiscardConfirm(true);
    } else {
      setShowSettings(false);
      setDraftSettings(null);
    }
  };

  const saveSettingsAndClose = async () => {
    if (draftSettings) {
      const clean = stripGlobalScheduler({ ...draftSettings, theme: normalizeTheme(draftSettings.theme) });
      await window.jetro?.saveSettings(clean);
      setSettings(clean);
      setThemeChoice(clean.theme);
      try { localStorage.setItem(THEME_KEY, clean.theme); } catch {}
    }
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  const discardSettingsChanges = () => {
    // Revert the live theme preview back to the saved choice.
    const saved = normalizeTheme((settings as any)?.theme ?? themeChoice);
    setThemeChoice(saved);
    try { localStorage.setItem(THEME_KEY, saved); } catch {}
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  // Escape in Settings: dismiss discard-confirm first, otherwise attempt close (asks if dirty)
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showDiscardConfirm) setShowDiscardConfirm(false);
      else attemptCloseSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, showDiscardConfirm, draftSettings, settings]);

  const statusNav: { key: string; label: string; Icon: typeof FiInbox }[] = [
    { key: 'all', label: 'All', Icon: FiInbox },
    { key: 'downloading', label: 'Downloading', Icon: FiArrowDown },
    { key: 'completed', label: 'Completed', Icon: FiCheckCircle },
    { key: 'failed', label: 'Failed', Icon: FiXCircle },
    { key: 'paused', label: 'Paused', Icon: FiPause },
    { key: 'queued', label: 'Queued', Icon: FiClock },
  ];

  const categoryNav: { key: string; label: string; Icon: typeof FiBox }[] = [
    { key: 'cat-video', label: 'Video', Icon: FiFilm },
    { key: 'cat-documents', label: 'Documents', Icon: FiFileText },
    { key: 'cat-archives', label: 'Archives', Icon: FiArchive },
    { key: 'cat-software', label: 'Software', Icon: FiDisc },
    { key: 'cat-others', label: 'Others', Icon: FiBox },
  ];

  const ctxQueue = ctx?.queueId ? queueById(ctx.queueId) : null;
  const completedPopup = completedQueue[0] || null;
  const dismissCompletedPopup = () => setCompletedQueue((prev) => prev.slice(1));

  // ---------- toolbar state ----------
  const selected = items.find((i) => i.id === selectedId) || null;
  const canResume = !!selected && (selected.status === 'paused' || selected.status === 'error');
  const canStop = !!selected && (selected.status === 'downloading' || selected.status === 'merging' || selected.status === 'queued');
  const canStopAll = items.some((i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'queued');

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  // remove-confirmation target (live item so progress stays fresh)
  const pendingRemoveItem = pendingRemove ? items.find((i) => i.id === pendingRemove.id) || null : null;

  // auto-dismiss the confirm dialog if the item disappears (or completes while
  // a cancel-confirm is open — a finished download needs no cancel prompt)
  useEffect(() => {
    if (!pendingRemove) return;
    const it = items.find((i) => i.id === pendingRemove.id);
    if (!it || (!pendingRemove.deleteFile && it.status === 'completed')) setPendingRemove(null);
  }, [items, pendingRemove]);

  // Escape dismisses the remove-confirm dialog
  useEffect(() => {
    if (!pendingRemove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingRemove(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingRemove]);

  // Escape dismisses rename / properties dialogs
  useEffect(() => {
    if (!renameState && !propsId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (renameState && !renaming) setRenameState(null);
      else if (propsId) setPropsId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renameState, propsId, renaming]);

  // Escape dismisses the file-exists dialog
  useEffect(() => {
    if (!pendingCollision) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingCollision(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingCollision]);

  // close queue dropdown on escape
  useEffect(() => {
    if (!queueMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQueueMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queueMenu]);

  // Escape dismisses the batch dialogs (not while resolving/adding)
  useEffect(() => {
    if (!showBatch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBatch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBatch, batchResolving, batchAdding]);

  const handleResumeSelected = () => {
    if (!canResume || !selected) return;
    window.jetro?.resume(selected.id);
  };
  const handleStopSelected = () => {
    if (!canStop || !selected) return;
    window.jetro?.pause(selected.id);
  };
  const handleStopAll = async () => {
    if (!canStopAll || !hasBackend()) return;
    const active = items.filter((i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'queued');
    for (const it of active) {
      try {
        await window.jetro!.pause(it.id);
      } catch {}
    }
  };

  return (
    <>
      <div className="app-bg" />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="logo"><img src={jetroLogo} alt="Jetro" className="logo-img" draggable={false} /><span className="logo-text">Jetro</span><span className="logo-version">v0.2.0</span><button className="logo-settings-btn" title="Settings" onClick={openSettings}><FiSettings size={16} /></button></div>
          <div className="sidebar-nav">
            {statusNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div className="nav-section">Categories</div>
            {categoryNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div
              className="nav-section row-between"
              onContextMenu={(e) => openCtx(e, null)}
              title="Right-click for queue options"
            >
              <span>Queues</span>
              <button className="nav-add-btn" title="Create new queue" onClick={openCreateModal}><FiPlus size={13} /></button>
            </div>
            {queues.map((q) => {
              const key = `queue:${q.id}`;
              const schedLabel = q.schedulerEnabled
                ? ` • ${(normalizeTime24h(q.scheduleStart) || QUEUE_SCHED_DEFAULT_START)}–${(normalizeTime24h(q.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP)}`
                : '';
              return (
                <div
                  key={q.id}
                  className={'nav-item' + (filter === key ? ' active' : '')}
                  onClick={() => setFilter(key)}
                  onContextMenu={(e) => openCtx(e, q.id)}
                  title={`Right-click: Start/Stop, Edit, Delete\n${q.running ? 'Running' : 'Stopped'}${schedLabel}`}
                >
                  <span className={'queue-dot' + (q.running ? ' running' : '')} />
                  <span className="nav-label"><FiLayers className="nav-icon" />{q.name}</span>
                  <span className="nav-count">{counts(key)}</span>
                </div>
              );
            })}
          </div>
          <div className="sidebar-footer">
            <div className={'speed-meter' + (totalSpeed > 0 ? ' active' : '')}>
              <div className="speed-meter-icon"><FiArrowDown size={16} /></div>
              <div className="speed-meter-info">
                <div className="speed-meter-label">Download speed</div>
                <div className="speed-meter-value">{fmtSpeed(totalSpeed)}</div>
              </div>
              <span className={'speed-meter-dot' + (totalSpeed > 0 ? ' live' : '')} />
            </div>
            <div className="sidebar-path"><FiHardDrive className="inline-icon" /> {settings.downloadDir || '…'}</div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <button className="btn btn-primary" onClick={() => { setSavePath(settings.downloadDir || ''); setNewQueueId(''); setUrlError(''); setShowAdd(true); }}><FiPlus className="btn-icon" /> New Download</button>
            <button className="btn" title="Add many file parts at once with a * pattern" onClick={openBatch}><FiLayers className="btn-icon" /> New Batch Download</button>
            <input className="search" placeholder="Search downloads…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button
              className="theme-toggle"
              title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? <FiSun size={17} /> : <FiMoon size={17} />}
            </button>
          </div>

          <div className="toolbar">
            <button className="btn" disabled={!canResume} title={canResume ? `Resume ${selected?.filename}` : 'Select a paused or failed download'} onClick={handleResumeSelected}><FiPlay className="btn-icon" /> Resume</button>
            <button className="btn" disabled={!canStop} title={canStop ? `Stop ${selected?.filename}` : 'Select an active download'} onClick={handleStopSelected}><FiPause className="btn-icon" /> Stop</button>
            <button className="btn" disabled={!canStopAll} title={canStopAll ? 'Stop all active downloads' : 'No active downloads'} onClick={handleStopAll}><FiSquare className="btn-icon" /> Stop All</button>
            <span className="toolbar-sep" />
            <div className="toolbar-dropdown">
              <button className="btn" title="Start a queue" onClick={() => setQueueMenu(queueMenu === 'start' ? null : 'start')}><FiPlay className="btn-icon" /> Start Queue <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'start' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">No queues yet</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={q.running}
                        title={q.running ? `"${q.name}" is already running` : `Start "${q.name}"`}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiPlay className="btn-icon" /> {q.name}{q.running ? ' (running)' : ''}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="toolbar-dropdown">
              <button className="btn" title="Stop a running queue" onClick={() => setQueueMenu(queueMenu === 'stop' ? null : 'stop')}><FiSquare className="btn-icon" /> Stop Queue <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'stop' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">No queues yet</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={!q.running}
                        title={q.running ? `Stop "${q.name}"` : `"${q.name}" is not running`}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiSquare className="btn-icon" /> {q.name}{q.running ? '' : ' (stopped)'}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="toolbar-spacer" />
            <div className="view-toggle" role="radiogroup" aria-label="Downloads viewing mode">
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'cards'}
                title="Card view"
                className={'view-toggle-btn' + (viewMode === 'cards' ? ' active' : '')}
                onClick={() => setViewModeAndPersist('cards')}
              ><FiGrid size={15} /></button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'details'}
                title="Details view (small list like File Explorer)"
                className={'view-toggle-btn' + (viewMode === 'details' ? ' active' : '')}
                onClick={() => setViewModeAndPersist('details')}
              ><FiList size={15} /></button>
            </div>
          </div>

          {showUpdateBanner && updateInfo && (
            <div className="card" style={{ justifyContent: 'space-between', alignItems: 'center', borderColor: 'var(--green-soft-border)', background: 'var(--green-soft-bg)' }}>
              <div>
                <b><FiDownloadCloud className="inline-icon" /> v{updateInfo.latest} available</b>{' '}
                <span className="queue-meta">you have v{updateInfo.current} — see what&apos;s new on GitHub</span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-small btn-primary" onClick={() => openExternalUrl(updateInfo.url || 'https://github.com/Erkalin/Jetro/releases')}><FiExternalLink className="btn-icon" /> Download</button>
                <button className="btn btn-small" onClick={() => setUpdateDismissed(updateInfo.latest)}>Later</button>
              </div>
            </div>
          )}
          <div
            className="list"
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={async (e) => {
              e.preventDefault();
              if (!hasBackend()) return;
              try {
                const texts: string[] = [];
                try {
                  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                  if (uri) texts.push(...String(uri).split(/\s+/));
                } catch {}
                const files = Array.from(e.dataTransfer.files || []) as File[];
                for (const f of files) {
                  try {
                    const t = await f.text();
                    texts.push(...t.split(/\s+/));
                  } catch {}
                }
                const urls = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, 200);
                if (!urls.length) return;
                const valid: string[] = [];
                for (const u of urls) {
                  try { valid.push(normalizeDownloadUrl(u)); } catch {}
                }
                if (!valid.length) return;
                const dir = (settings.downloadDir || '').trim() || undefined;
                if (typeof (window.jetro as any)?.addBatch === 'function') {
                  await (window.jetro as any).addBatch(valid, { dir });
                } else {
                  for (const u of valid) {
                    try { await window.jetro!.addDownload(u, { dir: dir || undefined }); } catch {}
                  }
                }
              } catch {}
            }}
            title="Drop links or a .txt file to add downloads"
          >
            {filter.startsWith('queue:') && (
              <div className="card" style={{ justifyContent: 'space-between' }}>
                <div>
                  <b className="queue-title"><FiLayers className="inline-icon" /> {queueById(filter.slice(6))?.name || 'Queue'}</b>{' '}
                  <span className="badge green">{queueById(filter.slice(6))?.running ? 'Running' : 'Stopped'}</span>{' '}
                  {normalizeQueuePowerAction(queueById(filter.slice(6))?.afterComplete) !== 'nothing' && (
                    <span className="badge">⏻ {queuePowerLabel(queueById(filter.slice(6))?.afterComplete)} on finish</span>
                  )}{' '}
                  <span className="queue-meta">
                    {counts(filter)} files
                    {(() => {
                      const qd = queueById(filter.slice(6));
                      if (!qd?.schedulerEnabled) return '';
                      const s = normalizeTime24h(qd.scheduleStart) || QUEUE_SCHED_DEFAULT_START;
                      const e = normalizeTime24h(qd.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP;
                      return ` • schedule ${s}–${e} (24h)`;
                    })()}
                  </span>
                </div>
                <div className="row">
                  {queueById(filter.slice(6))?.running ? (
                    <button className="btn" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiSquare className="btn-icon" /> Stop</button>
                  ) : (
                    <button className="btn btn-primary" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiPlay className="btn-icon" /> Start</button>
                  )}
                  <button className="btn" onClick={() => queueById(filter.slice(6)) && openEditModal(queueById(filter.slice(6))!)}>Edit</button>
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="card"><div className="empty" style={{ width: '100%' }}>
                <div className="empty-big"><FiDownloadCloud size={48} /></div>
                <div className="empty-title">No downloads here</div>
                <div>Paste a link — Jetro will ask where to save and split it into {settings.maxConnections} parallel segments for faster downloads.</div>
              </div></div>
            )}
            {viewMode === 'details' && filtered.length > 0 && (
              <div className="details-wrap">
                <div className="details-head" style={{ gridTemplateColumns: detailGridTemplate }}>
                  {detailOrder.map((col) => (
                    <div
                      key={col}
                      className={'details-th' + (dropCol === col ? ' drop-target' : '')}
                      draggable
                      title={`${DETAIL_COL_LABELS[col]} — click to sort, drag to reorder`}
                      onClick={() => setSort((prev) => {
                        if (!prev || prev.col !== col) return { col, dir: 1 };
                        if (prev.dir === 1) return { col, dir: -1 };
                        return null;
                      })}
                      onDragStart={(e) => {
                        dragColRef.current = col;
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col); } catch {}
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragColRef.current && dragColRef.current !== col) setDropCol(col);
                      }}
                      onDragLeave={() => setDropCol((prev) => (prev === col ? null : prev))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragColRef.current || ((): DetailColId | null => {
                          try {
                            const v = e.dataTransfer.getData('text/plain');
                            return (DETAIL_COLS_DEFAULT as string[]).includes(v) ? (v as DetailColId) : null;
                          } catch { return null; }
                        })();
                        dragColRef.current = null;
                        setDropCol(null);
                        if (from) moveDetailCol(from, col);
                      }}
                      onDragEnd={() => {
                        dragColRef.current = null;
                        setDropCol(null);
                      }}
                    >
                      <span className="details-th-label">{DETAIL_COL_LABELS[col]}{sort?.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                      <span
                        className="details-resizer"
                        title={`Resize ${DETAIL_COL_LABELS[col]}`}
                        onMouseDown={(e) => beginColResize(e, col)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ))}
                  <div className="details-th details-actions-head" title="Actions" />
                </div>
                <div className="details-body">
                  {filtered.map((it) => {
                    const completed = it.status === 'completed';
                    const active = it.status === 'downloading' || it.status === 'merging';
                    const lastTry = lastTryOf(it);
                    const statusText = fmtDetailStatus(it);
                    const statusTitle = it.status === 'error' && it.error
                      ? `${statusLabel(it.status)} — ${it.error}`
                      : `${statusLabel(it.status)} — ${itemPct(it).toFixed(2)}%`;
                    return (
                      <div
                        key={it.id}
                        className={'details-row' + (selectedId === it.id ? ' selected' : '')}
                        style={{ gridTemplateColumns: detailGridTemplate }}
                        onClick={(e) => toggleSelect(e, it.id)}
                        onContextMenu={(e) => openItemCtx(e, it)}
                        onDoubleClick={async () => {
                          if (!completed || !hasBackend()) return;
                          try { await window.jetro!.openFile(it.savePath); } catch (e: any) { alert(e?.message || 'Could not open file'); }
                        }}
                        title={`${it.filename}\n${it.savePath}`}
                      >
                        {detailOrder.map((col) => {
                          if (col === 'name') {
                            return (
                              <div key={col} className="details-td details-name">
                                <OsFileIcon item={it} />
                                <span className="details-filename" title={`${it.filename}\n${it.savePath}`}>{it.filename}</span>
                              </div>
                            );
                          }
                          if (col === 'queue') {
                            return (
                              <div key={col} className="details-td" onClick={(e) => e.stopPropagation()}>
                                <select
                                  className="queue-select details-queue-select"
                                  title={it.queueId ? `In queue: ${queueById(it.queueId)?.name || ''} — click to move` : 'No queue — click to add to a queue'}
                                  value={it.queueId || ''}
                                  disabled={it.status === 'downloading' || it.status === 'merging'}
                                  onChange={(e) => moveItemToQueue(it.id, e.target.value || null)}
                                >
                                  <option value="">—</option>
                                  {queues.map((q) => (
                                    <option key={q.id} value={q.id}>{q.name}</option>
                                  ))}
                                </select>
                              </div>
                            );
                          }
                          if (col === 'status') {
                            return (
                              <div key={col} className="details-td" title={statusTitle}>
                                <span className="details-status-dot" style={{ background: statusColor(it.status) }} />
                                <span className="details-status-text" style={{ color: statusColor(it.status) }}>{statusText}</span>
                              </div>
                            );
                          }
                          if (col === 'size') {
                            return (
                              <div
                                key={col}
                                className="details-td details-num"
                                title={it.totalBytesIsEstimate && !completed ? 'Estimated size — final size is set after merge' : `${it.downloadedBytes ? fmtBytes(it.downloadedBytes) : '0 B'} downloaded${it.totalBytes ? ` of ${fmtSize(it.totalBytes, !!it.totalBytesIsEstimate)}` : ''}`}
                              >{fmtDetailSize(it)}</div>
                            );
                          }
                          if (col === 'speed') {
                            return (
                              <div key={col} className="details-td details-num" title={active ? `${fmtSpeed(it.speedBps || 0)}` : 'Idle'}>
                                {active ? fmtSpeed(it.speedBps || 0) : '—'}
                              </div>
                            );
                          }
                          if (col === 'eta') {
                            return (
                              <div key={col} className="details-td details-num" title={fmtEta(it) === '—' ? 'ETA unknown (idle or size unknown)' : `ETA ${fmtEta(it)}`}>
                                {fmtEta(it)}
                              </div>
                            );
                          }
                          return (
                            <div key={col} className="details-td details-num" title={fmtLastTryTitle(lastTry)}>
                              {fmtLastTry(lastTry)}
                            </div>
                          );
                        })}
                        <div className="details-td details-actions" onClick={(e) => e.stopPropagation()}>
                          {it.status === 'downloading' || it.status === 'merging' || it.status === 'queued'
                            ? <button className="icon-btn details-action" title="Pause" onClick={() => window.jetro?.pause(it.id)}><FiPause size={13} /></button>
                            : !completed && <button className="icon-btn details-action" title="Resume" onClick={() => window.jetro?.resume(it.id)}><FiPlay size={13} /></button>}
                          {completed ? (
                            <>
                              <button
                                className="icon-btn details-action"
                                title="Open containing folder"
                                onClick={async () => {
                                  if (!hasBackend()) return;
                                  try { await window.jetro!.revealInFolder(it.savePath); } catch (e: any) { alert(e?.message || 'Could not open folder'); }
                                }}
                              ><FiFolder size={13} /></button>
                              <button
                                className="icon-btn details-action danger"
                                title="Delete file and remove from list"
                                onClick={() => setPendingRemove({ id: it.id, deleteFile: true })}
                              ><FiTrash2 size={13} /></button>
                            </>
                          ) : (
                            <button className="icon-btn details-action" title="Remove" onClick={() => setPendingRemove({ id: it.id, deleteFile: false })}><FiX size={13} /></button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {viewMode === 'cards' && filtered.map((it) => {
              const pct = it.totalBytes ? Math.min(100, (it.downloadedBytes / it.totalBytes) * 100) : 0;
              const completed = it.status === 'completed';
              const qNameOf = it.queueId ? queueById(it.queueId)?.name : null;
              return (
                <div
                  className={'card' + (selectedId === it.id ? ' selected' : '')}
                  key={it.id}
                  onClick={(e) => toggleSelect(e, it.id)}
                  onContextMenu={(e) => openItemCtx(e, it)}
                >
                  <OsFileIcon item={it} />
                  <div className="card-body">
                    <div className="card-title" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
                    <div className="card-url" title={it.savePath}>{it.url}</div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }} /></div>
                    <div className="meta">
                      <span><b className="card-pct">{pct.toFixed(1)}%</b></span>
                      <span title={it.totalBytesIsEstimate && !completed ? 'Estimated size (video+audio) — final size is set after merge' : undefined}>{fmtBytes(it.downloadedBytes)} / {fmtSize(it.totalBytes, !!it.totalBytesIsEstimate && !completed)}</span>
                      <span style={{ color: statusColor(it.status), fontWeight: 700 }}>{statusLabel(it.status)}</span>
                      <span className="badge"><FiZap className="inline-icon" /> {it.connections}x {it.supportsRange ? '' : '• single'}</span>
                      {(it.via === 'ytdlp') && <span className="badge green">{it.audioOnly ? <><FiMusic className="inline-icon" /> audio</> : <><FiFilm className="inline-icon" /> video{it.videoHeight ? ` ${it.videoHeight}p` : ''}</>}</span>}
                      {qNameOf && <span className="badge green"><FiLayers className="inline-icon" /> {qNameOf}</span>}
                      {it.status === 'error' && <span className="badge red">{it.error}</span>}
                      <select
                        className="queue-select"
                        title="Add / move to queue"
                        value={it.queueId || ''}
                        disabled={it.status === 'downloading' || it.status === 'merging'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => moveItemToQueue(it.id, e.target.value || null)}
                      >
                        <option value="">No queue</option>
                        {queues.map((q) => (
                          <option key={q.id} value={q.id}>{q.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="actions" onClick={(e) => e.stopPropagation()}>
                    {it.status === 'downloading' || it.status === 'merging' || it.status === 'queued'
                      ? <button className="icon-btn" title="Pause" onClick={() => window.jetro?.pause(it.id)}><FiPause size={15} /></button>
                      : !completed && <button className="icon-btn" title="Resume" onClick={() => window.jetro?.resume(it.id)}><FiPlay size={15} /></button>}
                    {completed ? (
                      <>
                        <button
                          className="icon-btn"
                          title="Open containing folder"
                          onClick={async () => {
                            if (!hasBackend()) return;
                            try {
                              await window.jetro!.revealInFolder(it.savePath);
                            } catch (e: any) {
                              alert(e?.message || 'Could not open folder');
                            }
                          }}
                        ><FiFolder size={15} /></button>
                        <button
                          className="icon-btn danger"
                          title="Delete file and remove from list"
                          onClick={() => setPendingRemove({ id: it.id, deleteFile: true })}
                        ><FiTrash2 size={15} /></button>
                      </>
                    ) : (
                      <button className="icon-btn" title="Remove" onClick={() => setPendingRemove({ id: it.id, deleteFile: false })}><FiX size={15} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* queue right-click menu */}
      {ctx && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div ref={ctxMenuRef} className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            {ctx.queueId && ctxQueue ? (
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    handleStartStopQueue(ctxQueue);
                    setCtx(null);
                  }}
                ><span className="ctx-icon">{ctxQueue.running ? <FiSquare size={14} /> : <FiPlay size={14} />}</span> {ctxQueue.running ? 'Stop queue' : 'Start queue'}</button>
                <button className="ctx-item" onClick={() => openEditModal(ctxQueue)}><FiEdit2 size={14} /> Edit Queue / Schedule</button>
                <div className="ctx-sep" />
                <button className="ctx-item danger" onClick={() => handleDeleteQueue(ctxQueue)}><FiTrash2 size={14} /> Delete queue</button>
                <div className="ctx-sep" />
              </>
            ) : (
              <div className="ctx-hint">Queue options</div>
            )}
            <button className="ctx-item" onClick={openCreateModal}><FiPlus size={14} /> Create New Queue</button>
          </div>
        </>
      )}

      {/* download item right-click menu */}
      {itemCtx && itemCtxItem && (() => {
        const it = itemCtxItem;
        const completed = it.status === 'completed';
        const active = it.status === 'downloading' || it.status === 'merging';
        const queued = it.status === 'queued';
        const canResume = it.status === 'paused' || it.status === 'error';
        const canStop = active || queued;
        const isVideo = it.via === 'ytdlp';
        const inQueue = !!it.queueId;
        const queueName = it.queueId ? queueById(it.queueId)?.name : null;
        const refreshing = refreshingId === it.id;
        return (
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setItemCtx(null)}
              onContextMenu={(e) => { e.preventDefault(); setItemCtx(null); }}
            />
            <div ref={itemMenuRef} className="ctx-menu ctx-menu-item" style={{ left: itemCtx.x, top: itemCtx.y }}>
              <div className="ctx-hint ctx-filename" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
              <button
                className="ctx-item"
                disabled={!completed}
                title={completed ? `Open ${it.filename} with the default app` : 'Open is available once the download is complete'}
                onClick={() => handleOpenItem('open')}
              ><FiFileText size={14} /> Open</button>
              <button
                className="ctx-item"
                disabled={!completed}
                title={completed ? 'Choose which app opens this file' : 'Open with is available once the download is complete'}
                onClick={() => handleOpenItem('open-with')}
              ><FiExternalLink size={14} /> Open with</button>
              <button
                className="ctx-item"
                title="Show the file in its folder"
                onClick={() => handleOpenItem('folder')}
              ><FiFolder size={14} /> Open Folder</button>
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                disabled={active}
                title={active ? 'Pause the download before renaming' : `Rename ${it.filename}`}
                onClick={openRenameModal}
              ><FiEdit2 size={14} /> Rename</button>
              <button
                className="ctx-item"
                disabled={active || queued}
                title={active || queued ? 'Only paused, failed or completed downloads can be restarted' : 'Delete the file and download it again from scratch'}
                onClick={handleRedownloadItem}
              ><FiRotateCcw size={14} /> Redownload</button>
              {canStop ? (
                <button className="ctx-item" onClick={handleItemResumeStop}>
                  <FiPause size={14} /> Stop Download
                </button>
              ) : canResume ? (
                <button className="ctx-item" onClick={handleItemResumeStop}>
                  <FiPlay size={14} /> Resume Download
                </button>
              ) : (
                <button
                  className="ctx-item"
                  disabled
                  title={completed ? 'Completed downloads need no resume' : 'Nothing to resume or stop'}
                ><FiPlay size={14} /> Resume Download</button>
              )}
              <button
                className="ctx-item"
                disabled={active || isVideo || refreshing}
                title={isVideo ? 'Refresh is not available for video/audio downloads' : active ? 'Stop the download before refreshing' : 'Re-check the link for a new size'}
                onClick={handleRefreshItem}
              ><FiRefreshCw size={14} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
              <button className="ctx-item danger" onClick={handleRemoveItem}>
                {completed ? <FiTrash2 size={14} /> : <FiX size={14} />} Remove
              </button>
              <div className="ctx-sep" />
              {inQueue ? (
                <button
                  className="ctx-item"
                  disabled={active}
                  title={active ? 'Pause the download before moving queues' : `Remove from "${queueName || 'queue'}"`}
                  onClick={() => {
                    const id = it.id;
                    setItemCtx(null);
                    moveItemToQueue(id, null);
                  }}
                ><FiLayers size={14} /> Remove from queue{queueName ? ` (${queueName})` : ''}</button>
              ) : (
                <>
                  <div className="ctx-hint">Add to queue</div>
                  <div className="ctx-queue-list">
                    {queues.length === 0 && <div className="ctx-hint">No queues yet</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={active}
                        title={active ? 'Pause the download before moving queues' : `Move to "${q.name}"`}
                        onClick={() => {
                          const id = it.id;
                          const qid = q.id;
                          setItemCtx(null);
                          moveItemToQueue(id, qid);
                        }}
                      ><FiLayers size={14} /> {q.name}{q.running ? '' : ' (stopped)'}</button>
                    ))}
                  </div>
                  <button
                    className="ctx-item"
                    onClick={() => {
                      setPendingQueueMove(it.id);
                      setItemCtx(null);
                      setQName('');
                      setQNameError('');
                      setQSchedOn(false);
                      setQStart(QUEUE_SCHED_DEFAULT_START);
                      setQStop(QUEUE_SCHED_DEFAULT_STOP);
                      setQSchedError('');
                      setQPower('nothing');
                      setShowQueueModal({ mode: 'create' });
                    }}
                  ><FiPlus size={14} /> New queue…</button>
                </>
              )}
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                onClick={() => {
                  setPropsId(it.id);
                  setItemCtx(null);
                }}
              ><FiInfo size={14} /> Properties</button>
            </div>
          </>
        );
      })()}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiPlus className="inline-icon" /> New download</h2>
            <p>Paste a link — rename the file below if you like, then choose where to save it.<br />You can also download from YouTube, TikTok, Instagram, Reddit and{' '}
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 'inherit' }}
                title="See all supported websites (yt-dlp)"
                onClick={() => openExternalUrl(SUPPORTED_SITES_URL)}
              >1000+ more websites</button>{' '}
              by pasting their links.</p>
            <input
              className="input"
              autoFocus
              placeholder="example.com/file.zip"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); if (urlError) setUrlError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
              style={urlError ? { borderColor: 'var(--red)' } : undefined}
            />
            {urlError && <div className="form-error">{urlError}</div>}
            {newUrl.trim() !== '' && (!isVideoPageUrl(newUrl) || !!selectedVideoKind || selectedVideoHeight > 0 || !!selectedVideoUrl) && (
              <>
                <label className="form-label">File name</label>
                <input
                  className="input"
                  placeholder={probedFilename || 'e.g. Mr Robot.mp4'}
                  value={newFilename}
                  onChange={(e) => {
                    setNewFilename(e.target.value);
                    filenameTouchedRef.current = true;
                    if (filenameError) setFilenameError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
                  style={filenameError ? { borderColor: 'var(--red)' } : undefined}
                />
                {filenameError && <div className="form-error">{filenameError}</div>}
                {!filenameError && probedFilename !== '' && probedFilename !== newFilename.trim() && (
                  <div className="form-hint">Detected: {probedFilename}</div>
                )}
              </>
            )}
            {newUrl.trim() !== '' && isVideoPageUrl(newUrl) && (
              <div className="video-box">
                <div className="video-box-desc">Video/audio page detected — all qualities, best available (merged to mp4 / extracted audio via bundled ffmpeg).</div>
                <button className="btn btn-small" disabled={videoLoading} onClick={detectVideo}>
                  <FiFilm className="btn-icon" /> {videoLoading ? 'Detecting…' : videoFormats.length ? 'Detect again' : 'Detect qualities'}
                </button>
                {needsCookies && (
                  <div className="cookie-box">
                    <div className="cookie-box-title">Login needed — log in on the website, export its cookies, then paste them or pick the file and retry.</div>
                    <label className="form-label-sm">Paste cookies.txt content</label>
                    <textarea
                      className="input"
                      rows={4}
                      placeholder={'# Netscape HTTP Cookie File… (paste the whole export)'}
                      value={cookiesText}
                      onChange={(e) => { setCookiesText(e.target.value); if (cookieError) setCookieError(''); if (urlError) setUrlError(''); }}
                    />
                    <div className="cookie-or">— or —</div>
                    <label className="form-label-sm">Cookie file from your directory (any text file)</label>
                    <div className="row" style={{ alignItems: 'flex-end' }}>
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
                        placeholder="cookie file path…"
                        value={cookiesFile}
                        onChange={(e) => { setCookiesFile(e.target.value); if (cookieError) setCookieError(''); if (urlError) setUrlError(''); }}
                      />
                      <button
                        className="btn btn-small"
                        title="Choose cookies.txt file"
                        onClick={async () => {
                          if (!hasBackend()) return;
                          const f = await window.jetro!.pickFile();
                          if (f) {
                            setCookiesFile(f);
                            if (cookieError) setCookieError('');
                            if (urlError) setUrlError('');
                          }
                        }}
                      >…</button>
                    </div>
                    {cookieError && <div className="form-error-mt">{cookieError}</div>}
                    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-small"
                        title="Open the Get cookies.txt Locally plugin in the Chrome Web Store"
                        onClick={async () => {
                          try {
                            if (window.jetro?.openExternal) await window.jetro.openExternal(COOKIE_EXPORTER_URL);
                            else window.open(COOKIE_EXPORTER_URL, '_blank', 'noopener');
                          } catch {
                            try { window.open(COOKIE_EXPORTER_URL, '_blank', 'noopener'); } catch {}
                          }
                        }}
                      ><MdExtension className="btn-icon" /> Install cookie exporter extension</button>
                      <button className="btn btn-small btn-primary" disabled={videoLoading} onClick={detectVideo}>
                        <FiFilm className="btn-icon" /> {videoLoading ? 'Retrying…' : 'Retry with cookies'}
                      </button>
                    </div>
                  </div>
                )}
                {videoHint && !cookieError && <div className="video-hint">{videoTitle ? `${videoTitle} — ` : ''}{videoHint}</div>}
                {videoDetail && (
                  <div className="video-detail-wrap">
                    <button className="link-btn" onClick={() => setShowVideoDetail((v) => !v)}>
                      {showVideoDetail ? 'Hide details' : 'Show details'}
                    </button>
                    {showVideoDetail && <pre className="video-detail-log">{videoDetail}</pre>}
                  </div>
                )}
                {videoFormats.filter((f) => (f.kind || 'video') !== 'audio').length > 0 && (
                  <>
                    <div className="video-group-label">VIDEO — pick a height (no cap)</div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {videoFormats.filter((f) => (f.kind || 'video') !== 'audio').map((f) => {
                        const fKind = (f.kind || 'video') as 'video' | 'audio';
                        const active = selectedVideoKind === fKind && selectedVideoHeight === (f.height || 0) && selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'v-' + f.height + f.quality + (f.needsMerge ? '-m' : '')}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => {
                              setSelectedVideoUrl(f.url || '');
                              setSelectedVideoHeight(f.height || 0);
                              setSelectedVideoNeedsMerge(!!f.needsMerge);
                              setSelectedVideoKind('video');
                              setSelectedVideoExt(String(f.ext || '').toLowerCase());
                              setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
                              if (!filenameTouchedRef.current && videoTitle) setNewFilename(sanitizeVideoFilename(videoTitle, f.ext));
                            }}
                          >{f.height ? `${f.height}p` : f.quality} · {f.ext}{f.needsMerge ? ' · merge' : ''}{Number((f as any)?.estimatedBytes || 0) > 0 ? ` · ${fmtSize(Number((f as any).estimatedBytes), true)}` : ''}</button>
                        );
                      })}
                    </div>
                  </>
                )}
                {videoFormats.filter((f) => f.kind === 'audio').length > 0 && (
                  <>
                    <div className="video-group-label">AUDIO — best available per format</div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {videoFormats.filter((f) => f.kind === 'audio').map((f) => {
                        const active = selectedVideoKind === 'audio' && selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'a-' + f.quality + f.ext}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => {
                              setSelectedVideoUrl('');
                              setSelectedVideoHeight(0);
                              setSelectedVideoNeedsMerge(true);
                              setSelectedVideoKind('audio');
                              setSelectedVideoExt(String(f.ext || '').toLowerCase());
                              setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
                              if (!filenameTouchedRef.current && videoTitle) setNewFilename(sanitizeVideoFilename(videoTitle, f.ext));
                              else if (filenameTouchedRef.current && newFilename && extOf(newFilename) !== String(f.ext || '').toLowerCase()) {
                                const base = newFilename.slice(0, newFilename.lastIndexOf('.') > 0 ? newFilename.lastIndexOf('.') : undefined);
                                setNewFilename(`${base}.${f.ext}`);
                              }
                            }}
                          >{f.abr ? `${f.ext} · ${Math.round(f.abr)}k` : `${f.quality} · ${f.ext}`}{Number((f as any)?.estimatedBytes || 0) > 0 ? ` · ${fmtSize(Number((f as any).estimatedBytes), true)}` : ''}</button>
                        );
                      })}
                    </div>
                  </>
                )}
                {!!selectedVideoKind && (
                  <div className="video-selected">
                    {selectedVideoKind === 'audio'
                      ? `Selected audio${selectedVideoEstimatedBytes > 0 ? ` (${fmtSize(selectedVideoEstimatedBytes, true)} estimated)` : ''} — Download will fetch best audio + convert if needed.`
                      : selectedVideoNeedsMerge || !selectedVideoUrl
                        ? `Selected ${selectedVideoHeight ? `${selectedVideoHeight}p` : 'best video'}${selectedVideoEstimatedBytes > 0 ? ` (${fmtSize(selectedVideoEstimatedBytes, true)} estimated)` : ''} — Download will fetch + merge to mp4.`
                        : 'Selected — Download will fetch the video file directly.'}
                  </div>
                )}
                {(videoFormats.length > 0 || playlist) && (
                  <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={videoSubtitles} onChange={(e) => setVideoSubtitles(e.target.checked)} /> Subtitles (EN)</label>
                    <select className="input" style={{ flex: 1, minWidth: 140, marginBottom: 0 }} value={videoQueueId} onChange={(e) => setVideoQueueId(e.target.value)} title="Add video to queue">
                      <option value="">No queue</option>
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.running ? ' (running)' : ''}</option>)}
                    </select>
                  </div>
                )}
                {playlist && playlist.entries.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="video-group-label">PLAYLIST — {playlist.count} videos{playlist.count > 50 ? ' (first 50 shown)' : ''}{playlist.title ? ` • ${playlist.title}` : ''}</div>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <button className="btn btn-small" onClick={() => setPlaylistSelected(new Set(playlist.entries.map((en) => String(en.url))))}>Select all</button>
                      <button className="btn btn-small" onClick={() => setPlaylistSelected(new Set())}>Clear</button>
                      <span className="queue-meta">{playlistSelected.size} selected — each becomes its own download</span>
                    </div>
                    <div className="ctx-queue-list" style={{ maxHeight: 180 }}>
                      {playlist.entries.map((en) => {
                        const key = String(en.url);
                        const on = playlistSelected.has(key);
                        return (
                          <label key={key} className="ctx-item" style={{ cursor: 'pointer' }} title={en.url}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setPlaylistSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })}
                            />
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{en.title}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button className="btn btn-primary btn-small" style={{ marginTop: 8 }} disabled={playlistAdding || playlistSelected.size === 0 || !selectedVideoKind} onClick={startPlaylistDownload}>
                      {playlistAdding ? 'Adding…' : `Download ${playlistSelected.size} video${playlistSelected.size === 1 ? '' : 's'}`}
                    </button>
                  </div>
                )}
              </div>
            )}
            <label className="form-label">Save to folder</label>
            <div className="save-path-box">
              <input className="input" placeholder="Choose a folder…" value={savePath} onChange={(e) => setSavePath(e.target.value)} />
              <button className="btn" title="Choose folder" onClick={() => chooseSaveFolder()}>…</button>
            </div>
            {isVideoPageUrl(newUrl) ? (
              <div className="queue-note">Video/audio downloads run via yt-dlp, which manages its own connections — queues don&apos;t apply.</div>
            ) : (
              <div className="row">
                <select className="input" style={{ flex: 1, minWidth: 0, marginBottom: 0 }} value={newConns} onChange={(e) => setNewConns(Number(e.target.value))}>
                  {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{n} connections</option>)}
                </select>
                <select className="input" style={{ flex: 1, minWidth: 0, marginBottom: 0 }} value={newQueueId} onChange={(e) => setNewQueueId(e.target.value)} title="Add to queue">
                  <option value="">No queue</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>{q.name}{q.running ? ' (running)' : ''}</option>
                  ))}
                </select>
              </div>
            )}
            <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) { setNewUrl(t.trim()); setUrlError(''); filenameTouchedRef.current = false; } } catch {} }}><FiClipboard className="btn-icon" /> Paste from clipboard</button>
            <div className="row modal-actions">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={adding} onClick={() => addDl()}>{adding ? 'Starting…' : 'Download'}</button>
            </div>
          </div>
        </div>
      )}

      {showBatch && batchStep === 1 && (
        <div className="modal-overlay" onClick={closeBatch}>
          <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiLayers className="inline-icon" /> New Batch Download</h2>
            <p>
              Batch download adds multiple file parts to your downloads at once, instead of pasting links one by one.{' '}
              Put an asterisk (<b>*</b>) where the part number or letter goes, then tweak the range below.{' '}
              Example: <code style={{ wordBreak: 'break-all' }}>example.com/files/part_*.zip</code> with 0–10 adds part_0 … part_10.
            </p>
            <label className="form-label">Address link (must contain *)</label>
            <input
              className="input"
              autoFocus
              placeholder="example.com/files/part_*.zip"
              value={batchUrl}
              onChange={(e) => { setBatchUrl(e.target.value); if (batchError) setBatchError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBatchOk(); }}
              style={batchError && !batchUrl.includes('*') ? { borderColor: 'var(--red)' } : undefined}
            />
            <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Replace * with</label>
            <div className="theme-segment" role="radiogroup" aria-label="Replace asterisk with">
              {(['numbers', 'letters'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={batchMode === m}
                  className={batchMode === m ? 'active' : ''}
                  onClick={() => { setBatchMode(m); setBatchError(''); }}
                >{m === 'numbers' ? 'Numbers' : 'Letters'}</button>
              ))}
            </div>
            {batchMode === 'numbers' ? (
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label className="form-label">From</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={999999}
                    step={1}
                    value={batchFromNum}
                    onChange={(e) => { setBatchFromNum(e.target.value); if (batchError) setBatchError(''); }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">To</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={999999}
                    step={1}
                    value={batchToNum}
                    onChange={(e) => { setBatchToNum(e.target.value); if (batchError) setBatchError(''); }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Wildcard size (1–10)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={batchWildcard}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Numbers only, clamp 1–10 on blur/OK; allow typing.
                      if (v === '' || /^\d+$/.test(v)) setBatchWildcard(v);
                      if (batchError) setBatchError('');
                    }}
                    onBlur={() => {
                      const n = parseInt(batchWildcard, 10);
                      if (!Number.isFinite(n)) setBatchWildcard('1');
                      else setBatchWildcard(String(Math.min(10, Math.max(1, n))));
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label className="form-label">From (a–z)</label>
                  <div className="batch-stepper">
                    <input
                      className="input"
                      maxLength={1}
                      value={batchFromLetter}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1);
                        setBatchFromLetter(v || '');
                        if (batchError) setBatchError('');
                      }}
                      style={{ marginBottom: 0, textAlign: 'center' }}
                    />
                    <div className="batch-stepper-btns">
                      <button className="btn btn-small" title="Next letter" onClick={() => setBatchFromLetter((v) => stepLetter(v || 'a', 1))}>▲</button>
                      <button className="btn btn-small" title="Previous letter" onClick={() => setBatchFromLetter((v) => stepLetter(v || 'a', -1))}>▼</button>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">To (a–z)</label>
                  <div className="batch-stepper">
                    <input
                      className="input"
                      maxLength={1}
                      value={batchToLetter}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1);
                        setBatchToLetter(v || '');
                        if (batchError) setBatchError('');
                      }}
                      style={{ marginBottom: 0, textAlign: 'center' }}
                    />
                    <div className="batch-stepper-btns">
                      <button className="btn btn-small" title="Next letter" onClick={() => setBatchToLetter((v) => stepLetter(v || 'z', 1))}>▲</button>
                      <button className="btn btn-small" title="Previous letter" onClick={() => setBatchToLetter((v) => stepLetter(v || 'z', -1))}>▼</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="batch-preview">
              <label className="form-label">First file</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchFirst} placeholder="—" title={batchFirst} />
              <label className="form-label">Second file</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchSecond} placeholder="—" title={batchSecond} />
              <div className="batch-ellipsis">…</div>
              <label className="form-label">Last file</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchLast} placeholder="—" title={batchLast} />
              {batchPreviewUrls.length > 0 && (
                <div className="form-hint" style={{ margin: '4px 0 0' }}>{batchPreviewUrls.length} file{batchPreviewUrls.length === 1 ? '' : 's'} will be added, lowest first.</div>
              )}
            </div>
            {batchValidation.error && batchUrl.trim() !== '' && (
              <div className="form-error" style={{ marginTop: 8 }}>{batchValidation.error}</div>
            )}
            {batchError && <div className="form-error" style={{ marginTop: 8 }}>{batchError}</div>}
            <label className="form-label">Save to folder</label>
            <div className="save-path-box">
              <input className="input" placeholder="Choose a folder…" value={batchSavePath} onChange={(e) => setBatchSavePath(e.target.value)} />
              <button
                className="btn"
                title="Choose folder"
                onClick={async () => {
                  if (!hasBackend()) return;
                  const f = await window.jetro!.pickFolder(batchSavePath || settings.downloadDir);
                  if (f) setBatchSavePath(f);
                }}
              >…</button>
            </div>
            <label className="form-label">Connections per file</label>
            <select className="input" style={{ marginBottom: 0 }} value={batchConns} onChange={(e) => setBatchConns(Number(e.target.value))}>
              {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{n} connections</option>)}
            </select>
            <button
              className="btn"
              style={{ width: '100%', marginTop: 10 }}
              onClick={async () => {
                try {
                  const t = await navigator.clipboard.readText();
                  if (t) { setBatchUrl(t.trim()); setBatchError(''); }
                } catch {}
              }}
            ><FiClipboard className="btn-icon" /> Paste from clipboard</button>
            <div className="row modal-actions">
              <button className="btn" disabled={batchResolving} onClick={closeBatch}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={batchResolving || !batchPreviewUrls.length}
                onClick={handleBatchOk}
              >OK</button>
            </div>
          </div>
        </div>
      )}

      {showBatch && batchStep === 2 && (
        <div className="modal-overlay" onClick={closeBatch}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiLayers className="inline-icon" /> Batch links ({batchUrls.length})</h2>
            <p>
              These links are resolved without downloading, so you can check you will get the right files.{' '}
              Files are added lowest first into a new queue, so they stay together instead of mixing with other downloads.{' '}
              Simultaneous files: <b>{Number(settings.maxConcurrentDownloads) || 3}</b> (change Concurrent downloads in Settings).
            </p>
            {batchResolving && <div className="video-hint">Resolving {batchUrls.length} links…</div>}
            {!batchResolving && batchRows.length > 0 && (
              <div className="video-hint">
                {batchOkCount} ok{batchFailCount ? ` • ${batchFailCount} failed` : ''} — failed links won&apos;t be added.
              </div>
            )}
            <div className="batch-list">
              {batchResolving && batchRows.length === 0 && (
                <div className="dropdown-empty">Resolving…</div>
              )}
              {batchRows.map((r, i) => (
                <div key={r.url + i} className="batch-row">
                  <span className="batch-num">{i + 1}</span>
                  <div className="batch-row-main">
                    <div className="batch-row-url" title={r.url}>{r.url}</div>
                    <div className="batch-row-meta">
                      {r.ok ? (
                        <>
                          <span className="badge green">OK</span>
                          <span className="batch-filename" title={r.filename}>{r.filename}</span>
                          <span>{r.totalBytes ? fmtBytes(r.totalBytes) : 'size unknown'}</span>
                        </>
                      ) : (
                        <>
                          <span className="badge red">Failed</span>
                          <span className="batch-filename" title={r.error || 'Invalid link'}>{r.error || 'Invalid link'}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {batchError && <div className="form-error" style={{ marginTop: 8 }}>{batchError}</div>}
            <div className="row modal-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn" disabled={batchAdding || batchResolving} onClick={closeBatch}>Cancel</button>
              <button className="btn" disabled={batchAdding || batchResolving} onClick={() => { if (!batchResolving && !batchAdding) setBatchStep(1); }}>← Back</button>
              <button
                className="btn btn-primary"
                disabled={batchAdding || batchResolving || batchOkCount === 0}
                onClick={handleBatchDownload}
              >{batchAdding ? 'Adding…' : `Download${batchOkCount ? ` (${batchOkCount})` : ''}`}</button>
            </div>
          </div>
        </div>
      )}

      {pendingFormatConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPendingFormatConfirm(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiFileText className="inline-icon" /> Change file format?</h2>
            <p>
              The link points to {pendingFormatConfirm.detExt ? <>a <b>.{pendingFormatConfirm.detExt}</b> file</> : 'a file with no extension'}{' '}
              (<b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.detectedName}</b>), but you named it{' '}
              <b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.finalName}</b>
              {pendingFormatConfirm.finalExt ? '' : ' (no extension)'}. The downloaded content
              stays the same — only the name changes, and your system may no longer recognize how to open it.
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus disabled={adding} onClick={confirmFormatAnyway}>{adding ? 'Starting…' : 'Download anyway'}</button>
              <button className="btn" disabled={adding} onClick={useOriginalFilename}>Use original name</button>
              <button className="btn" disabled={adding} onClick={() => setPendingFormatConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {pendingCollision && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPendingCollision(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiFileText className="inline-icon" /> File already exists</h2>
            <p>
              <b style={{ wordBreak: 'break-all' }}>{pendingCollision.filename}</b> is already in{' '}
              <b style={{ wordBreak: 'break-all' }}>{pendingCollision.dir || settings.downloadDir}</b>.
              What do you want to do?
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus disabled={adding} onClick={() => resolveCollision('replace')}>Replace file</button>
              <button className="btn" disabled={adding} onClick={() => resolveCollision('rename')}>Keep both</button>
              <button className="btn" disabled={adding} onClick={() => setPendingCollision(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showQueueModal && (
        <div className="modal-overlay" onClick={() => { setShowQueueModal(null); setPendingQueueMove(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{showQueueModal.mode === 'create' ? (<><FiPlus className="inline-icon" /> Create New Queue</>) : (<><FiEdit2 className="inline-icon" /> Edit Queue / Schedule</>)}</h2>
            <p>{showQueueModal.mode === 'create' ? 'Group downloads and start them together, optionally on a schedule.' : 'Rename or schedule this queue.'}</p>
            <label style={{ fontSize: 12 }}>Queue name *</label>
            <input
              className="input"
              autoFocus
              value={qName}
              onChange={(e) => {
                setQName(e.target.value);
                if (e.target.value.trim()) setQNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && qName.trim()) saveQueueModal();
              }}
              placeholder="e.g. Night batch"
              style={qNameError ? { borderColor: 'var(--red)' } : undefined}
            />
            {qNameError && <div className="form-error">{qNameError}</div>}
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={qSchedOn}
                onChange={(e) => {
                  setQSchedOn(e.target.checked);
                  setQSchedError('');
                }}
              /> Run only on schedule
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Start</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  placeholder="22:00"
                  value={qStart}
                  disabled={!qSchedOn}
                  onChange={(e) => {
                    setQStart(e.target.value);
                    if (qSchedError) setQSchedError('');
                  }}
                  style={qSchedError ? { borderColor: 'var(--red)' } : undefined}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Stop</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  placeholder="07:00"
                  value={qStop}
                  disabled={!qSchedOn}
                  onChange={(e) => {
                    setQStop(e.target.value);
                    if (qSchedError) setQSchedError('');
                  }}
                  style={qSchedError ? { borderColor: 'var(--red)' } : undefined}
                />
              </div>
            </div>
            {qSchedError && <div className="form-error">{qSchedError}</div>}
            <label style={{ fontSize: 12, marginTop: 12, display: 'block' }}>When queue finishes (all completed)</label>
            <select className="input" value={qPower} onChange={(e) => setQPower(normalizeQueuePowerAction(e.target.value))} title="Power action runs 60s after every file in this queue completes">
              {QUEUE_POWER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="form-hint" style={{ margin: '4px 0 0' }}>Off by default. Fires only when every file in this queue is completed.</div>
            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                onClick={saveQueueModal}
                disabled={!qName.trim() || (qSchedOn && (!normalizeTime24h(qStart) || !normalizeTime24h(qStop)))}
              >
                {showQueueModal.mode === 'create' ? 'Create queue' : 'Save changes'}
              </button>
              <button className="btn" onClick={() => { setShowQueueModal(null); setPendingQueueMove(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && draftSettings && (
        <div className="modal-overlay" onClick={attemptCloseSettings}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiSettings className="inline-icon" /> Settings</h2>
            <p>Queue, speed limit & proxy.</p>
            <label style={{ fontSize: 12 }}>Default download folder</label>
            <div className="row">
              <input className="input" value={draftSettings.downloadDir} onChange={(e) => setDraftSettings({ ...draftSettings, downloadDir: e.target.value })} />
              <button className="btn" onClick={async () => { const f = await window.jetro?.pickFolder(); if (f) setDraftSettings((s: any) => ({ ...s, downloadDir: f })); }}>…</button>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Connections</label>
                <select
                  className="input"
                  value={normalizeConnectionOption(draftSettings.maxConnections)}
                  onChange={(e) => setDraftSettings({ ...draftSettings, maxConnections: Number(e.target.value) })}
                >
                  {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{n} connections</option>)}
                  {!CONNECTION_OPTIONS.includes(normalizeConnectionOption(draftSettings.maxConnections)) && (
                    <option value={normalizeConnectionOption(draftSettings.maxConnections)}>{normalizeConnectionOption(draftSettings.maxConnections)} connections</option>
                  )}
                </select></div>
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Concurrent downloads</label>
                <input className="input" type="number" min={1} max={10} value={draftSettings.maxConcurrentDownloads} onChange={(e) => setDraftSettings({ ...draftSettings, maxConcurrentDownloads: Number(e.target.value) })} /></div>
            </div>
            <label style={{ fontSize: 12 }}>Speed limit</label>
            <select
              className="input"
              value={Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))}
              onChange={(e) => setDraftSettings({ ...draftSettings, speedLimitKBps: Number(e.target.value) })}
            >
              {SPEED_LIMIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!SPEED_LIMIT_OPTIONS.some((o) => o.value === Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))) && (
                <option value={Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))}>
                  {speedLimitLabel(draftSettings.speedLimitKBps)}
                </option>
              )}
            </select>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!draftSettings.autoCaptureClipboard} onChange={(e) => setDraftSettings({ ...draftSettings, autoCaptureClipboard: e.target.checked })} /> Clipboard auto-capture</label>
            <div className="settings-section">
              <h3 className="settings-section-title"><FiRotateCcw className="inline-icon" /> Auto-retry</h3>
              <p className="settings-section-sub">Failed downloads are re-queued with backoff instead of stopping at error.</p>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={draftSettings.autoRetryEnabled !== false} onChange={(e) => setDraftSettings({ ...draftSettings, autoRetryEnabled: e.target.checked })} /> Retry failed downloads</label>
              <div className="row">
                <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Max retries</label>
                  <input className="input" type="number" min={0} max={10} value={Math.min(10, Math.max(0, Math.round(Number(draftSettings.maxRetries ?? 3))))} onChange={(e) => setDraftSettings({ ...draftSettings, maxRetries: Number(e.target.value) })} /></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Base delay (sec)</label>
                  <input className="input" type="number" min={1} max={300} value={Math.min(300, Math.max(1, Math.round(Number(draftSettings.retryDelaySec ?? 5))))} onChange={(e) => setDraftSettings({ ...draftSettings, retryDelaySec: Number(e.target.value) })} /></div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiBox className="inline-icon" /> App</h3>
              <p className="settings-section-sub">Appearance & tray behavior.</p>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Appearance</label>
              <div className="theme-segment" role="radiogroup" aria-label="Appearance">
                {([
                  { key: 'light', label: 'Light', Icon: FiSun },
                  { key: 'dark', label: 'Dark', Icon: FiMoon },
                  { key: 'system', label: 'System', Icon: FiMonitor },
                ] as const).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={normalizeTheme(draftSettings.theme) === key}
                    className={normalizeTheme(draftSettings.theme) === key ? 'active' : ''}
                    onClick={() => {
                      setDraftSettings({ ...draftSettings, theme: key });
                      // Live preview without waiting for Save.
                      setThemeChoice(key);
                      try { localStorage.setItem(THEME_KEY, key); } catch {}
                    }}
                  ><Icon size={14} /> {label}</button>
                ))}
              </div>
              <label style={{ fontSize: 12 }}>When I click the X button</label>
              <select
                className="input"
                value={draftSettings.closeAction || 'ask'}
                onChange={(e) => setDraftSettings({ ...draftSettings, closeAction: e.target.value })}
              >
                <option value="ask">Ask every time</option>
                <option value="minimize">Minimize to tray</option>
                <option value="exit">Exit app</option>
              </select>
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiGlobe className="inline-icon" /> Proxy</h3>
              <p className="settings-section-sub">Route all download traffic through a proxy. Applies to new requests immediately.</p>
              <label style={{ fontSize: 12 }}>Proxy mode</label>
              <select
                className="input"
                value={draftSettings.proxyMode || 'none'}
                onChange={(e) => setDraftSettings({ ...draftSettings, proxyMode: e.target.value })}
              >
                <option value="none">No proxy (direct connection)</option>
                <option value="system">Use system proxy</option>
                <option value="custom">Custom proxy</option>
              </select>

              {(draftSettings.proxyMode || 'none') === 'custom' && (
                <>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Type</label>
                      <select className="input" value={draftSettings.proxyType || 'http'} onChange={(e) => setDraftSettings({ ...draftSettings, proxyType: e.target.value })}>
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks4">SOCKS4</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 12 }}>Host</label>
                      <input className="input" placeholder="proxy.example.com" value={draftSettings.proxyHost || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyHost: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Port</label>
                      <input className="input" type="number" min={1} max={65535} value={draftSettings.proxyPort || 8080} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPort: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Username (optional)</label>
                      <input className="input" autoComplete="off" value={draftSettings.proxyUser || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyUser: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Password (optional)</label>
                      <input className="input" type="password" autoComplete="new-password" value={draftSettings.proxyPass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPass: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {(draftSettings.proxyMode || 'none') !== 'none' && (
                <>
                  <label style={{ fontSize: 12 }}>Bypass (comma-separated, always skips localhost)</label>
                  <input className="input" placeholder="localhost,127.0.0.1,::1" value={draftSettings.proxyBypass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyBypass: e.target.value })} />
                </>
              )}
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiTool className="inline-icon" /> Others</h3>
              <p className="settings-section-sub">External tools used by Jetro.</p>
              <div className="vpn-status-box">
                <span className={'vpn-pill ' + (binStatus ? (binStatus.available ? 'on' : 'off') : '')}>
                  {binStatus ? (binStatus.available ? `● yt-dlp ${binStatus.version || ''}` : '○ yt-dlp missing') : '… checking'}
                </span>
                <button
                  className="btn btn-small"
                  disabled={binRefreshing}
                  onClick={refreshBinStatus}
                >{binRefreshing ? 'Checking…' : 'Refresh'}</button>
                <button
                  className="btn btn-small"
                  title={binStatus?.path ? `Open containing folder` : 'Tool location unknown'}
                  disabled={!binStatus?.path}
                  onClick={async () => {
                    if (!binStatus?.path || !hasBackend()) return;
                    try {
                      await window.jetro!.revealInFolder(binStatus.path);
                    } catch (e: any) {
                      alert(e?.message || 'Could not open folder');
                    }
                  }}
                ><FiFolder className="btn-icon" /></button>
              </div>
              {binStatus?.path && <div className="settings-muted"><code style={{ wordBreak: 'break-all' }}>{binStatus.path}</code></div>}
              <label style={{ fontSize: 13, marginTop: 10, display: 'block' }}><input type="checkbox" checked={draftSettings.checkUpdatesOnStart !== false} onChange={(e) => setDraftSettings({ ...draftSettings, checkUpdatesOnStart: e.target.checked })} /> Check for updates on startup</label>
              <div className="vpn-status-box" style={{ marginTop: 8 }}>
                <span className={'vpn-pill ' + (updateInfo ? (updateInfo.updateAvailable ? 'off' : 'on') : '')}>
                  {updateChecking ? '… checking' : updateInfo ? (updateInfo.updateAvailable ? `● v${updateInfo.latest} available (you have v${updateInfo.current})` : `● v${updateInfo.current} up to date`) : '○ not checked'}
                </span>
                <button
                  className="btn btn-small"
                  disabled={updateChecking}
                  onClick={async () => {
                    if (!hasBackend()) return;
                    setUpdateChecking(true);
                    try {
                      const r = await window.jetro!.checkUpdate?.();
                      if (r) setUpdateInfo(r);
                    } catch {}
                    setUpdateChecking(false);
                  }}
                >{updateChecking ? 'Checking…' : 'Check now'}</button>
                {updateInfo?.updateAvailable && (
                  <button className="btn btn-small btn-primary" onClick={() => openExternalUrl(updateInfo.url || 'https://github.com/Erkalin/Jetro/releases')}>Download</button>
                )}
              </div>
              {updateInfo?.error && <div className="settings-muted">{updateInfo.error}</div>}
            </div>

            <div className="row modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={attemptCloseSettings}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSettingsAndClose}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && showDiscardConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setShowDiscardConfirm(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiXCircle className="inline-icon" /> Discard unsaved changes?</h2>
            <p>You have unsaved changes in Settings. If you cancel now, your changes will be lost.</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setShowDiscardConfirm(false)}>Keep editing</button>
              <button className="btn btn-danger" onClick={discardSettingsChanges}>Discard changes</button>
            </div>
          </div>
        </div>
      )}

      {showClosePrompt && (
        <div className="modal-overlay" style={{ zIndex: 70 }} onClick={() => decideClose('cancel')}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiXCircle className="inline-icon" /> Close Jetro?</h2>
            <p>Do you want to exit Jetro or minimize it to the tray?</p>
            <p className="settings-section-sub">Minimized, Jetro keeps running in the tray and downloads continue.</p>
            <label style={{ fontSize: 13, display: 'block' }}>
              <input type="checkbox" checked={closeRemember} onChange={(e) => setCloseRemember(e.target.checked)} /> Remember my choice
            </label>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus onClick={() => decideClose('minimize')}>Minimize to tray</button>
              <button className="btn btn-danger" onClick={() => decideClose('exit')}>Exit Jetro</button>
              <button className="btn" onClick={() => decideClose('cancel')}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {powerDialog && (
        <div className="modal-overlay" style={{ zIndex: 75 }}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Queue finished — {queuePowerLabel(powerDialog.action)} in {powerDialog.secondsLeft}s</h2>
            <p>Every file in “{powerDialog.queueName}” is completed. Your PC will {queuePowerLabel(powerDialog.action).toLowerCase()} automatically. You can cancel below.</p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                autoFocus
                onClick={async () => {
                  try { await window.jetro?.powerExecute?.(powerDialog.queueId); } catch {}
                  setPowerDialog(null);
                }}
              >{queuePowerLabel(powerDialog.action)} now</button>
              <button
                className="btn"
                onClick={async () => {
                  try { await window.jetro?.powerCancel?.(powerDialog.queueId); } catch {}
                  setPowerDialog(null);
                }}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}

      {completedPopup && (
        <div className="modal-overlay complete-overlay" onClick={dismissCompletedPopup}>
          <div className="modal complete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="complete-glow" />
            <button className="complete-close" title="Dismiss" onClick={dismissCompletedPopup}><FiX size={16} /></button>
            <div className="complete-icon"><FiCheckCircle size={34} /></div>
            <h2 className="complete-title">Download complete</h2>
            <p className="complete-sub">Your file is ready</p>
            <div className="complete-file">
              <div className="complete-file-icon"><OsFileIcon item={completedPopup} /></div>
              <div className="complete-file-info">
                <div className="complete-file-name" title={`${completedPopup.filename}\n${completedPopup.savePath}`}>{completedPopup.filename}</div>
                <div className="complete-file-meta">
                  <span>{fmtBytes(completedPopup.totalBytes || completedPopup.downloadedBytes)}</span>
                  <span className="complete-dot-sep">•</span>
                  <span className="complete-file-path" title={completedPopup.savePath}>{completedPopup.savePath}</span>
                </div>
              </div>
            </div>
            {completedQueue.length > 1 && (
              <div className="complete-more">+{completedQueue.length - 1} more finished</div>
            )}
            <div className="row complete-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.openFile(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || 'Could not open file');
                  }
                  dismissCompletedPopup();
                }}
              ><FiFileText className="btn-icon" /> Open file</button>
              <button
                className="btn"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.revealInFolder(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || 'Could not open folder');
                  }
                  dismissCompletedPopup();
                }}
              ><FiFolder className="btn-icon" /> Open folder</button>
            </div>
            <button className="complete-dismiss" onClick={dismissCompletedPopup}>Dismiss</button>
          </div>
        </div>
      )}

      {pendingRemoveItem && pendingRemove && (
        <div className="modal-overlay" onClick={() => setPendingRemove(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {pendingRemove.deleteFile ? (
                <><FiTrash2 className="inline-icon" /> Delete download?</>
              ) : (
                <><FiXCircle className="inline-icon" /> Cancel download?</>
              )}
            </h2>
            <p>
              {pendingRemove.deleteFile
                ? 'This will delete the downloaded file from your disk and remove it from the list. This cannot be undone.'
                : 'This download is not complete yet. Removing it will stop the download and discard its progress.'}
            </p>
            <div className="complete-file">
              <div className="complete-file-icon"><OsFileIcon item={pendingRemoveItem} /></div>
              <div className="complete-file-info">
                <div className="complete-file-name" title={`${pendingRemoveItem.filename}\n${pendingRemoveItem.savePath}`}>{pendingRemoveItem.filename}</div>
                <div className="complete-file-meta">
                  {pendingRemove.deleteFile ? (
                    <>
                      <span>{fmtSize(pendingRemoveItem.totalBytes || pendingRemoveItem.downloadedBytes, !!pendingRemoveItem.totalBytesIsEstimate && pendingRemoveItem.status !== 'completed')}</span>
                      <span className="complete-dot-sep">•</span>
                      <span className="complete-file-path" title={pendingRemoveItem.savePath}>{pendingRemoveItem.savePath}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: statusColor(pendingRemoveItem.status), fontWeight: 700 }}>{statusLabel(pendingRemoveItem.status)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{pendingRemoveItem.totalBytes ? `${Math.min(100, (pendingRemoveItem.downloadedBytes / pendingRemoveItem.totalBytes) * 100).toFixed(1)}%` : fmtBytes(pendingRemoveItem.downloadedBytes)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{fmtBytes(pendingRemoveItem.downloadedBytes)} / {fmtSize(pendingRemoveItem.totalBytes, !!pendingRemoveItem.totalBytesIsEstimate && pendingRemoveItem.status !== 'completed')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setPendingRemove(null)}>
                {pendingRemove.deleteFile ? 'Keep file' : 'Keep downloading'}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  window.jetro?.remove(pendingRemoveItem.id, pendingRemove.deleteFile);
                  setPendingRemove(null);
                }}
              >{pendingRemove.deleteFile ? 'Delete file' : 'Remove download'}</button>
            </div>
          </div>
        </div>
      )}

      {renameState && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => { if (!renaming) setRenameState(null); }}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiEdit2 className="inline-icon" /> Rename</h2>
            <p>Enter a new name for this download. The file on disk is renamed too.</p>
            <label className="form-label">File name</label>
            <input
              className="input"
              autoFocus
              value={renameState.name}
              onChange={(e) => setRenameState({ ...renameState, name: e.target.value, error: '' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRenameModal();
                if (e.key === 'Escape' && !renaming) setRenameState(null);
              }}
              style={renameState.error ? { borderColor: 'var(--red)' } : undefined}
            />
            {renameState.error && <div className="form-error">{renameState.error}</div>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={renaming} onClick={() => setRenameState(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={renaming || !renameState.name.trim()} onClick={saveRenameModal}>
                {renaming ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {propsId && (() => {
        const it = items.find((x) => x.id === propsId) || null;
        if (!it) return null;
        const pct = it.totalBytes ? Math.min(100, (it.downloadedBytes / it.totalBytes) * 100) : 0;
        const qn = it.queueId ? queueById(it.queueId)?.name : null;
        const rows: [string, string][] = [
          ['File name', it.filename],
          ['URL', it.url],
          ['Save path', it.savePath],
          ['Status', `${statusLabel(it.status)}${it.status !== 'completed' ? ` — ${pct.toFixed(2)}%` : ''}`],
          ['Size', it.status === 'completed'
            ? fmtBytes(it.totalBytes || it.downloadedBytes)
            : `${fmtBytes(it.downloadedBytes)} / ${fmtSize(it.totalBytes, !!it.totalBytesIsEstimate)}`],
          ['Speed', (it.status === 'downloading' || it.status === 'merging') ? fmtSpeed(it.speedBps || 0) : '—'],
          ['Connections', `${it.connections}x${it.supportsRange ? '' : ' (single connection)'}`],
          ['Category', it.category || 'other'],
          ['Queue', qn || 'No queue'],
          ['Created', it.createdAt ? new Date(it.createdAt).toLocaleString() : '—'],
          ['Last try', fmtLastTryTitle(lastTryOf(it))],
        ];
        if (it.via === 'ytdlp') rows.push(['Source', it.audioOnly ? `audio${it.videoHeight ? '' : ''}` : `video${it.videoHeight ? ` ${it.videoHeight}p` : ''}`]);
        if (it.error) rows.push(['Error', it.error]);
        return (
          <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPropsId(null)}>
            <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title"><FiInfo className="inline-icon" /> Properties</h2>
              <div className="complete-file" style={{ marginBottom: 12 }}>
                <div className="complete-file-icon"><OsFileIcon item={it} /></div>
                <div className="complete-file-info">
                  <div className="complete-file-name" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
                  <div className="complete-file-meta">
                    <span style={{ color: statusColor(it.status), fontWeight: 700 }}>{statusLabel(it.status)}</span>
                    <span className="complete-dot-sep">•</span>
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="props-table">
                {rows.map(([k, v]) => (
                  <div className="props-row" key={k}>
                    <div className="props-key">{k}</div>
                    <div className="props-val" title={v}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 16 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!hasBackend()) return;
                    try { await window.jetro!.revealInFolder(it.savePath); } catch (e: any) { alert(e?.message || 'Could not open folder'); }
                  }}
                ><FiFolder className="btn-icon" /> Open Folder</button>
                <button className="btn btn-primary" autoFocus onClick={() => setPropsId(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
