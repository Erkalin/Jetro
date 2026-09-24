import { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu, Tray, nativeImage, nativeTheme, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as dns from 'node:dns';
import { SegmentedDownload, probeUrl, guessFilename, smoothSpeedBps, type ProxyOptions } from './downloader';
import {
  applySessionProxy,
  buildCustomProxyUrl,
  defaultNetworkSettings,
  normalizeNetworkSettings,
  resolveEffectiveProxyUrl,
  shouldBypassHostname,
  type NetworkSettings,
} from './proxy';
import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import { resolveYtDlp, getYtDlpVersion, updateYtDlp, ensureWritableYtDlp, consolidateYtDlpAfterUpdate, reconcileBinaries, bundledYtDlpPath, userYtDlpPath, ffmpegDir, envWithBinPath, getFfmpegVersion, getQuickjsVersion, resolveFfmpeg, resolveQuickjs } from './binaries';

// Native dialog titles (alert/confirm/file pickers) use the app name, which
try { app.setName('Jetro'); } catch {}

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
  /** Position inside its queue (lower = higher priority). */
  queueOrder?: number;
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
  /** Start downloads automatically when the app launches. */
  startOnStartup?: boolean;
  /** "Start download at" gate enabled. */
  startAtEnabled?: boolean;
  /** "Stop download at" gate enabled. */
  stopAtEnabled?: boolean;
  /** Once-date vs daily-weekdays schedule. */
  scheduleMode?: 'once' | 'daily';
  /** Once date YYYY-MM-DD (scheduleMode === 'once'). */
  onceDate?: string;
  /** Sun..Sat flags (scheduleMode === 'daily'). */
  weekdays?: boolean[];
  /** Per-file retries override (null = use global settings). */
  retriesPerFile?: number | null;
  /** Absolute path opened when the queue finishes. */
  openWhenDone?: string;
  /** Quit the app when the queue finishes. */
  exitAppWhenDone?: boolean;
  /** Force processes to terminate on shutdown/restart. */
  forceTerminate?: boolean;
  /** Epoch ms when open/exit finish actions fired (fire-once guard). */
  finishFiredAt?: number | null;
}

function normalizeQueuePowerAction(v: any): QueuePowerAction {
  return v === 'sleep' || v === 'hibernate' || v === 'shutdown' || v === 'restart' ? v : 'nothing';
}

function normalizeQueueMaxConcurrent(v: any, fallback = 1): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, n));
}

function normalizeScheduleMode(v: any): 'once' | 'daily' {
  return v === 'once' ? 'once' : 'daily';
}

function normalizeWeekdays(v: any): boolean[] {
  if (Array.isArray(v) && v.length === 7) return v.map((x) => !!x);
  return [true, true, true, true, true, true, true];
}

function normalizeOnceDate(v: any): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return s;
}

function defaultOnceDateStr(): string {
  try {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return '';
  }
}

function normalizeRetriesPerFile(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n;
}

function defaultQueueFields(): Pick<Queue, 'maxConcurrent' | 'startOnStartup' | 'startAtEnabled' | 'stopAtEnabled' | 'scheduleMode' | 'onceDate' | 'weekdays' | 'retriesPerFile' | 'openWhenDone' | 'exitAppWhenDone' | 'forceTerminate'> {
  return {
    maxConcurrent: 1,
    startOnStartup: false,
    startAtEnabled: false,
    stopAtEnabled: false,
    scheduleMode: 'daily',
    onceDate: defaultOnceDateStr(),
    weekdays: [true, true, true, true, true, true, true],
    retriesPerFile: null,
    openWhenDone: '',
    exitAppWhenDone: false,
    forceTerminate: false,
  };
}

function normalizeQueueRecord(q: any): Queue {
  const d = defaultQueueFields();
  return {
    ...q,
    maxConcurrent: normalizeQueueMaxConcurrent(q?.maxConcurrent, 1),
    schedulerEnabled: !!q?.schedulerEnabled,
    scheduleStart: normalizeTime24h(q?.scheduleStart) || '22:00',
    scheduleStop: normalizeTime24h(q?.scheduleStop) || '07:00',
    afterComplete: normalizeQueuePowerAction(q?.afterComplete),
    powerFiredAt: Number(q?.powerFiredAt) > 0 ? Number(q.powerFiredAt) : null,
    finishFiredAt: Number((q as any)?.finishFiredAt) > 0 ? Number((q as any).finishFiredAt) : null,
    startOnStartup: !!(q as any)?.startOnStartup,
    startAtEnabled: (q as any)?.startAtEnabled !== undefined ? !!(q as any).startAtEnabled : !!q?.schedulerEnabled,
    stopAtEnabled: (q as any)?.stopAtEnabled !== undefined ? !!(q as any).stopAtEnabled : !!q?.schedulerEnabled,
    scheduleMode: normalizeScheduleMode((q as any)?.scheduleMode),
    onceDate: normalizeOnceDate((q as any)?.onceDate) || d.onceDate,
    weekdays: normalizeWeekdays((q as any)?.weekdays),
    retriesPerFile: normalizeRetriesPerFile((q as any)?.retriesPerFile),
    openWhenDone: String((q as any)?.openWhenDone || '').slice(0, 1024),
    exitAppWhenDone: !!(q as any)?.exitAppWhenDone,
    forceTerminate: !!(q as any)?.forceTerminate,
  } as Queue;
}

/** Queue file order: explicit queueOrder, then batch order, then oldest first. */
function compareQueueFiles(a: Item, b: Item): number {
  const ao = Number((a as any)?.queueOrder);
  const bo = Number((b as any)?.queueOrder);
  const aHas = Number.isFinite(ao);
  const bHas = Number.isFinite(bo);
  if (aHas && bHas && ao !== bo) return ao - bo;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  const bi = Number((a as any)?.batchIndex ?? 0) - Number((b as any)?.batchIndex ?? 0);
  if (bi !== 0) return bi;
  return Number((a as any)?.createdAt ?? 0) - Number((b as any)?.createdAt ?? 0);
}

function nextQueueOrder(queueId: string): number {
  try {
    let max = 0;
    let has = false;
    for (const it of items) {
      if ((it.queueId || null) !== queueId) continue;
      const o = Number((it as any)?.queueOrder);
      if (Number.isFinite(o)) {
        has = true;
        if (o > max) max = o;
      }
    }
    if (has) return max + 1;
    const inQ = items.filter((i) => (i.queueId || null) === queueId);
    if (!inQ.length) return Date.now();
    const maxCreated = Math.max(...inQ.map((i) => Number((i as any)?.createdAt) || 0));
    return Number.isFinite(maxCreated) && maxCreated > 0 ? maxCreated + 1 : Date.now();
  } catch {
    return Date.now();
  }
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
type ThemeChoice = 'jetro' | 'midnight' | 'system' | 'gray' | 'silver' | 'crimson' | 'coral' | 'amber' | 'teal' | 'navy' | 'turquoise' | 'indigo' | 'aqua' | 'nord' | 'dracula' | 'solarized' | 'forest' | 'blossom' | 'espresso' | 'lavender' | 'ember' | 'pistachio' | 'ruby' | 'scarlet' | 'gold' | 'hunter' | 'clover';
const THEME_IDS: ThemeChoice[] = ['jetro', 'midnight', 'system', 'gray', 'silver', 'crimson', 'coral', 'amber', 'teal', 'navy', 'turquoise', 'indigo', 'aqua', 'nord', 'dracula', 'solarized', 'forest', 'blossom', 'espresso', 'lavender', 'ember', 'pistachio', 'ruby', 'scarlet', 'gold', 'hunter', 'clover'];
/** Legacy ids from before the brand rename (light->jetro, dark->midnight). */
const LEGACY_THEMES: Record<string, ThemeChoice> = { light: 'jetro', dark: 'midnight' };
function normalizeTheme(v: any): ThemeChoice {
  if (typeof v === 'string') {
    if ((THEME_IDS as string[]).includes(v)) return v as ThemeChoice;
    if (v in LEGACY_THEMES) return LEGACY_THEMES[v];
  }
  return 'system';
}
/** Themes rendered on a dark background (drives native chrome + window bg). */
const DARK_BASE_THEMES: ReadonlySet<string> = new Set(['midnight', 'gray', 'crimson', 'teal', 'navy', 'indigo', 'nord', 'dracula', 'forest', 'espresso', 'ember', 'ruby', 'hunter']);
/** Splash background per theme so the window paints the right color instantly. */
const THEME_BG: Record<string, string> = {
  jetro: '#ffffff', midnight: '#060b16', gray: '#14171e', silver: '#f4f6f9',
  crimson: '#160a12', coral: '#fff7f2', amber: '#fffdf5',
  teal: '#062a2a', navy: '#0a1633', turquoise: '#f0fdfa', indigo: '#12102e', aqua: '#f0f9ff',
  nord: '#242933', dracula: '#1a1b26', solarized: '#fefcf5',
  forest: '#0b1f16', blossom: '#fff5f7', espresso: '#1a130e',
  lavender: '#f5f3ff', ember: '#220f06', pistachio: '#f7fee7',
  ruby: '#1d0808', scarlet: '#fff5f5', gold: '#fefce8', hunter: '#060f0a', clover: '#f0fdf4',
};
/** Keep the native chrome (scrollbars, dialogs, titlebar) + window bg in sync with the glass theme. */
function applyNativeTheme() {
  try {
    const choice = normalizeTheme((settings as any).theme);
    // Electron only understands light/dark/system — map custom themes to their base.
    const dark = choice === 'system' ? nativeTheme.shouldUseDarkColors : DARK_BASE_THEMES.has(choice);
    try { nativeTheme.themeSource = choice === 'system' ? 'system' : (dark ? 'dark' : 'light'); } catch {}
    try { win?.setBackgroundColor(THEME_BG[choice] || (dark ? '#080f20' : '#ffffff')); } catch {}
  } catch {}
}
let settings: {
  maxConnections: number;
  maxConcurrentDownloads: number;
  downloadDir: string;
  /** Per-category override folders for the New Download dialog ("Remember path for X"). */
  categoryDirs: Record<string, string>;
  speedLimitKBps: number;
  autoCaptureClipboard: boolean;
  /** X-button behavior: ask every time, minimize to tray, or exit. */
  closeAction: 'ask' | 'minimize' | 'exit';
  /** Glass theme: jetro / midnight / follow the OS. */
  theme: ThemeChoice;
  /** Auto-retry failed downloads with backoff. */
  autoRetryEnabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  /** Check GitHub releases on startup. */
  checkUpdatesOnStart: boolean;
  /** Show the in-app download-complete popup. */
  showCompletePopup: boolean;
  /** Launch at OS startup (installable version only; ignored for portable). */
  launchAtStartup: boolean;
} & NetworkSettings = {
  maxConnections: 8,
  maxConcurrentDownloads: 3,
  downloadDir: app.getPath('downloads'),
  categoryDirs: {},
  speedLimitKBps: 0,
  autoCaptureClipboard: true,
  closeAction: 'ask',
  theme: 'system',
  autoRetryEnabled: true,
  maxRetries: 3,
  retryDelaySec: 5,
  checkUpdatesOnStart: true,
  showCompletePopup: true,
  launchAtStartup: false,
  ...defaultNetworkSettings(),
};
// Factory defaults snapshot (taken before loadAll merges the saved file).
// Used by app:reset-all to restore a fresh-install state.
const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(settings));

function normalizeRetrySettings(s: any) {
  const enabled = (s as any)?.autoRetryEnabled !== false;
  const maxR = Math.min(10, Math.max(0, Math.round(Number((s as any)?.maxRetries ?? 3))));
  const delay = Math.min(300, Math.max(1, Math.round(Number((s as any)?.retryDelaySec ?? 5))));
  (s as any).autoRetryEnabled = enabled;
  (s as any).maxRetries = Number.isFinite(maxR) ? maxR : 3;
  (s as any).retryDelaySec = Number.isFinite(delay) ? delay : 5;
  (s as any).checkUpdatesOnStart = (s as any)?.checkUpdatesOnStart !== false;
  (s as any).showCompletePopup = (s as any)?.showCompletePopup !== false;
  (s as any).launchAtStartup = (s as any)?.launchAtStartup === true;
}

/** True when running from the portable exe (no installer, exe may move). */
function isPortableApp(): boolean {
  try {
    const env: any = (process as any)?.env || {};
    // electron-builder portable wrapper sets these when running portable.
    if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_APP_DIR) return true;
  } catch {}
  return false;
}

/** Stable login-item identity (Windows registry value name). Must never change — renaming it orphans the old entry on reinstall. */
const LOGIN_ITEM_NAME = 'com.jetrodl.app';
/** Value names Jetro may have registered under in the past (before the AppUserModelId was fixed). Swept on boot + uninstall. */
const LEGACY_LOGIN_ITEM_NAMES = ['Jetro', 'jetro'];
/** Args for OS login launch — ALWAYS passed identically on enable AND disable so Electron can match/remove the same entry. */
const LOGIN_ITEM_ARGS = ['--startup-minimized'];

/** Extract the exe path from a Run-key data string (handles `"C:\a\b.exe" --flag` and bare `C:\a\b.exe --flag`). */
function normalizeRunExe(p: string): string {
  try {
    let s = String(p || '').trim();
    if (!s) return '';
    if (s.startsWith('"')) {
      const end = s.indexOf('"', 1);
      if (end > 1) s = s.slice(1, end);
    } else {
      const m = s.match(/^(.+?\.exe)\b/i);
      s = m ? m[1] : s.split(/\s+/)[0];
    }
    return s.replace(/\//g, '\\').toLowerCase();
  } catch { return ''; }
}

/** List all (name, data) values under a registry key. Returns [] on any error (missing key, reg.exe failure). */
function queryRunKeyValues(key: string): Array<{ name: string; data: string }> {
  try {
    const out = String(execFileSync('reg', ['query', key], { windowsHide: true, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] } as any) || '');
    const vals: Array<{ name: string; data: string }> = [];
    for (const line of out.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const m = line.match(/^\s+(.*?)\s+REG_(SZ|EXPAND_SZ|MULTI_SZ|BINARY|DWORD|QWORD)\s*([\s\S]*)$/i);
      if (!m) continue;
      vals.push({ name: (m[1] || '').trim(), data: (m[3] || '').trim() });
    }
    return vals;
  } catch { return []; }
}

function deleteRunValue(key: string, name: string) {
  try {
    execFileSync('reg', ['delete', key, '/v', name, '/f'], { windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] } as any);
  } catch {}
}

// Delete orphaned Jetro login items left by previous installs (Windows only).
function cleanupStaleStartupEntries() {
  try {
    if (process.platform !== 'win32') return;
    try { if (isPortableApp()) return; } catch {}
    const RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const APPROVED = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
    const RUN_MACHINE = 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const currentExe = normalizeRunExe(process.execPath);
    const enable = (settings as any)?.launchAtStartup === true;
    const known = new Set(LEGACY_LOGIN_ITEM_NAMES.map((n) => n.toLowerCase()));
    const isJetroName = (n: string) => {
      const s = String(n || '').toLowerCase();
      return known.has(s) || s.includes('jetro');
    };
    const isJetroExe = (data: string) => {
      try {
        const exe = normalizeRunExe(data);
        return (exe.split('\\').pop() || '') === 'jetro.exe';
      } catch { return false; }
    };
    const runVals = queryRunKeyValues(RUN);
    const liveExists = !!currentExe && runVals.some(
      (r) => String(r.name || '').toLowerCase() === LOGIN_ITEM_NAME.toLowerCase() && normalizeRunExe(r.data) === currentExe,
    );
    // 1) HKCU Run: keep only the canonical live entry (when enabled); drop every other Jetro value.
    for (const v of runVals) {
      try {
        if (!isJetroName(v.name) && !isJetroExe(v.data)) continue;
        const isLive = enable && String(v.name || '').toLowerCase() === LOGIN_ITEM_NAME.toLowerCase() && !!currentExe && normalizeRunExe(v.data) === currentExe;
        if (isLive) continue;
        deleteRunValue(RUN, v.name);
        deleteRunValue(APPROVED, v.name);
      } catch {}
    }
    // 2) StartupApproved ghosts: Approval lingers after its Run value is gone and Task Manager keeps showing it.
    for (const v of queryRunKeyValues(APPROVED)) {
      try {
        if (!isJetroName(v.name)) continue;
        if (enable && String(v.name || '').toLowerCase() === LOGIN_ITEM_NAME.toLowerCase() && liveExists) continue;
        deleteRunValue(APPROVED, v.name);
      } catch {}
    }
    // 3) Machine scope (old per-machine installs / admin leftovers). The current install is per-user, so drop any Jetro value here.
    for (const v of queryRunKeyValues(RUN_MACHINE)) {
      try {
        if (!isJetroName(v.name) && !isJetroExe(v.data)) continue;
        deleteRunValue(RUN_MACHINE, v.name);
      } catch {}
    }
  } catch {}
}

/** Reflect settings.launchAtStartup in the OS login item (installed builds only). */
function applyLaunchAtStartup() {
  try {
    if (isPortableApp()) return;
    const enable = (settings as any)?.launchAtStartup === true;
    // First collapse zombies from previous installs so reinstalls can never stack entries.
    try { cleanupStaleStartupEntries(); } catch {}
    const opts: any = { openAtLogin: enable };
    try {
      if (process.platform === 'win32') {
        opts.name = LOGIN_ITEM_NAME;
        opts.path = process.execPath;
        // Same args on enable AND disable — Electron needs the identical
        opts.args = [...LOGIN_ITEM_ARGS];
      } else if (process.platform === 'linux') {
        opts.path = process.execPath;
        opts.args = [...LOGIN_ITEM_ARGS];
      } else if (process.platform === 'darwin') {
        opts.openAsHidden = true;
      }
      app.setLoginItemSettings(opts);
    } catch {}
  } catch {}
}

/** True when this launch came from OS startup (login item). */
function startedMinimized(): boolean {
  try {
    const argv = (process.argv || []).map((s) => String(s || '').toLowerCase());
    if (argv.includes('--startup-minimized') || argv.includes('--hidden') || argv.includes('-m')) return true;
  } catch {}
  try {
    // macOS "open at login (hidden)" handoff.
    const li: any = (app as any)?.getLoginItemSettings?.();
    if (li?.wasOpenedAtLogin && li?.wasOpenedAsHidden) return true;
  } catch {}
  return false;
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
    // Each file loads independently with shape validation + last-known-good
    // .bak fallback: one corrupt file can no longer wipe the other two.
    const loadedItems = readStoreJson(storeFile, `${storeFile}.bak`, Array.isArray);
    if (loadedItems !== undefined) items = loadedItems;
    const loadedSettings = readStoreJson(
      settingsFile,
      `${settingsFile}.bak`,
      (v) => !!v && typeof v === 'object' && !Array.isArray(v),
    );
    if (loadedSettings !== undefined) settings = { ...settings, ...loadedSettings };
    const loadedQueues = readStoreJson(queuesFile, `${queuesFile}.bak`, Array.isArray);
    if (loadedQueues !== undefined) queues = loadedQueues;
    // backfill queueId / batch fields for old items
    items = items.map((i: any) => ({ queueId: null, batchId: null, batchIndex: 0, attempts: 0, nextRetryAt: null, queueOrder: Number(i?.queueOrder) || Number(i?.createdAt) || 0, ...i }));
    // Ensure every item has a numeric queueOrder (old rows fall back to createdAt).
    items = items.map((i: any) => ({
      ...i,
      queueOrder: Number.isFinite(Number(i?.queueOrder)) ? Number(i.queueOrder) : (Number(i?.createdAt) || 0),
    }));
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
      queues = (Array.isArray(queues) ? queues : []).map((q: any) => normalizeQueueRecord(q));
    } catch {}
    // One-time cleanup: batch queues created by older versions baked the file
    try {
      // Pre-seed with every current name so a stripped name dedups against
      const seen = new Set<string>(
        (Array.isArray(queues) ? queues : []).map((q: any) => String((q as any)?.name || '').toLowerCase()),
      );
      queues = (Array.isArray(queues) ? queues : []).map((q: any) => {
        const name = String((q as any)?.name || '');
        const m = /^(Batch(?: – .+)?) \(\d+ files?\)$/.exec(name);
        if (!m) return q;
        const base = m[1].trim().slice(0, 60) || 'Batch';
        let cand = base;
        for (let n = 2; n < 1000 && seen.has(cand.toLowerCase()); n++) {
          const suffix = ` (${n})`;
          cand = (base.slice(0, 60 - suffix.length) + suffix).trim() || `Batch${suffix}`;
        }
        seen.add(cand.toLowerCase());
        return { ...q, name: cand };
      });
    } catch {}
    // Queues marked "start on startup" resume automatically after relaunch.
    try {
      for (const q of queues) {
        if (!(q as any)?.startOnStartup) continue;
        (q as any).running = true;
        (q as any).powerFiredAt = null;
        (q as any).finishFiredAt = null;
        for (const it of items.filter((i) => (i.queueId || null) === (q as any).id)) {
          if (it.status === 'paused' || it.status === 'error') {
            it.status = 'queued';
            (it as any).error = undefined;
            it.attempts = 0;
            it.nextRetryAt = null;
            touchTry(it);
          }
        }
      }
    } catch {}
    // Backfill retry + update-check defaults for old settings files.
    try { normalizeRetrySettings(settings); } catch {}
    // The browser-extension integration was removed: drop any stale keys.
    delete (settings as any).extensionEnabled;
    delete (settings as any).extensionPort;
    delete (settings as any).extensionToken;
    delete (settings as any).lastExtensionSeenAt;
    delete (settings as any).hideExtensionNudge;
    // Old yt-dlp rows predate estimates: their totals were single-file based,
    // so treat active ones as estimates until they complete and get real sizes.
    items = items.map((i: any) =>
      i?.via === 'ytdlp' && i?.status !== 'completed' && (i?.totalBytes || 0) > 0 && i?.totalBytesIsEstimate === undefined
        ? { ...i, totalBytesIsEstimate: true }
        : i,
    );
    // Relaunch after quit/crash: no live runners exist, so anything saved
    items = items.map((i: any) =>
      i?.status === 'downloading' || i?.status === 'merging'
        ? { ...i, status: 'paused', speedBps: 0 }
        : { ...i, speedBps: 0 },
    );
    // backfill proxy defaults for old settings files
    settings = { ...settings, ...normalizeNetworkSettings(settings) };
    // drop removed VPN option from old settings files
    delete (settings as any).vpnKillSwitch;
    // backfill app/tray defaults for old settings files
    (settings as any).closeAction = normalizeCloseAction((settings as any).closeAction);
    (settings as any).theme = normalizeTheme((settings as any).theme);
    // Run-at-startup only applies to the installed build: normalize the flag,
    // force it off for portable, and reflect it in the OS login item.
    (settings as any).launchAtStartup = (settings as any)?.launchAtStartup === true;
    if (isPortableApp()) (settings as any).launchAtStartup = false;
    // a bare drive letter ("C:") is drive-relative and breaks mkdir — root it
    try { settings.downloadDir = normalizeDir(settings.downloadDir) || settings.downloadDir; } catch {}
    // Per-category folders ("Remember path for X"): sanitize old files.
    try { (settings as any).categoryDirs = normalizeCategoryDirs((settings as any).categoryDirs); } catch {}
    applyNativeTheme();
    try { applyLaunchAtStartup(); } catch {}
  } catch {}
}
// Atomic JSON store: tmp+rename with .bak.
function readStoreJson(primary: string, backup: string, validate: (v: any) => boolean): any | undefined {
  const tryParse = (f: string): any | undefined => {
    try {
      if (!fs.existsSync(f)) return undefined;
      const raw = fs.readFileSync(f, 'utf8');
      if (!raw || !raw.trim()) return undefined;
      const v = JSON.parse(raw);
      return validate(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };
  return tryParse(primary) ?? tryParse(backup);
}

function writeStoreJsonSync(primary: string, backup: string, data: string) {
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    const tmp = `${primary}.tmp`;
    fs.writeFileSync(tmp, data);
    try {
      if (fs.existsSync(primary)) fs.copyFileSync(primary, backup);
    } catch {}
    fs.renameSync(tmp, primary);
  } catch {}
}

/** Serialized chain so async flushes never write concurrently. */
let saveChain: Promise<void> = Promise.resolve();
function writeStoreJsonAsync(primary: string, backup: string, data: string) {
  const run = async () => {
    try {
      await fs.promises.mkdir(storeDir, { recursive: true });
      const tmp = `${primary}.tmp`;
      await fs.promises.writeFile(tmp, data);
      try {
        if (fs.existsSync(primary)) await fs.promises.copyFile(primary, backup);
      } catch {}
      await fs.promises.rename(tmp, primary);
    } catch {}
  };
  saveChain = saveChain.then(run, run);
  saveChain.catch(() => {});
}

function saveAllSync() {
  writeStoreJsonSync(storeFile, `${storeFile}.bak`, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 500)));
  writeStoreJsonSync(settingsFile, `${settingsFile}.bak`, JSON.stringify(settings));
  writeStoreJsonSync(queuesFile, `${queuesFile}.bak`, JSON.stringify((Array.isArray(queues) ? queues : []).slice(0, 100)));
}
let saveTimer: NodeJS.Timeout | null = null;
function saveAllDebounced() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeStoreJsonAsync(storeFile, `${storeFile}.bak`, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 500)));
      writeStoreJsonAsync(settingsFile, `${settingsFile}.bak`, JSON.stringify(settings));
      writeStoreJsonAsync(queuesFile, `${queuesFile}.bak`, JSON.stringify((Array.isArray(queues) ? queues : []).slice(0, 100)));
    } catch {}
  }, 1000);
}
let lastBroadcast = 0;
let lastTrayRefresh = 0;
let lastTraySig = '';
// Signature of what the tray menu shows: integer % per active download +
function trayProgressSig(): string {
  try {
    const active = items.filter((i) => i.status === 'downloading' || i.status === 'merging');
    const parts = active.map((it) => {
      let pct = 0;
      try {
        const total = Number(it.totalBytes) || 0;
        const done = Number(it.downloadedBytes) || 0;
        pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
      } catch {}
      return `${it.id}:${Math.floor(pct)}:${it.status}`;
    });
    const speed = String((settings as any)?.speedLimitKBps ?? 0);
    const retries = String((settings as any)?.maxRetries ?? 3);
    const retryOn = (settings as any)?.autoRetryEnabled !== false ? '1' : '0';
    return `${parts.join('|')}#${speed}#${retries}#${retryOn}`;
  } catch {
    return '';
  }
}
/** Rebuild the tray menu when the integer % (or set/settings) changed. */
function requestTrayRefresh(immediate = false) {
  try {
    const now = Date.now();
    const sig = trayProgressSig();
    const sigChanged = sig !== lastTraySig;
    // Progress ticks with no integer-% change: skip the rebuild entirely.
    if (!immediate && !sigChanged) return;
    // Min gap between rebuilds so a fast burst (many files crossing % at
    // once) can't rebuild the native menu dozens of times per second.
    if (!immediate && now - lastTrayRefresh < 400) return;
    lastTrayRefresh = now;
    lastTraySig = sig;
    refreshTrayMenu();
  } catch {}
}
function broadcast(immediate = false) {
  const now = Date.now();
  // Coalesce 100ms progress ticks: at most 10 full-list sends/sec unless forced.
  if (!immediate && now - lastBroadcast < 100) {
    saveAllDebounced();
    try { requestTrayRefresh(false); } catch {}
    return;
  }
  lastBroadcast = now;
  try {
    win?.webContents.send('dl:update', items);
    win?.webContents.send('queue:update', queues);
  } catch {}
  saveAllDebounced();
  requestTrayRefresh(immediate);
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

/**
 * Sanitize settings.categoryDirs: keep only the 6 known sidebar keys with
 * non-empty string paths (rooting bare drive letters like downloadDir).
 */
function normalizeCategoryDirs(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of ['video', 'music', 'documents', 'archives', 'software', 'others']) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.trim()) out[k] = normalizeDir(v);
      }
    }
  } catch {}
  return out;
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

// Ensure downloads can actually be written to `dir`: create it if needed and
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
  return items.filter((i) => i.status === 'downloading' || i.status === 'merging').length;
}
function activeCountForQueue(queueId: string | null) {
  return items.filter((i) => (i.queueId || null) === (queueId || null) && (i.status === 'downloading' || i.status === 'merging')).length;
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
function queueRetryLimit(queueId: string | null): number {
  try {
    const q = queueId ? queues.find((x) => x.id === queueId) : undefined;
    const per = normalizeRetriesPerFile((q as any)?.retriesPerFile);
    if (per !== null) return per;
  } catch {}
  return Math.min(10, Math.max(0, Math.round(Number((settings as any).maxRetries ?? 3))));
}

/** Re-queue an item with exponential backoff. Returns true when scheduled. */
function scheduleAutoRetry(item: Item): boolean {
  try {
    if (!(settings as any).autoRetryEnabled) return false;
    const maxR = queueRetryLimit((item as any)?.queueId || null);
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
          // Both engines go through the queue pump so stopped queues,
          // schedule windows and concurrency limits are respected.
          pumpQueue();
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
  if (!q) return;
  let changed = false;
  if ((q as any).powerFiredAt) {
    (q as any).powerFiredAt = null;
    changed = true;
  }
  if ((q as any).finishFiredAt) {
    (q as any).finishFiredAt = null;
    changed = true;
  }
  if (changed) broadcast(true);
}

function maybeFireQueueFinishActions() {
  try {
    for (const q of queues) {
      const qItems = items.filter((i) => (i.queueId || null) === q.id);
      if (!qItems.length) continue;
      if (!qItems.every((i) => i.status === 'completed')) continue;
      if (!(q as any).finishFiredAt) {
        (q as any).finishFiredAt = Date.now();
        broadcast(true);
        const openTarget = String((q as any)?.openWhenDone || '').trim();
        if (openTarget) {
          try {
            if (fs.existsSync(openTarget)) {
              const st = fs.statSync(openTarget);
              if (st.isFile()) shell.openPath(openTarget).catch(() => {});
              else if (st.isDirectory()) shell.openPath(openTarget).catch(() => {});
            }
          } catch {}
        }
        if ((q as any)?.exitAppWhenDone) {
          try {
            setTimeout(() => {
              try {
                const still = items.filter((i) => (i.queueId || null) === q.id);
                if (still.length && still.every((i) => i.status === 'completed')) {
                  try { saveAllSync(); } catch {}
                  app.quit();
                }
              } catch {}
            }, 3000);
          } catch {}
        }
      }
    }
  } catch {}
}

/** Fire per-queue power actions: only when every item is completed. */
function maybeFireQueuePower() {
  try {
    maybeFireQueueFinishActions();
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

function runPowerAction(action: string, force = false) {
  const a = normalizeQueuePowerAction(action);
  if (a === 'nothing') return;
  try {
    if (process.platform !== 'win32') return;
    if (a === 'shutdown') {
      const args = force ? ['/s', '/f', '/t', '0'] : ['/s', '/t', '0'];
      spawn('shutdown', args, { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'restart') {
      const args = force ? ['/r', '/f', '/t', '0'] : ['/r', '/t', '0'];
      spawn('shutdown', args, { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'hibernate') {
      spawn('shutdown', ['/h'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    } else if (a === 'sleep') {
      spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { detached: true, stdio: 'ignore', windowsHide: true })?.unref?.();
    }
  } catch {}
}
// Legacy cap for pre-queue batches (batch items with no queueId, from before
function batchLimit(): number {
  const n = Number((settings as any).maxConcurrentDownloads ?? 3);
  return Math.min(10, Math.max(1, Math.round(n) || 3));
}
function activeCountForBatch(batchId: string): number {
  return items.filter((i) => (i.batchId || null) === batchId && (i.status === 'downloading' || i.status === 'merging')).length;
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
function time24hToSeconds(v: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}
function inDateWindow(q: Queue): boolean {
  try {
    const mode = normalizeScheduleMode((q as any)?.scheduleMode);
    if (mode === 'once') {
      const iso = normalizeOnceDate((q as any)?.onceDate);
      // No valid once-date: fail open so a bad value never wedges the queue.
      if (!iso) return true;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return today === iso;
    }
    const days = normalizeWeekdays((q as any)?.weekdays);
    // All unchecked = fail open (IDM-like: nothing selected means no day filter).
    if (!days.some(Boolean)) return true;
    return !!days[new Date().getDay()];
  } catch {
    return true;
  }
}
function inQueueWindow(q: Queue): boolean {
  // Legacy single toggle still gates both time checks; the Scheduler window
  // exposes finer start/stop toggles that override it when present.
  const startOn = (q as any)?.startAtEnabled !== undefined ? !!(q as any).startAtEnabled : !!q.schedulerEnabled;
  const stopOn = (q as any)?.stopAtEnabled !== undefined ? !!(q as any).stopAtEnabled : !!q.schedulerEnabled;
  const gated = startOn || stopOn;
  if (!gated) {
    // No time gate: only the day filter still applies (and only when the
    // queue was created with scheduling enabled).
    if (q.schedulerEnabled && !inDateWindow(q)) return false;
    return true;
  }
  if (!inDateWindow(q)) return false;
  // Seconds precision so Start/Stop fire within ~1s of the set HH:MM
  // (minute truncation used to fire the Stop up to 59s late).
  const now = new Date();
  const cur = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  if (startOn) {
    const s = time24hToSeconds(String(q.scheduleStart || ''));
    if (Number.isFinite(s)) {
      const e = stopOn ? time24hToSeconds(String(q.scheduleStop || '')) : NaN;
      if (stopOn && Number.isFinite(e) && s > e) {
        // Overnight range (e.g. 22:00–07:00): the morning half before e is
        if (cur >= e && cur < s) return false;
      } else if (cur < s) {
        return false;
      }
    }
  }
  if (stopOn) {
    const e = time24hToSeconds(String(q.scheduleStop || ''));
    if (Number.isFinite(e)) {
      const s = startOn ? time24hToSeconds(String(q.scheduleStart || '')) : NaN;
      if (startOn && Number.isFinite(s)) {
        // Start+stop window [s, e): start inclusive, stop exclusive so the
        // Stop fires exactly at HH:MM:00 (overnight ranges wrap past midnight).
        const inside = s <= e ? cur >= s && cur < e : cur >= s || cur < e;
        if (!inside) return false;
      } else if (cur >= e) {
        return false;
      }
    }
  }
  return true;
}
function queueConcurrentLimit(q: Queue): number {
  const per = normalizeQueueMaxConcurrent((q as any)?.maxConcurrent, 1);
  const global = Math.min(10, Math.max(1, Math.round(Number((settings as any).maxConcurrentDownloads ?? 3)) || 3));
  // Per-queue value caps its own queue; the global setting stays a hard ceiling.
  return Math.min(per, global);
}

// Enforce per-queue schedules: a running queue with a schedule only downloads
function enforceQueueSchedules(): boolean {
  let parked = false;
  for (const q of queues) {
    if (!q.running || inQueueWindow(q)) continue;
    const gated = !!((q as any)?.startAtEnabled || (q as any)?.stopAtEnabled || (q as any)?.schedulerEnabled);
    if (!gated) continue;
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

// Edge-triggered same-day start/stop.
const schedPrevWin = new Map<string, boolean>();
function scheduleEventsTick(): void {
  try {
    for (const q of queues) {
      const qid = (q as any)?.id as string;
      if (!qid) continue;
      const startOn = (q as any)?.startAtEnabled !== undefined ? !!(q as any).startAtEnabled : !!(q as any)?.schedulerEnabled;
      const stopOn = (q as any)?.stopAtEnabled !== undefined ? !!(q as any).stopAtEnabled : !!(q as any)?.schedulerEnabled;
      if (!startOn && !stopOn) {
        if (schedPrevWin.has(qid)) schedPrevWin.delete(qid);
        continue;
      }
      let inWin = true;
      try {
        inWin = inQueueWindow(q);
      } catch {
        continue;
      }
      const prev = schedPrevWin.get(qid);
      if (prev === undefined) {
        // First sighting (boot / new queue): remember, then apply today's
        schedPrevWin.set(qid, inWin);
        try {
          if (inWin && startOn && !q.running && queueHasWork(qid)) startQueueById(qid);
        } catch {}
        continue;
      }
      if (prev === inWin) continue;
      // Record BEFORE firing: start/stop re-enter pumpQueue, and the inner
      // tick must see the new state (no double fire).
      schedPrevWin.set(qid, inWin);
      try {
        if (!prev && inWin) {
          if (startOn && !q.running && queueHasWork(qid)) startQueueById(qid);
        } else if (prev && !inWin) {
          if (stopOn && q.running) stopQueueById(qid);
        }
      } catch {}
    }
    // Evict deleted queues so the map can't grow.
    if (schedPrevWin.size > queues.length + 8) {
      const live = new Set(queues.map((x) => (x as any)?.id));
      for (const id of [...schedPrevWin.keys()]) if (!live.has(id)) schedPrevWin.delete(id);
    }
  } catch {}
}

/** Route a queued item to the right engine. Segmented URLs must never go to
 * yt-dlp and page URLs must never go to the segmented engine. */
async function startQueuedItem(item: Item): Promise<void> {
  if (!item || item.status !== 'queued') return;
  if ((item as any)?.via === 'ytdlp') {
    if (ytJobs.has(item.id)) return;
    if (item.nextRetryAt && Number(item.nextRetryAt) > Date.now()) return;
    await startYtDownload(item).catch(() => {});
  } else {
    await startDownload(item).catch(() => {});
  }
}
async function pumpQueue() {
  // Fire same-day schedule edges first (auto start/stop at HH:MM:00), so the
  // running flags already reflect the window before parking/pumping below.
  try { scheduleEventsTick(); } catch {}
  // Park anything running outside its queue's schedule window first, so closing
  // windows actually stop downloads (and re-opening windows resume them).
  enforceQueueSchedules();
  // Global (no-queue) downloads — singles first, then legacy batches in
  {
    const now = Date.now();
    const retryReady = (i: Item) => !i.nextRetryAt || Number(i.nextRetryAt) <= now;
    const queuedSingles = items
      .filter((i) => i.status === 'queued' && !(i.queueId || null) && !(i.batchId || null) && retryReady(i))
      // FIFO: oldest added starts first. items[] itself is newest-first
      .sort((a, b) => (Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)) || (Number((a as any)?.queueOrder ?? 0) - Number((b as any)?.queueOrder ?? 0)));
    while (activeCount() < settings.maxConcurrentDownloads && queuedSingles.length) {
      const next = queuedSingles.shift()!;
      startQueuedItem(next).catch(() => {});
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
        startQueuedItem(next).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  // Per-queue downloads: only when queue is running + in its schedule window.
  for (const q of queues) {
    if (!q.running) continue;
    if (!inQueueWindow(q)) continue;
    const nowQ = Date.now();
    const queued = items
      .filter((i) => i.status === 'queued' && (i.queueId || null) === q.id && (!i.nextRetryAt || Number(i.nextRetryAt) <= nowQ))
      .sort(compareQueueFiles);
    const perQueueCap = queueConcurrentLimit(q);
    while (
      queued.length &&
      activeCount() < settings.maxConcurrentDownloads &&
      activeCountForQueue(q.id) < perQueueCap
    ) {
      const next = queued.shift()!;
      if (next.status !== 'queued') continue;
      startQueuedItem(next).catch(() => {});
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
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'Jetro-notext.png'),
    path.join(app.getAppPath(), 'src', 'assets', 'Jetro-notext.png'),
    path.join(app.getAppPath(), '..', 'src', 'assets', 'Jetro-notext.png'),
    path.join(__dirname, '..', 'src', 'assets', 'Jetro-notext.png'),
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
  const startDark = themeChoice === 'system' ? nativeTheme.shouldUseDarkColors : DARK_BASE_THEMES.has(themeChoice);
  try { nativeTheme.themeSource = themeChoice === 'system' ? 'system' : (startDark ? 'dark' : 'light'); } catch {}
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: THEME_BG[themeChoice] || (startDark ? '#080f20' : '#ffffff'),
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
      // Launched from OS startup: stay in the tray, don't pop a window.
      // Launched via jetro:// link: only the download dialog pops up.
      if (startedMinimized() || coldProtocolLaunch) {
        try { win?.hide(); } catch {}
      } else {
        win?.show();
        win?.focus();
      }
    } catch {}
    flushPendingExternalUrl();
  });
  try {
    win.webContents.on('did-finish-load', () => flushPendingExternalUrl());
  } catch {}
  // X button: exit / minimize-to-tray per settings.closeAction.
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

// Tray
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

// Browser download dialog: separate IDMstyle toplevel window
let browserDialogWin: BrowserWindow | null = null;

function createBrowserDialogWindow() {
  if (browserDialogWin && !browserDialogWin.isDestroyed()) return browserDialogWin;
  const icon = resolveAppIcon();
  const themeChoice = normalizeTheme((settings as any).theme);
  const startDark = themeChoice === 'system' ? nativeTheme.shouldUseDarkColors : DARK_BASE_THEMES.has(themeChoice);
  browserDialogWin = new BrowserWindow({
    width: 650,
    // Height is a placeholder — the renderer reports its real content height
    // via 'browser-dialog:resize' and the window hugs it (see handler below).
    height: 400,
    minWidth: 580,
    minHeight: 340,
    backgroundColor: THEME_BG[themeChoice] || (startDark ? '#080f20' : '#ffffff'),
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
  browserDialogWin.setMenu(null);
  if (process.env.NODE_ENV === 'development') {
    browserDialogWin.loadURL('http://localhost:5173/#browser-download');
  } else {
    browserDialogWin.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'browser-download' });
  }
  browserDialogWin.once('ready-to-show', () => {
    try {
      browserDialogWin?.show();
      browserDialogWin?.focus();
    } catch {}
    flushPendingExternalUrl();
  });
  try {
    browserDialogWin.webContents.on('did-finish-load', () => flushPendingExternalUrl());
  } catch {}
  browserDialogWin.on('closed', () => {
    browserDialogWin = null;
  });
  return browserDialogWin;
}

// Browser dialog dynamic height: hug the content, grow with video UI
const BD_MIN_CONTENT_H = 280;
const BD_MAX_CONTENT_H = 760;
ipcMain.on('browser-dialog:resize', (_e, rawH?: number) => {
  try {
    const win = browserDialogWin;
    if (!win || win.isDestroyed()) return;
    const want = Math.round(Number(rawH) || 0);
    if (!want || want < 50 || want > 3000) return;
    let workH = 900;
    try {
      workH = screen.getPrimaryDisplay()?.workAreaSize?.height || 900;
    } catch {}
    const maxH = Math.max(340, Math.min(BD_MAX_CONTENT_H, workH - 60));
    const target = Math.max(BD_MIN_CONTENT_H, Math.min(maxH, want));
    const [curW, curH] = win.getContentSize();
    if (Math.abs(curH - target) < 2) return;
    win.setContentSize(curW, target, false);
  } catch {}
});

function focusBrowserDialogWindow() {
  try {
    if (browserDialogWin && !browserDialogWin.isDestroyed()) {
      if (!browserDialogWin.isVisible()) browserDialogWin.show();
      if (browserDialogWin.isMinimized()) browserDialogWin.restore();
      browserDialogWin.focus();
      return true;
    }
  } catch {}
  return false;
}

// Tray menu helpers (live downloads + quick settings)
/** Speed-limit presets (KB/s, 0 = unlimited). Mirrors SPEED_LIMIT_VALUES in src/lib/options.ts. */
const TRAY_SPEED_LIMITS = [0, 100, 256, 512, 1024, 2048, 5120, 10240];
/** Max auto-retry choices (0–10). Mirrors normalizeRetrySettings clamping. */
const TRAY_MAX_RETRIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function traySpeedLabel(kbps: number): string {
  const v = Math.max(0, Math.round(Number(kbps) || 0));
  if (!v) return 'Unlimited';
  if (v >= 1024 && v % 1024 === 0) return `${v / 1024} MB/s`;
  return `${v} KB/s`;
}

/** Keep tray rows readable: Electron menus don't wrap, so cap at ~64 chars. */
function truncateTrayFilename(name: string, max = 64): string {
  const s = String(name || 'download');
  if (s.length <= max) return s;
  if (max <= 4) return s.slice(0, max);
  return s.slice(0, max - 3) + '...';
}

/** 0–100 progress of an item (same math as the card progress bar). */
function trayItemPct(it: Item): number {
  try {
    const total = Number(it.totalBytes) || 0;
    const done = Number(it.downloadedBytes) || 0;
    if (!(total > 0)) return 0;
    return Math.min(100, Math.max(0, (done / total) * 100));
  } catch {
    return 0;
  }
}

/** Persist + live-apply a tray speed-limit change and keep the UI in sync. */
function applyTraySpeedLimit(kbps: number) {
  try {
    const v = Math.max(0, Math.round(Number(kbps) || 0));
    (settings as any).speedLimitKBps = v;
    try { saveAllSync(); } catch {}
    // Live-apply: running segmented downloads keep the snapshot they started
    // with, so push the new value (same as settings:save).
    try {
      const limitBps = v * 1024;
      runners.forEach((dl) => {
        try { dl.setSpeedLimitBps(limitBps); } catch {}
      });
    } catch {}
    try { win?.webContents.send('settings:changed', settings); } catch {}
    refreshTrayMenu();
  } catch {}
}

/** Persist a tray max-retries change and keep the UI in sync. */
function applyTrayMaxRetries(n: number) {
  try {
    const v = Math.min(10, Math.max(0, Math.round(Number(n) || 0)));
    (settings as any).maxRetries = Number.isFinite(v) ? v : 3;
    // Picking a number implies the user wants retries: re-enable when > 0 so
    // the choice takes effect even if the toggle was off.
    if ((settings as any).maxRetries > 0 && (settings as any).autoRetryEnabled === false) {
      (settings as any).autoRetryEnabled = true;
    }
    try { normalizeRetrySettings(settings); } catch {}
    try { saveAllSync(); } catch {}
    try { win?.webContents.send('settings:changed', settings); } catch {}
    refreshTrayMenu();
  } catch {}
}

function refreshTrayMenu() {
  if (!tray) return;
  try {
    const closeAction = normalizeCloseAction((settings as any).closeAction);
    const speedRaw = Math.round(Number((settings as any).speedLimitKBps) || 0);
    const speedKBps = Number.isFinite(speedRaw) ? Math.max(0, speedRaw) : 0;
    const autoRetryEnabled = (settings as any).autoRetryEnabled !== false;
    const retriesRaw = Math.round(Number((settings as any).maxRetries ?? 3));
    const maxRetries = Number.isFinite(retriesRaw) ? Math.min(10, Math.max(0, retriesRaw)) : 3;

    // Currently downloading files, one row each: "<progress percentage> <File name>".
    // Integer % so the menu advances 46% -> 47% like the user expects.
    const active = items.filter((i) => i.status === 'downloading' || i.status === 'merging');
    const downloadItems: any[] =
      active.length > 0
        ? active.map((it) => {
            const pct = trayItemPct(it);
            const label = `${Math.floor(pct)}% ${truncateTrayFilename(it.filename)}`;
            return {
              label,
              toolTip: String(it.filename || ''),
              click: () => showMainWindow(),
            };
          })
        : [{ label: 'No active downloads', enabled: false }];

    // Speed limiter presets. A custom value (typed in Settings) gets its own
    // checked row so the menu never shows nothing selected.
    const speedValues = TRAY_SPEED_LIMITS.includes(speedKBps)
      ? TRAY_SPEED_LIMITS
      : [...TRAY_SPEED_LIMITS, speedKBps].sort((a, b) => a - b);
    const speedSubmenu: any[] = speedValues.map((v) => ({
      label: traySpeedLabel(v),
      type: 'radio' as const,
      checked: v === speedKBps,
      click: () => applyTraySpeedLimit(v),
    }));

    const retrySubmenu: any[] = [
      {
        label: 'Retry failed downloads',
        type: 'checkbox' as const,
        checked: autoRetryEnabled,
        click: () => {
          (settings as any).autoRetryEnabled = !autoRetryEnabled;
          try { normalizeRetrySettings(settings); } catch {}
          try { saveAllSync(); } catch {}
          try { win?.webContents.send('settings:changed', settings); } catch {}
          refreshTrayMenu();
        },
      },
      { type: 'separator' as const },
      ...TRAY_MAX_RETRIES.map((n) => ({
        label: n === 0 ? '0 (no retry)' : `${n}`,
        type: 'radio' as const,
        checked: n === maxRetries,
        click: () => applyTrayMaxRetries(n),
      })),
    ];

    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Jetro',
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      ...downloadItems,
      { type: 'separator' },
      {
        label: `Speed limit (${traySpeedLabel(speedKBps)})`,
        submenu: speedSubmenu,
      },
      {
        label: `Max auto retries (${maxRetries})`,
        submenu: retrySubmenu,
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
    try {
      if (active.length > 0) {
        // Hover feedback updates live without opening the menu. Keep it short:
        // "Jetro - 2 downloading (46%, 12%)".
        const pcts = active.slice(0, 5).map((it) => `${Math.floor(trayItemPct(it))}%`);
        const extra = active.length > 5 ? ` +${active.length - 5} more` : '';
        tray.setToolTip(`Jetro - ${active.length} downloading (${pcts.join(', ')})${extra}`);
      } else {
        tray.setToolTip('Jetro');
      }
    } catch {}
    tray.setContextMenu(menu);
    // Direct callers (tray clicks, settings:save) bypass requestTrayRefresh —
    // keep the % signature in sync so the next progress tick diffs correctly.
    try {
      lastTraySig = trayProgressSig();
      lastTrayRefresh = Date.now();
    } catch {}
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

// Browser extension: jetro:// protocol handoff
let pendingExternalUrls: { url: string; source: string }[] = [];
// True when the app was launched by a jetro:// link: the main window stays
// hidden and only the browser download dialog appears (IDM-style).
let coldProtocolLaunch = false;

function parseJetroProtocolUrl(raw: string): { url: string; source: string } | null {
  try {
    const s = String(raw || '').trim();
    if (!/^jetro:\/\//i.test(s)) return null;
    // URL requires //host; jetro://add?url=.. parses with hostname 'add'.
    const u = new URL(s);
    const target = String(u.searchParams.get('url') || '').trim();
    const source = String(u.searchParams.get('source') || 'page').trim().slice(0, 32) || 'page';
    if (!target || target.length > 2048 || /\s/.test(target)) return null;
    let inner: URL;
    try {
      inner = new URL(target);
    } catch {
      return null;
    }
    if (inner.protocol !== 'http:' && inner.protocol !== 'https:') return null;
    if (!inner.hostname || !isValidDownloadHost(inner.hostname)) return null;
    return { url: target, source };
  } catch {
    return null;
  }
}

function extractJetroUrlFromArgv(argv: string[]): string | null {
  try {
    for (const a of argv || []) {
      const s = String(a || '').trim().replace(/^"+|"+$/g, '');
      if (/^jetro:\/\//i.test(s)) return s;
    }
  } catch {}
  return null;
}

function deliverExternalUrl(url: string, source: string) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return;
  const payload = { url: cleanUrl, source: String(source || 'page') };
  // Prefer the live dialog window.
  try {
    if (browserDialogWin && !browserDialogWin.isDestroyed()) {
      if (browserDialogWin.webContents && !browserDialogWin.webContents.isLoading()) {
        browserDialogWin.webContents.send('external-url', payload);
      } else {
        pendingExternalUrls.push(payload);
        if (pendingExternalUrls.length > 20) pendingExternalUrls = pendingExternalUrls.slice(-20);
      }
      focusBrowserDialogWindow();
      return;
    }
  } catch {}
  // No dialog yet — queue and create it (IDM-style: only the dialog appears).
  pendingExternalUrls.push(payload);
  if (pendingExternalUrls.length > 20) pendingExternalUrls = pendingExternalUrls.slice(-20);
  try {
    createBrowserDialogWindow();
  } catch {
    // Dialog creation failed — fall back to the main window so the link
    // is never lost (its renderer handles 'external-url' the same way).
    try {
      showMainWindow();
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isLoading()) {
        const queued = pendingExternalUrls;
        pendingExternalUrls = [];
        for (const p of queued) {
          try { win.webContents.send('external-url', p); } catch {}
        }
        return;
      }
    } catch {}
  }
  // Retry shortly in case the window becomes ready without re-firing flush.
  try {
    setTimeout(() => flushPendingExternalUrl(), 1500);
  } catch {}
}

function flushPendingExternalUrl() {
  if (!pendingExternalUrls.length) return;
  // Dialog window first (normal path). Never send while it is still loading
  // (the message would be dropped) — keep queued; did-finish-load flushes.
  try {
    if (browserDialogWin && !browserDialogWin.isDestroyed() && browserDialogWin.webContents) {
      if (browserDialogWin.webContents.isLoading()) return;
      const queued = pendingExternalUrls;
      pendingExternalUrls = [];
      for (const payload of queued) {
        try { browserDialogWin.webContents.send('external-url', payload); } catch {}
      }
      return;
    }
  } catch {}
  // Fallback: main window (only when the dialog could not be created).
  try {
    if (!win || win.isDestroyed()) return;
    if (win.webContents && win.webContents.isLoading()) return;
    const queued = pendingExternalUrls;
    pendingExternalUrls = [];
    for (const payload of queued) {
      try { win.webContents.send('external-url', payload); } catch {}
    }
  } catch {}
}

function handleJetroProtocolArg(raw: string | null | undefined) {
  if (!raw) return;
  const parsed = parseJetroProtocolUrl(String(raw));
  if (parsed) deliverExternalUrl(parsed.url, parsed.source);
}

function registerJetroProtocol() {
  try {
    if (process.defaultApp) {
      // Dev (`electron dist-electron/main.js`): register with explicit script path.
      if (process.argv.length >= 2) {
        try {
          app.setAsDefaultProtocolClient('jetro', process.execPath, [path.resolve(process.argv[1])]);
          return;
        } catch {}
      }
    }
    app.setAsDefaultProtocolClient('jetro');
  } catch (e) {
    console.warn('[jetro] protocol registration failed', e);
  }
}

// macOS: protocol link while running.
try {
  app.on('open-url', (e: any, url: string) => {
    try { e?.preventDefault?.(); } catch {}
    handleJetroProtocolArg(url);
  });
} catch {}

app.whenReady().then(() => {
  // Single instance: a second launch focuses the running app.
  try {
    if (!app.requestSingleInstanceLock()) {
      isQuitting = true;
      app.quit();
      return;
    }
    app.on('second-instance', (_e: any, argv?: string[]) => {
      try {
        const proto = extractJetroUrlFromArgv(argv || []);
        if (proto) handleJetroProtocolArg(proto);
        else showMainWindow();
      } catch {
        showMainWindow();
      }
    });
  } catch {}
  registerJetroProtocol();
  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('com.jetrodl.app');
    } catch {}
  }
  Menu.setApplicationMenu(null);
  loadAll();
  // Fold any legacy AppData binary duplicates back into resources/bin
  // (keeps the newer yt-dlp, deletes the stale copy). Non-blocking.
  try { reconcileBinaries().catch(() => {}); } catch {}
  // fix downloadDir default if missing
  try {
    fs.mkdirSync(settings.downloadDir, { recursive: true });
  } catch {}
  // Cold start via jetro:// link (Windows passes it in process.argv).
  // The main window stays hidden; only the download dialog appears.
  try {
    const cold = extractJetroUrlFromArgv(process.argv || []);
    if (cold) {
      const parsed = parseJetroProtocolUrl(cold);
      if (parsed) {
        coldProtocolLaunch = true;
        pendingExternalUrls.push({ url: parsed.url, source: parsed.source });
      }
    }
  } catch {}
  createWindow();
  if (coldProtocolLaunch && pendingExternalUrls.length) {
    try { createBrowserDialogWindow(); } catch {}
  }
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

// IPC
// Shared single-download add path. Normalizes + probes + queues.
async function addSingleDownload(rawUrl: string, opts?: any): Promise<Item> {
  const url = normalizeDownloadUrl(rawUrl);
  // HLS/DASH playlists are not direct files: the segmented engine would save
  // the few-KB playlist text as video. Point at video detection instead.
  if (/\.m3u8(\?|#|$)/i.test(url) || /\.mpd(\?|#|$)/i.test(url)) {
    throw new Error('This looks like a stream playlist (m3u8/mpd), not a direct file — use "Is this a video/audio page? Click to detect" to download it as video.');
  }
  let filename = opts?.filename;
  let total = 0;
  let supportsRange = false;
  try {
    const p = await probeUrl(url, currentProxyOpts());
    total = p.totalBytes;
    supportsRange = p.supportsRange;
    if (!filename) filename = p.filename;
    // Hotlink-protected / expired CDN URL: the server answered with a web
    try {
      const ct = String((p as any)?.contentType || '').toLowerCase();
      const fn = String(filename || (p as any)?.filename || url).toLowerCase();
      const looksVideo = /\.(mp4|mkv|webm|mov|avi|m4v|mp3|m4a|aac|opus|ogg|wav|flac)$/i.test(fn);
      if (looksVideo && ct.includes('text/html') && (total || 0) > 0 && (total || 0) < 300 * 1024) {
        throw new Error('Server returned a web page instead of a video file (hotlink protection or expired link) — use "Is this a video/audio page? Click to detect" to download it as video.');
      }
    } catch (e: any) {
      if (/web page instead of a video/i.test(String(e?.message || ''))) throw e;
    }
  } catch (e: any) {
    if (/web page instead of a video|stream playlist/i.test(String(e?.message || ''))) throw e;
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
    await unlinkWithRetries(savePath, 3);
    await unlinkWithRetries(savePath + '.jetro.json', 3);
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
    queueOrder: validQueueId ? nextQueueOrder(validQueueId) : now,
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
}

ipcMain.handle('dl:probe', async (_e, url: string) => {
  url = normalizeDownloadUrl(url);
  return probeUrl(url, currentProxyOpts());
});

ipcMain.handle('dl:add', async (_e, url: string, opts?: any) => {
  return addSingleDownload(url, opts);
});

// Batch downloads (New Batch Download: one *pattern → many files)
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

// Suggested batch queue name from the batch URLs: host only (never a file
function batchQueueNameFor(clean: string[]): string {
  let host = '';
  try {
    host = new URL(normalizeDownloadUrl(clean[0])).hostname.replace(/^www\./i, '');
  } catch {
    host = '';
  }
  const core = host ? `Batch – ${host}` : 'Batch';
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
  const queueName = uniqueBatchQueueName(String(opts?.queueName || '').trim() || batchQueueNameFor(clean));
  const queue: Queue = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + 'b',
    name: queueName,
    running: true,
    schedulerEnabled: false,
    scheduleStart: '22:00',
    scheduleStop: '07:00',
    createdAt: baseTs,
    afterComplete: 'nothing',
    powerFiredAt: null,
    finishFiredAt: null,
    ...defaultQueueFields(),
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
    // Dedup filenames inside the batch (e.g. pattern only in query string)
    const used = new Set<string>();
    for (const it of items) {
      try {
        if (it?.savePath && path.dirname(it.savePath) === dir) {
          used.add(path.basename(it.savePath).toLowerCase());
        }
      } catch {}
    }
    try {
      for (const n of fs.readdirSync(dir)) used.add(String(n).toLowerCase());
    } catch {}
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
        queueOrder: baseTs + idx,
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
  // Merging (ffmpeg mux/extract) is atomic and can't be paused: killing it
  if (it?.status === 'merging') return;
  // yt-dlp downloads are non-pausable while downloading: killing the yt-dlp
  if (it?.via === 'ytdlp' && it?.status === 'downloading') return;
  clearRetryTimer(id);
  if (it) it.nextRetryAt = null;
  if (it?.via === 'ytdlp') {
    if (it.status !== 'queued') return;
    killYtJob(id); // no-op when nothing is running (race safety)
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
    // Queue it so stopped queues, schedule windows and concurrency limits apply.
    it.status = 'queued';
    it.error = undefined;
    touchTry(it);
    broadcast(true);
    pumpQueue();
    return;
  }
  // Drop any stale runner left behind by a previous run (e.g. pause raced a
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
/** Best-effort unlink that survives Windows file locks (open handle still closing). */
async function unlinkWithRetries(target: string, attempts = 6): Promise<void> {
  const p = String(target || '');
  if (!p) return;
  for (let i = 0; i < attempts; i++) {
    try {
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) return;
      } catch {
        // ENOENT = already gone.
        return;
      }
      fs.unlinkSync(p);
      return;
    } catch (e: any) {
      const code = String((e as any)?.code || '');
      if (code === 'ENOENT' || /ENOENT/i.test(String(e?.message || ''))) return;
      if (i === attempts - 1) return;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
}

// Remove yt-dlp side-products next to the final file (split-stream fragments, subs).
async function cleanupYtDlpTemps(savePath: string, opts?: { audioOnly?: boolean; includeAltSourceExt?: boolean }): Promise<void> {
  try {
    const dir = path.dirname(savePath);
    const rawBase = path.basename(savePath);
    if (!rawBase) return;
    const bases = new Set<string>([rawBase]);
    // startYtDownload escapes % → # for -o, so on-disk names of legacy rows
    // may use '#' where savePath still has '%'.
    const escBase = rawBase.replace(/%/g, '#');
    if (escBase !== rawBase) bases.add(escBase);
    // Known single-file sidecars of the final file itself.
    for (const base of bases) {
      const full = path.join(dir, base);
      for (const suffix of ['.part', '.ytdl', '.temp', '.tmp']) {
        try { await unlinkWithRetries(full + suffix, 6); } catch {}
      }
    }
    const stems = new Set<string>();
    for (const base of bases) {
      const dot = base.lastIndexOf('.');
      stems.add(dot > 0 ? base.slice(0, dot) : base);
    }
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { return; }
    const subExt = /\.(vtt|srt|ass|ssa|lrc|ttml|sbv)(\.part)?$/i;
    const metaExt = /\.(info\.json|description|annotations|live_chat\.json)(\.part)?$/i;
    const audioSrcExt = /^(m4a|webm|weba|opus|ogg|oga|mp3|mp4|mkv|mov|avi|flv|wav|flac|aac|m4b|ac3|dts)$/i;
    const owned = new Set<string>();
    try {
      for (const it of items) {
        if (it?.savePath) owned.add(path.resolve(it.savePath));
      }
    } catch {}
    for (const name of entries) {
      if (bases.has(name)) continue;
      let rest: string | null = null;
      for (const stem of stems) {
        if (stem && name.startsWith(stem + '.')) { rest = name.slice(stem.length + 1); break; }
      }
      if (rest == null) continue;
      const full = path.join(dir, name);
      // `.part`, `.part.`, `.part-FragNNN` (native HLS/DASH fragments).
      const isPart = /\.part($|\.|-Frag)/i.test(name);
      // In-flight HLS/DASH chunk `<tmp>-FragNNN`. This app passes `--no-part`,
      const isFragChunk = /-Frag\d+(\.part)?$/i.test(name);
      const isYtdl = /\.ytdl$/i.test(name);
      const isTempInfix = /\.temp\./i.test(name) || /\.tmp$/i.test(name);
      // Split-stream temps `<stem>.f<format_id>.<ext>`. Format ids are numeric
      const isFragId = (seg: string): boolean => /^f(?:\d|hls|dash|http|m3u8|mpd|ism|rtmp|sb)[\w-]*$/i.test(seg);
      const isFragment = isFragId(rest.split('.')[0]) || /\.f(?:\d|hls|dash|http|m3u8|mpd|ism|rtmp|sb)[\w-]*\./i.test(name);
      const isSub = subExt.test(name) || metaExt.test(name);
      let isAltAudio = false;
      if (opts?.includeAltSourceExt && opts?.audioOnly && !rest.includes('.') && audioSrcExt.test(rest)) {
        try { isAltAudio = !owned.has(path.resolve(full)); } catch { isAltAudio = true; }
      }
      if (isPart || isYtdl || isTempInfix || isFragment || isFragChunk || isSub || isAltAudio) {
        try { await unlinkWithRetries(full, 6); } catch {}
      }
    }
  } catch {}
}

// Delayed second sweep for yt-dlp leftovers that were still locked (or still
function scheduleYtDlpResweep(savePath: string, opts?: { audioOnly?: boolean; includeAltSourceExt?: boolean }): void {
  const target = String(savePath || '');
  if (!target) return;
  setTimeout(() => {
    try {
      // Same-path re-add, or a same-stem sibling (e.g. `video.m4a` next to a
      const dir = path.dirname(target);
      const base = path.basename(target);
      const dot = base.lastIndexOf('.');
      const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
      const live = items.some((it) => {
        if (!it?.savePath) return false;
        if (it.savePath === target &&
          (it.status === 'queued' || it.status === 'downloading' || it.status === 'merging')) return true;
        if ((it.status === 'downloading' || it.status === 'merging') && path.dirname(it.savePath) === dir) {
          const b = path.basename(it.savePath);
          const d = b.lastIndexOf('.');
          if ((d > 0 ? b.slice(0, d) : b).toLowerCase() === stem) return true;
        }
        return false;
      });
      if (live) return;
      cleanupYtDlpTemps(target, opts).catch(() => {});
    } catch {}
  }, 2500);
}
ipcMain.handle('dl:remove', async (_e, id: string, deleteFile?: boolean) => {
  killYtJob(id);
  clearRetryTimer(id);
  const r = runners.get(id);
  if (r) {
    try { r.pause(); } catch {}
  }
  runners.delete(id);
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    const [rm] = items.splice(idx, 1);
    // Unfinished downloads only leave a partial file + resume sidecar behind —
    const isCompleted = rm.status === 'completed';
    const shouldDeleteMain = !!deleteFile || !isCompleted;
    if (rm.savePath) {
      if (shouldDeleteMain) {
        await unlinkWithRetries(rm.savePath);
        if (rm.via === 'ytdlp') {
          // Pre-conversion intermediates (<stem>.webm/m4a/...) only exist for
          // unfinished audio downloads — completed ones keep their siblings.
          const sweepOpts = { audioOnly: !!(rm as any).audioOnly, includeAltSourceExt: !isCompleted };
          try { await cleanupYtDlpTemps(rm.savePath, sweepOpts); } catch {}
          // Second pass: the killed process may still have held a handle.
          scheduleYtDlpResweep(rm.savePath, sweepOpts);
        }
      }
      // Resume sidecar is never user data — always drop it so a removed
      // download can never be half-resurrected and never wastes space.
      try { await unlinkWithRetries(rm.savePath + '.jetro.json', 3); } catch {}
    }
    // Per-download cookie session is never shared — drop it with the item.
    try {
      const cf = String((rm as any)?.cookiesFile || '');
      if (cf && cf.includes('jetro-cookies-')) await unlinkWithRetries(cf, 2);
    } catch {}
  }
  broadcast(true);
});
ipcMain.handle('dl:list', () => items);
// Live per-connection progress + server info for the analytics view.
const hostIpCache = new Map<string, string | null>();
async function resolveHostIp(host: string): Promise<string | null> {
  if (!host) return null;
  if (hostIpCache.has(host)) return hostIpCache.get(host)!;
  try {
    const r = await dns.promises.lookup(host);
    hostIpCache.set(host, r.address || null);
    return r.address || null;
  } catch {
    hostIpCache.set(host, null);
    return null;
  }
}
// Server geolocation, resolved exactly once per IP via a free no-key API and
const hostGeoCache = new Map<string, { label: string; countryCode: string | null } | null>();
async function resolveHostGeo(ip: string | null): Promise<{ label: string; countryCode: string | null } | null> {
  if (!ip) return null;
  if (hostGeoCache.has(ip)) return hostGeoCache.get(ip)!;
  let geo: { label: string; countryCode: string | null } | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctrl.signal });
      const j: any = await res.json();
      if (j && j.success !== false && (j.city || j.country)) {
        const code = typeof j.country_code === 'string' && /^[a-z]{2}$/i.test(j.country_code)
          ? j.country_code.toUpperCase()
          : null;
        geo = {
          label: [j.country, j.city].filter(Boolean).join(', ') || 'Unknown location',
          countryCode: code,
        };
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    geo = null;
  }
  hostGeoCache.set(ip, geo);
  return geo;
}
ipcMain.handle('dl:segments', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  let host = '';
  try { host = new URL(it.url).hostname; } catch {}
  let segments: { index: number; start: number; end: number; downloaded: number }[] | null = null;
  let live = false;
  const r = runners.get(id);
  if (r) {
    live = true;
    if (r.segments.length) {
      segments = r.segments.map((s) => ({ index: s.index, start: s.start, end: s.end, downloaded: s.downloaded }));
    } else {
      // Single-stream transfer: synthesize one segment from the item counters.
      const total = it.totalBytes || it.downloadedBytes || 0;
      segments = [{ index: 0, start: 0, end: Math.max(0, total - 1), downloaded: it.downloadedBytes || 0 }];
    }
  } else {
    try {
      const raw = fs.readFileSync(it.savePath + '.jetro.json', 'utf8');
      const s = JSON.parse(raw);
      if (s && s.url === it.url && Array.isArray(s.segments) && s.segments.length) {
        segments = s.segments.map((sg: any) => ({
          index: Number(sg.index) || 0,
          start: Number(sg.start) || 0,
          end: Number(sg.end) || 0,
          downloaded: Number(sg.downloaded) || 0,
        }));
      }
    } catch {}
  }
  const ip = host ? await resolveHostIp(host) : null;
  return { host, ip, geo: await resolveHostGeo(ip), segments, live };
});
ipcMain.handle('dl:move', async (_e, id: string, queueId?: string | null) => {
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  if (it.status === 'downloading' || it.status === 'merging') return it; // don't move active downloads
  const prevQueue = it.queueId || null;
  const valid = queueId && queues.some((q) => q.id === queueId) ? String(queueId) : null;
  it.queueId = valid;
  if (valid && valid !== prevQueue) {
    try { (it as any).queueOrder = nextQueueOrder(valid); } catch {}
  } else if (!valid) {
    try { (it as any).queueOrder = Number((it as any)?.createdAt) || Date.now(); } catch {}
  }
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
  if (/%/.test(name))
    throw new Error('File name can\'t contain % (it breaks video output paths).');
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
  // yt-dlp fragments/subs belong to the old stem and can't resume under the
  // new name — drop them so they don't linger as orphans.
  if ((it as any)?.via === 'ytdlp') {
    try { await cleanupYtDlpTemps(oldPath, { audioOnly: !!(it as any).audioOnly, includeAltSourceExt: true }); } catch {}
  }
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
    await unlinkWithRetries(it.savePath);
    const sweepOpts = { audioOnly: !!(it as any).audioOnly, includeAltSourceExt: true };
    try { await cleanupYtDlpTemps(it.savePath, sweepOpts); } catch {}
    // The entry stays (re-queued): the resweep self-skips while it is live so
    scheduleYtDlpResweep(it.savePath, sweepOpts);
    it.downloadedBytes = 0;
    it.status = 'queued';
    it.error = undefined;
    it.speedBps = 0;
    touchTry(it);
    broadcast(true);
    // Go through the queue pump so limits / stopped queues / schedules apply.
    pumpQueue();
    return it;
  }
  const r = runners.get(id);
  if (r) {
    try { r.pause(); } catch {}
  }
  runners.delete(id);
  await unlinkWithRetries(it.savePath);
  await unlinkWithRetries(it.savePath + '.jetro.json', 3);
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
      // Source shrank below our progress — drop stale partial + resume state.
      it.downloadedBytes = 0;
      await unlinkWithRetries(it.savePath, 3);
      await unlinkWithRetries(it.savePath + '.jetro.json', 3);
    }
    it.totalBytes = p.totalBytes;
  }
  it.supportsRange = !!p.supportsRange;
  broadcast(true);
  return it;
});

// Queues
ipcMain.handle('queue:list', () => queues);
ipcMain.handle('queue:create', async (_e, name?: string) => {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new Error('Queue name cannot be empty');
  const d = defaultQueueFields();
  const q: Queue = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: clean,
    running: false,
    schedulerEnabled: false,
    scheduleStart: '22:00',
    scheduleStop: '07:00',
    createdAt: Date.now(),
    afterComplete: 'nothing',
    powerFiredAt: null,
    finishFiredAt: null,
    ...d,
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
  if ((patch as any).maxConcurrent !== undefined) {
    q.maxConcurrent = normalizeQueueMaxConcurrent((patch as any).maxConcurrent, q.maxConcurrent || 1);
  }
  if (patch.schedulerEnabled !== undefined) q.schedulerEnabled = !!patch.schedulerEnabled;
  if ((patch as any).startOnStartup !== undefined) q.startOnStartup = !!(patch as any).startOnStartup;
  if ((patch as any).startAtEnabled !== undefined) q.startAtEnabled = !!(patch as any).startAtEnabled;
  if ((patch as any).stopAtEnabled !== undefined) q.stopAtEnabled = !!(patch as any).stopAtEnabled;
  if ((patch as any).scheduleMode !== undefined) q.scheduleMode = normalizeScheduleMode((patch as any).scheduleMode);
  if ((patch as any).onceDate !== undefined) {
    const v = normalizeOnceDate((patch as any).onceDate);
    if (!v) throw new Error('Once date must be YYYY-MM-DD.');
    q.onceDate = v;
  }
  if ((patch as any).weekdays !== undefined) {
    const w = normalizeWeekdays((patch as any).weekdays);
    q.weekdays = w;
  }
  if ((patch as any).retriesPerFile !== undefined) {
    const raw = (patch as any).retriesPerFile;
    q.retriesPerFile = raw === null || raw === '' ? null : normalizeRetriesPerFile(raw);
    if (raw !== null && raw !== '' && q.retriesPerFile === null) throw new Error('Retries must be 0-10.');
  }
  if ((patch as any).openWhenDone !== undefined) {
    q.openWhenDone = String((patch as any).openWhenDone || '').slice(0, 1024);
  }
  if ((patch as any).exitAppWhenDone !== undefined) q.exitAppWhenDone = !!(patch as any).exitAppWhenDone;
  if ((patch as any).forceTerminate !== undefined) q.forceTerminate = !!(patch as any).forceTerminate;
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
  if ((patch as any).openWhenDone !== undefined || (patch as any).exitAppWhenDone !== undefined) {
    (q as any).finishFiredAt = null;
  }
  // Keep the legacy toggle in sync when the fine-grained toggles change.
  try {
    q.schedulerEnabled = !!((q as any).startAtEnabled || (q as any).stopAtEnabled);
  } catch {}
  // Same-day catch-up when the schedule itself was just armed/changed: a
  try {
    const touched = ['startAtEnabled', 'stopAtEnabled', 'scheduleMode', 'onceDate', 'weekdays', 'scheduleStart', 'scheduleStop', 'schedulerEnabled']
      .some((k) => (patch as any)[k] !== undefined);
    if (touched) {
      const startOn = (q as any)?.startAtEnabled !== undefined ? !!(q as any).startAtEnabled : !!q.schedulerEnabled;
      const stopOn = (q as any)?.stopAtEnabled !== undefined ? !!(q as any).stopAtEnabled : !!q.schedulerEnabled;
      if (startOn || stopOn) {
        let inWin = true;
        try { inWin = inQueueWindow(q); } catch {}
        // Keep the edge memory in sync so the 1s tick doesn't refire this edge.
        try { schedPrevWin.set(q.id, inWin); } catch {}
        if (inWin && startOn && !q.running && queueHasWork(q.id)) {
          startQueueById(q.id);
        } else if (!inWin && stopOn && q.running) {
          stopQueueById(q.id);
        }
      } else {
        try { schedPrevWin.delete(q.id); } catch {}
      }
    }
  } catch {}
  broadcast(true);
  pumpQueue();
  return q;
});
ipcMain.handle('queue:reorder', async (_e, queueId?: string, orderedIds?: string[]) => {
  const qid = String(queueId || '');
  if (!qid || !queues.some((q) => q.id === qid)) throw new Error('Queue not found');
  const list = Array.isArray(orderedIds) ? orderedIds.map((x) => String(x)) : [];
  if (!list.length) return false;
  const inQueue = new Set(items.filter((i) => (i.queueId || null) === qid).map((i) => i.id));
  // Stamp queueOrder by position; ignore unknown ids so a stale client can't wipe order.
  const base = Date.now();
  let pos = 0;
  for (const id of list) {
    if (!inQueue.has(id)) continue;
    const it = items.find((i) => i.id === id);
    if (it) (it as any).queueOrder = base + pos++;
  }
  // Any queue file missing from the list goes last (stable).
  for (const it of items.filter((i) => (i.queueId || null) === qid)) {
    if (!list.includes(it.id)) (it as any).queueOrder = base + pos++;
  }
  broadcast(true);
  pumpQueue();
  return true;
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
function queueHasWork(id: string): boolean {
  try {
    return items.some((i) => (i.queueId || null) === id && i.status !== 'completed');
  } catch {
    return false;
  }
}
function startQueueById(id: string): Queue {
  const q = queues.find((x) => x.id === id);
  if (!q) throw new Error('Queue not found');
  // Empty / all-completed queues have nothing to start — keep them stopped.
  if (!queueHasWork(id)) return q;
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
  // Restarting re-arms the power + finish actions.
  q.powerFiredAt = null;
  (q as any).finishFiredAt = null;
  broadcast(true);
  pumpQueue();
  return q;
}
function stopQueueById(id: string): Queue {
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
}
ipcMain.handle('queue:start', async (_e, id: string) => {
  return startQueueById(id);
});
ipcMain.handle('queue:stop', async (_e, id: string) => {
  return stopQueueById(id);
});
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('app:is-portable', () => isPortableApp());
ipcMain.handle('settings:save', async (_e, s: any) => {
  settings = { ...settings, ...s, ...normalizeNetworkSettings({ ...settings, ...s }) };
  try { normalizeRetrySettings(settings); } catch {}
  // drop removed VPN option (old clients / old settings files may still send it)
  delete (settings as any).vpnKillSwitch;
  // the browser-extension integration was removed: drop any stale keys
  delete (settings as any).extensionEnabled;
  delete (settings as any).extensionPort;
  delete (settings as any).extensionToken;
  delete (settings as any).lastExtensionSeenAt;
  delete (settings as any).hideExtensionNudge;
  // Run-at-startup only applies to the installed build: ignore it from
  // portable clients so the flag can never stick there.
  (settings as any).launchAtStartup = (settings as any)?.launchAtStartup === true;
  if (isPortableApp()) (settings as any).launchAtStartup = false;
  try { applyLaunchAtStartup(); } catch {}
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
  // Per-category folders ("Remember path for X category").
  try { (settings as any).categoryDirs = normalizeCategoryDirs((settings as any).categoryDirs); } catch {}
  applyNativeTheme();
  refreshTrayMenu();
  // Live-apply the speed limit: running segmented downloads keep the snapshot
  try {
    const limitBps = Math.max(0, Math.round(Number((settings as any).speedLimitKBps || 0))) * 1024;
    runners.forEach((dl) => {
      try { dl.setSpeedLimitBps(limitBps); } catch {}
    });
  } catch {}
  broadcast(true);
  pumpQueue();
  await refreshNetworkRouting();
  return settings;
});
// Full reset: stop everything, wipe downloads / queues / settings back to
ipcMain.handle('app:reset-all', async () => {
  try {
    for (const id of [...ytJobs.keys()]) {
      try { killYtJob(id); } catch {}
    }
  } catch {}
  try {
    for (const t of [...retryTimers.values()]) {
      try { clearTimeout(t); } catch {}
    }
    retryTimers.clear();
  } catch {}
  try {
    for (const dl of [...runners.values()]) {
      try { dl.pause(); } catch {}
    }
    runners.clear();
  } catch {}
  // Drop resume sidecars so reset entries can never be half-resurrected.
  for (const it of items) {
    try {
      if (it?.savePath) fs.unlinkSync(it.savePath + '.jetro.json');
    } catch {}
    try {
      if ((it as any)?.via === 'ytdlp' && it?.savePath) {
        await cleanupYtDlpTemps(it.savePath, { audioOnly: !!(it as any).audioOnly, includeAltSourceExt: it.status !== 'completed' });
      }
    } catch {}
    try {
      const cf = String((it as any)?.cookiesFile || '');
      if (cf && cf.includes('jetro-cookies-')) await unlinkWithRetries(cf, 2);
    } catch {}
  }
  try {
    for (const n of fs.readdirSync(storeDir)) {
      if (/^jetro-cookies-.*\.txt$/i.test(n)) {
        try { await unlinkWithRetries(path.join(storeDir, n), 2); } catch {}
      }
    }
  } catch {}
  items = [];
  queues = [];
  try {
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  } catch {}
  try {
    fs.unlinkSync(path.join(storeDir, 'jetro-cookies.txt'));
  } catch {}
  try {
    fs.mkdirSync(settings.downloadDir, { recursive: true });
  } catch {}
  try { applyNativeTheme(); } catch {}
  try { applyLaunchAtStartup(); } catch {}
  try { saveAllSync(); } catch {}
  broadcast(true);
  return { ok: true };
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

function getAppVersion(): string {
  const FALLBACK = '1.3.0';
  try {
    const electronVer = String((process.versions as any)?.electron || '').trim();
    // package.json is authoritative — app.getVersion() returns the Electron
    const candidates: string[] = [];
    try { candidates.push(path.join(app.getAppPath(), 'package.json')); } catch {}
    candidates.push(path.join(__dirname, '..', 'package.json'));
    candidates.push(path.join(__dirname, 'package.json'));
    candidates.push(path.join(process.cwd(), 'package.json'));
    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p)) {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          const v = String(j?.version || '').trim();
          if (v && v !== electronVer) return v;
        }
      } catch {}
    }
    const viaApp = String(app.getVersion?.() || '').trim();
    if (viaApp && viaApp !== electronVer) return viaApp;
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

ipcMain.handle('app:get-version', async () => getAppVersion());

ipcMain.handle('app:check-update', async () => {
  const current = getAppVersion();
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
  runPowerAction(action, !!(q as any).forceTerminate);
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
const COOKIE_BROWSERS = new Set(['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'vivaldi']);

const LOGIN_NEEDED_HINT = 'This video needs login — log in on the site in your browser, export the site\u2019s cookies (cookies.txt), then paste them below or pick the file and Detect again.';
const COOKIE_IMPORT_HINT = 'Those cookies couldn\u2019t be used — re-export a fresh cookies.txt while logged in and try again.';
// Cookies were sent to yt-dlp but YouTube still answered LOGIN_REQUIRED /
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

/** Per-download cookie file so two videos never share (and clobber) one session. */
function pastedCookiesPathFor(id: string): string {
  const safe = String(id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'item';
  try {
    return path.join(storeDir, `jetro-cookies-${safe}.txt`);
  } catch {
    return path.join(os.tmpdir(), `jetro-cookies-${safe}.txt`);
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

// True when a cookies.txt export actually contains a YouTube login session
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

// Explicit JS runtime flags for yt-dlp. Two pitfalls avoided
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

// YouTube player-client fallback. `web_safari` + `web_embedded` avoid the
function ytDlpYoutubeClientArgs(pageUrl: string, _usedCookies?: boolean): string[] {
  if (!/youtube\.com|youtu\.be/i.test(String(pageUrl || ''))) return [];
  void _usedCookies;
  return ['--extractor-args', 'youtube:player_client=web_safari,web_embedded,-tv_downgraded'];
}

/** `--proxy` for yt-dlp so it routes exactly like the rest of the app. */
async function ytDlpProxyArgs(pageUrl: string): Promise<string[]> {
  try {
    const eff = await resolveEffectiveProxyUrl(pageUrl, networkCfg());
    if (eff?.proxyUrl && !shouldBypassProxyHost(pageUrl)) return ['--proxy', eff.proxyUrl];
  } catch {}
  return [];
}

/** `--referer` for yt-dlp so hotlink-protected sites resolve (origin of the page URL). */
function ytDlpRefererArgs(pageUrl: string): string[] {
  try {
    const u = new URL(String(pageUrl || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
    const origin = u.origin;
    if (!origin || origin === 'null') return [];
    return ['--referer', origin + '/'];
  } catch {
    return [];
  }
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
  let url = String(pageUrl || '').trim();
  if (!url) return { formats: [] as any[], hint: 'empty url' };
  // Accept bare domains pasted without a scheme (example.com/video/123).
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    url = url.startsWith('//') ? `https:${url}` : `https://${url}`;
  }
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
      const plArgs = ['-J', '--flat-playlist', '--socket-timeout', '10', ...ytDlpJsRuntimeArgs(), ...ck.args, ...proxyArgs, ...ytDlpRefererArgs(url)];
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
  const args = ['-J', '--no-playlist', '--socket-timeout', '10', ...ytDlpJsRuntimeArgs(), ...ytDlpYoutubeClientArgs(url, ck.usedCookies), ...ck.args, ...proxyArgs, ...ytDlpRefererArgs(url)];
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
        // Progressive (single-file) heights — kept only for size estimates.
        const isHlsOrDashFormat = (f: any): boolean => {
          const proto = String(f?.protocol || '').toLowerCase();
          const furl = String(f?.url || '').toLowerCase();
          const fext = String(f?.ext || '').toLowerCase();
          if (proto.includes('m3u8') || proto.includes('m3u8_native') || proto.includes('hls') || proto.includes('dash') || proto.includes('mpd') || proto.includes('mss')) return true;
          if (furl.includes('.m3u8') || furl.includes('.mpd') || furl.includes('.m3u8?') || furl.includes('.mpd?')) return true;
          if (fext === 'm3u8' || fext === 'mpd') return true;
          return false;
        };
        const progHeights = new Set<number>();
        const progUrl = new Map<number, any>();
        for (const f of all) {
          if (!f?.url || f.vcodec === 'none' || f.acodec === 'none') continue;
          if (isHlsOrDashFormat(f)) continue;
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
            // All extractor formats go through yt-dlp (page URL + height
            const p = h > 0 ? progUrl.get(h) : null;
            const ps = p ? sizeOf(p) : { bytes: 0, approx: true };
            // Split stream: final mp4 ~= best video (+ba) + best audio.
            const v = h > 0 ? bestVideoAtOrBelow(h) : bestVideoAtOrBelow(0) || bestVideoAtOrBelow(4320);
            const vs = v ? sizeOf(v) : { bytes: 0, approx: true };
            const splitBytes = (vs.bytes || 0) + (bestAudioSize.bytes || 0);
            // Prefer the progressive size when the site only offers muxed
            const useProg = (ps.bytes || 0) > 0 && (splitBytes <= 0 || (ps.bytes || 0) <= splitBytes * 1.5);
            const bytes = useProg ? ps.bytes : splitBytes;
            const fps = (p?.fps ? Number(p.fps) : 0) || (v?.fps ? Number(v.fps) : undefined);
            return {
              kind: 'video',
              quality: h > 0 ? `${h}p` : 'best',
              height: h,
              needsMerge: true,
              url: '',
              ext: 'mp4',
              fps,
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
      hint: detail || 'Could not reach the video page — check your internet connection and proxy settings (use System proxy or a proper Custom proxy), then click Detect again.',
      detail: '',
      needsCookies: false,
      proxyHint: true,
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
    hint: detail || 'No video/audio formats found. Check your internet connection and proxy settings (System proxy or a proper Custom proxy) — or the link may need login.',
    detail: '',
    needsCookies: false,
    proxyHint: true,
  };
});

function killYtJob(id: string) {
  const j = ytJobs.get(id);
  if (!j) return;
  ytJobs.delete(id);
  try { clearInterval(j.timer); } catch {}
  try {
    const pid = j.proc.pid;
    if (pid && !j.proc.killed) {
      if (process.platform === 'win32') {
        // Synchronous tree kill: the old async execFile could return before
        try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000, stdio: ['ignore', 'ignore', 'ignore'] }); } catch {}
      }
      try { j.proc.kill('SIGKILL'); } catch {}
      try { if (!j.proc.killed) (j.proc as any).kill('SIGTERM'); } catch {}
    }
  } catch {}
}

// Run bundled yt-dlp to download+merge a page URL at any height (no cap), or best audio.
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
    '--concurrent-fragments', '8',
    ...ytDlpJsRuntimeArgs(),
    '--newline', '--progress', '--progress-delta', '0.1',
    ...ytDlpYoutubeClientArgs(item.url, ck.usedCookies),
    ...ck.args,
    ...proxyArgs,
    ...ytDlpRefererArgs(item.url),
  ];
  // Segmented downloads are throttled by the global token bucket; yt-dlp
  try {
    const limitKBps = Math.max(0, Math.round(Number((settings as any).speedLimitKBps || 0)));
    if (limitKBps > 0) args.push('--limit-rate', `${limitKBps}K`);
  } catch {}
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
    } else if (ext === '.mp4') {
      // MP4 audio container: keep mp4 so the file lands at the requested path.
      args.push('--merge-output-format', 'mp4');
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
    // Honor the requested container instead of forcing mp4 under a .mkv/.webm name.
    const vext = (path.extname(item.savePath) || '').toLowerCase();
    const mergeFmt = vext === '.mkv' ? 'mkv' : vext === '.webm' ? 'webm' : 'mp4';
    args.push('--merge-output-format', mergeFmt, '-o', outTemplate, '--no-part');
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
  let progBase = 0;
  let progCurTotal = 0;
  let progHasOutput = false;
  let lastProgAt = 0;
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
        // Ramp down instead of snapping to zero — the poll timer below keeps
        // decaying toward 0 while ffmpeg merges.
        item.speedBps = smoothSpeedBps(item.speedBps, 0);
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
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(~\s*)?([\d.]+)\s*([KMGT]?i?B)/i.exec(line);
    if (m) {
      progHasOutput = true;
      lastProgAt = Date.now();
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
        if (sp > 0) item.speedBps = smoothSpeedBps(item.speedBps, sp);
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
      // yt-dlp went quiet (stall gap, file switch, merge): decay gradually
      // instead of freezing the last speed or snapping to zero.
      try {
        if (Date.now() - lastProgAt > 400 && (item.speedBps || 0) > 0) {
          const decayed = smoothSpeedBps(item.speedBps, 0);
          if (decayed !== item.speedBps) {
            item.speedBps = decayed;
            broadcast();
            return;
          }
        }
      } catch {}
      broadcast();
      return;
    }
    try {
      const st = fs.statSync(item.savePath);
      const now = Date.now();
      const dt = Math.max(0.05, (now - lastTick) / 1000);
      item.speedBps = smoothSpeedBps(item.speedBps, Math.max(0, st.size - lastBytes) / dt);
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
        // Merge reported success but the expected file is missing (e.g. output
        // landed under a different name) — never report a false completion.
        item.status = 'error';
        item.error = 'Download finished but the output file is missing: ' + item.savePath;
        item.speedBps = 0;
        touchTry(item);
        broadcast(true);
        return;
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

/**
 * Shared video/audio (yt-dlp) add path. Derives a default filename when the
 * caller only has a page URL.
 */
async function addVideoDownload(opts?: any): Promise<Item> {
  let pageUrl = String(opts?.pageUrl || '').trim();
  if (!pageUrl) throw new Error('Missing video URL');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pageUrl)) {
    pageUrl = pageUrl.startsWith('//') ? `https:${pageUrl}` : `https://${pageUrl}`;
  }
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
  const nowYt = Date.now();
  const newId = nowYt.toString(36) + Math.random().toString(36).slice(2, 7);
  if (opts?.replace) {
    await unlinkWithRetries(savePath, 3);
    try { await cleanupYtDlpTemps(savePath, { audioOnly, includeAltSourceExt: true }); } catch {}
  }
  const ck = ytDlpCookieArgs(opts, pageUrl);
  if (ck.error) throw new Error(ck.error);
  // Persist pasted cookies per download so pause/resume/retry of one video
  // never picks up another video's pasted session.
  const pastedText = String(opts?.cookiesText ?? '').trim();
  let storedCookiesFile: string | undefined;
  if (pastedText) {
    const perPath = pastedCookiesPathFor(newId);
    try {
      fs.mkdirSync(path.dirname(perPath), { recursive: true });
      fs.writeFileSync(perPath, pastedText.endsWith('\n') ? pastedText : pastedText + '\n', 'utf8');
      try { fs.chmodSync(perPath, 0o600); } catch {}
      storedCookiesFile = perPath;
    } catch (e: any) {
      throw new Error('Could not save pasted cookies: ' + String(e?.message || e).slice(0, 160));
    }
  } else {
    storedCookiesFile = String(opts?.cookiesFile || '').trim() || undefined;
  }
  // Pre-merge estimate from probe (video+audio sum). Gives the bar a sane
  // starting total instead of 0 -> video-only -> video+audio growth.
  const estBytes = Math.max(0, Math.round(Number(opts?.estimatedBytes || 0)));
  const validQueueId =
    (opts as any)?.queueId && queues.some((q) => q.id === (opts as any).queueId) ? String((opts as any).queueId) : null;
  const item: Item = {
    id: newId,
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
    queueOrder: validQueueId ? nextQueueOrder(validQueueId) : nowYt,
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
  // Go through the queue pump so concurrency limits, stopped queues and
  // schedule windows apply to videos just like segmented downloads.
  broadcast(true);
  pumpQueue();
  return item;
}

ipcMain.handle('video:download', async (_e, opts?: any) => {
  return addVideoDownload(opts);
});

ipcMain.handle('binaries:status', async () => {
  const custom = String((settings as any).ytDlpPath || '').trim();
  const candidate = resolveYtDlp(custom);
  const [ytVersion, ffVersion, qjsVersion] = await Promise.all([
    getYtDlpVersion(candidate).catch(() => null),
    getFfmpegVersion().catch(() => null),
    getQuickjsVersion().catch(() => null),
  ]);
  return {
    available: !!ytVersion,
    path: ytVersion ? candidate : null,
    version: ytVersion,
    ffmpeg: ffVersion,
    ffmpegPath: resolveFfmpeg(),
    quickjs: qjsVersion,
    quickjsPath: resolveQuickjs(),
    userPath: userYtDlpPath(),
    bundled: bundledYtDlpPath(),
  };
});

ipcMain.handle('binaries:update-ytdlp', async () => {
  const bin = ensureWritableYtDlp(String((settings as any).ytDlpPath || ''));
  const r = await updateYtDlp(bin);
  if ((r as any)?.ok) {
    // Updated bundled in place: the legacy AppData copy is stale, drop it.
    try { consolidateYtDlpAfterUpdate(bin); } catch {}
  }
  return r;
});
