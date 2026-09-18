import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// electron-builder names the portable exe "${productName}.exe",
// so it becomes "Jetro.exe" (no version in the filename).

function main() {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const full = String(pkg.version || '').trim();
  if (!full) throw new Error('[build-release] package.json has no version');
  const localBin = path.join(
    root, 'node_modules', '.bin',
    process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
  );
  const useLocal = fs.existsSync(localBin);
  const cmd = useLocal ? localBin : 'npx';
  const args = useLocal ? process.argv.slice(2) : ['electron-builder', ...process.argv.slice(2)];
  console.log(`[build-release] version ${full} -> portable "${pkg.build?.productName || 'Jetro'}.exe" + installer "${pkg.build?.productName || 'Jetro'} Setup.exe"`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.error) throw r.error;
  process.exit(r.status ?? 1);
}

main();
