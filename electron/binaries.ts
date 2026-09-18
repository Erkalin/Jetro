import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

const isWin = process.platform === 'win32';
const YTDLP_BIN = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const FFMPEG_BIN = isWin ? 'ffmpeg.exe' : 'ffmpeg';
const QUICKJS_BIN = isWin ? 'quickjs.exe' : 'quickjs';

export function userBinDir(): string {
  try {
    return path.join(app.getPath('userData'), 'jetro', 'bin');
  } catch {
    return path.join(process.cwd(), 'bin');
  }
}

function isWritableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function bundledBin(name: string): string | null {
  const candidates = [
    (() => { try { return path.join(process.resourcesPath, 'bin', name); } catch { return ''; } })(),
    path.join(app.getAppPath(), 'bin', name),
    path.join(app.getAppPath(), '..', 'bin', name),
    path.join(__dirname, '..', 'bin', name),
    (() => { try { return path.join(path.dirname(app.getPath('exe')), 'bin', name); } catch { return ''; } })(),
    (() => { try { return path.join(path.dirname(app.getPath('exe')), name); } catch { return ''; } })(),
  ];
  for (const p of candidates) {
    if (!p) continue;
    try {
      if (p.includes('.asar') && !p.includes('.asar.unpacked')) continue;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

function userCopyPath(name: string): string | null {
  try {
    const p = path.join(userBinDir(), name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  } catch {}
  return null;
}

/**
 * Copy bundled -> writable user copy (creating it). Used ONLY as a fallback
 * when the bundled copy is read-only or missing (admin Program Files install,
 * portable on read-only media) and yt-dlp needs a writable binary for `-U`.
 */
function ensureUserCopy(name: string): string | null {
  try {
    const existing = userCopyPath(name);
    if (existing) return existing;
    const bundled = bundledBin(name);
    if (!bundled) return null;
    fs.mkdirSync(userBinDir(), { recursive: true });
    const dest = path.join(userBinDir(), name);
    fs.copyFileSync(bundled, dest);
    return dest;
  } catch {
    return bundledBin(name);
  }
}

/**
 * Resolve a vendored static tool (ffmpeg/quickjs) with NO duplication:
 * bundled (resources/bin) first, legacy user copy only as fallback.
 * These never self-update, so a writable copy is never needed — a stale
 * AppData duplicate left by older versions is deleted best-effort.
 */
function resolveTool(name: string, customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  // Static tools never need a writable copy: run straight from resources/bin.
  // Clean up legacy AppData duplicates so existing users reclaim the space.
  const bundled = bundledBin(name);
  if (bundled) {
    try {
      const stale = userCopyPath(name);
      if (stale) {
        try {
          if (path.resolve(stale) !== path.resolve(bundled)) fs.unlinkSync(stale);
        } catch {}
      }
    } catch {}
    return bundled;
  }
  return userCopyPath(name) || name; // legacy fallback / dev without bundle
}

/**
 * Single-file rule for yt-dlp: run from the bundled copy whenever the install
 * location accepts writes (per-user Setup, portable on writable media, dev),
 * so there is exactly ONE yt-dlp.exe on disk and `-U` updates it in place.
 * The AppData copy is only used when the bundled file is read-only (admin
 * Program Files install) or missing — the only cases where two files are
 * physically unavoidable without elevation.
 */
export function resolveYtDlp(customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  const bundled = bundledBin(YTDLP_BIN);
  const user = userCopyPath(YTDLP_BIN);
  if (bundled && user) {
    try {
      if (isWritableFile(bundled)) return bundled;
    } catch {}
    return user; // read-only install: user copy holds the updates
  }
  return bundled || user || YTDLP_BIN; // PATH fallback
}

export function resolveFfmpeg(): string {
  return resolveTool(FFMPEG_BIN);
}

export function resolveQuickjs(): string | null {
  const p = resolveTool(QUICKJS_BIN);
  try {
    // resolveTool always returns something; verify it really exists before claiming bundled.
    if (p === QUICKJS_BIN) {
      // PATH fallback — check it actually resolves by probing version lazily at call site.
      return p;
    }
    if (fs.existsSync(p)) return p;
  } catch {}
  return p;
}

/**
 * Path suitable for `yt-dlp -U` (must be writable). Prefers the bundled copy
 * so updates happen in place with zero duplication; falls back to the AppData
 * copy only when the install location is read-only.
 */
export function ensureWritableYtDlp(customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  const bundled = bundledBin(YTDLP_BIN);
  if (bundled && isWritableFile(bundled)) return bundled; // update in place
  const existing = userCopyPath(YTDLP_BIN);
  if (existing) return existing;
  return ensureUserCopy(YTDLP_BIN) || bundled || YTDLP_BIN;
}

/** After an in-place bundled update, the legacy AppData copy is stale — drop it. */
export function consolidateYtDlpAfterUpdate(updatedPath: string): void {
  try {
    const bundled = bundledBin(YTDLP_BIN);
    if (!bundled) return;
    let same = false;
    try { same = path.resolve(String(updatedPath || '')) === path.resolve(bundled); } catch {}
    if (!same) return;
    try {
      const user = userCopyPath(YTDLP_BIN);
      if (user) {
        try { fs.unlinkSync(user); } catch {}
      }
    } catch {}
  } catch {}
}

/** Numeric-split version compare (handles yt-dlp date versions like 2026.08.19). */
function cmpVersions(a: string, b: string): number {
  const pa = String(a || '').split(/[^0-9]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[^0-9]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * One-time boot consolidation: fold a legacy AppData yt-dlp copy back into a
 * writable bundled copy (keeping whichever version is newer), then delete the
 * duplicate. Fresh installs no-op here (no user copy, no spawns). Safe to call
 * unawaited — worst case the first download of the session uses the bundled
 * copy a moment before consolidation finishes.
 */
export async function reconcileBinaries(): Promise<void> {
  try {
    // Static tools: bundled is authoritative, drop legacy dups proactively.
    for (const name of [FFMPEG_BIN, QUICKJS_BIN]) {
      try {
        if (bundledBin(name) && userCopyPath(name)) {
          try { fs.unlinkSync(path.join(userBinDir(), name)); } catch {}
        }
      } catch {}
    }
    const bundled = bundledBin(YTDLP_BIN);
    const user = userCopyPath(YTDLP_BIN);
    if (!bundled || !user) return;
    try {
      if (path.resolve(bundled) === path.resolve(user)) return;
    } catch {}
    if (!isWritableFile(bundled)) return; // read-only install: user copy must stay
    try {
      const [bv, uv] = await Promise.all([
        getYtDlpVersion(bundled).catch(() => null),
        getYtDlpVersion(user).catch(() => null),
      ]);
      let userNewer = false;
      if (bv && uv) {
        userNewer = cmpVersions(uv, bv) > 0;
      } else {
        // Version probe failed: fall back to mtime (an `-U` rewrite is always
        // newer than the install time).
        try { userNewer = fs.statSync(user).mtimeMs > fs.statSync(bundled).mtimeMs; } catch { userNewer = false; }
      }
      if (userNewer) {
        // Migrate the newer bytes into place; on failure keep both rather
        // than risk losing the newest copy.
        try { fs.copyFileSync(user, bundled); } catch { return; }
      }
      try { fs.unlinkSync(user); } catch {}
    } catch {}
  } catch {}
}

/** Directory holding ffmpeg for yt-dlp --ffmpeg-location (must exist). */
export function ffmpegDir(): string | null {
  const ff = resolveFfmpeg();
  try {
    if (fs.existsSync(ff)) return path.dirname(ff);
  } catch {}
  return null;
}

/** PATH with our bin dirs first so yt-dlp finds ffmpeg + quickjs it spawns. */
export function envWithBinPath(): NodeJS.ProcessEnv {
  const dirs: string[] = [];
  try { dirs.push(userBinDir()); } catch {}
  const bundled = bundledBin(YTDLP_BIN);
  if (bundled) dirs.push(path.dirname(bundled));
  try { dirs.push(path.join(process.cwd(), 'bin')); } catch {}
  const seen = new Set<string>();
  const clean = dirs.filter((d) => d && !seen.has(d.toLowerCase()) && (seen.add(d.toLowerCase()), true));
  const sep = isWin ? ';' : ':';
  return { ...process.env, PATH: [...clean, process.env.PATH || ''].filter(Boolean).join(sep) };
}

export function bundledYtDlpPath(): string | null {
  return bundledBin(YTDLP_BIN);
}

export function userYtDlpPath(): string {
  return path.join(userBinDir(), YTDLP_BIN);
}

function runVersion(bin: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve(null);
      const v = String(stdout || '').trim().split('\n')[0].trim();
      resolve(v || null);
    });
  });
}

export function getYtDlpVersion(binPath: string, timeoutMs = 8000): Promise<string | null> {
  return runVersion(binPath, ['--version'], timeoutMs);
}

export function getFfmpegVersion(timeoutMs = 8000): Promise<string | null> {
  return runVersion(resolveFfmpeg(), ['-version'], timeoutMs).then((v) => (v ? v.split('\n')[0].slice(0, 80) : null));
}

export function getQuickjsVersion(timeoutMs = 5000): Promise<string | null> {
  const qjs = resolveQuickjs();
  if (!qjs) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(qjs, ['--help'], { timeout: timeoutMs, env: envWithBinPath() }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '');
      if (/quickjs/i.test(out)) return resolve(out.split('\n')[0].trim().slice(0, 80) || 'quickjs');
      // qjs --help exits nonzero on some builds; still treat output as present.
      if (out.trim()) return resolve(out.split('\n')[0].trim().slice(0, 80));
      void err;
      resolve(null);
    });
  });
}

export function updateYtDlp(binPath: string, timeoutMs = 120000): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(binPath, ['-U'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout || '') + String(stderr || '');
      if (err) {
        resolve({ ok: false, error: out.trim().slice(0, 500) || String(err.message || err) });
        return;
      }
      const m = /to version\s+([^\s]+)/i.exec(out) || /version\s+([0-9.]+)/i.exec(out);
      resolve({ ok: true, version: m ? m[1] : undefined });
    });
  });
}
