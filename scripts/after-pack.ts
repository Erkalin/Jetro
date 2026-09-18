import * as fs from 'fs';
import * as path from 'path';

// electron-builder afterPack: keep only English + Persian Electron locales.
// Saves ~39MB (55 .pak files -> 2). en-US is the Electron fallback, fa is the app's second language.
const KEEP = new Set(['en-US.pak', 'fa.pak']);

export default async function afterPack(context: any): Promise<void> {
  try {
    const localesDir = path.join(context?.appOutDir || '', 'locales');
    if (!localesDir || !fs.existsSync(localesDir)) return;
    const files = fs.readdirSync(localesDir);
    let removed = 0;
    for (const f of files) {
      if (!f.endsWith('.pak') || KEEP.has(f)) continue;
      try {
        fs.unlinkSync(path.join(localesDir, f));
        removed++;
      } catch {}
    }
    console.log(`[after-pack] locales: kept ${[...KEEP].join(', ')}, removed ${removed}`);
  } catch (e) {
    console.warn('[after-pack] locale strip failed', (e as any)?.message || e);
  }
}
