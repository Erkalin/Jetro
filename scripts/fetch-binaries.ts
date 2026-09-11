import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execFile } from 'child_process';

// Pinned versions — bump deliberately.
const YTDLP_VERSION = process.env.YTDLP_VERSION || '2026.08.19';
const FFMPEG_VERSION = process.env.FFMPEG_VERSION || '9.0';
const QUICKJS_VERSION = process.env.QUICKJS_VERSION || 'v0.16.2';

const isWin = process.platform === 'win32';
const YTDLP_BIN = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_BIN}`;

// Gyan essentials (GPLv3 static): contains bin/ffmpeg.exe + bin/ffprobe.exe (+ ffplay, unused).
const FFMPEG_ZIP_URL = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`;

const QUICKJS_BIN = isWin ? 'quickjs.exe' : 'quickjs';
const QUICKJS_URL = isWin
  ? `https://github.com/quickjs-ng/quickjs/releases/download/${QUICKJS_VERSION}/qjs-windows-x86_64.exe`
  : `https://github.com/quickjs-ng/quickjs/releases/download/${QUICKJS_VERSION}/qjs-linux-x86_64`;

async function main() {
  const outDir = path.join(process.cwd(), 'bin');
  fs.mkdirSync(outDir, { recursive: true });

  // 1. yt-dlp (ejs challenge solvers are bundled inside the official exe — nothing extra to fetch).
  const ytdlpOut = path.join(outDir, YTDLP_BIN);
  if (fs.existsSync(ytdlpOut)) {
    console.log(`[fetch-binaries] yt-dlp exists (${fs.statSync(ytdlpOut).size} bytes), skipping`);
  } else {
    console.log(`[fetch-binaries] downloading ${YTDLP_URL}`);
    await download(YTDLP_URL, ytdlpOut);
    console.log(`[fetch-binaries] saved yt-dlp (${fs.statSync(ytdlpOut).size} bytes)`);
    if (!isWin) { try { fs.chmodSync(ytdlpOut, 0o755); } catch {} }
  }

  // 2. ffmpeg + ffprobe (extract only the two needed exes, drop ffplay + docs).
  const ffmpegOut = path.join(outDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobeOut = path.join(outDir, isWin ? 'ffprobe.exe' : 'ffprobe');
  if (fs.existsSync(ffmpegOut) && fs.existsSync(ffprobeOut)) {
    console.log('[fetch-binaries] ffmpeg+ffprobe exist, skipping');
  } else {
    const zipPath = path.join(outDir, `_ffmpeg-${FFMPEG_VERSION}.zip`);
    if (!fs.existsSync(zipPath)) {
      console.log(`[fetch-binaries] downloading ffmpeg essentials ${FFMPEG_VERSION} (~106MB, one-time)`);
      await download(FFMPEG_ZIP_URL, zipPath);
    } else {
      console.log('[fetch-binaries] ffmpeg zip already downloaded, reusing');
    }
    console.log('[fetch-binaries] extracting ffmpeg.exe + ffprobe.exe');
    await extractFfmpeg(zipPath, outDir);
    for (const f of [ffmpegOut, ffprobeOut]) {
      if (!fs.existsSync(f)) throw new Error('missing after extract: ' + f);
      console.log(`[fetch-binaries] ok ${path.basename(f)} (${fs.statSync(f).size} bytes)`);
      if (!isWin) { try { fs.chmodSync(f, 0o755); } catch {} }
    }
    try { fs.unlinkSync(zipPath); } catch {}
  }

  // 3. QuickJS runtime for yt-dlp EJS challenges (~2MB). System deno/node are
  // also auto-detected at runtime; QuickJS guarantees offline out-of-box support.
  const qjsOut = path.join(outDir, QUICKJS_BIN);
  if (fs.existsSync(qjsOut)) {
    console.log(`[fetch-binaries] quickjs exists (${fs.statSync(qjsOut).size} bytes), skipping`);
  } else {
    console.log(`[fetch-binaries] downloading ${QUICKJS_URL}`);
    await download(QUICKJS_URL, qjsOut);
    console.log(`[fetch-binaries] saved quickjs (${fs.statSync(qjsOut).size} bytes)`);
    if (!isWin) { try { fs.chmodSync(qjsOut, 0o755); } catch {} }
  }

  console.log('[fetch-binaries] done');
}

function download(url: string, dest: string, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Jetro-fetch' } }, (res) => {
      const loc = res.headers.location;
      if (loc && res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && redirects > 0) {
        res.resume();
        download(new URL(loc, url).toString(), dest, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Extract only ffmpeg(.exe)+ffprobe(.exe) from the Gyan zip via PowerShell (Windows) or unzip (posix). */
function extractFfmpeg(zipPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isWin) {
      const tmp = path.join(outDir, '_ffmpeg-tmp');
      const ps = [
        `$ErrorActionPreference='Stop';`,
        `Add-Type -AssemblyName System.IO.Compression.FileSystem;`,
        `if (Test-Path '${tmp}') { Remove-Item -Recurse -Force '${tmp}' };`,
        `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${tmp}');`,
        `$b = Get-ChildItem -Recurse -Directory '${tmp}' | Where-Object { Test-Path (Join-Path $_.FullName 'bin') } | Select-Object -First 1;`,
        `if (-not $b) { $b = Get-Item '${tmp}' };`,
        `Copy-Item (Join-Path $b.FullName 'bin\\ffmpeg.exe') '${path.join(outDir, 'ffmpeg.exe')}' -Force;`,
        `Copy-Item (Join-Path $b.FullName 'bin\\ffprobe.exe') '${path.join(outDir, 'ffprobe.exe')}' -Force;`,
        `Remove-Item -Recurse -Force '${tmp}';`,
      ].join(' ');
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 300000 }, (err, _o, se) => {
        if (err) reject(new Error(String(se || err.message).slice(0, 500)));
        else resolve();
      });
    } else {
      execFile('unzip', ['-j', '-o', zipPath, '*/bin/ffmpeg', '*/bin/ffprobe', '-d', outDir], { timeout: 300000 }, (err, _o, se) => {
        if (err) reject(new Error(String(se || err.message).slice(0, 500)));
        else resolve();
      });
    }
  });
}

main().catch((e) => {
  console.error('[fetch-binaries] FAILED', e?.message || e);
  console.error('[fetch-binaries] Build can continue without binaries (PATH fallback at runtime).');
  process.exit(0);
});
