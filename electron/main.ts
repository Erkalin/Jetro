import { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu, Tray, nativeImage, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SegmentedDownload, probeUrl, guessFilename, type ProxyOptions } from './downloader';
import {
  applySessionProxy,
  buildCustomProxyUrl,
  defaultNetworkSettings,
  normalizeNetworkSettings,
  resolveEffectiveProxyUrl,
  shouldBypassHostname,
  type NetworkSettings,
} from './proxy';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { resolveYtDlp, getYtDlpVersion, updateYtDlp, bundledYtDlpPath, userYtDlpPath, ffmpegDir, envWithBinPath, getFfmpegVersion, getQuickjsVersion, resolveFfmpeg, resolveFfprobe, resolveQuickjs } from './binaries';

interface Item {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'merging';
  speedBps: number;
  connections: number;
  supportsRange: boolean;
  error?: string;
  createdAt: number;
  category: string;
  queueId?: string | null;
  /** Last time this download was attempted (queued→active transition, resume, retry, finish). Falls back to createdAt for old rows. */
  lastTryAt?: number;
  /** Batch group id for "New Batch Download" items. Null/undefined = single download. */
  batchId?: string | null;
  /** Order inside its batch (0 = lowest asterisk value). Used to start in From→To order. */
  batchIndex?: number;
  /** 'ytdlp' = downloaded+merged by bundled yt-dlp+ffmpeg (YouTube split streams). Undefined = segmented engine. */
  via?: 'ytdlp';
  videoHeight?: number;
  /** True for audio-only yt-dlp downloads (best audio + optional ffmpeg extract). */
  audioOnly?: boolean;
  /** Browser name for yt-dlp --cookies-from-browser (login-walled sites). */
  cookiesFromBrowser?: string;
  /** Path to a Netscape cookies.txt file for yt-dlp --cookies. */
  cookiesFile?: string;
  /** True while totalBytes is a pre-merge estimate (video+audio sum / ~ sizes). Cleared on completion. */
  totalBytesIsEstimate?: boolean;
  /** Auto-retry bookkeeping (segmented + yt-dlp). */
  attempts?: number;
  /** Epoch ms when the next retry may start (pumpQueue skips until then). */
  nextRetryAt?: number | null;
  /** Write subtitles for yt-dlp downloads. */
  subtitles?: boolean;
}

export type QueuePowerAction = 'nothing' | 'sleep' | 'hibernate' | 'shutdown' | 'restart';

interface Queue {
  id: string;
  name: string;
  running: boolean;
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
  /** Power action fired when every item in the queue is completed. Default 'nothing' (off). */
  afterComplete?: QueuePowerAction;
  /** Epoch ms when the power action fired (fire-once guard, reset on new work). Null = not fired. */
  powerFiredAt?: number | null;
}

function normalizeQueuePowerAction(v: any): QueuePowerAction {
  return v === 'sleep' || v === 'hibernate' || v === 'shutdown' || v === 'restart' ? v : 'nothing';
}

const storeDir = path.join(app.getPath('userData'), 'jetro');
const storeFile = path.join(storeDir, 'downloads.json');
const settingsFile = path.join(storeDir, 'settings.json');
const queuesFile = path.join(storeDir, 'queues.json');

let win: BrowserWindow | null = null;
let items: Item[] = [];
let queues: Queue[] = [];
let runners = new Map<string, SegmentedDownload>();
/** Active yt-dlp merge processes (video downloads) + their progress timers. */
let ytJobs = new Map<string, { proc: ChildProcess; timer: NodeJS.Timeout; lastBytes: number; lastTick: number }>();
type ThemeChoice = 'light' | 'dark' | 'system';
function normalizeTheme(v: any): ThemeChoice {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}
/** Keep the native chrome (scrollbars, dialogs, titlebar) + window bg in sync with the glass theme. */
function applyNativeTheme() {
  try {
    const choice = normalizeTheme((settings as any).theme);
    nativeTheme.themeSource = choice;
    const dark = choice === 'dark' || (choice === 'system' && nativeTheme.shouldUseDarkColors);
    try { win?.setBackgroundColor(dark ? '#080f20' : '#ffffff'); } catch {}
  } catch {}
}
let settings: {
  maxConnections: number;
  maxConcurrentDownloads: number;
  downloadDir: string;
  speedLimitKBps: number;
  autoCaptureClipboard: boolean;
  /** X-button behavior: ask every time, minimize to tray, or exit. */
  closeAction: 'ask' | 'minimize' | 'exit';
  /** Glass theme: light / dark / follow the OS. */
  theme: ThemeChoice;
  /** Auto-retry failed downloads with backoff. */
  autoRetryEnabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  /** Check GitHub releases on startup. */
  checkUpdatesOnStart: boolean;
} & NetworkSettings = {
  maxConnections: 8,
  maxConcurrentDownloads: 3,
  downloadDir: app.getPath('downloads'),
  speedLimitKBps: 0,
  autoCaptureClipboard: true,
  closeAction: 'ask',
  theme: 'system',
  autoRetryEnabled: true,
  maxRetries: 3,
  retryDelaySec: 5,
  checkUpdatesOnStart: true,
  ...defaultNetworkSettings(),
};

function normalizeRetrySettings(s: any) {
  const enabled = (s as any)?.autoRetryEnabled !== false;
  const maxR = Math.min(10, Math.max(0, Math.round(Number((s as any)?.maxRetries ?? 3))));
  const delay = Math.min(300, Math.max(1, Math.round(Number((s as any)?.retryDelaySec ?? 5))));
  (s as any).autoRetryEnabled = enabled;
  (s as any).maxRetries = Number.isFinite(maxR) ? maxR : 3;
  (s as any).retryDelaySec = Number.isFinite(delay) ? delay : 5;
  (s as any).checkUpdatesOnStart = (s as any)?.checkUpdatesOnStart !== false;
}

function networkCfg(): NetworkSettings {
  return normalizeNetworkSettings(settings);
}

/** Live proxy options for the downloader (resolves system proxy per URL). */
function currentProxyOpts(): ProxyOptions {
  const cfg = networkCfg();
  return {
    proxyBypass: cfg.proxyBypass,
    proxyUrl: cfg.proxyMode === 'custom' ? buildCustomProxyUrl(cfg) : null,
    getProxyUrl: async (targetUrl: string) => {
      const eff = await resolveEffectiveProxyUrl(targetUrl, cfg);
      return eff.proxyUrl;
    },
  };
}

async function refreshNetworkRouting() {
  try {
    await applySessionProxy(networkCfg());
  } catch {}
  // Push new proxy config to running downloads so it applies without restart.
  try {
    const opts = currentProxyOpts();
    runners.forEach((dl) => dl.updateProxy(opts));
  } catch {}
}

function loadAll() {
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    if (fs.existsSync(storeFile)) items = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (fs.existsSync(settingsFile)) settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
    if (fs.existsSync(queuesFile)) queues = JSON.parse(fs.readFileSync(queuesFile, 'utf8'));
    // backfill queueId / batch fields for old items
    items = items.map((i: any) => ({ queueId: null, batchId: null, batchIndex: 0, attempts: 0, nextRetryAt: null, ...i }));
    // backfill Last Try for rows saved before lastTryAt existed
    items = items.map((i: any) => ({
      ...i,
      lastTryAt: Number(i?.lastTryAt) > 0 ? Number(i.lastTryAt) : Number(i?.createdAt) || 0,
    }));
    // The separate batch-concurrency setting was removed: batches now live in
    // their own queue which follows the global concurrent-downloads setting.
    delete (settings as any).batchConcurrentDownloads;
    // The global scheduler was removed: per-queue schedules are the only
    // scheduler now. Drop stale keys from old settings files / old clients.
    delete (settings as any).schedulerEnabled;
    delete (settings as any).schedulerStart;
    delete (settings as any).schedulerStop;
    // Normalize per-queue schedules to strict 24-hour HH:MM so an old or
    // hand-edited queues.json can never wedge a queue shut.
    try {
      queues = (Array.isArray(queues) ? queues : []).map((q: any) => ({
        ...q,
        schedulerEnabled: !!q?.schedulerEnabled,
        scheduleStart: normalizeTime24h(q?.scheduleStart) || '22:00',
        scheduleStop: normalizeTime24h(q?.scheduleStop) || '07:00',
        afterComplete: normalizeQueuePowerAction(q?.afterComplete),
        powerFiredAt: Number(q?.powerFiredAt) > 0 ? Number(q.powerFiredAt) : null,
      }));
    } catch {}
    // Backfill retry + update-check defaults for old settings files.
    try { normalizeRetrySettings(settings); } catch {}
    // Old yt-dlp rows predate estimates: their totals were single-file based,
    // so treat active ones as estimates until they complete and get real sizes.
    items = items.map((i: any) =>
      i?.via === 'ytdlp' && i?.status !== 'completed' && (i?.totalBytes || 0) > 0 && i?.totalBytesIsEstimate === undefined
        ? { ...i, totalBytesIsEstimate: true }
        : i,
    );
    // backfill proxy defaults for old settings files
    settings = { ...settings, ...normalizeNetworkSettings(settings) };
    // drop removed VPN option from old settings files
    delete (settings as any).vpnKillSwitch;
    // backfill app/tray defaults for old settings files
    (settings as any).closeAction = normalizeCloseAction((settings as any).closeAction);
    (settings as any).theme = normalizeTheme((settings as any).theme);
    // the run-at-startup feature was removed: drop any stale saved flag
    delete (settings as any).launchAtStartup;
    // a bare drive letter ("C:") is drive-relative and breaks mkdir — root it
    try { settings.downloadDir = normalizeDir(settings.downloadDir) || settings.downloadDir; } catch {}
    applyNativeTheme();
  } catch {}
}
function saveAllSync() {
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(items.slice(0, 500)));
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    fs.writeFileSync(queuesFile, JSON.stringify(queues.slice(0, 100)));
  } catch {}
}
let saveTimer: NodeJS.Timeout | null = null;
function saveAllDebounced() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.promises.mkdir(storeDir, { recursive: true }).then(() => {
        fs.promises.writeFile(storeFile, JSON.stringify(items.slice(0, 500))).catch(() => {});
        fs.promises.writeFile(settingsFile, JSON.stringify(settings)).catch(() => {});
        fs.promises.writeFile(queuesFile, JSON.stringify(queues.slice(0, 100))).catch(() => {});
      }).catch(() => {});
    } catch {}
  }, 1000);
}
let lastBroadcast = 0;
function broadcast(immediate = false) {
  const now = Date.now();
  // Coalesce 100ms progress ticks: at most 10 full-list sends/sec unless forced.
  // Disk persistence stays debounced at ~1s via saveAllDebounced below.
  if (!immediate && now - lastBroadcast < 100) {
    saveAllDebounced();
    return;
  }
  lastBroadcast = now;
  try {
    win?.webContents.send('dl:update', items);
    win?.webContents.send('queue:update', queues);
  } catch {}
  saveAllDebounced();
  if (immediate) {
    try { maybeFireQueuePower(); } catch {}
  }
}
function categoryOf(filename: string): string {
  const ext = (path.extname(filename) || '').toLowerCase();
  if (['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m3u8', '.mpd'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.flac', '.m4a', '.ogg'].includes(ext)) return 'audio';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'compressed';
  if (['.pdf', '.doc', '.docx', '.txt', '.epub'].includes(ext)) return 'document';
  if (['.exe', '.msi', '.dmg', '.apk'].includes(ext)) return 'program';
  return 'other';
}

/** Stamp a download attempt so the Details view "Last Try" column stays fresh. */
function touchTry(item: Item) {
  try {
    item.lastTryAt = Date.now();
  } catch {}
}

/**
 * A bare Windows drive ("C:") is drive-relative — mkdir('C:') fails with
 * ENOENT. Expand it to the drive root ("C:\") so drive roots just work.
 */
function normalizeDir(raw: string): string {
  const s = String(raw || '').trim();
  if (/^[a-zA-Z]:$/.test(s)) return s + path.sep;
  return s;
}

/** User-facing explanation for filesystem errors (e.g. protected drive roots). */
function friendlyFsError(e: any, dir: string): string {
  const msg = String(e?.message || e);
  if (/EPERM|EACCES|EROFS/i.test(msg)) {
    return `Permission denied writing to ${dir} — Windows protects that location. Run Jetro as administrator or choose another folder.`;
  }
  if (/ENOENT/i.test(msg) && /mkdir/i.test(msg)) {
    return `Could not create folder ${dir} — check the drive exists and try again.`;
  }
  return msg;
}

/**
 * Ensure downloads can actually be written to `dir`: create it if needed and
 * probe with a temp file. Throws a user-facing error otherwise, so adds fail
 * fast in the dialog instead of erroring mid-download with raw mkdir text.
 */
function assertDirWritable(rawDir: string): string {
  const dir = normalizeDir(rawDir);
  if (!dir) throw new Error('Please choose a download folder.');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e: any) {
    throw new Error(friendlyFsError(e, dir));
  }
  try {
    const probe = path.join(dir, `.jetro-write-test-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probe, '');
    try { fs.unlinkSync(probe); } catch {}
  } catch (e: any) {
    throw new Error(friendlyFsError(e, dir));
  }
  return dir;
}

/** True for localhost, IPv4/IPv6, or a dot-containing domain with a letter-bearing TLD. */
function isValidDownloadHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');
  if (!h || h.length > 253) return false;
  if (h === 'localhost') return true;
  // IPv4 (e.g. 192.168.1.10, optionally with port stripped already by URL)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    return h.split('.').every((p) => {
      if (!p || p.length > 3 || !/^\d+$/.test(p)) return false;
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
  // IPv6 — URL.hostname strips the brackets (e.g. ::1)
  if (h.includes(':')) {
    return /^[0-9a-f:]+$/i.test(h) && h.includes(':');
  }
  // Public domains must contain at least one dot (e.g. abcdef.xyz)
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
function activeCount() {
  return items.filter((i) => i.status === 'downloading').length;
}
function activeCountForQueue(queueId: string | null) {
  return items.filter((i) => (i.queueId || null) === (queueId || null) && i.status === 'downloading').length;
}

/** Non-retryable failures: user pause, validation, or unwritable location. */
function shouldAutoRetryError(e: any): boolean {
  const msg = String(e?.message || e || '').toLowerCase();
  if (msg.includes('aborted') || msg.includes('paused')) return false;
  if (msg.includes('permission denied') || msg.includes('could not create folder')) return false;
  if (msg.includes('pause the download before')) return false;
  return true;
}

const retryTimers = new Map<string, NodeJS.Timeout>();
function clearRetryTimer(id: string) {
  const t = retryTimers.get(id);
  if (t) {
    try { clearTimeout(t); } catch {}
    retryTimers.delete(id);
  }
}
/** Re-queue an item with exponential backoff. Returns true when scheduled. */
function scheduleAutoRetry(item: Item): boolean {
  try {
    if (!(settings as any).autoRetryEnabled) return false;
    const maxR = Math.min(10, Math.max(0, Math.round(Number((settings as any).maxRetries ?? 3))));
    const baseSec = Math.min(300, Math.max(1, Math.round(Number((settings as any).retryDelaySec ?? 5))));
    const used = Math.max(0, Math.round(Number(item.attempts || 0)));
    if (used >= maxR) return false;
    item.attempts = used + 1;
    const delayMs = Math.min(300000, baseSec * 1000 * 2 ** used);
    item.nextRetryAt = Date.now() + delayMs;
    item.status = 'queued';
    item.error = `${item.error || 'Failed'} — retrying (${item.attempts}/${maxR})`;
    item.speedBps = 0;
    touchTry(item);
    broadcast(true);
    clearRetryTimer(item.id);
    const timer = setTimeout(() => {
      retryTimers.delete(item.id);
      try {
        if (item.status === 'queued') {
          item.nextRetryAt = null;
          broadcast(true);
          if (item.via === 'ytdlp') {
            startYtDownload(item).catch(() => {});
          } else {
            pumpQueue();
          }
        }
      } catch {}
    }, delayMs + 50);
    try { (timer as any)?.unref?.(); } catch {}
    retryTimers.set(item.id, timer);
    return true;
  } catch {
    return false;
  }
}

/** Reset fire-once guard when a queue gains new work. */
function resetQueuePower(queueId: string | null) {
  if (!queueId) return;
  const q = queues.find((x) => x.id === queueId);
  if (q && q.powerFiredAt) {
    q.powerFiredAt = null;
    broadcast(true);
  }
}

/** Fire per-queue power actions: only when every item is completed. */
function maybeFireQueuePower() {
  try {
    for (const q of queues) {
      const action = normalizeQueuePowerAction((q as any).afterComplete);
      if (action === 'nothing') continue;
      if ((q as any).powerFiredAt) continue;
      const qItems = items.filter((i) => (i.queueId || null) === q.id);
      if (!qItems.length) continue;
      if (!qItems.every((i) => i.status === 'completed')) continue;
      (q as any).powerFiredAt = Date.now();
      broadcast(true);
      try {
        win?.webContents.send('queue:power-ready', { queueId: q.id, queueName: q.name, action });
      } catch {}
    }
  } catch {}
}

function runPowerAction(action: string) {
  const a = normalizeQueuePowerAction(action);
  if (a === 'nothing') return;
  try {
    if (process.platform !== 'win32') return;
    if (a === 'shutdown') {
      spawn('shutdown', ['/s', '/t', '0'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'restart') {
      spawn('shutdown', ['/r', '/t', '0'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'hibernate') {
      spawn('shutdown', ['/h'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'sleep') {
      spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    }
  } catch {}
}
/**
 * Legacy cap for pre-queue batches (batch items with no queueId, from before
 * each batch got its own queue). Follows the global concurrent-downloads
 * setting so old batches behave like new ones.
 */
function batchLimit(): number {
  const n = Number((settings as any).maxConcurrentDownloads ?? 3);
  return Math.min(10, Math.max(1, Math.round(n) || 3));
}
function activeCountForBatch(batchId: string): number {
  return items.filter((i) => (i.batchId || null) === batchId && i.status === 'downloading').length;
}
/** Queued items of one batch in From→To order (batchIndex asc, then createdAt). */
function queuedOfBatch(batchId: string): Item[] {
  const now = Date.now();
  return items
    .filter((i) => i.status === 'queued' && (i.batchId || null) === batchId && (!i.nextRetryAt || Number(i.nextRetryAt) <= now))
    .sort((a, b) => (Number(a.batchIndex ?? 0) - Number(b.batchIndex ?? 0)) || (a.createdAt - b.createdAt));
}
/** Strict 24-hour HH:MM ("00:00"–"23:59"). Accepts "2:5" → "02:05". Returns '' when invalid. */
function normalizeTime24h(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(s)) return s;
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
function time24hToMinutes(v: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
function inWindow(enabled: boolean, start?: string, stop?: string): boolean {
  if (!enabled) return true;
  const s = time24hToMinutes(String(start || ''));
  const e = time24hToMinutes(String(stop || ''));
  // Invalid times must never wedge a queue shut: fail open.
  if (!Number.isFinite(s) || !Number.isFinite(e)) return true;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
}
function inQueueWindow(q: Queue): boolean {
  return inWindow(q.schedulerEnabled, q.scheduleStart, q.scheduleStop);
}

/**
 * Enforce per-queue schedules: a running queue with a schedule only downloads
 * inside its 24h window. Active files are parked back to `queued` when the
 * window closes so the 1s pump restarts them when it re-opens (overnight
 * ranges like 22:00–07:00 work). Returns true when anything was parked.
 */
function enforceQueueSchedules(): boolean {
  let parked = false;
  for (const q of queues) {
    if (!q.running || !q.schedulerEnabled || inQueueWindow(q)) continue;
    for (const it of items.filter((i) => (i.queueId || null) === q.id && (i.status === 'downloading' || i.status === 'merging'))) {
      try {
        if (it.via === 'ytdlp') {
          try { killYtJob(it.id); } catch {}
        } else {
          const r = runners.get(it.id);
          if (r) {
            try { r.pause(); } catch {}
            runners.delete(it.id);
          } else {
            runners.delete(it.id);
          }
        }
      } catch {}
      it.status = 'queued';
      it.speedBps = 0;
      parked = true;
    }
  }
  if (parked) broadcast(true);
  return parked;
}

async function pumpQueue() {
  // Park anything running outside its queue's schedule window first, so closing
  // windows actually stop downloads (and re-opening windows resume them).
  enforceQueueSchedules();
  // Global (no-queue) downloads — singles first, then legacy batches in
  // From→To order. Legacy batch groups share the global concurrent-downloads
  // limit: at most that many files of the same batch download at once;
  // whichever finishes first frees a slot for the next file in the batch.
  // New batches live in their own queue (see batch:add) and are governed by
  // the global concurrent-downloads setting instead.
  {
    const now = Date.now();
    const retryReady = (i: Item) => !i.nextRetryAt || Number(i.nextRetryAt) <= now;
    const queuedSingles = items.filter((i) => i.status === 'queued' && !(i.queueId || null) && !(i.batchId || null) && retryReady(i));
    while (activeCount() < settings.maxConcurrentDownloads && queuedSingles.length) {
      const next = queuedSingles.shift()!;
      startDownload(next).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
    const batchIds = [...new Set(items.filter((i) => i.status === 'queued' && !(i.queueId || null) && (i.batchId || null)).map((i) => String(i.batchId)))];
    // Oldest batch first so two batches don't starve each other arbitrarily.
    batchIds.sort((a, b) => {
      const qa = queuedOfBatch(a)[0]?.createdAt ?? 0;
      const qb = queuedOfBatch(b)[0]?.createdAt ?? 0;
      return qa - qb;
    });
    for (const bid of batchIds) {
      const queued = queuedOfBatch(bid);
      while (
        queued.length &&
        activeCount() < settings.maxConcurrentDownloads &&
        activeCountForBatch(bid) < batchLimit()
      ) {
        const next = queued.shift()!;
        // Re-check: the item may have been paused/removed while we waited.
        if (next.status !== 'queued') continue;
        startDownload(next).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  // Per-queue downloads: only when queue is running + in its schedule window.
  // Every queue follows the global concurrent-downloads setting.
  for (const q of queues) {
    if (!q.running) continue;
    if (!inQueueWindow(q)) continue;
    const nowQ = Date.now();
    const queued = items
      .filter((i) => i.status === 'queued' && (i.queueId || null) === q.id && (!i.nextRetryAt || Number(i.nextRetryAt) <= nowQ))
      .sort((a, b) => (Number(a.batchIndex ?? 0) - Number(b.batchIndex ?? 0)) || (a.createdAt - b.createdAt));
    while (
      queued.length &&
      activeCount() < settings.maxConcurrentDownloads &&
      activeCountForQueue(q.id) < batchLimit()
    ) {
      const next = queued.shift()!;
      if (next.status !== 'queued') continue;
      startDownload(next).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function startDownload(item: Item) {
  if (runners.has(item.id)) return;
  if (item.nextRetryAt && Number(item.nextRetryAt) > Date.now()) return;
  item.nextRetryAt = null;
  item.status = 'downloading';
  item.error = undefined;
  touchTry(item);
  broadcast(true);
  const dl = new SegmentedDownload(
    item.url,
    item.savePath,
    item.connections || settings.maxConnections,
    (settings.speedLimitKBps || 0) * 1024,
    currentProxyOpts()
  );
  // Reuse the add-time probe instead of probing a second time: two probes of
  // a dynamic URL can report different sizes.
  if (item.totalBytes > 0) {
    dl.seedProbe = {
      totalBytes: item.totalBytes,
      supportsRange: item.supportsRange,
      filename: item.filename,
      contentType: '',
    };
  }
  runners.set(item.id, dl);
  dl.onProgress = (done, total) => {
    item.downloadedBytes = done;
    if (total) item.totalBytes = total;
    item.speedBps = dl.speedBps;
    broadcast();
  };
  try {
    await dl.run();
    try {
      // The file on disk is the truth: always sync both counters to it so a
      // stale probe total can never linger as "227 KB / 176 KB".
      const size = fs.statSync(item.savePath).size;
      item.downloadedBytes = size;
      item.totalBytes = size;
    } catch {}
    item.status = 'completed';
    item.speedBps = 0;
    item.attempts = 0;
    item.nextRetryAt = null;
    touchTry(item);
  } catch (e: any) {
    // Only this run may set the outcome: if the user already paused, re-queued,
    // or errored the item (or a newer run took over), leave their state alone.
    if (item.status === 'downloading') {
      if (String(e?.message || e).includes('aborted')) {
        item.status = 'paused';
        item.nextRetryAt = null;
      } else {
        try {
          item.error = friendlyFsError(e, path.dirname(item.savePath));
        } catch {
          item.error = String(e?.message || e);
        }
        if (shouldAutoRetryError(e) && scheduleAutoRetry(item)) {
          // scheduleAutoRetry re-queued with backoff; outcome handled there.
        } else {
          item.status = 'error';
          item.nextRetryAt = null;
        }
      }
      touchTry(item);
    }
    item.speedBps = 0;
  } finally {
    runners.delete(item.id);
    broadcast(true);
    pumpQueue();
  }
}

function resolveAppIcon(): string | undefined {
  // NOTE: `electron dist-electron/main.js` sets getAppPath() to dist-electron,
  // and packaged apps hide files inside app.asar (native icons need real files),
  // so probe every plausible location and skip anything inside an asar archive.
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'public', 'Jetro-notext.png'),
    path.join(app.getAppPath(), '..', 'public', 'Jetro-notext.png'),
    path.join(__dirname, '..', 'public', 'Jetro-notext.png'),
    path.join(process.resourcesPath, 'public', 'Jetro-notext.png'),
  ];
  for (const p of candidates) {
    try {
      if (p.includes('.asar') && !p.includes('.asar.unpacked')) continue;
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}

function createWindow() {
  const icon = resolveAppIcon();
  if (!icon) console.warn('[jetro] app icon not found, using default');
  const themeChoice = normalizeTheme((settings as any).theme);
  const startDark = themeChoice === 'dark' || (themeChoice === 'system' && nativeTheme.shouldUseDarkColors);
  try { nativeTheme.themeSource = themeChoice; } catch {}
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: startDark ? '#080f20' : '#ffffff',
    title: 'Jetro',
    autoHideMenuBar: true,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  win.once('ready-to-show', () => {
    try {
      win?.show();
      win?.focus();
    } catch {}
  });
  // X button: exit / minimize-to-tray per settings.closeAction.
  // 'ask' notifies the renderer, which shows a styled in-app dialog
  // (same .modal-overlay/.modal look as the other popups).
  win.on('close', (e) => {
    if (isQuitting) return;
    const action = normalizeCloseAction((settings as any).closeAction);
    if (action === 'exit') return; // fall through to window-all-closed → quit
    e.preventDefault();
    if (action === 'minimize') {
      try { win?.hide(); } catch {}
      return;
    }
    if (closePromptOpen) {
      try { win?.focus(); } catch {}
      return;
    }
    closePromptOpen = true;
    try {
      win?.webContents.send('app:close-request');
      try { win?.focus(); } catch {}
    } catch {
      // Renderer unreachable — fall back so X never dead-ends.
      closePromptOpen = false;
      try { win?.hide(); } catch {}
    }
  });
}

// Renderer answered the styled close dialog.
ipcMain.handle('app:close-decision', async (_e, payload?: any) => {
  const decision = String(payload?.decision || 'cancel').toLowerCase();
  const remember = !!payload?.remember;
  if (!closePromptOpen) return { ok: true };
  closePromptOpen = false;
  if (decision === 'minimize') {
    if (remember) {
      (settings as any).closeAction = 'minimize';
      try { saveAllSync(); } catch {}
      refreshTrayMenu();
      try { win?.webContents.send('settings:changed', settings); } catch {}
    }
    try { win?.hide(); } catch {}
  } else if (decision === 'exit' || decision === 'quit') {
    if (remember) {
      (settings as any).closeAction = 'exit';
      try { saveAllSync(); } catch {}
      refreshTrayMenu();
    }
    isQuitting = true;
    try { app.quit(); } catch {}
  }
  // 'cancel' (overlay click / Escape / Cancel button): stay open, do nothing.
  return { ok: true };
});

// ---- Tray ----
let tray: Tray | null = null;
let isQuitting = false;
let closePromptOpen = false;

function normalizeCloseAction(v: any): 'ask' | 'minimize' | 'exit' {
  return v === 'minimize' || v === 'exit' ? v : 'ask';
}

function showMainWindow() {
  try {
    if (!win || win.isDestroyed()) {
      createWindow();
    } else {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  } catch {}
}

function refreshTrayMenu() {
  if (!tray) return;
  try {
    const closeAction = normalizeCloseAction((settings as any).closeAction);
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Jetro',
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: 'Close button',
        submenu: [
          {
            label: 'Ask every time',
            type: 'radio',
            checked: closeAction === 'ask',
            click: () => {
              (settings as any).closeAction = 'ask';
              try { saveAllSync(); } catch {}
              refreshTrayMenu();
            },
          },
          {
            label: 'Minimize to tray',
            type: 'radio',
            checked: closeAction === 'minimize',
            click: () => {
              (settings as any).closeAction = 'minimize';
              try { saveAllSync(); } catch {}
              refreshTrayMenu();
            },
          },
          {
            label: 'Exit app',
            type: 'radio',
            checked: closeAction === 'exit',
            click: () => {
              (settings as any).closeAction = 'exit';
              try { saveAllSync(); } catch {}
              refreshTrayMenu();
            },
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          try { app.quit(); } catch {}
        },
      },
    ]);
    tray.setContextMenu(menu);
  } catch {}
}

function ensureTray(): boolean {
  if (tray) {
    refreshTrayMenu();
    return true;
  }
  try {
    const iconPath = resolveAppIcon();
    if (!iconPath) {
      console.warn('[jetro] tray icon not found, skipping tray');
      return false;
    }
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) {
      console.warn('[jetro] tray icon is empty, skipping tray:', iconPath);
      return false;
    }
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('Jetro');
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
    refreshTrayMenu();
    return true;
  } catch (e) {
    console.warn('[jetro] failed to create tray', e);
    tray = null;
    return false;
  }
}

app.whenReady().then(() => {
  // Single instance: a second launch focuses the running app.
  try {
    if (!app.requestSingleInstanceLock()) {
      isQuitting = true;
      app.quit();
      return;
    }
    app.on('second-instance', () => showMainWindow());
  } catch {}
  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('com.jetrodl.app');
    } catch {}
  }
  Menu.setApplicationMenu(null);
  loadAll();
  // fix downloadDir default if missing
  try {
    fs.mkdirSync(settings.downloadDir, { recursive: true });
  } catch {}
  createWindow();
  ensureTray();
  try {
    nativeTheme.on('updated', () => {
      // Follow the OS while the user chose "system".
      if (normalizeTheme((settings as any).theme) === 'system') applyNativeTheme();
    });
  } catch {}
  refreshNetworkRouting().catch(() => {});

  // clipboard auto-capture (accepts bare domains like example.com/file.zip)
  setInterval(async () => {
    try {
      if (!settings.autoCaptureClipboard || !win?.isFocused()) return;
      const t = clipboard.readText().trim();
      if (!t || t.length > 2048 || /\s/.test(t)) return;
      let normalized: string;
      try {
        normalized = normalizeDownloadUrl(t);
      } catch {
        return;
      }
      if (!items.some((i) => i.url === t || i.url === normalized) && (global as any).__lastClip !== t) {
        (global as any).__lastClip = t;
        win?.webContents.send('clipboard-url', t);
      }
    } catch {}
  }, 1500);

  setInterval(pumpQueue, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  try { saveAllSync(); } catch {}
  // Minimized-to-tray keeps the app alive with no windows; only quit for real.
  if (!isQuitting && tray) return;
  for (const id of [...ytJobs.keys()]) killYtJob(id);
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  isQuitting = true;
  try { saveAllSync(); } catch {}
  for (const id of [...ytJobs.keys()]) killYtJob(id);
});

// ---- IPC ----
ipcMain.handle('dl:probe', async (_e, url: string) => {
  url = normalizeDownloadUrl(url);
  return probeUrl(url, currentProxyOpts());
});

ipcMain.handle('dl:add', async (_e, url: string, opts?: any) => {
  url = normalizeDownloadUrl(url);
  let filename = opts?.filename;
  let total = 0;
  let supportsRange = false;
  try {
    const p = await probeUrl(url, currentProxyOpts());
    total = p.totalBytes;
    supportsRange = p.supportsRange;
    if (!filename) filename = p.filename;
  } catch {
    if (!filename) filename = guessFilename(url);
  }
  filename = String(filename).replace(/[<>:"/\\|?*]/g, '_');
  // Renderer sends a folder (dir) — the real filename comes from probing the URL.
  // Legacy callers may still send a full file path via savePath; detect both.
  let savePath: string;
  let dir: string;
  const rawDir = opts?.dir ? normalizeDir(String(opts.dir)) : '';
  const rawSave = opts?.savePath ? normalizeDir(String(opts.savePath)) : '';
  if (rawDir) {
    dir = rawDir;
    savePath = path.join(dir, filename);
  } else if (rawSave) {
    let isDir = /[/\\]$/.test(rawSave);
    try {
      if (!isDir && fs.existsSync(rawSave) && fs.statSync(rawSave).isDirectory()) isDir = true;
    } catch {}
    if (isDir) {
      dir = rawSave;
      savePath = path.join(dir, filename);
    } else {
      savePath = rawSave;
      dir = path.dirname(savePath);
      const base = path.basename(savePath);
      if (base) filename = base;
    }
  } else {
    dir = settings.downloadDir;
    savePath = path.join(dir, filename);
  }
  // Fail fast with a readable message (protected drive roots, missing drives)
  // instead of a raw mkdir error on the item mid-download.
  assertDirWritable(dir);
  if (opts?.replace) {
    // User chose "Replace": drop any previous file + resume state first.
    try { fs.unlinkSync(savePath); } catch {}
    try { fs.unlinkSync(savePath + '.jetro.json'); } catch {}
  }
  const validQueueId =
    opts?.queueId && queues.some((q) => q.id === opts.queueId) ? String(opts.queueId) : null;
  const now = Date.now();
  const item: Item = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 7),
    url,
    filename,
    savePath,
    totalBytes: total,
    downloadedBytes: 0,
    status: 'queued',
    speedBps: 0,
    connections: Math.min(32, Math.max(1, opts?.connections || settings.maxConnections)),
    supportsRange,
    createdAt: now,
    lastTryAt: now,
    category: categoryOf(filename),
    queueId: validQueueId,
    batchId: opts?.batchId ? String(opts.batchId) : null,
    batchIndex: Number.isFinite(Number(opts?.batchIndex)) ? Number(opts.batchIndex) : 0,
    attempts: 0,
    nextRetryAt: null,
  };
  items.unshift(item);
  resetQueuePower(validQueueId);
  broadcast(true);
  pumpQueue();
  return item;
});

// ---- Batch downloads (New Batch Download: one *-pattern → many files) ----
const BATCH_MAX_FILES = 200;

/** Resolve one URL without downloading: normalized URL + probe (filename/size). */
async function resolveBatchUrl(raw: string) {
  const normalized = normalizeDownloadUrl(raw);
  try {
    const p = await probeUrl(normalized, currentProxyOpts());
    return {
      url: normalized,
      ok: true as const,
      filename: p.filename || guessFilename(normalized),
      totalBytes: p.totalBytes || 0,
      supportsRange: !!p.supportsRange,
      contentType: p.contentType || '',
    };
  } catch (e: any) {
    // Probe failed (404/offline/…) — still return a row so the user sees
    // which tweak is wrong instead of silently dropping the file.
    let filename = '';
    try { filename = guessFilename(normalized); } catch { filename = 'unknown'; }
    return {
      url: normalized,
      ok: false as const,
      filename,
      totalBytes: 0,
      supportsRange: false,
      contentType: '',
      error: String(e?.message || 'Could not resolve this link.'),
    };
  }
}

ipcMain.handle('batch:resolve', async (_e, urls?: string[]) => {
  const list = Array.isArray(urls) ? urls.map((u) => String(u || '')).filter(Boolean) : [];
  if (!list.length) throw new Error('No links to resolve.');
  if (list.length > BATCH_MAX_FILES) throw new Error(`Too many files (max ${BATCH_MAX_FILES}). Narrow the From/To range.`);
  // Small worker pool so 100+ links don't open 100+ sockets at once.
  const out: Awaited<ReturnType<typeof resolveBatchUrl>>[] = new Array(list.length);
  const CONC = 5;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONC, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor++;
      const raw = list[i];
      try {
        out[i] = await resolveBatchUrl(raw);
      } catch (e: any) {
        out[i] = {
          url: raw, ok: false as const, filename: 'unknown',
          totalBytes: 0, supportsRange: false, contentType: '',
          error: String(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).'),
        };
      }
    }
  });
  await Promise.all(workers);
  return out;
});

/** Unique queue name for a new batch (max 60 chars, like queue:create). */
function uniqueBatchQueueName(suggested: string): string {
  const base = String(suggested || 'Batch').trim().slice(0, 60) || 'Batch';
  const taken = new Set(queues.map((q) => q.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const cand = (base.slice(0, 60 - suffix.length) + suffix).trim() || `Batch${suffix}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return `${base.slice(0, 50)} ${Date.now().toString(36)}`.trim();
}

/** Suggested batch queue name from the batch URLs: host + file count. */
function batchQueueNameFor(clean: string[]): string {
  let host = '';
  try {
    host = new URL(normalizeDownloadUrl(clean[0])).hostname.replace(/^www\./i, '');
  } catch {
    host = '';
  }
  const count = clean.length;
  const core = host ? `Batch – ${host} (${count} file${count === 1 ? '' : 's'})` : `Batch (${count} file${count === 1 ? '' : 's'})`;
  return uniqueBatchQueueName(core.slice(0, 60));
}

ipcMain.handle('batch:add', async (_e, urls?: string[], opts?: any) => {
  const clean = Array.isArray(urls) ? (urls as any[]).map((u) => String(u || '').trim()).filter(Boolean) : [];
  if (!clean.length) throw new Error('No links to download.');
  if (clean.length > BATCH_MAX_FILES) throw new Error(`Too many files (max ${BATCH_MAX_FILES}). Narrow the From/To range.`);
  const dir = assertDirWritable(String(opts?.dir || settings.downloadDir || '').trim() || settings.downloadDir);
  const connections = Math.min(32, Math.max(1, Number(opts?.connections) || settings.maxConnections));
  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const baseTs = Date.now();
  // Every batch gets its own running queue so its files stay together instead
  // of mixing with other downloads. Its concurrency defaults to the global
  // concurrent-downloads setting (tweakable later via Edit Queue).
  const queueName = uniqueBatchQueueName(String(opts?.queueName || '').trim() || batchQueueNameFor(clean));
  const queue: Queue = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + 'b',
    name: queueName,
    running: true,
    maxConcurrent: Math.min(10, Math.max(1, Math.round(Number(settings.maxConcurrentDownloads) || 3))),
    schedulerEnabled: false,
    scheduleStart: '22:00',
    scheduleStop: '07:00',
    createdAt: baseTs,
    afterComplete: 'nothing',
    powerFiredAt: null,
  };
  queues.push(queue);
  // Probe first (in order) so filenames/sizes are known, then insert so that
  // index 0 ends up on top of the list and starts first.
  const probed = await (async () => {
    const out: typeof items = [];
    // Reuse the same pool size as resolve for speed without socket storms.
    const CONC = 5;
    const results: ({ url: string; filename: string; total: number; supportsRange: boolean })[] = new Array(clean.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONC, clean.length) }, async () => {
      while (cursor < clean.length) {
        const i = cursor++;
        const raw = clean[i];
        let url = raw;
        try { url = normalizeDownloadUrl(raw); } catch { url = raw; }
        let filename = '';
        let total = 0;
        let supportsRange = false;
        try {
          const p = await probeUrl(url, currentProxyOpts());
          total = p.totalBytes; supportsRange = p.supportsRange;
          filename = String(opts?.filename || '') || p.filename;
        } catch {
          filename = guessFilename(url);
        }
        filename = String(filename || guessFilename(url)).replace(/[<>:"/\\|?*]/g, '_') || 'download.bin';
        results[i] = { url, filename, total, supportsRange };
      }
    }));
    // Dedup filenames inside the batch (e.g. pattern only in query string):
    // file.zip, file (1).zip, file (2).zip …
    const used = new Set<string>();
    results.forEach((r, idx) => {
      let name = r.filename;
      if (used.has(name.toLowerCase())) {
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let n = 1;
        while (used.has(`${base} (${n})${ext}`.toLowerCase()) && n < 1000) n++;
        name = `${base} (${n})${ext}`;
        r.filename = name;
      }
      used.add(name.toLowerCase());
      const savePath = path.join(dir, name);
      out.push({
        id: baseTs.toString(36) + idx.toString(36) + Math.random().toString(36).slice(2, 5),
        url: r.url,
        filename: name,
        savePath,
        totalBytes: r.total,
        downloadedBytes: 0,
        status: 'queued',
        speedBps: 0,
        connections,
        supportsRange: r.supportsRange,
        createdAt: baseTs + idx,
        lastTryAt: baseTs + idx,
        category: categoryOf(name),
        queueId: queue.id,
        batchId,
        batchIndex: idx,
        attempts: 0,
        nextRetryAt: null,
      } as Item);
    });
    return out;
  })();
  for (let i = probed.length - 1; i >= 0; i--) items.unshift(probed[i]);
  broadcast(true);
  pumpQueue();
  return { batchId, queueId: queue.id, queueName: queue.name, count: probed.length, ids: probed.map((p) => p.id) };
});

ipcMain.handle('dl:pause', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  clearRetryTimer(id);
  if (it) it.nextRetryAt = null;
  if (it?.via === 'ytdlp') {
    killYtJob(id); // yt-dlp resumes partial files on re-spawn
    if (it) {
      it.status = 'paused';
      it.speedBps = 0;
    }
    broadcast(true);
    return;
  }
  const r = runners.get(id);
  if (r) {
    if (it) it.status = 'paused';
    r.pause();
  } else if (it) {
    it.status = 'paused';
    it.speedBps = 0;
  }
  broadcast(true);
});
ipcMain.handle('dl:resume', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  if (it.status === 'completed') return;
  clearRetryTimer(id);
  it.attempts = 0;
  it.nextRetryAt = null;
  resetQueuePower(it.queueId || null);
  if (it.via === 'ytdlp') {
    if ((it.status === 'downloading' || it.status === 'merging') && ytJobs.has(id)) return;
    startYtDownload(it).catch(() => {}); // yt-dlp auto-resumes its partial file
    return;
  }
  // Drop any stale runner left behind by a previous run (e.g. pause raced a
  // reconnect) so startDownload actually starts fresh instead of early-returning.
  // Never touch a healthy active run.
  if (it.status !== 'downloading') {
    const r = runners.get(id);
    if (r) {
      try {
        r.pause();
      } catch {}
      runners.delete(id);
    }
  }
  it.status = 'queued';
  touchTry(it);
  broadcast(true);
  pumpQueue();
});
ipcMain.handle('dl:remove', async (_e, id: string, deleteFile?: boolean) => {
  killYtJob(id);
  clearRetryTimer(id);
  const r = runners.get(id);
  if (r) r.pause();
  runners.delete(id);
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    const [rm] = items.splice(idx, 1);
    if (deleteFile) {
      try { fs.unlinkSync(rm.savePath); } catch {}
      try { fs.unlinkSync(rm.savePath + '.jetro.json'); } catch {}
    }
  }
  broadcast(true);
});
ipcMain.handle('dl:list', () => items);
ipcMain.handle('dl:move', async (_e, id: string, queueId?: string | null) => {
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  if (it.status === 'downloading' || it.status === 'merging') return it; // don't move active downloads
  const prevQueue = it.queueId || null;
  const valid = queueId && queues.some((q) => q.id === queueId) ? String(queueId) : null;
  it.queueId = valid;
  // Moving to a stopped queue parks it as paused so it won't auto-run elsewhere.
  if (valid) {
    const q = queues.find((x) => x.id === valid);
    if (q && !q.running && it.status === 'queued') it.status = 'paused';
  }
  if (it.status !== 'completed') {
    resetQueuePower(valid);
    resetQueuePower(prevQueue);
  }
  broadcast(true);
  pumpQueue();
  return it;
});

// Rename a download (file on disk + list entry). Blocked while active so the
// open file handle / yt-dlp process never writes to a moved path.
ipcMain.handle('dl:rename', async (_e, id: string, newName?: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error('Download not found');
  if (it.status === 'downloading' || it.status === 'merging')
    throw new Error('Pause the download before renaming.');
  const name = String(newName || '').trim();
  if (!name) throw new Error('Please enter a file name.');
  if (name.length > 255) throw new Error('File name is too long (max 255 characters).');
  if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name))
    throw new Error('File name can\'t contain any of these characters: < > : " / \\ | ? *');
  if (/[. ]$/.test(name)) throw new Error('File name can\'t end with a space or dot.');
  if (/^\.+$/.test(name)) throw new Error('Please enter a valid file name.');
  const dir = path.dirname(it.savePath);
  const newPath = path.join(dir, name);
  if (newPath === it.savePath) return it;
  if (newPath.toLowerCase() !== it.savePath.toLowerCase() && fs.existsSync(newPath)) {
    throw new Error(`A file named "${name}" already exists in this folder.`);
  }
  const oldPath = it.savePath;
  const oldState = oldPath + '.jetro.json';
  const newState = newPath + '.jetro.json';
  try {
    if (fs.existsSync(oldPath)) {
      if (oldPath.toLowerCase() === newPath.toLowerCase()) {
        // Case-only rename on Windows needs a temp hop.
        const tmp = oldPath + `.jetro-case-${Date.now()}.tmp`;
        fs.renameSync(oldPath, tmp);
        fs.renameSync(tmp, newPath);
      } else {
        fs.renameSync(oldPath, newPath);
      }
    }
  } catch (e: any) {
    throw new Error('Could not rename file: ' + String(e?.message || e).slice(0, 200));
  }
  try {
    if (fs.existsSync(oldState) && oldState !== newState) {
      try { fs.renameSync(oldState, newState); } catch {}
    }
  } catch {}
  it.filename = name;
  it.savePath = newPath;
  it.category = categoryOf(name);
  broadcast(true);
  return it;
});

// Restart a download from zero (drops partial file + resume state, re-queues).
ipcMain.handle('dl:redownload', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error('Download not found');
  clearRetryTimer(id);
  it.attempts = 0;
  it.nextRetryAt = null;
  resetQueuePower(it.queueId || null);
  if (it.via === 'ytdlp') {
    killYtJob(id);
    try { fs.unlinkSync(it.savePath); } catch {}
    it.downloadedBytes = 0;
    it.status = 'queued';
    it.error = undefined;
    it.speedBps = 0;
    touchTry(it);
    broadcast(true);
    // yt-dlp items bypass the segmented queue pump — restart directly.
    startYtDownload(it).catch(() => {});
    return it;
  }
  const r = runners.get(id);
  if (r) {
    try { r.pause(); } catch {}
  }
  runners.delete(id);
  try { fs.unlinkSync(it.savePath); } catch {}
  try { fs.unlinkSync(it.savePath + '.jetro.json'); } catch {}
  it.downloadedBytes = 0;
  it.status = 'queued';
  it.error = undefined;
  it.speedBps = 0;
  touchTry(it);
  broadcast(true);
  pumpQueue();
  return it;
});

// Re-probe the source URL to refresh size / range support (not a download try).
ipcMain.handle('dl:refresh', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error('Download not found');
  if (it.status === 'downloading' || it.status === 'merging')
    throw new Error('Stop the download before refreshing.');
  if (it.via === 'ytdlp') throw new Error('Refresh is not available for video/audio downloads.');
  let p: { totalBytes: number; supportsRange: boolean };
  try {
    p = await probeUrl(it.url, currentProxyOpts());
  } catch (e: any) {
    throw new Error(String(e?.message || 'Could not refresh — check your connection.').slice(0, 300));
  }
  if (p.totalBytes > 0 && it.status !== 'completed') {
    if (it.downloadedBytes > p.totalBytes) {
      // Source shrank below our progress — drop stale resume state.
      it.downloadedBytes = 0;
      try { fs.unlinkSync(it.savePath + '.jetro.json'); } catch {}
    }
    it.totalBytes = p.totalBytes;
  }
  it.supportsRange = !!p.supportsRange;
  broadcast(true);
  return it;
});

// ---- Queues ----
ipcMain.handle('queue:list', () => queues);
ipcMain.handle('queue:create', async (_e, name?: string) => {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new Error('Queue name cannot be empty');
  const q: Queue = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: clean,
    running: false,
    maxConcurrent: Math.min(5, Math.max(1, settings.maxConcurrentDownloads || 2)),
    schedulerEnabled: false,
    scheduleStart: '22:00',
    scheduleStop: '07:00',
    createdAt: Date.now(),
    afterComplete: 'nothing',
    powerFiredAt: null,
  };
  queues.push(q);
  broadcast(true);
  return q;
});
ipcMain.handle('queue:update', async (_e, id: string, patch: Partial<Queue>) => {
  const q = queues.find((x) => x.id === id);
  if (!q) throw new Error('Queue not found');
  if (patch.name !== undefined) {
    const clean = String(patch.name).trim().slice(0, 60);
    if (!clean) throw new Error('Queue name cannot be empty');
    q.name = clean;
  }
  if (patch.schedulerEnabled !== undefined) q.schedulerEnabled = !!patch.schedulerEnabled;
  // Per-queue concurrency was removed: queues follow the global
  // concurrent-downloads setting, so maxConcurrent patches are ignored.
  void patch.maxConcurrent;
  if (patch.scheduleStart !== undefined) {
    const v = normalizeTime24h(patch.scheduleStart);
    if (!v) throw new Error('Start must be HH:MM from 00:00 to 23:59.');
    q.scheduleStart = v;
  }
  if (patch.scheduleStop !== undefined) {
    const v = normalizeTime24h(patch.scheduleStop);
    if (!v) throw new Error('Stop must be HH:MM from 00:00 to 23:59.');
    q.scheduleStop = v;
  }
  if ((patch as any).afterComplete !== undefined) {
    q.afterComplete = normalizeQueuePowerAction((patch as any).afterComplete);
    // Changing the action re-arms the fire-once guard so a new choice can fire.
    q.powerFiredAt = null;
  }
  broadcast(true);
  pumpQueue();
  return q;
});
ipcMain.handle('queue:delete', async (_e, id: string) => {
  const idx = queues.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  for (const it of items.filter((i) => (i.queueId || null) === id)) {
    try { clearRetryTimer(it.id); } catch {}
  }
  // Stop its active downloads first (segmented + yt-dlp)
  for (const it of items.filter((i) => (i.queueId || null) === id && (i.status === 'downloading' || i.status === 'merging'))) {
    try { killYtJob(it.id); } catch {}
    const r = runners.get(it.id);
    if (r) {
      it.status = 'paused';
      try { r.pause(); } catch {}
    } else if (it.status !== 'completed') {
      it.status = 'paused';
    }
    runners.delete(it.id);
    it.speedBps = 0;
  }
  // Unassign its files back to No queue (kept, paused)
  for (const it of items.filter((i) => (i.queueId || null) === id)) {
    it.queueId = null;
    if (it.status === 'queued') it.status = 'paused';
    it.speedBps = 0;
  }
  queues.splice(idx, 1);
  broadcast(true);
  return true;
});
ipcMain.handle('queue:start', async (_e, id: string) => {
  const q = queues.find((x) => x.id === id);
  if (!q) throw new Error('Queue not found');
  q.running = true;
  // Re-queue its parked files so they can run
  for (const it of items.filter((i) => (i.queueId || null) === id)) {
    if (it.status === 'paused' || it.status === 'error') {
      it.status = 'queued';
      it.error = undefined;
      it.attempts = 0;
      it.nextRetryAt = null;
      touchTry(it);
    }
  }
  // Restarting re-arms the power action.
  q.powerFiredAt = null;
  broadcast(true);
  pumpQueue();
  return q;
});
ipcMain.handle('queue:stop', async (_e, id: string) => {
  const q = queues.find((x) => x.id === id);
  if (!q) throw new Error('Queue not found');
  q.running = false;
  for (const it of items.filter((i) => (i.queueId || null) === id && (i.status === 'downloading' || i.status === 'merging'))) {
    try { killYtJob(it.id); } catch {}
    const r = runners.get(it.id);
    if (r) {
      it.status = 'paused';
      try { r.pause(); } catch {}
    } else if (it.status !== 'completed') {
      it.status = 'paused';
    }
    runners.delete(it.id);
    it.speedBps = 0;
  }
  for (const it of items.filter((i) => (i.queueId || null) === id && i.status === 'queued')) {
    it.status = 'paused';
  }
  broadcast(true);
  return q;
});
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:save', async (_e, s: any) => {
  settings = { ...settings, ...s, ...normalizeNetworkSettings({ ...settings, ...s }) };
  try { normalizeRetrySettings(settings); } catch {}
  // drop removed VPN option (old clients / old settings files may still send it)
  delete (settings as any).vpnKillSwitch;
  // the run-at-startup feature was removed: ignore any stale flag from old clients
  delete (settings as any).launchAtStartup;
  // the global scheduler was removed: per-queue schedules only
  delete (settings as any).schedulerEnabled;
  delete (settings as any).schedulerStart;
  delete (settings as any).schedulerStop;
  (settings as any).closeAction = normalizeCloseAction((settings as any).closeAction);
  (settings as any).theme = normalizeTheme((settings as any).theme);
  // Removed setting: batches now live in their own queue defaulting to
  // maxConcurrentDownloads — drop any stale value from old clients.
  delete (settings as any).batchConcurrentDownloads;
  // a bare drive letter ("C:") is drive-relative and breaks mkdir — root it
  try { settings.downloadDir = normalizeDir(settings.downloadDir) || settings.downloadDir; } catch {}
  applyNativeTheme();
  refreshTrayMenu();
  broadcast(true);
  pumpQueue();
  await refreshNetworkRouting();
  return settings;
});

ipcMain.handle('dialog:folder', async (_e, defaultPath?: string) => {
  const opts: any = { properties: ['openDirectory'] };
  const dp = String(defaultPath || settings.downloadDir || '').trim();
  if (dp) opts.defaultPath = dp;
  const r = await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:file', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Text files', extensions: ['txt', 'text', 'log', 'tsv', 'csv'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('app:open-url', async (_e, rawUrl?: string) => {
  const u = String(rawUrl || '').trim();
  if (!/^https:\/\//i.test(u)) throw new Error('Only https links can be opened.');
  await shell.openExternal(u);
  return true;
});

function compareVersions(a: string, b: string): number {
  const pa = String(a || '').replace(/^v/i, '').split(/[.\-+_]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split(/[.\-+_]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

ipcMain.handle('app:check-update', async () => {
  const current = String(app.getVersion() || '').trim() || '0.2.0';
  const releasesUrl = 'https://github.com/Erkalin/Jetro/releases';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 10000);
    let latest = '';
    try {
      const res = await fetch('https://api.github.com/repos/Erkalin/Jetro/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Jetro' },
        signal: ctrl.signal as any,
      } as any);
      if (res.ok) {
        const j: any = await (res as any).json().catch(() => null);
        latest = String(j?.tag_name || j?.name || '').trim();
      }
    } catch {}
    if (!latest) {
      // Fallback: follow the /releases/latest redirect manually.
      try {
        const res2 = await fetch(releasesUrl + '/latest', {
          redirect: 'manual',
          headers: { 'User-Agent': 'Jetro' },
          signal: ctrl.signal as any,
        } as any);
        const loc = String((res2 as any)?.headers?.get?.('location') || '');
        const m = /\/releases\/tag\/([^/?#]+)/i.exec(loc);
        if (m) latest = decodeURIComponent(m[1]);
      } catch {}
    }
    clearTimeout(timer);
    if (!latest) return { current, latest: '', updateAvailable: false, url: releasesUrl, error: 'Could not reach GitHub releases.' };
    // Keep the raw tag (e.g. "v0.3") for the download URL, compare without the "v".
    const rawLatest = latest.trim();
    const normLatest = rawLatest.replace(/^v/i, '');
    const cur = current.replace(/^v/i, '');
    const updateAvailable = compareVersions(normLatest, cur) > 0;
    // When an update exists, link straight to that release tag (e.g.
    // .../releases/tag/v0.3); otherwise link to the releases index.
    const url = updateAvailable ? `${releasesUrl}/tag/${encodeURIComponent(rawLatest)}` : releasesUrl;
    return { current: cur, latest: normLatest, updateAvailable, url };
  } catch (e: any) {
    return { current, latest: '', updateAvailable: false, url: releasesUrl, error: String(e?.message || e).slice(0, 200) };
  }
});

ipcMain.handle('power:execute', async (_e, queueId?: string) => {
  const q = queues.find((x) => x.id === String(queueId || ''));
  if (!q) throw new Error('Queue not found');
  const action = normalizeQueuePowerAction((q as any).afterComplete);
  if (action === 'nothing') throw new Error('No power action set for this queue.');
  const qItems = items.filter((i) => (i.queueId || null) === q.id);
  if (!qItems.length || !qItems.every((i) => i.status === 'completed')) {
    throw new Error('Queue is not fully completed.');
  }
  runPowerAction(action);
  return { ok: true, action };
});

ipcMain.handle('power:cancel', async (_e, queueId?: string) => {
  // Countdown runs in the renderer; the fire-once guard is already set so
  // cancelling simply acknowledges — no re-fire until new work arrives.
  const q = queues.find((x) => x.id === String(queueId || ''));
  if (q && !(q as any).powerFiredAt) (q as any).powerFiredAt = Date.now();
  broadcast(true);
  return { ok: true };
});

// Same icon the OS shows in File Explorer, via Electron native APIs.
const iconCache = new Map<string, string>();
ipcMain.handle('file:icon', async (_e, savePath?: string, filename?: string) => {
  const name = path.basename(savePath || filename || 'file.bin');
  const ext = (path.extname(name) || '.bin').toLowerCase();
  if (iconCache.has(ext)) return iconCache.get(ext);
  try {
    let target = savePath && fs.existsSync(savePath) ? savePath : '';
    let tmpToClean = '';
    if (!target) {
      // Create a temp placeholder with the same extension so the OS can resolve its icon.
      tmpToClean = path.join(os.tmpdir(), `jetro-icon-${Date.now()}${ext}`);
      try {
        fs.writeFileSync(tmpToClean, '');
        target = tmpToClean;
      } catch {
        target = app.getPath('desktop');
      }
    }
    const icon = await app.getFileIcon(target, { size: 'normal' });
    if (tmpToClean) {
      try { fs.unlinkSync(tmpToClean); } catch {}
    }
    if (!icon.isEmpty()) {
      const url = icon.toDataURL();
      iconCache.set(ext, url);
      return url;
    }
  } catch {}
  return null;
});

// Open the finished file itself with the OS default app.
ipcMain.handle('file:open', async (_e, savePath?: string) => {
  const p = String(savePath || '').trim();
  if (!p) throw new Error('No file path');
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return true;
});

// Show the OS "Open with" chooser so the user can pick which app opens the file.
ipcMain.handle('file:open-with', async (_e, savePath?: string) => {
  const p = String(savePath || '').trim();
  if (!p) throw new Error('No file path');
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  if (process.platform === 'win32') {
    try {
      const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref?.();
      return true;
    } catch (e: any) {
      throw new Error('Could not show Open with: ' + String(e?.message || e).slice(0, 160));
    }
  }
  // No native chooser via Electron on macOS/Linux — fall back to default open.
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return true;
});

// Does <dir>/<filename> already exist on disk? Used for the overwrite prompt.
ipcMain.handle('file:exists', async (_e, dir?: string, filename?: string) => {
  const d = normalizeDir(String(dir || settings.downloadDir || '').trim()) || settings.downloadDir;
  const name = String(filename || '').trim();
  if (!name) return { exists: false, path: '' };
  const p = path.join(d, name);
  try {
    const st = fs.statSync(p);
    return { exists: true, path: p, size: st.isFile() ? st.size : 0 };
  } catch {
    return { exists: false, path: p };
  }
});

// Open the folder containing a finished download (and select the file).
ipcMain.handle('file:reveal', async (_e, savePath?: string) => {
  const p = String(savePath || '').trim();
  if (!p) throw new Error('No file path');
  if (fs.existsSync(p)) {
    shell.showItemInFolder(p);
    return true;
  }
  const dir = path.dirname(p);
  if (fs.existsSync(dir)) {
    await shell.openPath(dir);
    return true;
  }
  throw new Error('File not found: ' + p);
});

// Video + audio grabber (no quality cap, full bundle: yt-dlp + ffmpeg merge + QuickJS/system runtime).
// Probe lists every available video height (144p..4K/8K, whatever the page offers)
// plus best audio-only options; split streams are merged by yt-dlp at download time.
// Cookies are fully automatic: probe/download first try without cookies. Only when
// yt-dlp reports a login/cookie error does the UI show the manual cookies.txt
// paste/file box. No browser picker — `--cookies-from-browser` is legacy-only.
/** Legacy allowlist for old queued items that still carry cookiesFromBrowser. Not exposed in UI. */
const COOKIE_BROWSERS = new Set(['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'vivaldi']);

const LOGIN_NEEDED_HINT = 'This video needs login — log in on the site in your browser, export the site\u2019s cookies (cookies.txt), then paste them below or pick the file and Detect again.';
const COOKIE_IMPORT_HINT = 'Those cookies couldn\u2019t be used — re-export a fresh cookies.txt while logged in and try again.';
/**
 * Cookies were sent to yt-dlp but YouTube still answered LOGIN_REQUIRED /
 * "not a bot". That usually means the IP is blocked (VPN/datacenter), not the
 * cookies: YouTube blocks most VPN/proxy IPs even with a valid session — a
 * stale export, logged-out export, or IP switch between export and resolve
 * are the remaining causes.
 */
const COOKIE_REJECTED_HINT = 'Those cookies were sent but YouTube still blocked the resolve — this is usually the VPN/proxy, not the cookies: YouTube blocks most datacenter/VPN IPs. Turn the VPN off (or switch to a residential server/IP), stay on the same IP you exported the cookies on, re-export fresh while logged in, and Detect again.';

/** Extra line naming the actual routing when the resolve went out via proxy/VPN. */
function cookieRejectedVpnNote(viaProxy: boolean): string {
  return viaProxy
    ? ' This resolve went through a proxy/VPN — retry on a direct residential connection if possible.'
    : ' If you are on a VPN, turn it off or switch server and retry on the same IP you exported the cookies on.';
}

/** File holding user-pasted cookies.txt content (overwritten on each paste). */
function pastedCookiesPath(): string {
  try {
    return path.join(storeDir, 'jetro-cookies.txt');
  } catch {
    return path.join(os.tmpdir(), 'jetro-cookies.txt');
  }
}

/** Minimal check that text looks like a Netscape cookies.txt export (tab-separated). */
function looksLikeCookiesTxt(content: string): boolean {
  const t = String(content || '');
  if (!t || t.length < 10) return false;
  if (!/[\t]/.test(t)) return false;
  return /netscape|http.*cookie|#http|TRUE|FALSE|\.youtube\.|\.google\.|youtube\.com|cook/i.test(t)
    || (t.split('\n').some((l) => (l.match(/\t/g) || []).length >= 5));
}

/**
 * True when a cookies.txt export actually contains a YouTube login session
 * (auth cookies), not just a logged-out VISITOR_INFO / PREF row. Catches the
 * most common "paste succeeds but YouTube still says sign in" case: the file
 * was exported while logged out, from an incognito window, or the wrong
 * browser profile.
 */
function hasYoutubeAuthCookies(content: string): boolean {
  const t = String(content || '');
  if (!/youtube\.com/i.test(t)) return false;
  return /(^|\n)#?.*[^\s]+\.youtube\.com[^\n]*\t(SID|__Secure-[\w-]*SID|HSID|SSID|APISID|SAPISID|__Secure-[\w-]*PAPISID|LOGIN_INFO|__Secure-[\w-]*PSID)\b/i.test(t)
    || /(^|\n)[^\n]*\t(LOGIN_INFO)\t/i.test(t);
}

/** Warn when a YouTube URL gets cookies without any YouTube auth session in them. */
function youtubeCookieSessionError(pageUrl: string, contentHead: string): string | null {
  if (!/youtube\.com|youtu\.be/i.test(String(pageUrl || ''))) return null;
  if (hasYoutubeAuthCookies(contentHead)) return null;
  return 'Those cookies don\u2019t contain a YouTube login session (no SID/LOGIN_INFO for youtube.com) — you exported while logged out, from an incognito window, or the wrong browser profile. Log in on youtube.com in a normal window, open the video once, then re-export with HttpOnly cookies included and try again.';
}

/** yt-dlp output means the page needs login cookies (age/bot/private/members). */
function isCookieLoginError(output: string): boolean {
  return /sign in to confirm|confirm you['\u2019]re not a bot|please (sign|log)[ -]?in|login required|log[ -]?in (required|to)|use .*--cookies|provide .*--cookies|cookies (are )?required|pass cookies|account cookies|did you provide.*cookies|private video|members[- ]only|channel members|join this channel|available to .*members|age[- ]?gate|confirm your age|age restricted|bot detection|human verification|not a bot|only available (for|to) (registered|logged)|requires authentication/i.test(
    String(output || ''),
  );
}

/** yt-dlp output means the supplied cookies file itself failed (parse/permission/empty). */
function isCookieFileError(output: string): boolean {
  return /could not (parse|read|copy).{0,40}cookie|invalid.{0,30}cookie|no valid cookies|unsupported.{0,20}cookies?.{0,20}format|cookies?.{0,20}(not found|not readable|empty|expired|malformed)|failed to (decrypt|read|load).{0,40}cookie|permission denied.{0,40}cookie|error .{0,40}cookies?\.txt/i.test(
    String(output || ''),
  );
}

/** Cookie args for yt-dlp probe/download. `error` is a user-facing import problem. */
function ytDlpCookieArgs(opts?: any, pageUrl?: string): { args: string[]; error?: string; usedCookies: boolean } {
  const text = String(opts?.cookiesText ?? '').trim();
  const file = String(opts?.cookiesFile || '').trim();
  // Pasted cookies.txt content wins over a file path (freshest).
  if (text) {
    if (text.length > 1_000_000) return { args: [], error: 'Pasted cookies are too large — export a fresh cookies.txt instead.', usedCookies: true };
    if (!looksLikeCookiesTxt(text)) {
      return { args: [], error: 'Pasted cookies don\u2019t look like a cookies.txt export — use the exporter plugin and paste the whole file.', usedCookies: true };
    }
    const sessionErr = pageUrl ? youtubeCookieSessionError(pageUrl, text.slice(0, 65536)) : null;
    if (sessionErr) return { args: [], error: sessionErr, usedCookies: true };
    try {
      const out = pastedCookiesPath();
      try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch {}
      fs.writeFileSync(out, text.endsWith('\n') ? text : text + '\n', 'utf8');
      try { fs.chmodSync(out, 0o600); } catch {}
      return { args: ['--cookies', out], usedCookies: true };
    } catch (e: any) {
      return { args: [], error: 'Could not save pasted cookies: ' + String(e?.message || e).slice(0, 160), usedCookies: true };
    }
  }
  if (file) {
    let head = '';
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return { args: [], error: 'Cookie file not found: ' + file, usedCookies: true };
      }
      const st = fs.statSync(file);
      if (st.size === 0) return { args: [], error: 'Cookie file is empty — export a fresh cookies.txt while logged in.', usedCookies: true };
      if (st.size > 5 * 1024 * 1024) return { args: [], error: 'Cookie file is too large — export a fresh cookies.txt instead.', usedCookies: true };
      try {
        head = fs.readFileSync(file, 'utf8').slice(0, 65536);
        if (!looksLikeCookiesTxt(head)) {
          return { args: [], error: 'Cookie file doesn\u2019t look like a cookies.txt export — re-export with the Get cookies.txt plugin.', usedCookies: true };
        }
      } catch (e: any) {
        return { args: [], error: 'Could not read cookie file: ' + String(e?.message || e).slice(0, 160), usedCookies: true };
      }
    } catch (e: any) {
      return { args: [], error: 'Cookie file not found: ' + file, usedCookies: true };
    }
    const sessionErr = pageUrl ? youtubeCookieSessionError(pageUrl, head) : null;
    if (sessionErr) return { args: [], error: sessionErr, usedCookies: true };
    return { args: ['--cookies', file], usedCookies: true };
  }
  // Legacy: old queued items may still carry a browser name. Kept working, no UI.
  const from = String(opts?.cookiesFromBrowser || '').trim().toLowerCase();
  if (from) {
    if (!COOKIE_BROWSERS.has(from)) return { args: [], error: 'Unsupported browser for cookies.', usedCookies: true };
    return { args: ['--cookies-from-browser', from], usedCookies: true };
  }
  return { args: [], usedCookies: false };
}

/**
 * Explicit JS runtime flags for yt-dlp. Two pitfalls avoided:
 * 1. `--js-runtimes quickjs:node:deno` parses as runtime `quickjs` with path
 *    `node:deno` (colon = path separator), so no runtime was ever enabled.
 * 2. The bundled quickjs.exe is only picked up by full path — a bare
 *    `quickjs` on PATH still reports as unavailable.
 * Without a working runtime, YouTube signature/n-challenge solving fails and
 * formats go missing ("page needs to be reloaded").
 */
function ytDlpJsRuntimeArgs(): string[] {
  const out: string[] = [];
  try {
    const qjs = resolveQuickjs();
    if (qjs && qjs !== 'quickjs' && qjs !== 'quickjs.exe') {
      try {
        if (fs.existsSync(qjs)) out.push('--js-runtimes', `quickjs:${qjs}`);
      } catch {}
    }
  } catch {}
  if (!out.length) out.push('--js-runtimes', 'quickjs');
  out.push('--js-runtimes', 'node', '--js-runtimes', 'deno');
  return out;
}

/**
 * YouTube player-client fallback. Since 2024 the `web` client requires a
 * proof-of-origin token yt-dlp can't manufacture, so identifying as `web`
 * without one yields "Sign in to confirm you're not a bot" even with valid
 * cookies. `tv` is the least-scrutinised client for anonymous videos, but it
 * authenticates differently — never pair it with cookies (the mismatch
 * invalidates the session). With cookies use `web_safari` first.
 */
function ytDlpYoutubeClientArgs(pageUrl: string, usedCookies: boolean): string[] {
  if (!/youtube\.com|youtu\.be/i.test(String(pageUrl || ''))) return [];
  if (usedCookies) return ['--extractor-args', 'youtube:player_client=web_safari,web'];
  return ['--extractor-args', 'youtube:player_client=tv,web_safari,web'];
}

/** `--proxy` for yt-dlp so it routes exactly like the rest of the app. */
async function ytDlpProxyArgs(pageUrl: string): Promise<string[]> {
  try {
    const eff = await resolveEffectiveProxyUrl(pageUrl, networkCfg());
    if (eff?.proxyUrl && !shouldBypassProxyHost(pageUrl)) return ['--proxy', eff.proxyUrl];
  } catch {}
  return [];
}

function shouldBypassProxyHost(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname;
    return shouldBypassHostname(hostname, networkCfg().proxyBypass || '');
  } catch {
    return false;
  }
}

const PLAYLIST_MAX_ENTRIES = 50;

ipcMain.handle('video:probe', async (_e, pageUrl: string, opts?: any) => {
  const url = String(pageUrl || '').trim();
  if (!url) return { formats: [] as any[], hint: 'empty url' };
  // direct media?
  if (/\.(mp4|webm|mkv|mp3|m4a)(\?|$)/i.test(url)) {
    return { formats: [{ kind: 'video', quality: 'direct', url, ext: 'mp4', height: 0, needsMerge: false }], hint: 'direct media url' };
  }
  const ck = ytDlpCookieArgs(opts, url);
  if (ck.error) return { formats: [] as any[], hint: ck.error, detail: ck.error, needsCookies: true, cookieError: ck.error };
  const bin = resolveYtDlp((settings as any).ytDlpPath);
  const ffdir = ffmpegDir();
  const proxyArgs = await ytDlpProxyArgs(url);
  const allowPlaylist = !!(opts as any)?.allowPlaylist;
  // Playlist mode: flat list of entries (capped), each becomes its own row.
  if (allowPlaylist) {
    try {
      const plArgs = ['-J', '--flat-playlist', '--socket-timeout', '10', ...ytDlpJsRuntimeArgs(), ...ck.args, ...proxyArgs];
      if (ffdir) plArgs.push('--ffmpeg-location', ffdir);
      plArgs.push(url);
      const out = await new Promise<any>((resolve) => {
        execFile(bin, plArgs, { timeout: 25000, maxBuffer: 15 * 1024 * 1024, env: envWithBinPath() }, (err, stdout) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(String(stdout))); } catch { resolve(null); }
        });
      });
      const rawEntries = Array.isArray(out?.entries) ? out.entries : [];
      if (rawEntries.length > 1) {
        const entries = rawEntries.slice(0, PLAYLIST_MAX_ENTRIES).map((en: any, idx: number) => {
          const id = String(en?.id || '');
          // flat-playlist gives id + extractor; rebuild watch URL when needed.
          let page = String(en?.webpage_url || en?.url || '');
          if (!/^https?:\/\//i.test(page) && id) {
            page = `https://www.youtube.com/watch?v=${id}`;
          }
          return {
            index: idx,
            id,
            title: String(en?.title || `Video ${idx + 1}`).slice(0, 160),
            duration: Number(en?.duration || 0) || undefined,
            url: page || url,
          };
        }).filter((en: any) => !!en.url);
        if (entries.length) {
          return {
            formats: [] as any[],
            hint: `Playlist detected — ${rawEntries.length} video${rawEntries.length === 1 ? '' : 's'}${rawEntries.length > PLAYLIST_MAX_ENTRIES ? ` (showing first ${PLAYLIST_MAX_ENTRIES})` : ''}. Pick entries below; each becomes its own download.`,
            title: String(out?.title || '').slice(0, 120),
            playlist: { title: String(out?.title || '').slice(0, 120), count: rawEntries.length, entries },
            needsCookies: false,
          };
        }
      }
      // Single video (or 1-entry playlist): fall through to formats probe below.
    } catch {}
  }
  const args = ['-J', '--no-playlist', '--socket-timeout', '10', ...ytDlpJsRuntimeArgs(), ...ytDlpYoutubeClientArgs(url, ck.usedCookies), ...ck.args, ...proxyArgs];
  if (ffdir) args.push('--ffmpeg-location', ffdir);
  args.push(url);
  let probeFailure = '';
  let probeStderr = '';
  const tryYt = await new Promise<any[]>((resolve) => {
    execFile(bin, args, { timeout: 25000, maxBuffer: 15 * 1024 * 1024, env: envWithBinPath() }, (err, stdout, stderr) => {
      if (err) {
        probeStderr = String(stderr || '');
        probeFailure = String((err as any)?.message || err) + '\n' + probeStderr;
        return resolve([]);
      }
      try {
        const j = JSON.parse(String(stdout));
        const all = Array.isArray(j.formats) ? j.formats : [];
        const title = String(j.title || '').slice(0, 120);
        const topDuration = Number((j as any)?.duration || 0);
        // Size of one yt-dlp format: exact `filesize` wins, otherwise
        // `filesize_approx` (bitrate x duration, often printed with `~`),
        // otherwise a tbr x duration fallback. 0 = unknown.
        const sizeOf = (f: any): { bytes: number; approx: boolean } => {
          const exact = Number(f?.filesize || 0);
          if (exact > 0) return { bytes: Math.round(exact), approx: false };
          const approx = Number(f?.filesize_approx || 0);
          if (approx > 0) return { bytes: Math.round(approx), approx: true };
          const tbr = Number(f?.tbr || f?.abr || f?.vbr || 0);
          const dur = Number(f?.duration || topDuration || 0);
          if (tbr > 0 && dur > 0) return { bytes: Math.round((tbr * 1000) / 8 * dur), approx: true };
          return { bytes: 0, approx: true };
        };
        // Progressive (single-file) heights — no cap, keep best URL per height.
        const progHeights = new Set<number>();
        const progUrl = new Map<number, any>();
        for (const f of all) {
          if (!f?.url || f.vcodec === 'none' || f.acodec === 'none') continue;
          const h = Number(f.height || 0);
          if (h > 0 && !progHeights.has(h)) {
            progHeights.add(h);
            progUrl.set(h, f);
          }
        }
        const isAudioOnly = (f: any) => f?.vcodec === 'none' && f?.acodec !== 'none';
        const isVideo = (f: any) => f?.vcodec !== 'none';
        // Best overall audio (what `+ba` actually picks) for merge estimates.
        let bestAudioOverall: any = null;
        let bestAudioScore = -1;
        for (const f of all) {
          if (!f?.url || !isAudioOnly(f)) continue;
          const s = sizeOf(f);
          const score = s.bytes > 0 ? s.bytes : Number(f.abr || f.tbr || 0);
          if (score > bestAudioScore) {
            bestAudioScore = score;
            bestAudioOverall = f;
          }
        }
        const bestAudioSize = bestAudioOverall ? sizeOf(bestAudioOverall) : { bytes: 0, approx: true };
        const bestVideoAtOrBelow = (cap: number): any => {
          let best: any = null;
          let bestKey = -1;
          for (const f of all) {
            if (!f?.url || !isVideo(f) || f.acodec !== 'none') continue; // split video only
            const h = Number(f.height || 0);
            if (cap > 0 && (h <= 0 || h > cap)) continue;
            const s = sizeOf(f);
            // Prefer taller, then larger/bitrate-higher within that height.
            const key = h * 1e12 + (s.bytes > 0 ? s.bytes : Number(f.tbr || 0) * 1e6);
            if (key > bestKey) {
              bestKey = key;
              best = f;
            }
          }
          return best;
        };
        // All video heights available (split or progressive) — no cap.
        const heights = new Set<number>();
        for (const f of all) {
          if (f?.vcodec === 'none') continue;
          const h = Number(f.height || 0);
          if (h > 0) heights.add(h);
          else if (f?.url && f.vcodec && f.vcodec !== 'none') heights.add(0);
        }
        const fmts: any[] = [...heights]
          .sort((a, b) => a - b)
          .map((h) => {
            const p = h > 0 ? progUrl.get(h) : null;
            if (p) {
              const s = sizeOf(p);
              return {
                kind: 'video',
                quality: h > 0 ? `${h}p` : 'best',
                height: h,
                needsMerge: false,
                url: String(p.url),
                ext: String(p.ext || 'mp4'),
                fps: h > 0 && p?.fps ? Number(p.fps) : undefined,
                title,
                estimatedBytes: s.bytes || 0,
                estimatedApprox: s.bytes > 0 ? s.approx : true,
              };
            }
            // Split stream: final mp4 ~= best video (+ba) + best audio.
            const v = h > 0 ? bestVideoAtOrBelow(h) : bestVideoAtOrBelow(0) || bestVideoAtOrBelow(4320);
            const vs = v ? sizeOf(v) : { bytes: 0, approx: true };
            const bytes = (vs.bytes || 0) + (bestAudioSize.bytes || 0);
            return {
              kind: 'video',
              quality: h > 0 ? `${h}p` : 'best',
              height: h,
              needsMerge: true,
              url: '',
              ext: 'mp4',
              fps: v?.fps ? Number(v.fps) : undefined,
              title,
              estimatedBytes: bytes || 0,
              estimatedApprox: true,
            };
          });
        // Audio-only options: best stream per container, sorted by bitrate desc.
        // No cap — offer whatever the page provides (usually 48k..320k opus/m4a).
        const bestAudioByExt = new Map<string, any>();
        for (const f of all) {
          if (!f?.url || f.vcodec !== 'none' || f.acodec === 'none') continue;
          const ext = String(f.ext || 'm4a').toLowerCase();
          const abr = Number(f.abr || f.tbr || 0);
          const prev = bestAudioByExt.get(ext);
          const prevAbr = prev ? Number(prev.abr || prev.tbr || 0) : -1;
          if (!prev || abr > prevAbr) bestAudioByExt.set(ext, f);
        }
        const audioFmts: any[] = [...bestAudioByExt.entries()]
          .map(([ext, f]) => {
            const s = sizeOf(f);
            return {
              kind: 'audio',
              quality: `audio ${ext}`,
              height: 0,
              abr: Number(f.abr || f.tbr || 0) || undefined,
              acodec: f.acodec ? String(f.acodec) : undefined,
              needsMerge: true,
              url: '',
              ext: ext === 'webm' ? 'opus' : ext,
              title,
              estimatedBytes: s.bytes || 0,
              // Re-encode on extract (mp3/m4a/...) makes even exact sources approximate.
              estimatedApprox: true,
            };
          })
          .sort((a, b) => (b.abr || 0) - (a.abr || 0))
          .slice(0, 4);
        // Always offer MP3 (best-audio extract preset) even when the page
        // only lists opus/m4a — download path already handles mp3 extract.
        if (bestAudioOverall && !audioFmts.some((a) => String(a.ext || '').toLowerCase() === 'mp3')) {
          const s = sizeOf(bestAudioOverall);
          audioFmts.push({
            kind: 'audio',
            quality: 'audio mp3',
            height: 0,
            abr: Number((bestAudioOverall as any)?.abr || (bestAudioOverall as any)?.tbr || 0) || undefined,
            acodec: 'mp3',
            needsMerge: true,
            url: '',
            ext: 'mp3',
            title,
            estimatedBytes: s.bytes || 0,
            estimatedApprox: true,
          });
        }
        // Fallback: page has a video stream but no labeled heights.
        if (!fmts.length && all.some((f: any) => f?.url && f.vcodec !== 'none')) {
          fmts.push({ kind: 'video', quality: 'best', height: 0, needsMerge: true, url: '', ext: 'mp4', title, estimatedBytes: 0, estimatedApprox: true });
        }
        // Fallback: audio-only page (e.g. SoundCloud / music video with no video stream).
        if (!fmts.length && !audioFmts.length && all.some((f: any) => f?.url && f.vcodec === 'none' && f.acodec !== 'none')) {
          audioFmts.push({ kind: 'audio', quality: 'audio best', height: 0, needsMerge: true, url: '', ext: 'm4a', title, estimatedBytes: 0, estimatedApprox: true });
        }
        resolve([...fmts, ...audioFmts]);
      } catch {
        resolve([]);
      }
    });
  });
  if (tryYt.length) return { formats: tryYt, hint: 'via yt-dlp + ffmpeg (best available)', title: (tryYt[0] as any)?.title, needsCookies: false };
  // Last meaningful yt-dlp output lines so the UI can show the real cause
  // (firewall block, proxy, DNS, …) instead of only a generic hint.
  const errLines = probeStderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\[download\]\s+\d/i.test(l));
  const detail = (
    errLines.length ? errLines.slice(-2).join(' | ') : String(probeFailure.split('\n')[0] || '').trim()
  ).slice(0, 300);
  // Supplied cookies.txt itself failed (parse/permission/empty) — surface as an
  // import problem so the UI keeps the cookie box open with an error.
  if (ck.usedCookies && (isCookieFileError(probeFailure) || /could not copy \S+ cookie database|failed to decrypt with DPAPI/i.test(probeFailure))) {
    return {
      formats: [],
      hint: COOKIE_IMPORT_HINT,
      detail,
      needsCookies: true,
      cookieError: detail || COOKIE_IMPORT_HINT,
    };
  }
  // Page needs login (age/bot/private/members) — prompt for cookies.txt.
  // Distinguish "no cookies sent yet" from "cookies were sent but rejected":
  // the latter is usually a blocked VPN/proxy IP, not a missing box.
  if (isCookieLoginError(probeFailure)) {
    if (ck.usedCookies) {
      // Short human-readable hint only — raw yt-dlp lines stay in `detail`
      // and the UI reveals them behind a "Show details" toggle.
      const hint = (COOKIE_REJECTED_HINT + cookieRejectedVpnNote(proxyArgs.length > 0)).slice(0, 400);
      return {
        formats: [],
        hint,
        detail,
        needsCookies: true,
        cookieError: hint,
      };
    }
    return {
      formats: [],
      hint: LOGIN_NEEDED_HINT,
      detail,
      needsCookies: true,
    };
  }
  if (/enotfound|eai_again|ehostunreach|enetunreach|enetdown|enotconn|network is unreachable|temporary failure in name resolution|failed to resolve|connection aborted|connection reset|timed out|timeout|socket hang up|offline|err_internet|dns/i.test(probeFailure)) {
    return {
      formats: [],
      hint: detail || 'Could not reach the video page — check your internet connection, firewall/proxy allowances for yt-dlp, and click Detect again.',
      detail: '',
      needsCookies: false,
    };
  }
  if (/unsupported url|no video formats found|no formats found|video unavailable/i.test(probeFailure)) {
    return {
      formats: [],
      hint: 'This link is not a supported or public video page. Check the link and try again.',
      detail,
      needsCookies: false,
    };
  }
  return {
    formats: [],
    hint: detail || 'No video/audio formats found. Check your internet connection, or the link needs login.',
    detail: '',
    needsCookies: false,
  };
});

function killYtJob(id: string) {
  const j = ytJobs.get(id);
  if (!j) return;
  ytJobs.delete(id);
  try { clearInterval(j.timer); } catch {}
  try {
    if (j.proc.pid && !j.proc.killed) {
      if (process.platform === 'win32') {
        try { execFile('taskkill', ['/pid', String(j.proc.pid), '/T', '/F']); } catch {}
      }
      try { j.proc.kill('SIGKILL'); } catch {}
    }
  } catch {}
}

/** Run bundled yt-dlp to download+merge a page URL at any height (no cap), or best audio.
 * Progress comes from yt-dlp's live stdout (`--newline --progress`): file-size
 * polling alone can't work because split streams download to temp files and the
 * final `savePath` only appears at merge time (hence the old `-- / --`). */
async function startYtDownload(item: Item) {
  if (ytJobs.has(item.id)) return;
  if (item.nextRetryAt && Number(item.nextRetryAt) > Date.now()) return;
  const bin = resolveYtDlp((settings as any).ytDlpPath);
  const ffdir = ffmpegDir();
  try { fs.mkdirSync(path.dirname(item.savePath), { recursive: true }); } catch {}
  // yt-dlp -o is a template: escape % so titles with % don't expand.
  const outTemplate = item.savePath.replace(/%/g, '#');
  const ck = ytDlpCookieArgs(item, item.url);
  const proxyArgs = await ytDlpProxyArgs(item.url);
  const args = [
    '--no-playlist', '--socket-timeout', '10', '--retries', '3',
    ...ytDlpJsRuntimeArgs(),
    '--newline', '--progress', '--progress-delta', '0.1',
    ...ytDlpYoutubeClientArgs(item.url, ck.usedCookies),
    ...ck.args,
    ...proxyArgs,
  ];
  if ((item as any).subtitles) {
    args.push('--write-subs', '--sub-langs', 'en.*', '--embed-subs');
  }
  if (item.audioOnly) {
    // Audio-only: best audio, convert only when the requested container needs it.
    // m4a/mp3/etc. need ffmpeg extract; opus/webm can stay native.
    const ext = (path.extname(item.savePath) || '').toLowerCase();
    args.push('-f', 'ba/b', '-o', outTemplate, '--no-part');
    const extractFor: Record<string, string> = {
      '.mp3': 'mp3', '.m4a': 'm4a', '.aac': 'aac', '.flac': 'flac', '.wav': 'wav', '.opus': 'opus', '.ogg': 'vorbis',
    };
    const fmt = extractFor[ext];
    if (fmt) {
      args.push('--extract-audio', '--audio-format', fmt);
      if (fmt === 'mp3') args.push('--audio-quality', '0');
    } else if (ext !== '.webm') {
      args.push('--merge-output-format', 'm4a');
    }
  } else {
    const h = Number(item.videoHeight || 0);
    if (h > 0) {
      const hc = Math.max(144, Math.min(4320, Math.round(h)));
      args.push('-f', `bv*[height<=${hc}]+ba/b[height<=${hc}]/b`);
    } else {
      // height 0 / unknown = best available (e.g. 4K/8K if the page offers it).
      args.push('-f', 'bv*+ba/b');
    }
    args.push('--merge-output-format', 'mp4', '-o', outTemplate, '--no-part');
  }
  if (ffdir) args.push('--ffmpeg-location', ffdir);
  args.push(item.url);
  item.nextRetryAt = null;
  item.status = 'downloading';
  item.error = undefined;
  touchTry(item);
  broadcast(true);
  const proc = spawn(bin, args, { env: envWithBinPath(), windowsHide: true });
  // --- live progress state (see header comment) ---
  // bv+ba downloads N temp files back-to-back; `base` accumulates finished
  // files so the bar never jumps backwards when the next file starts.
  // `floorTotal` is the probe estimate (video+audio sum) — the total never
  // shrinks below it, it only grows when yt-dlp reports larger actuals.
  let progBase = 0;
  let progCurTotal = 0;
  let progHasOutput = false;
  let outBuf = '';
  let lastErrLines: string[] = [];
  const floorTotal = Math.max(0, Math.round(Number(item.totalBytes || 0)));
  if (floorTotal > 0 && !item.totalBytesIsEstimate) item.totalBytesIsEstimate = true;
  const parseSize = (num: string, unit: string): number => {
    const v = Number(num);
    if (!isFinite(v)) return 0;
    const u = (unit || 'B').toLowerCase();
    const mult =
      u.startsWith('g') ? 1024 ** 3 :
      u.startsWith('m') ? 1024 ** 2 :
      u.startsWith('k') ? 1024 :
      u.startsWith('t') ? 1024 ** 4 : 1;
    return Math.round(v * mult);
  };
  const parseSpeed = (num: string, unit: string): number => parseSize(num, unit);
  const handleProgLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^\[JETROPROG\]/.test(line)) return; // reserved for future --progress-template
    if (/\[merger\]|\[extractaudio\]|\[videoconvertor\]|merging formats into/i.test(line)) {
      if (item.status === 'downloading') {
        item.status = 'merging';
        item.speedBps = 0;
        broadcast();
      }
      return;
    }
    if (/\[download\]\s+destination:/i.test(line)) {
      if (progCurTotal > 0) {
        progBase += progCurTotal;
        progCurTotal = 0;
        // New file starting: total is finished bytes so far, but never below
        // the probe estimate (audio half still to come) and never shrinking.
        item.totalBytes = Math.max(floorTotal, progBase, item.totalBytes || 0);
        if (item.downloadedBytes < progBase) item.downloadedBytes = progBase;
        if (item.totalBytes > 0) item.totalBytesIsEstimate = true;
        broadcast();
      }
      return;
    }
    // e.g. "[download]  12.3% of  15.62MiB at  2.34MiB/s ETA 00:05"
    // or   "[download]  12.3% of ~ 15.62MiB at  2.34MiB/s ETA 00:05"
    // `~` = filesize_approx (bitrate x duration) — final is often larger.
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~\s*)?([\d.]+)\s*([KMGT]?i?B)/i.exec(line);
    if (m) {
      progHasOutput = true;
      const pct = Math.min(100, Math.max(0, Number(m[1])));
      const isApprox = !!m[2];
      const total = parseSize(m[3], m[4]);
      if (total > 0) {
        progCurTotal = total;
        const combined = progBase + total;
        // Monotonic: actuals can exceed the estimate (merge overhead,
        // re-encode, ~ sizes) — grow, never shrink back to one file's size.
        item.totalBytes = Math.max(floorTotal, combined, item.totalBytes || 0);
        item.downloadedBytes = Math.min(
          Math.round(progBase + (total * pct) / 100),
          item.totalBytes,
        );
        if (isApprox || floorTotal > 0) item.totalBytesIsEstimate = true;
      }
      const sm = /at\s+([\d.]+)\s*([KMGT]?i?B)\/s/i.exec(line);
      if (sm) {
        const sp = parseSpeed(sm[1], sm[2]);
        if (sp > 0) item.speedBps = sp;
      }
      if (item.status === 'downloading' || item.status === 'merging') broadcast();
      return;
    }
    // Keep a short tail of real (non-progress) output for error messages.
    if (!/^\[download\]\s+(\d|100%)/.test(line) && !/ETA/i.test(line)) {
      lastErrLines.push(line.slice(0, 200));
      if (lastErrLines.length > 5) lastErrLines.shift();
    }
  };
  const onProgChunk = (d: any) => {
    try {
      outBuf += String(d || '');
      const parts = outBuf.split(/[\r\n]+/);
      outBuf = parts.pop() || '';
      for (const p of parts) handleProgLine(p);
    } catch {}
  };
  try {
    proc.stdout?.on('data', onProgChunk);
    proc.stderr?.on('data', onProgChunk);
  } catch {}
  let lastBytes = 0;
  try {
    const st = fs.statSync(item.savePath);
    lastBytes = st.size;
  } catch {}
  let lastTick = Date.now();
  const timer = setInterval(() => {
    // Stdout progress is authoritative; file polling is only a fallback for
    // cases where yt-dlp prints no percentage (e.g. direct single file).
    if (progHasOutput) {
      lastTick = Date.now();
      try {
        const st = fs.statSync(item.savePath);
        lastBytes = st.size;
      } catch {}
      broadcast();
      return;
    }
    try {
      const st = fs.statSync(item.savePath);
      const now = Date.now();
      const dt = Math.max(0.05, (now - lastTick) / 1000);
      item.speedBps = Math.round(Math.max(0, st.size - lastBytes) / dt);
      lastBytes = st.size;
      lastTick = now;
      item.downloadedBytes = st.size;
      // No percentages seen yet: grow the total instead of showing 100% early.
      if (st.size > (item.totalBytes || 0)) {
        item.totalBytes = st.size;
        if (st.size > 0) item.totalBytesIsEstimate = true;
      }
      broadcast();
    } catch {}
  }, 100);
  ytJobs.set(item.id, { proc, timer, lastBytes, lastTick });
  proc.on('error', (e: any) => {
    if (!ytJobs.has(item.id)) return;
    killYtJob(item.id);
    if (item.status === 'downloading' || item.status === 'merging') {
      try {
        item.error = String(e?.message || e).slice(0, 300);
      } catch {
        item.error = 'Video download failed.';
      }
      if (shouldAutoRetryError(e) && scheduleAutoRetry(item)) {
        // re-queued with backoff; timer restarts via startYtDownload.
      } else {
        item.status = 'error';
        item.nextRetryAt = null;
      }
      item.speedBps = 0;
      touchTry(item);
    }
    broadcast(true);
  });
  proc.on('close', (code: number) => {
    if (!ytJobs.has(item.id)) return; // paused/removed already handled state
    try {
      if (outBuf.trim()) handleProgLine(outBuf);
    } catch {}
    killYtJob(item.id);
    if (code === 0) {
      try {
        const st = fs.statSync(item.savePath);
        item.downloadedBytes = st.size;
        item.totalBytes = st.size;
      } catch {
        // Merge finished but file stat failed (rare) — fall back to progress totals.
        if (item.totalBytes > 0) item.downloadedBytes = item.totalBytes;
      }
      // Final file on disk is authoritative — estimate ends here.
      delete (item as any).totalBytesIsEstimate;
      item.status = 'completed';
      item.speedBps = 0;
      item.attempts = 0;
      item.nextRetryAt = null;
      touchTry(item);
    } else if (item.status === 'downloading' || item.status === 'merging') {
      const tail = lastErrLines.filter(Boolean).slice(-2).join(' | ').slice(0, 280);
      const loginErr = isCookieFileError(tail) || isCookieLoginError(tail) || /could not copy \S+ cookie database|failed to decrypt with DPAPI/i.test(tail);
      if (isCookieFileError(tail) || /could not copy \S+ cookie database|failed to decrypt with DPAPI/i.test(tail)) {
        item.error = (COOKIE_IMPORT_HINT + (tail ? ' Details: ' + tail : '')).slice(0, 300);
      } else if (isCookieLoginError(tail)) {
        if (ck.usedCookies) {
          // Badge text stays short — raw lines were already shown at probe time.
          item.error = (COOKIE_REJECTED_HINT + cookieRejectedVpnNote(proxyArgs.length > 0)).slice(0, 400);
        } else {
          item.error = (LOGIN_NEEDED_HINT + (tail ? ' Details: ' + tail : '')).slice(0, 500);
        }
      } else {
        item.error = tail || `yt-dlp exited (${code})`;
      }
      if (!loginErr && shouldAutoRetryError(item.error) && scheduleAutoRetry(item)) {
        // re-queued with backoff.
      } else {
        item.status = 'error';
        item.nextRetryAt = null;
      }
      item.speedBps = 0;
      touchTry(item);
    }
    broadcast(true);
  });
}

ipcMain.handle('video:download', async (_e, opts?: any) => {
  const pageUrl = String(opts?.pageUrl || '').trim();
  if (!pageUrl) throw new Error('Missing video URL');
  const kind = String(opts?.kind || (opts?.audioOnly ? 'audio' : '') || '').toLowerCase() === 'audio' ? 'audio' : 'video';
  const audioOnly = kind === 'audio';
  const rawH = Number(opts?.height || 0);
  const height = audioOnly ? 0 : rawH > 0 ? Math.max(144, Math.min(4320, Math.round(rawH))) : 0;
  let filename = String(opts?.filename || '').replace(/[<>:"/\\|?*]/g, '_').replace(/%/g, '#').trim();
  if (!filename) filename = audioOnly ? 'audio.m4a' : 'video.mp4';
  if (audioOnly) {
    if (!/\.(mp3|m4a|aac|opus|ogg|wav|flac|webm|mp4)$/i.test(filename)) filename += '.m4a';
  } else {
    if (!/\.(mp4|mkv|webm)$/i.test(filename)) filename += '.mp4';
  }
  const dir = assertDirWritable(String(opts?.dir || settings.downloadDir || '').trim() || settings.downloadDir);
  const savePath = path.join(dir, filename);
  if (opts?.replace) {
    try { fs.unlinkSync(savePath); } catch {}
  }
  const ck = ytDlpCookieArgs(opts, pageUrl);
  if (ck.error) throw new Error(ck.error);
  // Persist pasted cookies as a file so pause/resume still finds them.
  const pastedText = String(opts?.cookiesText ?? '').trim();
  const storedCookiesFile = pastedText
    ? pastedCookiesPath()
    : (String(opts?.cookiesFile || '').trim() || undefined);
  // Pre-merge estimate from probe (video+audio sum). Gives the bar a sane
  // starting total instead of 0 -> video-only -> video+audio growth.
  const estBytes = Math.max(0, Math.round(Number(opts?.estimatedBytes || 0)));
  const validQueueId =
    (opts as any)?.queueId && queues.some((q) => q.id === (opts as any).queueId) ? String((opts as any).queueId) : null;
  const nowYt = Date.now();
  const item: Item = {
    id: nowYt.toString(36) + Math.random().toString(36).slice(2, 7),
    url: pageUrl,
    filename,
    savePath,
    totalBytes: estBytes,
    downloadedBytes: 0,
    status: 'queued',
    speedBps: 0,
    connections: 1,
    supportsRange: false,
    createdAt: nowYt,
    lastTryAt: nowYt,
    category: audioOnly ? 'audio' : 'video',
    queueId: validQueueId,
    batchId: (opts as any)?.batchId ? String((opts as any).batchId) : null,
    batchIndex: Number.isFinite(Number((opts as any)?.batchIndex)) ? Number((opts as any).batchIndex) : 0,
    via: 'ytdlp',
    videoHeight: height,
    audioOnly,
    cookiesFromBrowser: String(opts?.cookiesFromBrowser || '').trim() || undefined,
    cookiesFile: storedCookiesFile,
    totalBytesIsEstimate: estBytes > 0 ? true : undefined,
    attempts: 0,
    nextRetryAt: null,
    subtitles: !!(opts as any)?.subtitles,
  };
  items.unshift(item);
  resetQueuePower(validQueueId);
  await startYtDownload(item);
  return item;
});

ipcMain.handle('binaries:status', async () => {
  const custom = String((settings as any).ytDlpPath || '').trim();
  const candidate = resolveYtDlp(custom);
  const [ytVersion, ffVersion, qjsVersion] = await Promise.all([
    getYtDlpVersion(candidate).catch(() => null),
    getFfmpegVersion().catch(() => null),
    getQuickjsVersion().catch(() => null),
  ]);
  let ffprobe: string | null = null;
  try {
    const fp = resolveFfprobe();
    ffprobe = await new Promise<string | null>((res) => {
      execFile(fp, ['-version'], { timeout: 8000 }, (err: any, out: any) => {
        if (err) return res(null);
        res(String(out || '').split('\n')[0].trim().slice(0, 80) || null);
      });
    });
  } catch {}
  return {
    available: !!ytVersion,
    path: ytVersion ? candidate : null,
    version: ytVersion,
    ffmpeg: ffVersion,
    ffmpegPath: resolveFfmpeg(),
    ffprobe,
    ffprobePath: resolveFfprobe(),
    quickjs: qjsVersion,
    quickjsPath: resolveQuickjs(),
    userPath: userYtDlpPath(),
    bundled: bundledYtDlpPath(),
  };
});

ipcMain.handle('binaries:update-ytdlp', async () => {
  const bin = resolveYtDlp(String((settings as any).ytDlpPath || ''));
  const r = await updateYtDlp(bin);
  return r;
});
