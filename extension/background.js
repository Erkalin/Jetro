/* Jetro Resolver — MV3 background service worker.
 *
 * Flow: right-click (link / image / video / audio / page / frame / selection)
 *   -> build jetro://add?url=<encoded>&source=... -> navigate the tab the
 *   user is already looking at to that URL. External-protocol navigations
 *   never commit, so the page is untouched — the browser just shows the
 *   "Open Jetro?" approval in place, in the same tab.
 * Jetro (Electron) registers the `jetro://` protocol, focuses its window,
 * opens New Download pre-filled and auto-resolves (direct files and video pages).
 * Any file download started in the browser is also captured (cancelled and
 * forwarded) when download capture is on, so file links resolve in Jetro too.
 *
 * No localhost server, no token, no firewall prompt. Works in
 * Chrome / Edge / Brave / Opera / Vivaldi (MV3) and Firefox (MV3-compat).
 */

const MENU_ID = 'jetro-download';
const PROTOCOL = 'jetro://add';

function extractUrlFromText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (t.length <= 2048 && !/\s/.test(t)) {
    try {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      if (u.protocol === 'http:' || u.protocol === 'https:') return t;
    } catch {
      /* fall through to token scan */
    }
  }
  const tokens = t.split(/[\s"'<>]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  for (const tok of tokens) {
    const clean = tok.replace(/^[(\[]+|[.,;:!?)\]]+$/g, '').trim();
    if (!clean || clean.length > 2048) continue;
    try {
      const candidate = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
      const u = new URL(candidate);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) return clean;
    } catch {
      /* not a link — try next token */
    }
  }
  return null;
}

function pickTargetUrl(info, tab) {
  // Priority: explicit link > direct media src > frame > selected text URL > page.
  if (info.linkUrl) return { url: info.linkUrl, source: 'link' };
  if (info.srcUrl) {
    const kind = info.mediaType === 'image' ? 'image' : info.mediaType || 'media';
    return { url: info.srcUrl, source: kind };
  }
  if (info.frameUrl) return { url: info.frameUrl, source: 'frame' };
  if (info.selectionText) {
    const found = extractUrlFromText(info.selectionText);
    if (found) return { url: found, source: 'selection' };
  }
  if (info.pageUrl) return { url: info.pageUrl, source: 'page' };
  if (tab && tab.url && /^https?:/i.test(tab.url)) return { url: tab.url, source: 'tab' };
  return { url: '', source: '' };
}

function isSendableHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// How long the OS "Open Jetro?" approval dialog gets before we repurpose
// the helper tab. Closing the tab dismisses the prompt, so this must be
// generous on first run (the "Always allow" tick makes later runs instant).
const LAUNCH_SWAP_MS = 8000;
// The helper tab always cleans up after itself; Jetro (if approved) is
// already opening by then.
const LAUNCH_CLOSE_MS = 60000;

// Active-tab lookup that works with both promise-style (Chrome) and
// callback-style (Firefox chrome.* namespace) tabs APIs.
async function queryActiveTabId() {
  try {
    const r = chrome.tabs.query({ active: true, currentWindow: true });
    if (r && typeof r.then === 'function') {
      const tabs = await r;
      const active = tabs && tabs[0];
      if (active && active.id != null) return active.id;
      return null;
    }
  } catch {}
  try {
    return await new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          try {
            const t = tabs && tabs[0];
            resolve(t && t.id != null ? t.id : null);
          } catch {
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  } catch {}
  return null;
}

async function sendToJetro(rawUrl, source, tabId) {
  const url = String(rawUrl || '').trim();
  if (!isSendableHttpUrl(url)) return;
  const src = source || 'page';
  const jetroUrl = `${PROTOCOL}?url=${encodeURIComponent(url)}&source=${encodeURIComponent(src)}`;
  // Primary path: navigate the tab the user is already looking at to the
  // jetro:// URL. External-protocol navigations never commit, so the page
  // stays exactly as it is — the browser just shows the "Open Jetro?"
  // approval dialog in place, in the same tab.
  let id = typeof tabId === 'number' && tabId >= 0 ? tabId : null;
  if (id == null) id = await queryActiveTabId();
  if (id != null) {
    try {
      await chrome.tabs.update(id, { url: jetroUrl });
      return;
    } catch {
      // Restricted tab (or similar) — fall through to the helper tab below.
    }
  }
  // Fallback (no usable tab): background helper tab. The OS intercepts
  // jetro:// and shows the approval dialog for that tab.
  try {
    const tab = await chrome.tabs.create({ url: jetroUrl, active: false });
    if (tab && tab.id != null) {
      const helperId = tab.id;
      // Repurpose the leftover tab into an explanation + manual retry page
      // (a blind blank tab is confusing, and the prompt may have been missed).
      setTimeout(() => {
        try {
          const launchUrl =
            chrome.runtime.getURL('launch.html') +
            `?url=${encodeURIComponent(url)}&source=${encodeURIComponent(src)}`;
          const r = chrome.tabs.update(helperId, { url: launchUrl });
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch {}
      }, LAUNCH_SWAP_MS);
      setTimeout(() => {
        try {
          const r = chrome.tabs.remove(helperId);
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch {}
      }, LAUNCH_CLOSE_MS);
    }
  } catch {}
}

async function setupMenus() {
  // MV3 service workers are non-persistent: they are stopped after ~30s idle
  // and restarted on demand WITHOUT onInstalled/onStartup firing. Menus must
  // therefore be (re)created on every worker start, not just on install.
  try {
    try {
      const p = chrome.contextMenus.removeAll();
      if (p && typeof p.catch === 'function') await p.catch(() => {});
      else if (p && typeof p.then === 'function') await p;
    } catch {}
  } catch {}
  try {
    const p = chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Download with Jetro',
      contexts: ['link', 'image', 'video', 'audio', 'page', 'frame', 'selection'],
    });
    // Chrome returns a Promise; Firefox (callbacks) returns undefined — only
    // await when a thenable was actually returned.
    if (p && typeof p.catch === 'function') await p.catch(() => {});
    else if (p && typeof p.then === 'function') await p;
  } catch (e) {
    // create() throws if the id already exists after a fast restart — that
    // just means the menu is already there.
    try {
      if (!String((e && e.message) || e).match(/duplicate|already exists/i)) throw e;
    } catch {}
  }
}

// Run on every service-worker start (install, browser startup, AND wake from
// idle eviction). Kept unconditional on purpose — see setupMenus comment.
try {
  const r = setupMenus();
  if (r && typeof r.catch === 'function') r.catch(() => {});
} catch {}

chrome.runtime.onInstalled.addListener(() => {
  // Download interception defaults to ON — opt-out via the popup.
  try {
    chrome.storage.sync.get({ interceptDownloads: true }, (cur) => {
      try {
        if (typeof cur.interceptDownloads !== 'boolean') {
          chrome.storage.sync.set({ interceptDownloads: true });
        }
      } catch {}
    });
  } catch {}
  try {
    const r = setupMenus();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {}
});

chrome.runtime.onStartup.addListener(() => {
  try {
    const r = setupMenus();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {}
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const { url, source } = pickTargetUrl(info, tab);
  // Pass the tab the user right-clicked in so the "Open Jetro?" approval
  // appears in that same tab instead of a hidden background tab.
  if (url) sendToJetro(url, source, tab && tab.id);
});

// Toolbar button: send the current tab URL (page context).
chrome.action.onClicked.addListener(async (tab) => {
  // When a popup is set, onClicked does not fire — kept for Firefox builds
  // without popup and as a fallback. Popup buttons call sendToJetro instead.
  if (tab && tab.url && isSendableHttpUrl(tab.url)) sendToJetro(tab.url, 'tab', tab.id);
});

// Download capture: cancel the browser download and forward the URL to Jetro,
// which resolves it (direct files and video/audio pages).
// Default ON — any downloadable file link clicked in the browser lands in
// Jetro automatically. Turn off anytime via the popup toggle.
chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const { interceptDownloads } = await chrome.storage.sync.get({ interceptDownloads: true });
    if (!interceptDownloads) return;
    const url = String(item && item.url ? item.url : '');
    if (!isSendableHttpUrl(url)) return;
    if (/^blob:/i.test(url)) return;
    try {
      await chrome.downloads.cancel(item.id);
    } catch {}
    try {
      await chrome.downloads.erase({ id: item.id });
    } catch {}
    sendToJetro(url, 'download');
  } catch {}
});

// Page + popup -> background messages (intercepted file-link clicks,
// send-tab). Content-script messages carry sender.tab, so the
// "Open Jetro?" approval for an intercepted click appears in that same tab.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'jetro:send-link' && isSendableHttpUrl(msg.url)) {
    const fromTab = sender && sender.tab && sender.tab.id;
    sendToJetro(msg.url, 'link', fromTab);
    reply && reply({ ok: true });
    return true;
  }
  if (msg && msg.type === 'jetro:send-tab' && isSendableHttpUrl(msg.url)) {
    sendToJetro(msg.url, 'tab');
    reply && reply({ ok: true });
    return true;
  }
  return false;
});
