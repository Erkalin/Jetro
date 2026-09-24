<div align="center">

<img src="src/assets/Jetro.png" alt="Jetro" width="200" />

<p><strong>A modern and professional download manager for Windows with a segmented multi-connection
engine, bundled with yt-dlp for video and audio downloads from <big>1000+</big> platforms.</strong></p>

<p><a href="README-fa.md">برای خواندن مستندات فارسی کلیک کنید</a></p>

<p>
<a href="package.json"><img src="https://img.shields.io/badge/version-1.3.0-blue?style=for-the-badge" alt="Version" /></a>
  <a href="https://github.com/Erkalin/Jetro/releases"><img src="https://img.shields.io/badge/platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" /></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

<p>
  <a href="#-preview">👀 Preview</a> •
  <a href="#-features">✨ Features</a> •
  <a href="#-getting-started">🚀 Getting Started</a> •
  <a href="#-project-structure">📁 Project Structure</a> •
  <a href="#️-how-downloading-works">⚙️ How It Works</a>
</p>

</div>

---

## 👀 Preview

<details>
<summary><strong><big>📸 Click to expand screenshots</big></strong></summary>
<br>

<details>
<summary><strong>📱 App</strong></summary>
<br>

![Main window](docs/app/preview.png)
<p align="center"><sub>Main window</sub></p>

![Main window (Persian)](docs/app/preview-fa.png)
<p align="center"><sub>Main window (Persian)</sub></p>

![Video qualities & audio picker](docs/app/youtube-manual.png)
<p align="center"><sub>Video qualities & audio picker</sub></p>

![Download from browser](docs/app/browser-download-popup.png)
<p align="center"><sub>Download from browser</sub></p>

![Download analytics](docs/app/analysis.png)
<p align="center"><sub>Download analytics</sub></p>

![Download properties](docs/app/properties.png)
<p align="center"><sub>Download properties</sub></p>

![Browser extension](docs/app/resolver.png)
<p align="center"><sub>Browser extension</sub></p>

![App settings](docs/app/settings.png)
<p align="center"><sub>App settings</sub></p>

![Keyboard shortcuts](docs/app/shortcuts.png)
<p align="center"><sub>Keyboard shortcuts</sub></p>

![List pagination](docs/app/pagination.png)
<p align="center"><sub>List pagination</sub></p>

</details>

<details>
<summary><strong>🕐 Scheduler</strong></summary>
<br>

![General & start schedule](docs/scheduler/scheduler-1.png)
<p align="center"><sub>General & start schedule</sub></p>

![Stop schedule & retries](docs/scheduler/scheduler-2.png)
<p align="center"><sub>Stop schedule & retries</sub></p>

![Power actions on finish](docs/scheduler/scheduler-3.png)
<p align="center"><sub>Power actions on finish</sub></p>

![Queue files](docs/scheduler/scheduler-files.png)
<p align="center"><sub>Queue files</sub></p>

</details>

<details>
<summary><strong>🎨 Themes</strong></summary>
<br>

![Amber](docs/themes/theme-amber.png)

![Aqua](docs/themes/theme-aqua.png)

![Blossom](docs/themes/theme-blossom.png)

![Clover](docs/themes/theme-clover.png)

![Coral](docs/themes/theme-coral.png)

![Crimson](docs/themes/theme-crimson.png)

![Dracula](docs/themes/theme-dracula.png)

![Ember](docs/themes/theme-ember.png)

![Espresso](docs/themes/theme-espresso.png)

![Forest](docs/themes/theme-forest.png)

![Gold](docs/themes/theme-gold.png)

![Gray](docs/themes/theme-gray.png)

![Hunter](docs/themes/theme-hunter.png)

![Indigo](docs/themes/theme-indigo.png)

![Jetro](docs/themes/theme-jetro.png)

![Lavender](docs/themes/theme-lavender.png)

![Midnight](docs/themes/theme-midnight.png)

![Navy](docs/themes/theme-navy.png)

![Nord](docs/themes/theme-nord.png)

![Pistachio](docs/themes/theme-pistachio.png)

![Ruby](docs/themes/theme-ruby.png)

![Scarlet](docs/themes/theme-scarlet.png)

![Silver](docs/themes/theme-silver.png)

![Solarized](docs/themes/theme-solarized.png)

![Teal](docs/themes/theme-teal.png)

![Turquoise](docs/themes/theme-turquoise.png)

</details>

</details>

## 📥 Download

Download the latest version from the
[**Releases page**](https://github.com/Erkalin/Jetro/releases).

| OS | File | How to run |
| -- | ---- | ---------- |
| 🪟 Windows x64 (portable) | `Jetro.exe` | Run directly, no installation |
| 🪟 Windows x64 (installer) | `Jetro Setup.exe` | Install per-user (desktop + Start Menu shortcuts, run after finish) |

These builds includes all components required for video and audio downloads
(`yt-dlp`, `ffmpeg`, `quickjs`). No separate installation is required.

## ✨ Features

### 📥 Downloading

| Feature | Description |
| ------- | ----------- |
| ⚡ Segmented engine | 1–32 parallel `Range` connections per file |
| 🚦 Speed control | Global speed limit presets from 100 KB/s to Unlimited speed + Per-download connections (`1`, `4`, `8`, `16`, `32`) configurable for each download |
| 🔁 Auto-retry | Failed downloads are re-queued with exponential backoff instead of stopping at error |
| 📦 Batch download | Add up to 200 file parts at once with a `*` pattern (numbers or letters), with live preview and link resolving |
| 📄 Pagination | Filter the number of downloads shown on each download menu page to reduce lag and animation flickering. |

### 🎬 Video & Audio

Powered by the bundled `yt-dlp` + `ffmpeg`, with `quickjs` for player challenges.
Paste a link from YouTube, TikTok, Instagram, Reddit, Vimeo, Dailymotion,
Twitch, Facebook, X/Twitter and
[1000+ more websites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

| Feature | Description |
| ------- | ----------- |
| 🔍 Detect qualities | The `Detect qualities` button acts as the gateway to yt-dlp. If you're willing to download from a yt-dlp supported website, just paste in the link and start resolving the page for video/audio downloads. Click `Show details` to check the logs if you encountered any errors. |
| 🎞️ Video picker | Choose `mp4` video format from `144p` to `8K` (Thanks to ffmpeg!) |
| 🎧 Audio picker | `AUDIO - best available per format` |
| 💬 Subtitles | `Subtitles (EN)` — writes and embeds English subtitles when available |
| 📃 Playlists | You can download a YouTube playlist with up to `50` videos |
| 🍪 Cookies | Login support via pasted `cookies.txt` content or a cookie file from disk, with a cookie-exporter extension link |
| 🛠️ Bundled tools | `yt-dlp` + `ffmpeg` + `quickjs` shipped in `bin/` and auto-resolved (custom `yt-dlp` path supported) |

> Video/audio downloads run via yt-dlp, which manages its own connections so don't expect 8-32 connections like other downloads!

### 🗂️ Queues & Scheduler

| Feature | Description |
| ------- | ----------- |
| 🗂️ Queues | Group downloads, start/stop together
| 🕐 Scheduler | The main place to configure almost everything in a queue. |
| ⏻ Power action | You can: `Do nothing` / `Sleep` / `Hibernate` / `Shutdown` / `Restart`, with a 60-second countdown dialog when every file in the queue is completed |

### 🎨 Appearance, Language & System

| Feature | Description |
| ------- | ----------- |
| 🎨 Themes | 27-theme gallery (`Jetro`, `Midnight`, `{System}`, `Gray`, `Silver`, `Crimson`, `Coral`, `Amber`, `Teal`, `Navy`, `Turquoise`, `Indigo`, `Aqua`, `Nord`, `Dracula`, `Solarized`, `Forest`, `Blossom`, `Espresso`, `Lavender`, `Ember`, `Pistachio`, `Ruby`, `Scarlet`, `Gold`, `Hunter`, `Clover`) with palette-dot picker, live preview and a header sun/moon toggle (Remembers your last light/dark pick!) |
| 🌍 Language | Choose your desired language from the settings. Currently (`English`, `فارسی` fully supported, plus `العربية`, `Türkçe`, `Français`, `Deutsch`, `Español`, `Русский`, `简体中文`, `हिन्दी`, `Português`, `Italiano`, `Nederlands`, `日本語`, `한국어`, `اردو`, `Bahasa Indonesia`, `Polski`, `Українська`, `Tiếng Việt`, `繁體中文`, `עברית`, `کوردی (سۆرانی)`, `Azərbaycanca`, `বাংলা`, `தமிழ்`, `తెలుగు`, `ไทย`, `Bahasa Melayu`, `Filipino`, `Svenska`, `Norsk`, `Dansk`, `Suomi`, `Ελληνικά`, `Magyar`, `Čeština`, `Română`, `Português (Brasil)`, `Español (Latinoamérica)`). |
| 📌 System tray | Minimize the app to tray to save space on your taskbar. Downloads still continue while minimized. You can right click the tray to tweak a few download settings. |
| 🚀 Launch at startup | Self-explanatory! Launches minimized upon startup (only available in Installer version) |
| 🔄 Update check | Checks for updates on startup. A manual `Check now` tweak in settings to check for new releases on GitHub in real time. |
| 📊 Details & speed | Per-download view with live/average/peak speed, speed-over-time graph, per-connection progress, and server host/IP + location |


> 🔴 English and Persian are human-translated; the other 38 languages are AI-translated — please report mistakes via [Issues](https://github.com/Erkalin/Jetro/issues)
### 🧩 Browser extension (new in v1.0.0)

Jetro Resolver is located in `extension/` — a Chromium MV3 extension (Chrome,
Edge, Brave, Opera, Vivaldi, with Firefox compatibility). Send any link,
image, video, or page to Jetro via the context menu, or click a direct file
link to open it in the application instead of the browser. Communication with
the desktop application is handled via the `jetro://add?url=...` protocol
(registered on first run). Links from the browser now open in a separate
`Download from browser` dialog with `Start download` / `Download later` and
`+n queued` stacking. See
[`extension/README.md`](extension/README.md) for installation instructions.

### 🌐 Network & Privacy

| Feature | Description |
| ------- | ----------- |
| 🌍 Proxy modes | `No proxy (direct connection)`, `Use system proxy` (OS settings / PAC / env fallback), or `Custom proxy` |
| 🔌 Proxy protocols | `HTTP` / `HTTPS` / `SOCKS4` / `SOCKS5` with auth + `Bypass (comma-separated, always skips localhost)` |


## 🚀 Getting Started

> **Requirements:** [Node.js](https://nodejs.org/) 20+ and Windows.

```powershell
# 1️⃣ Install dependencies
npm install

# 2️⃣ Fetch bundled video tools (yt-dlp, ffmpeg, quickjs) into bin/
npm run fetch:binaries

# 3️⃣ Run the full app (Vite on :5173 + Electron with devtools)
npm run app:dev
```

### 📜 Commands

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Vite dev server only (web preview, no backend) |
| `npm run app:dev` | Full application: Vite + Electron |
| `npm run build` | Type-check + production renderer build |
| `npm run build:electron` | Compile the Electron main process |
| `npm run electron:build` | Build the ffmpeg-bundled release (portable + installer): `release/` (`Jetro.exe`, `Jetro Setup.exe`, ffmpeg bundled) |
| `npm run fetch:binaries` | Download yt-dlp / ffmpeg / quickjs into `bin/` (ffmpeg is always fetched — every release bundles it) |
| `npm run test:engine` | Engine-only download test, no GUI |

```powershell
# Test the engine without the UI (custom URL + output file supported)
npm run test:engine -- https://speed.hetzner.de/10MB.bin
```

<details> <summary><strong><big>📁 Project Structure</strong></big></summary>

```
Jetro/
├── 📂 electron/            # Main process: window, IPC, engine, proxy, video
│   ├── main.ts             # 🪟 App entry, BrowserWindow, tray, jetro:// protocol, themes, launch-at-startup, all IPC handlers
│   ├── preload.ts          # 🔒 Secure renderer bridge (contextIsolation)
│   ├── downloader.ts       # ⚡ Download engine (global speed limit, smoothed speed)
│   ├── proxy.ts            # 🌍 Proxy resolution
│   └── binaries.ts         # 🛠️ yt-dlp / ffmpeg / quickjs resolution
├── 📂 extension/           # 🧩 Jetro Resolver browser extension (MV3) + its own README
├── 📂 src/                 # Renderer (React)
│   ├── App.tsx             # 🖥️ UI (cards/details, video, batch, queues, settings)
│   ├── main.tsx            # 🚪 React entry (wraps App in LanguageProvider)
│   ├── index.css           # 🎨 Style entry — imports per-area files in styles/
│   ├── styles/             # 🎨 Split styles (settings, sidebar, modals, analytics, rtl, themes, …)
│   ├── locale/             # 🌍 Language files + languages.ts registry + LanguageContext
│   ├── components/         # 🧩 DownloadAnalytics, SpeedGraph, OsFileIcon, ThemePicker, LanguagePicker, FlagIcon, QueueScheduler, …
│   ├── hooks/              # 🪝 useSpeedHistory, useExclusiveDropdown, useEscape, useContextMenuNudge, …
│   ├── lib/                # 🛠️ Formatting, URL/batch helpers, speed history, themes, schedule, backend wrapper
│   ├── api/                # 🔌 Renderer backend wrapper (jetro.ts)
│   ├── fonts/              # 🔤 Bundled Iranyekan (Persian) font
│   ├── global.d.ts         # 📝 Renderer API typings
│   └── assets/             # 🖼️ Images bundled
├── 📂 scripts/             # Dev/test scripts (never shipped)
│   ├── test-engine.ts      # 🧪 Engine-only download test, no GUI
│   ├── fetch-binaries.ts   # ⬇️ Fetch yt-dlp / ffmpeg / quickjs into bin/
│   ├── after-pack.ts       # 📦 Strip unused Electron locales (~39 MB saved)
│   └── build-release.ts    # 📦 Portable Jetro.exe + Installer Jetro Setup.exe
├── 📂 bin/                 # 🛠️ Local-only video tools (yt-dlp, ffmpeg, quickjs) — git-ignored, fetch via `npm run fetch:binaries`
├── 📂 build/               # Icon, installer sidebar + script (installerSidebar.bmp, installer.nsh)
├── 📂 docs/                # 🖼️ Screenshots used in preview
├── index.html              # 🌐 Renderer HTML entry
├── vite.config.ts          # ⚙️ Vite config
├── tsconfig.json           # 📘 Renderer + shared TS config
├── tsconfig.electron.json  # 📗 Main-process TS config
└── tsconfig.scripts.json   # 📙 Scripts TS config
```
</details>


## ⚙️ How Downloading Works

```mermaid
graph LR
    A[🔗 Paste URL] --> B[🔍 Probe Accept-Ranges]
    B --> C[✂️ Split into N byte ranges]
    C --> D[⚡ N parallel TCP connections]
    D --> E[💾 Write at file offsets]
    E --> F[✅ Complete]
    D -.⏸️ pause.-> G[💿 .jetro.json sidecar]
    G -.▶️ resume.-> D
```

Jetro probes `Accept-Ranges`, splits the file into N ranges downloaded over N
parallel connections writing directly at file offsets, and resumes from a
`.jetro.json` sidecar file. A single global token bucket enforces the speed
limit across all connections and concurrent downloads, and speed readings are
smoothed to keep the displayed speed and ETA stable.

Video and audio pages take a separate path: Jetro resolves them with the bundled
`yt-dlp`, selects the requested height / audio format, then merges to `mp4` or
extracts audio with the bundled `ffmpeg`. Playlists are expanded (first 50
shown) so each entry becomes its own download.

Batch downloads expand a `*` pattern into up to 200 URLs, resolve each link
for filename and size, then add them lowest-first into a dedicated queue.

---

## 🤝 Contributing

Issues and pull requests are welcome.
Please check the [issues page](https://github.com/Erkalin/Jetro/issues) first.

## 📄 License

[MIT](LICENSE) © 2026 Erkalin
