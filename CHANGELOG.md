# Changelog

All notable changes to Jetro are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-14

First stable release. Portable Windows app (`Jetro 1.0.0.exe`, no install)
with bundled `yt-dlp` + `ffmpeg`/`ffprobe` + `quickjs` — no separate setup.

### Downloading

- Segmented multi-connection engine (1–32 parallel `Range` connections per file)
- Global speed-limit presets + per-download connection choice
- Auto-retry for failed downloads with exponential backoff
- Batch downloads: up to 200 parts via `*` pattern with live preview and resolving

### Video & audio

- Bundled `yt-dlp` + `ffmpeg` with `quickjs` for player challenges
- Quality detection, mp4 picker (144p–8K), best-audio picker, English subtitles
- Playlists (first 50 shown, each selection becomes its own download)
- Cookie login via pasted `cookies.txt` or file from disk

### Queues & scheduler

- Download queues with shared concurrency limit
- Per-queue 24-hour time windows (overnight supported) with run-on-schedule mode
- Power action when a queue finishes (Sleep / Hibernate / Shutdown / Restart)
  with 60-second countdown

### Appearance, language & system

- Full English / فارسی UI with RTL layout and bundled Iranyekan font
- Light / Dark / System appearance with header toggle
- System tray (ask / minimize / exit), single instance, update check
- Per-download details: live/average/peak speed, speed graph, per-connection
  progress, server host/IP + location

### Browser extension (new)

- Jetro Resolver (Chromium MV3 + Firefox compat) in `extension/` —
  see [`extension/README.md`](extension/README.md)
- Right-click → Download with Jetro, direct file-link interception,
  download capture, toolbar popup, `jetro://add?url=…` handoff

### Network & privacy

- Proxy modes (direct / system / custom) with HTTP/HTTPS/SOCKS4/SOCKS5,
  auth, and bypass list

## Earlier releases

- `v0.2.0` / `v0.1.0` — pre-release development builds.

[1.0.0]: https://github.com/Erkalin/Jetro/releases/tag/v1.0.0
