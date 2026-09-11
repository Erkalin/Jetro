import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

const isWin = process.platform === 'win32';
const YTDLP_BIN = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const FFMPEG_BIN = isWin ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_BIN = isWin ? 'ffprobe.exe' : 'ffprobe';
const QUICKJS_BIN = isWin ? 'quickjs.exe' : 'quickjs';

export function userBinDir(): string {
  try {
    return path.join(app.getPath('userData'), 'jetro', 'bin');
  } catch {
    return path.join(process.cwd(), 'bin');
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

/** Promote bundled -> writable user copy on first run (resources are read-only in portable). */
function promote(name: string): string | null {
  try {
    const userPath = path.join(userBinDir(), name);
    if (fs.existsSync(userPath)) return userPath;
    const bundled = bundledBin(name);
    if (!bundled) return null;
    fs.mkdirSync(userBinDir(), { recursive: true });
    fs.copyFileSync(bundled, userPath);
    return userPath;
  } catch {
    return bundledBin(name);
  }
}

/**
 * Resolve a vendored tool: custom path -> user copy -> bundled -> PATH fallback.
 * Returns a path or bare binary name suitable for execFile/spawn.
 */
export function resolveTool(name: string, customPath?: string): string {
  const custom = String(customPath || '').trim();
  if (custom) {
    try {
      if (fs.existsSync(custom) && fs.statSync(custom).isFile()) return custom;
    } catch {}
  }
  try {
    const userPath = path.join(userBinDir(), name);
    if (fs.existsSync(userPath)) return userPath;
  } catch {}
  const promoted = promote(name);
  if (promoted) return promoted;
  return name; // PATH fallback
}

export function resolveYtDlp(customPath?: string): string {
  return resolveTool(YTDLP_BIN, customPath);
}

export function resolveFfmpeg(): string {
  return resolveTool(FFMPEG_BIN);
}

export function resolveFfprobe(): string {
  return resolveTool(FFPROBE_BIN);
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

/** Directory holding ffmpeg/ffprobe for yt-dlp --ffmpeg-location (must exist). */
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

export function ytDlpStatus(_customPath?: string): { candidate: string; bundled: string | null; userExists: boolean } {
  const bundled = bundledYtDlpPath();
  let userExists = false;
  try { userExists = fs.existsSync(userYtDlpPath()); } catch {}
  return { candidate: resolveYtDlp(_customPath), bundled, userExists };
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
