<div align="center">

<img src="icons/icon48.png" alt="Jetro Resolver" width="64" />

# Jetro Resolver

**Browser extension for [Jetro](../README.md) — send any link, image, video, or page
to the desktop app in one click.**

<p>
  <img src="https://img.shields.io/badge/version-1.2.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Manifest-V3-47848F?style=for-the-badge" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome_Edge_Brave_Opera-Vivaldi_supported-1a7f37?style=for-the-badge" alt="Chromium" />
  <img src="https://img.shields.io/badge/Firefox-compatible-FF7139?style=for-the-badge" alt="Firefox" />
</p>

<p>
  <a href="#-installation">📦 Installation</a> •
  <a href="#-usage">🖱️ Usage</a> •
  <a href="#-how-it-works">⚙️ How It Works</a> •
  <a href="#-troubleshooting">🛠️ Troubleshooting</a>
</p>

</div>

---

## ✨ What it does

Right-click anything and choose **Download with Jetro**. Jetro focuses, opens its
**New Download** window pre-filled, and auto-resolves the link — direct files as
well as video/audio pages from
[1000+ sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)
(YouTube, TikTok, Instagram, Reddit, Vimeo, Dailymotion, Twitch, Facebook,
X/Twitter, …).

| Way to send | What happens |
| ----------- | ------------ |
| 🖱️ **Right-click menu** | `Download with Jetro` on any link, image, video, audio, frame, selected text, or page |
| 👆 **Direct file-link clicks** | Plain left-click on a file link (`.zip`, `.exe`, `.pdf`, `.docx`, …, or any link with a `download` attribute) goes straight to Jetro — no Save As dialog, no leftover tab |
| 🧲 **Download capture** (ON by default) | Safety net: any download the browser does start is cancelled and forwarded to Jetro |
| 🔘 **Toolbar popup** | **Send this page to Jetro** for the current tab |

One toggle in the popup controls both click interception and download capture
together.

## ✅ Requirements

- **Jetro desktop app** installed, run **at least once** — the first run
  registers the `jetro://` protocol handler (via `app.setAsDefaultProtocolClient`
  + `build.protocols` in `package.json`).
- A Chromium browser (**Chrome / Edge / Brave / Opera / Vivaldi**, MV3) or
  **Firefox 109+** (MV3-compatible via `browser_specific_settings.gecko`).

## 📦 Installation

No store needed — load it unpacked:

### 1. Register the protocol

Run the Jetro app once and leave it installed. This is what makes
`jetro://add?url=…` links open the app.

### 2a. Chromium (Chrome / Edge / Brave / Opera / Vivaldi)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Enable **Developer mode** (top-right corner).
3. Click **Load unpacked** → select this `extension/` folder.
4. Pin **Jetro Resolver** to the toolbar for easy access.

### 2b. Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** → select `manifest.json`
   (or install the signed `.xpi` when available).

### 3. Verify

1. Right-click any link → you should see **Download with Jetro**.
2. Or paste this into the Windows Run dialog (<kbd>Win</kbd> + <kbd>R</kbd>):

   ```
   jetro://add?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ
   ```

   Jetro should focus and open New Download with that URL resolving.

## 🖱️ Usage

- **Link / media / page:** right-click → **Download with Jetro**.
- **Selected text containing a URL:** select it, right-click → **Download with Jetro**.
- **Current page:** click the toolbar icon → **Send this page to Jetro**.
- **Turn capture off:** uncheck **Capture browser downloads** in the popup.
  Click interception and the download safety net are disabled together.

> ⚠️ Extension menu items never appear on `chrome://`, `edge://`,
> `about:` pages or the Chrome Web Store — test on a normal page like
> `https://example.com`.

## ⚙️ How It Works

No localhost server, no token, no firewall prompt — just an OS protocol handoff:

```
Right-click / click / popup
  → build jetro://add?url=<encoded>&source=...
  → navigate the tab you're already on to that URL
  → browser shows "Open Jetro?" in place (page is untouched —
    protocol navigations never commit)
  → Jetro opens New Download, pre-filled + auto-resolving
```

Details worth knowing:

- **Same-tab approval:** the handoff reuses the tab you clicked in, so the
  **Open Jetro?** dialog appears where you're looking. Tick **Always allow**
  once and later clicks open Jetro instantly.
- **Context priority:** `linkUrl` → `srcUrl` (image/video/audio) → `frameUrl` →
  URL found in selected text → `pageUrl`.
- **Click interceptor** (`content.js`): only plain, unmodified left-clicks on
  non-viewable file types are forwarded. <kbd>Ctrl</kbd>-click, middle-click,
  <kbd>Shift</kbd>-click, and viewable types (images, web pages) are left alone
  so normal browsing is never hijacked.
- **Helper tab** (`launch.html`): used only as a fallback when there is no
  usable tab. It explains the handoff, offers an **Open Jetro** retry button
  (a real user gesture always re-triggers the prompt), and closes itself after
  ~60 seconds.
- **Limits:** only `http(s)` URLs up to 2048 characters are forwarded;
  `blob:`, `chrome:`, `about:`, and similar URLs are ignored by design.

## 📁 Files

| File | Purpose |
| ---- | ------- |
| `manifest.json` | MV3 manifest, permissions, icons, content script |
| `background.js` | Context menus, protocol handoff, download capture |
| `content.js` | In-page click interceptor for direct file links |
| `launch.html` / `launch.js` | Helper tab: explains the handoff, manual retry, self-closes |
| `popup.html` / `popup.js` | Toolbar popup (send tab + capture toggle) |
| `icons/` | Extension icons (`icon16/48/128.png`) |

## 🔐 Permissions — why each is needed

| Permission | Used for |
| ---------- | -------- |
| `contextMenus` | The **Download with Jetro** right-click item |
| `tabs` | Send the current tab; show the approval in the tab you clicked |
| `downloads` | Cancel browser-side downloads and forward them to Jetro |
| `storage` | Remember the capture on/off toggle |
| `<all_urls>` | Detect file links on any site via the content script |

The extension never reads page content beyond finding the clicked link, and
never sends URLs anywhere except to Jetro on your own machine via `jetro://`.

## 🛠️ Troubleshooting

**No "Download with Jetro" in the right-click menu?**

1. Test on a normal page (`https://example.com`) — menus never appear on
   `chrome://`, `edge://`, or store pages.
2. Go to `chrome://extensions` → find **Jetro Resolver** → hit reload (↻),
   then right-click the test page again.
3. Check for a duplicate install (two entries with the same name) and remove
   the extra one — duplicates fight over the same menu id.

**Browser asks what app opens `jetro://` links?**

Point it at the Jetro exe. Portable builds register on first run — just re-run
Jetro once if needed.

**Browser still shows its own Save As dialog for a file?**

That happens when a download starts outside the click interceptor (JS-triggered
downloads, some `target=_blank` links). Two fixes:

1. Keep **Capture browser downloads** ON in the popup.
2. In Chrome, turn off **Ask where to save each file before downloading**
   (`chrome://settings/downloads`) — otherwise Chrome prompts before the
   extension gets a chance to cancel. Jetro asks for the location itself.

**Nothing happens on click?**

The URL must be `http(s)` and ≤ 2048 chars. `blob:` / `chrome:` / `about:`
URLs are ignored by design. Reload the extension (↻) and try again.

---

Part of [Jetro](../README.md) · [Report an issue](https://github.com/Erkalin/Jetro/issues) · [MIT](../LICENSE)
