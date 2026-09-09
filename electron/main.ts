import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SegmentedDownload, probeUrl, guessFilename, type ProxyOptions } from './downloader';
import {
  applySessionProxy,
  buildCustomProxyUrl,
  defaultNetworkSettings,
  getPublicIp,
  getVpnStatus,
  normalizeNetworkSettings,
  resolveEffectiveProxyUrl,
  type NetworkSettings,
} from './proxy';
import { execFile } from 'child_process';

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
}

const storeDir = path.join(app.getPath('userData'), 'jetro');
const storeFile = path.join(storeDir, 'downloads.json');
const settingsFile = path.join(storeDir, 'settings.json');
const queuesFile = path.join(storeDir, 'queues.json');

let win: BrowserWindow | null = null;
let items: Item[] = [];
let queues: Queue[] = [];
let runners = new Map<string, SegmentedDownload>();
let settings: {
  maxConnections: number;
  maxConcurrentDownloads: number;
  downloadDir: string;
  speedLimitKBps: number;
  autoCaptureClipboard: boolean;
  schedulerEnabled: boolean;
  schedulerStart: string;
  schedulerStop: string;
} & NetworkSettings = {
  maxConnections: 8,
  maxConcurrentDownloads: 3,
  downloadDir: app.getPath('downloads'),
  speedLimitKBps: 0,
  autoCaptureClipboard: true,
  schedulerEnabled: false,
  schedulerStart: '01:00',
  schedulerStop: '07:00',
  ...defaultNetworkSettings(),
};

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
    // backfill queueId for old items
    items = items.map((i: any) => ({ queueId: null, ...i }));
    // backfill proxy/VPN defaults for old settings files
    settings = { ...settings, ...normalizeNetworkSettings(settings) };
  } catch {}
}
function saveAll() {
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(items.slice(0, 500)));
    fs.writeFileSync(settingsFile, JSON.stringify(settings));
    fs.writeFileSync(queuesFile, JSON.stringify(queues.slice(0, 100)));
  } catch {}
}
function broadcast() {
  win?.webContents.send('dl:update', items);
  win?.webContents.send('queue:update', queues);
  saveAll();
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
function activeCount() {
  return items.filter((i) => i.status === 'downloading').length;
}
function activeCountForQueue(queueId: string | null) {
  return items.filter((i) => (i.queueId || null) === (queueId || null) && i.status === 'downloading').length;
}
function inWindow(enabled: boolean, start?: string, stop?: string): boolean {
  if (!enabled) return true;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (start || '00:00').split(':').map(Number);
  const [eh, em] = (stop || '23:59').split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
}
function inScheduleWindow(): boolean {
  return inWindow(settings.schedulerEnabled, settings.schedulerStart, settings.schedulerStop);
}
function inQueueWindow(q: Queue): boolean {
  return inWindow(q.schedulerEnabled, q.scheduleStart, q.scheduleStop);
}

async function pumpQueue() {
  // Global (no-queue) downloads
  if (inScheduleWindow()) {
    const queued = items.filter((i) => i.status === 'queued' && !(i.queueId || null));
    while (activeCount() < settings.maxConcurrentDownloads && queued.length) {
      const next = queued.shift()!;
      startDownload(next).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  // Per-queue downloads: only when queue is running + in its schedule window
  for (const q of queues) {
    if (!q.running) continue;
    if (!inQueueWindow(q)) continue;
    const queued = items.filter((i) => i.status === 'queued' && (i.queueId || null) === q.id);
    while (
      queued.length &&
      activeCount() < settings.maxConcurrentDownloads &&
      activeCountForQueue(q.id) < Math.max(1, q.maxConcurrent || 1)
    ) {
      const next = queued.shift()!;
      startDownload(next).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function startDownload(item: Item) {
  if (runners.has(item.id)) return;
  item.status = 'downloading';
  item.error = undefined;
  broadcast();
  const dl = new SegmentedDownload(
    item.url,
    item.savePath,
    item.connections || settings.maxConnections,
    (settings.speedLimitKBps || 0) * 1024,
    currentProxyOpts()
  );
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
      item.downloadedBytes = fs.statSync(item.savePath).size;
      if (!item.totalBytes) item.totalBytes = item.downloadedBytes;
    } catch {}
    item.status = 'completed';
    item.speedBps = 0;
  } catch (e: any) {
    // Only this run may set the outcome: if the user already paused, re-queued,
    // or errored the item (or a newer run took over), leave their state alone.
    if (item.status === 'downloading') {
      if (String(e?.message || e).includes('aborted')) {
        item.status = 'paused';
      } else {
        item.status = 'error';
        item.error = String(e?.message || e);
      }
    }
    item.speedBps = 0;
  } finally {
    runners.delete(item.id);
    broadcast();
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
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: 'Jetro',
    autoHideMenuBar: true,
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
}

function enforceVpnKillSwitch() {
  try {
    if (!networkCfg().vpnKillSwitch) return;
    const vpn = getVpnStatus();
    if (vpn.vpnDetected) return;
    const active = items.filter((i) => i.status === 'downloading');
    if (!active.length) return;
    for (const it of active) {
      const r = runners.get(it.id);
      if (r) {
        it.status = 'paused';
        it.error = 'Paused by VPN kill-switch (no VPN tunnel detected)';
        r.pause();
      } else {
        it.status = 'paused';
        it.speedBps = 0;
      }
      runners.delete(it.id);
    }
    broadcast();
  } catch {}
}

app.whenReady().then(() => {
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
  refreshNetworkRouting().catch(() => {});

  // clipboard auto-capture
  setInterval(async () => {
    try {
      if (!settings.autoCaptureClipboard || !win?.isFocused()) return;
      const t = clipboard.readText().trim();
      if (/^https?:\/\/\S+\.\S+/.test(t) && !items.some((i) => i.url === t) && !(global as any).__lastClip?.includes(t)) {
        (global as any).__lastClip = t;
        win?.webContents.send('dl:update', items);
        // let renderer prompt — send via separate event
        win?.webContents.send('dl:clipboard-url', t);
      }
    } catch {}
  }, 1500);

  setInterval(pumpQueue, 1000);
  setInterval(broadcast, 800);
  setInterval(enforceVpnKillSwitch, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('dl:probe', async (_e, url: string) => {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http(s)://');
  return probeUrl(url, currentProxyOpts());
});

ipcMain.handle('dl:add', async (_e, url: string, opts?: any) => {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http(s)://');
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
  const rawDir = opts?.dir ? String(opts.dir).trim() : '';
  const rawSave = opts?.savePath ? String(opts.savePath).trim() : '';
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
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  const validQueueId =
    opts?.queueId && queues.some((q) => q.id === opts.queueId) ? String(opts.queueId) : null;
  const item: Item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    url,
    filename,
    savePath,
    totalBytes: total,
    downloadedBytes: 0,
    status: 'queued',
    speedBps: 0,
    connections: Math.min(32, Math.max(1, opts?.connections || settings.maxConnections)),
    supportsRange,
    createdAt: Date.now(),
    category: categoryOf(filename),
    queueId: validQueueId,
  };
  items.unshift(item);
  broadcast();
  pumpQueue();
  return item;
});

ipcMain.handle('dl:pause', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  const r = runners.get(id);
  if (r) {
    if (it) it.status = 'paused';
    r.pause();
  } else if (it) {
    it.status = 'paused';
    it.speedBps = 0;
  }
  broadcast();
});
ipcMain.handle('dl:resume', async (_e, id: string) => {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  if (it.status === 'completed') return;
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
  broadcast();
  pumpQueue();
});
ipcMain.handle('dl:remove', async (_e, id: string, deleteFile?: boolean) => {
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
  broadcast();
});
ipcMain.handle('dl:list', () => items);
ipcMain.handle('dl:move', async (_e, id: string, queueId?: string | null) => {
  const it = items.find((i) => i.id === id);
  if (!it) return null;
  if (it.status === 'downloading') return it; // don't move active downloads
  const valid = queueId && queues.some((q) => q.id === queueId) ? String(queueId) : null;
  it.queueId = valid;
  // Moving to a stopped queue parks it as paused so it won't auto-run elsewhere.
  if (valid) {
    const q = queues.find((x) => x.id === valid);
    if (q && !q.running && it.status === 'queued') it.status = 'paused';
  }
  broadcast();
  pumpQueue();
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
  };
  queues.push(q);
  broadcast();
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
  if (patch.maxConcurrent !== undefined)
    q.maxConcurrent = Math.min(10, Math.max(1, Number(patch.maxConcurrent) || 1));
  if (patch.schedulerEnabled !== undefined) q.schedulerEnabled = !!patch.schedulerEnabled;
  if (patch.scheduleStart !== undefined) q.scheduleStart = String(patch.scheduleStart);
  if (patch.scheduleStop !== undefined) q.scheduleStop = String(patch.scheduleStop);
  broadcast();
  pumpQueue();
  return q;
});
ipcMain.handle('queue:delete', async (_e, id: string) => {
  const idx = queues.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  // Stop its active downloads first
  for (const it of items.filter((i) => (i.queueId || null) === id && i.status === 'downloading')) {
    const r = runners.get(it.id);
    if (r) {
      it.status = 'paused';
      r.pause();
    }
    runners.delete(it.id);
  }
  // Unassign its files back to No queue (kept, paused)
  for (const it of items.filter((i) => (i.queueId || null) === id)) {
    it.queueId = null;
    if (it.status === 'queued') it.status = 'paused';
    it.speedBps = 0;
  }
  queues.splice(idx, 1);
  broadcast();
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
    }
  }
  broadcast();
  pumpQueue();
  return q;
});
ipcMain.handle('queue:stop', async (_e, id: string) => {
  const q = queues.find((x) => x.id === id);
  if (!q) throw new Error('Queue not found');
  q.running = false;
  for (const it of items.filter((i) => (i.queueId || null) === id && i.status === 'downloading')) {
    const r = runners.get(it.id);
    if (r) {
      it.status = 'paused';
      r.pause();
    }
    runners.delete(it.id);
    it.speedBps = 0;
  }
  for (const it of items.filter((i) => (i.queueId || null) === id && i.status === 'queued')) {
    it.status = 'paused';
  }
  broadcast();
  return q;
});
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:save', async (_e, s: any) => {
  settings = { ...settings, ...s, ...normalizeNetworkSettings({ ...settings, ...s }) };
  broadcast();
  pumpQueue();
  await refreshNetworkRouting();
  return settings;
});

// Which proxy (if any) applies to a URL with the current settings.
ipcMain.handle('proxy:resolve', async (_e, targetUrl: string) => {
  const url = String(targetUrl || '').trim();
  if (!url) return { proxyUrl: null, source: 'none' };
  return resolveEffectiveProxyUrl(url, networkCfg());
});

// Real end-to-end check: probe a URL through the given (or current) proxy config.
ipcMain.handle('proxy:test', async (_e, testUrl?: string, override?: any) => {
  const url = String(testUrl || 'https://example.com/').trim() || 'https://example.com/';
  const cfg = normalizeNetworkSettings(override && typeof override === 'object' ? { ...networkCfg(), ...override } : networkCfg());
  const started = Date.now();
  const eff = await resolveEffectiveProxyUrl(url, cfg);
  try {
    const probeOpts: ProxyOptions = {
      proxyBypass: cfg.proxyBypass,
      proxyUrl: eff.proxyUrl,
      getProxyUrl: async () => eff.proxyUrl,
    };
    const p = await probeUrl(url, probeOpts);
    return {
      ok: true,
      status: 200,
      ms: Date.now() - started,
      proxyUrl: eff.proxyUrl,
      source: eff.source,
      raw: eff.raw || null,
      totalBytes: p.totalBytes,
      supportsRange: p.supportsRange,
    };
  } catch (err: any) {
    return {
      ok: false,
      ms: Date.now() - started,
      proxyUrl: eff.proxyUrl,
      source: eff.source,
      raw: eff.raw || null,
      error: String(err?.message || err),
    };
  }
});

ipcMain.handle('net:public-ip', async () => {
  const cfg = networkCfg();
  const eff = await resolveEffectiveProxyUrl('https://api.ipify.org/', cfg);
  const ip = await getPublicIp(eff.proxyUrl);
  return { ip, via: eff.proxyUrl, source: eff.source };
});

ipcMain.handle('vpn:status', async () => {
  const vpn = getVpnStatus();
  let publicIp: string | null = null;
  let ipError: string | null = null;
  try {
    const cfg = networkCfg();
    const eff = await resolveEffectiveProxyUrl('https://api.ipify.org/', cfg);
    publicIp = await getPublicIp(eff.proxyUrl);
  } catch (e: any) {
    ipError = String(e?.message || e);
  }
  return { ...vpn, publicIp, ipError, killSwitch: networkCfg().vpnKillSwitch };
});
ipcMain.handle('dialog:folder', async (_e, defaultPath?: string) => {
  const opts: any = { properties: ['openDirectory'] };
  const dp = String(defaultPath || settings.downloadDir || '').trim();
  if (dp) opts.defaultPath = dp;
  const r = await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:save', async (_e, suggestedName?: string) => {
  const fallback = suggestedName || 'download.bin';
  const r = await dialog.showSaveDialog(win!, {
    title: 'Save file as',
    defaultPath: path.join(settings.downloadDir, fallback),
    buttonLabel: 'Save',
  });
  return r.canceled || !r.filePath ? null : r.filePath;
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

// Video grabber: yt-dlp probe if available, else HLS hint
ipcMain.handle('video:probe', async (_e, pageUrl: string) => {
  const url = String(pageUrl || '').trim();
  if (!url) return { formats: [] as any[], hint: 'empty url' };
  // direct media?
  if (/\.(mp4|webm|mkv|mp3|m4a)(\?|$)/i.test(url) || /\.m3u8(\?|$)/i.test(url) || /\.mpd(\?|$)/i.test(url)) {
    return { formats: [{ quality: 'direct', url }], hint: 'direct media url' };
  }
  // try yt-dlp
  const tryYt = await new Promise<any[]>((resolve) => {
    execFile('yt-dlp', ['-J', '--flat-playlist', url], { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const j = JSON.parse(String(stdout));
        const fmts = (j.formats || []).slice(-8).map((f: any) => ({
          quality: f.format_note || f.resolution || f.ext,
          url: f.url,
          ext: f.ext,
        }));
        resolve(fmts);
      } catch {
        resolve([]);
      }
    });
  });
  if (tryYt.length) return { formats: tryYt, hint: 'via yt-dlp' };
  return {
    formats: [],
    hint: 'Install yt-dlp for auto video detection (https://github.com/yt-dlp/yt-dlp). Direct .mp4/.m3u8 links work without it.',
  };
});
