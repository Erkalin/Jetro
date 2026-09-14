import type { BatchMode } from '@/types';
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

// ---------- New Batch Download helpers (pattern with * → many URLs) ----------
export const BATCH_MAX_FILES = 200;

export function padBatchNum(n: number, size: number): string {
  const s = String(n);
  if (s.length >= size) return s;
  return '0'.repeat(size - s.length) + s;
}

export function expandBatchUrls(
  pattern: string,
  mode: BatchMode,
  fromNum: number,
  toNum: number,
  wildcardSize: number,
  fromLetter: string,
  toLetter: string,
): string[] {
  const out: string[] = [];
  if (!pattern.includes('*')) return out;
  if (mode === 'numbers') {
    for (let i = fromNum; i <= toNum; i++) {
      out.push(pattern.split('*').join(padBatchNum(i, wildcardSize)));
    }
  } else {
    const a = String(fromLetter || '').charCodeAt(0);
    const b = String(toLetter || '').charCodeAt(0);
    for (let c = a; c <= b; c++) {
      out.push(pattern.split('*').join(String.fromCharCode(c)));
    }
  }
  return out;
}

export function isSingleLetter(s: string): boolean {
  return /^[A-Za-z]$/.test(String(s || ''));
}

/** Validate batch inputs. Returns expanded URLs or an error message. */
export function validateBatchInput(
  pattern: string,
  mode: BatchMode,
  fromNumRaw: string,
  toNumRaw: string,
  wildcardRaw: string,
  fromLetterRaw: string,
  toLetterRaw: string,
  e: AppStrings['batchError'] = en.batchError,
): { urls?: string[]; error?: string } {
  const p = String(pattern || '').trim();
  if (!p) return { error: e.empty };
  if (!p.includes('*')) return { error: e.noWildcard };
  if (p.length > 2048 || /\s/.test(p)) return { error: e.invalid };
  if (mode === 'numbers') {
    if (!/^-?\d+$/.test(String(fromNumRaw).trim()) || !/^-?\d+$/.test(String(toNumRaw).trim())) {
      return { error: e.numbersOnly };
    }
    if (!/^\d+$/.test(String(wildcardRaw).trim())) {
      return { error: e.wildcardNumbers };
    }
    const from = parseInt(String(fromNumRaw).trim(), 10);
    const to = parseInt(String(toNumRaw).trim(), 10);
    const size = parseInt(String(wildcardRaw).trim(), 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: e.numbersOnly };
    if (!Number.isFinite(size) || size < 1 || size > 10) return { error: e.wildcardRange };
    if (from < 0 || to < 0) return { error: e.nonNegative };
    if (from > 999999 || to > 999999) return { error: e.tooLarge };
    if (from > to) return { error: e.fromTo };
    const count = to - from + 1;
    if (count > BATCH_MAX_FILES) return { error: e.tooMany(count, BATCH_MAX_FILES) };
    return { urls: expandBatchUrls(p, mode, from, to, size, '', '') };
  }
  const fl = String(fromLetterRaw || '').trim();
  const tl = String(toLetterRaw || '').trim();
  if (!isSingleLetter(fl) || !isSingleLetter(tl)) {
    return { error: e.letterSingle };
  }
  const lowerFl = fl.toLowerCase() === fl;
  const lowerTl = tl.toLowerCase() === tl;
  if (lowerFl !== lowerTl) return { error: e.letterCase };
  const a = fl.charCodeAt(0);
  const b = tl.charCodeAt(0);
  if (a > b) return { error: e.letterOrder };
  const count = b - a + 1;
  if (count > BATCH_MAX_FILES) return { error: e.tooMany(count, BATCH_MAX_FILES) };
  return { urls: expandBatchUrls(p, mode, 0, 0, 1, fl, tl) };
}

export function stepLetter(value: string, dir: 1 | -1): string {
  const s = String(value || '').trim();
  if (!isSingleLetter(s)) return dir > 0 ? 'a' : 'z';
  const isLower = s.toLowerCase() === s;
  const base = isLower ? 97 : 65;
  const top = base + 25;
  let c = s.charCodeAt(0) + dir;
  if (c < base) c = base;
  if (c > top) c = top;
  return String.fromCharCode(c);
}
