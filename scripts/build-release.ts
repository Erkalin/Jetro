import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// electron-builder names the portable exe "${productName}.exe",
// so it becomes "Jetro.exe" (no version in the filename).
//
// Single ffmpeg-bundled release:
//   release/ (Jetro.exe + Jetro Setup.exe, ffmpeg always bundled)
//
// Usage:
//   node dist-scripts/scripts/build-release.js [--out-dir=<dir>] [--keep-config] [--dry-run]
//     [extra electron-builder args...]
//
// When --config is passed, electron-builder reads ONLY that file (package.json
// "build" is ignored), so the temp config below is a complete standalone
// config cloned from package.json.

const DEFAULT_OUT = 'release';

function parseArgs(argv: string[]) {
  let outDir = DEFAULT_OUT;
  let keepConfig = false;
  let dryRun = false;
  const passthrough: string[] = [];
  for (const a of argv) {
    if (a.startsWith('--out-dir=')) outDir = a.slice('--out-dir='.length) || outDir;
    else if (a.startsWith('--out=')) outDir = a.slice('--out='.length) || outDir;
    else if (a === '--keep-config') keepConfig = true;
    else if (a === '--dry-run' || a === '--list') dryRun = true;
    else if (
      a === '--variant=full' ||
      a === '--full' ||
      a === '--with-ffmpeg' ||
      a === '--variant=all' ||
      a.startsWith('--full-out=')
    ) {
      // Backwards-compat no-ops (single ffmpeg build is now the only output).
      if (a.startsWith('--full-out=')) outDir = a.slice('--full-out='.length) || outDir;
      else console.warn(`[build-release] note: "${a}" is obsolete — there is only one ffmpeg-bundled build now.`);
    } else if (
      a.startsWith('--variant=') ||
      a === '--lite' ||
      a === '--without-ffmpeg' ||
      a === '--no-ffmpeg' ||
      a.startsWith('--lite-out=')
    ) {
      throw new Error(
        `[build-release] the without-ffmpeg (lite) build was removed — every release bundles ffmpeg. Got "${a}".`,
      );
    } else passthrough.push(a);
  }
  return { outDir, keepConfig, dryRun, passthrough };
}

/** Resolve a config-relative file to an absolute path (project-root based). */
function toAbs(root: string, p: unknown): unknown {
  if (typeof p !== 'string' || !p.trim()) return p;
  if (path.isAbsolute(p)) return p;
  // Leave glob patterns / protocol schemes / URLs alone — only absolutize
  // paths that actually exist on disk relative to the project root.
  const abs = path.join(root, p);
  return fs.existsSync(abs) ? abs : p;
}

function buildReleaseConfig(root: string, base: any, outDir: string): any {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.directories = { ...(cfg.directories || {}), output: path.isAbsolute(outDir) ? outDir : path.join(root, outDir) };

  // Absolutize extraResource sources so the temp config works regardless of its location.
  if (Array.isArray(cfg.extraResources)) {
    cfg.extraResources = cfg.extraResources.map((e: any) => {
      if (typeof e === 'string') return toAbs(root, e);
      if (e && typeof e === 'object' && typeof e.from === 'string') return { ...e, from: toAbs(root, e.from) };
      return e;
    });
  }

  // Absolutize single-file references (icon, hooks, nsis includes).
  if (typeof cfg.afterPack === 'string') cfg.afterPack = toAbs(root, cfg.afterPack) as string;
  if (cfg.win && typeof cfg.win.icon === 'string') cfg.win = { ...cfg.win, icon: toAbs(root, cfg.win.icon) };
  if (cfg.nsis) {
    const nsis = { ...cfg.nsis };
    if (typeof nsis.installerSidebar === 'string') nsis.installerSidebar = toAbs(root, nsis.installerSidebar) as string;
    if (typeof nsis.include === 'string') nsis.include = toAbs(root, nsis.include) as string;
    cfg.nsis = nsis;
  }
  return cfg;
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function summarizeDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) {
      console.log(`[build-release] ${dir}: (missing)`);
      return;
    }
    const files = fs.readdirSync(dir)
      .filter((f) => /\.(exe|yml|blockmap)$/i.test(f))
      .map((f) => {
        try {
          const st = fs.statSync(path.join(dir, f));
          return st.isFile() ? `  ${f}  (${fmtMB(st.size)})` : null;
        } catch { return null; }
      })
      .filter(Boolean);
    console.log(`[build-release] ${dir}:`);
    for (const f of files) console.log(f);
  } catch (e: any) {
    console.warn(`[build-release] could not list ${dir}: ${e?.message || e}`);
  }
}

function main() {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) throw new Error('[build-release] package.json has no version');
  const base = pkg.build;
  if (!base || typeof base !== 'object') throw new Error('[build-release] package.json has no "build" section');

  const { outDir, keepConfig, dryRun, passthrough } = parseArgs(process.argv.slice(2));

  const product = base?.productName || 'Jetro';
  console.log(`[build-release] Jetro v${version} (ffmpeg bundled) -> ${outDir}/`);
  console.log(`[build-release] portable "${product}.exe" + installer "${product} Setup.exe"`);

  // Pre-flight: ffmpeg must be on disk so it always ships.
  const ff = path.join(root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (!fs.existsSync(ff)) {
    throw new Error(
      `[build-release] ffmpeg is required but missing: ${ff}. Run "npm run fetch:binaries" first.`,
    );
  }

  if (dryRun) {
    const cfg = buildReleaseConfig(root, base, outDir);
    const resources = Array.isArray(cfg.extraResources)
      ? cfg.extraResources.map((e: any) => (typeof e === 'string' ? e : `${e.from} -> ${e.to}`))
      : [];
    console.log(`[build-release] [dry-run] output=${outDir}`);
    console.log(`[build-release] [dry-run] extraResources=${JSON.stringify(resources, null, 2)}`);
    return;
  }

  const localBin = path.join(
    root, 'node_modules', '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
  );
  const useLocal = fs.existsSync(localBin);
  const cmd = useLocal ? localBin : 'npx';
  const cmdBase = useLocal ? [] : ['electron-builder'];

  const outAbs = path.isAbsolute(outDir) ? outDir : path.join(root, outDir);
  fs.mkdirSync(outAbs, { recursive: true });
  const cfg = buildReleaseConfig(root, base, outDir);
  const tmpName = 'electron-builder.release.json';
  const tmpPath = path.join(root, tmpName);
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), 'utf8');
  console.log(`[build-release] ---- building with ffmpeg -> ${outDir} ----`);
  const r = spawnSync(cmd, [...cmdBase, '--config', tmpPath, ...passthrough], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (!keepConfig) {
    try { fs.unlinkSync(tmpPath); } catch {}
  } else {
    console.log(`[build-release] kept temp config: ${tmpName}`);
  }
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) {
    console.error(`[build-release] build failed (exit ${r.status})`);
    process.exit(1);
  }
  summarizeDir(outAbs);
  console.log('[build-release] done.');
}

main();
