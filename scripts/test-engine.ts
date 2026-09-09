import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SegmentedDownload, probeUrl } from '../electron/downloader';

async function main() {
  const url = process.argv[2] || 'https://speed.hetzner.de/10MB.bin';
  const out = process.argv[3] || path.join(os.tmpdir(), 'jetro-test.bin');
  try { fs.unlinkSync(out); } catch {}
  try { fs.unlinkSync(out + '.jetro.json'); } catch {}
  console.log('[jetro-test] probing', url);
  const p = await probeUrl(url);
  console.log('[jetro-test] probe:', p);
  const dl = new SegmentedDownload(url, out, 8, 0);
  dl.onProgress = (done, total, speed) => {
    const pct = total ? ((done / total) * 100).toFixed(1) : '?';
    process.stdout.write(`\r ${done}/${total} (${pct}%) ${(speed / 1024).toFixed(0)} KB/s   `);
  };
  await dl.run();
  const st = fs.statSync(out);
  console.log('\n[jetro-test] DONE bytes=', st.size);
}
main().catch((e) => {
  console.error('\n[jetro-test] FAILED', e);
  process.exit(1);
});
