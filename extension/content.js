/* Click interceptor (runs in the page, capture phase).
 *
 * Plain left-clicks on links that point straight at a downloadable file never
 * reach the browser download flow: they are forwarded to Jetro instead. That
 * means no Save As dialog, no browser-side resolving, and no leftover blank
 * file tab — Jetro becomes the only handler.
 *
 * Respects the "Capture browser downloads" toggle (default ON). Only
 * unmodified left-clicks are touched; middle-click / ctrl-click / shift-click
 * pass through to the browser. Types the browser can display inline (images,
 * web pages, …) are deliberately left alone so normal browsing is never
 * hijacked — those still go through the downloads.onCreated safety net if the
 * user actually downloads them.
 */

'use strict';

// Extensions browsers cannot display inline — left-clicking one of these
// always starts a download, so handing it straight to Jetro is safe.
const FILE_EXTS = new Set(
  (
    'zip,rar,7z,tar,gz,tgz,bz2,xz,zst,cab,arj,lzh,iso,img,bin,nrg,mdf,' +
    'dmg,pkg,deb,rpm,msi,msu,exe,com,bat,cmd,msc,reg,scr,apk,appx,aab,ipa,' +
    'jar,war,ear,doc,docx,xls,xlsx,ppt,pptx,odt,ods,odp,epub,mobi,azw,fb2,' +
    'psd,ai,ttf,otf,woff,woff2,torrent'
  ).split(',')
);

let captureOn = true; // default ON, synced from storage below
try {
  chrome.storage.sync.get({ interceptDownloads: true }, (cur) => {
    try {
      captureOn = !cur || cur.interceptDownloads !== false;
    } catch {}
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    try {
      if (area === 'sync' && changes && changes.interceptDownloads) {
        captureOn = changes.interceptDownloads.newValue !== false;
      }
    } catch {}
  });
} catch {}

function fileExtOf(pathname) {
  try {
    const base = String(pathname || '').split('/').pop() || '';
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) return '';
    return base.slice(i + 1).toLowerCase();
  } catch {
    return '';
  }
}

// Returns the URL to forward, or null to leave the click alone.
function shouldIntercept(anchor) {
  try {
    if (!anchor || !anchor.href) return null;
    const href = String(anchor.href);
    if (!/^https?:/i.test(href)) return null;
    if (href.length > 2048 || /\s/.test(href)) return null;
    // Explicit author intent ("download this") — always a download.
    if (anchor.hasAttribute && anchor.hasAttribute('download')) return href;
    let path = '';
    try {
      path = new URL(href).pathname || '';
    } catch {
      return null;
    }
    if (FILE_EXTS.has(fileExtOf(path))) return href;
  } catch {}
  return null;
}

document.addEventListener(
  'click',
  (e) => {
    try {
      if (!captureOn) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      const anchor = t && t.closest ? t.closest('a[href]') : null;
      if (!anchor) return;
      const url = shouldIntercept(anchor);
      if (!url) return;
      e.preventDefault();
      try {
        e.stopImmediatePropagation();
      } catch {}
      try {
        chrome.runtime.sendMessage({ type: 'jetro:send-link', url });
      } catch {}
    } catch {}
  },
  true
);
