# Jetro v0.2.0 → v1.0.0 — what changed

Compared `jetro-0.2/` with `jetro/` (package version `0.2.0` → `1.0.0`).
This is a human summary, not an auto-generated diff dump.

## TL;DR

- Full Persian support (language switcher + RTL + Iranyekan font).
- New browser extension (Jetro Resolver) + `jetro://` protocol support in the app.
- New "Details & speed" view per download (speed graph + per-connection progress + server info).
- Download engine feels more stable: global speed limit, smoother speed/ETA.
- Small but useful settings additions: Reset app, version check fix, proxy hint on video errors.
- Big code cleanup under the hood (split up App.tsx / index.css).

---

## 1. Persian / فارسی support

The biggest visible change.

- You can now switch the whole UI between English and فارسی from Settings → App.
- Choice is saved (`jetro-lang`) and applied before first paint, so no flash of wrong direction on startup.
- Full RTL layout when Persian is active (`rtl.css`, `dir="rtl"` on `<html>`). URLs, file paths, speeds and sizes stay LTR on purpose so they don't get mangled.
- Iranyekan font is now bundled in `src/fonts/` (woff2 + ttf) and loaded via `src/styles/fonts.css`.
- All strings moved to `src/locale/en.ts` + `src/locale/fa.ts` with a `LanguageContext` provider. Same keys on both sides, so nothing shows up untranslated by accident.

## 2. Browser extension — Jetro Resolver (new `extension/` folder)

Didn't exist in v0.2.0 at all.

- New `extension/` folder: MV3 extension for Chrome / Edge / Brave / Opera / Vivaldi, plus Firefox compat.
- Right-click any link / image / video / page → "Jetro Resolver" sends it to the app.
- Toolbar popup to send the current page, plus a toggle for download capture.
- Clicking a direct file link (zip, exe, pdf, …) goes straight to Jetro instead of the browser downloading it. Other browser-started downloads get cancelled and forwarded too (can be turned off).
- Works over a new `jetro://add?url=...` protocol:
  - `package.json` now declares `build.protocols` (`jetro` scheme).
  - `electron/main.ts` registers it (`setAsDefaultProtocolClient`), handles cold start / second instance / macOS open-url, and forwards the URL to the UI via a new `external-url` event (`onExternalUrl`).
  - The app opens New Download pre-filled and starts resolving.
- Has its own README in `extension/README.md` with install + troubleshooting steps.

## 3. Details & speed view

New per-download analytics dialog.

- Click "Details & speed" on a download to see live speed, average/peak, ETA, retries, and a speed-over-time graph (`SpeedGraph.tsx`).
- Per-connection progress bars via a new `dl:segments` IPC channel (`DownloadSegmentsInfo` in `global.d.ts` / `preload.ts`).
- Shows server host / IP and a rough location (country + city, looked up once per IP and cached).
- Speed history is tracked with `useSpeedHistory` + `speedHistoryStore`, so the graph has something to draw even after switching views.

## 4. Engine fixes (you'll feel these more than see them)

`electron/downloader.ts` + `electron/main.ts`:

- Speed limit is now actually global. Before it was roughly per-chunk; now all connections and all concurrent downloads share one token bucket, so the total stays near what you set. You can also change it live without restarting downloads (`setSpeedLimitBps`).
- Speed readings are smoothed (`smoothSpeedBps`) — fast up, slow down — so the number and ETA don't jump around every 100ms.
- UA string bumped to `Jetro/1.0.0`.

## 5. Settings & small UX stuff

- New "Reset app…" in Settings → Danger zone (`app:reset-all`). Stops everything and clears list / queues / settings / speed history. Files on disk are kept.
- New `app:get-version` — version shown in the app comes from `package.json` instead of the Electron version, which was wrong before.
- Video detect failures now tell you when it looks like a proxy/VPN issue (`proxyHint`), with a shortcut to proxy settings.
- Download list now shows real Windows file icons (`OsFileIcon`, cached by extension) with a simple category icon fallback (`CategoryIcon`).

## 6. Codebase reorganization (dev-only, no behavior change)

- Old `src/App.tsx` (~193 KB) and `src/index.css` (~37 KB) were split up:
  - `src/components/` (analytics, speed graph, file icons)
  - `src/hooks/`, `src/lib/` (format, url, batch, schedule, theme, view prefs, …)
  - `src/styles/` (one file per area, imported from `index.css`)
  - `src/api/jetro.ts`, `src/types.ts`
- Added `@/` import alias (`vite.config.ts` + `tsconfig.json`).
- `index.html` now also restores language/dir before paint, same as it already did for theme.

## What didn't change

- Core feature set is the same: segmented engine (1–32 connections), batch `*` downloads, video/audio via yt-dlp + ffmpeg, queues + scheduler + power actions, tray, auto-update check, proxy modes.
- Build / scripts / portable exe output are the same. Old README feature tables still apply.
- `preview.png` is unchanged.
