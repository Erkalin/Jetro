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

function resolveTool(name: string, customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  // Static tools run from resources/bin; drop legacy dup.
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

// Prefer writable bundled yt-dlp, else AppData copy.
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
    return user;
  }
  return bundled || user || YTDLP_BIN;
}

export function resolveFfmpeg(): string {
  return resolveTool(FFMPEG_BIN);
}

export function resolveQuickjs(): string | null {
  const p = resolveTool(QUICKJS_BIN);
  try {
    if (p === QUICKJS_BIN) {
      return p;
    }
    if (fs.existsSync(p)) return p;
  } catch {}
  return p;
}

export function ensureWritableYtDlp(customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  const bundled = bundledBin(YTDLP_BIN);
  if (bundled && isWritableFile(bundled)) return bundled;
  const existing = userCopyPath(YTDLP_BIN);
  if (existing) return existing;
  return ensureUserCopy(YTDLP_BIN) || bundled || YTDLP_BIN;
}

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

function cmpVersions(a: string, b: string): number {
  const pa = String(a || '').split(/[^0-9]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[^0-9]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Fold AppData yt-dlp into bundled copy, keep newer.
export async function reconcileBinaries(): Promise<void> {
  try {
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
    if (!isWritableFile(bundled)) return;
    try {
      const [bv, uv] = await Promise.all([
        getYtDlpVersion(bundled).catch(() => null),
        getYtDlpVersion(user).catch(() => null),
      ]);
      let userNewer = false;
      if (bv && uv) {
        userNewer = cmpVersions(uv, bv) > 0;
      } else {
        try { userNewer = fs.statSync(user).mtimeMs > fs.statSync(bundled).mtimeMs; } catch { userNewer = false; }
      }
      if (userNewer) {
        try { fs.copyFileSync(user, bundled); } catch { return; }
      }
      try { fs.unlinkSync(user); } catch {}
    } catch {}
  } catch {}
}

export function ffmpegDir(): string | null {
  const ff = resolveFfmpeg();
  try {
    if (fs.existsSync(ff)) return path.dirname(ff);
  } catch {}
  return null;
}

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
