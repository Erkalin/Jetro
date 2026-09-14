import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiActivity, FiArchive, FiArrowDown, FiBox, FiCheckCircle, FiChevronDown, FiClipboard,
  FiClock, FiDisc, FiDownloadCloud, FiEdit2, FiExternalLink, FiFileText, FiFilm,
  FiFolder, FiGlobe, FiGrid, FiHardDrive, FiInbox, FiInfo, FiLayers, FiList, FiMonitor, FiMoon, FiMusic, FiPause, FiPlay,
  FiPlus, FiRefreshCw, FiRotateCcw, FiSettings, FiSquare, FiSun, FiTool, FiTrash2, FiX, FiXCircle, FiZap,
} from 'react-icons/fi';
import { MdExtension } from 'react-icons/md';

import jetroLogo from './assets/Jetro-notext.png';
import type { BatchMode, DetailColId, Item, Queue, QueuePowerAction, ThemeChoice, ViewMode } from '@/types';
import {
  fmtBytes,
  fmtDetailSize,
  fmtDetailStatus,
  fmtEta,
  fmtLastTry,
  fmtLastTryTitle,
  fmtSize,
  fmtSpeed,
  formatEtaSec,
  itemPct,
  lastTryOf,
  speedLimitLabel,
  statusColor,
  statusLabel,
} from '@/lib/format';
import {
  normalizeQueuePowerAction,
  normalizeTime24h,
  queuePowerOptions,
  QUEUE_SCHED_DEFAULT_START,
  QUEUE_SCHED_DEFAULT_STOP,
  queuePowerLabel,
  stripGlobalScheduler,
} from '@/lib/schedule';
import { CONNECTION_OPTIONS, normalizeConnectionOption, speedLimitOptions } from '@/lib/options';
import { normalizeTheme, readInitialTheme, resolveTheme, THEME_KEY } from '@/lib/theme';
import { LANG_KEY, useLanguage } from '@/locale/LanguageContext';
import { SPEED_HISTORY_KEY } from '@/lib/speedHistoryStore';
import {
  DETAIL_COLS_DEFAULT,
  DETAIL_LAYOUT_KEY,
  DETAIL_MIN_WIDTH,
  DETAIL_WIDTHS_DEFAULT,
  readDetailLayout,
  readViewMode,
  VIEW_MODE_KEY,
} from '@/lib/viewPrefs';
import {
  COOKIE_EXPORTER_URL,
  extOf,
  FILENAME_FALLBACK,
  guessNameFromUrl,
  isVideoPageUrl,
  normalizeDownloadUrl,
  sanitizeVideoFilename,
  SUPPORTED_SITES_URL,
} from '@/lib/url';
import {
  stepLetter,
  validateBatchInput,
} from '@/lib/batch';
import { menuAnchor } from '@/lib/contextMenu';
import { hasBackend, openExternalUrl } from '@/api/jetro';
import OsFileIcon from '@/components/OsFileIcon';
import DownloadAnalytics from '@/components/DownloadAnalytics';
import useEscape from '@/hooks/useEscape';
import useContextMenuNudge from '@/hooks/useContextMenuNudge';
import useSpeedHistory from '@/hooks/useSpeedHistory';

export default function App() {
  const { t, lang, setLang, isRTL } = useLanguage();
  const localeName = lang === 'fa' ? 'fa-IR-u-ca-persian' : undefined;
  const [items, setItems] = useState<Item[]>([]);
  // Session speed history for the analytics view (avg / peak / graph).
  const getSpeedStats = useSpeedHistory(items);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // Downloads list viewing mode + explorer-like details column layout (persisted).
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode());
  const [detailLayout, setDetailLayout] = useState(() => readDetailLayout());
  const detailOrder = detailLayout.order;
  const detailWidths = detailLayout.widths;
  const dragColRef = useRef<DetailColId | null>(null);
  const [dropCol, setDropCol] = useState<DetailColId | null>(null);
  // Physical drop side on the hovered header (for the insertion indicator).
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null);
  // Logical "insert after target" for the pending drop (derived from the
  // pointer side + layout direction on dragover). Ref so onDrop reads fresh.
  const dropAfterRef = useRef(false);
  const dropSideRef = useRef<'left' | 'right' | null>(null);
  const resizeRef = useRef<{ col: DetailColId; startX: number; startW: number } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // When Settings is opened from the New Download proxy guidance, scroll to
  // and briefly highlight the Proxy section so the user lands in the right place.
  const [settingsFocusProxy, setSettingsFocusProxy] = useState(false);
  const [proxyHighlight, setProxyHighlight] = useState(false);
  const proxySectionRef = useRef<HTMLDivElement | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [filenameError, setFilenameError] = useState('');
  // Authoritative file name detected for the current link (via backend probe).
  const [probedFilename, setProbedFilename] = useState('');
  const [probedOk, setProbedOk] = useState(false);
  // Set when the user's file name changes the format vs. the detected one.
  const [pendingFormatConfirm, setPendingFormatConfirm] = useState<null | {
    url: string; finalName: string; detectedName: string; detExt: string; finalExt: string;
  }>(null);
  // True once the user manually edits the file name box (stops auto-fill).
  const filenameTouchedRef = useRef(false);
  // Mirror of showSettings for the tray-settings subscription (mounted once).
  const showSettingsRef = useRef(false);
  // Refs for the clipboard listener (registered once) + fill-on-open logic.
  const showAddRef = useRef(false);
  const newUrlRef = useRef('');
  const settingsRef = useRef<any>(null);
  const pendingClipboardRef = useRef('');
  // Browser-extension handoff (jetro://): open New Download + auto-resolve once
  // per arrival. Direct files resolve via the existing debounced probe effect;
  // video pages auto-run detectVideo() (yt-dlp) below.
  const externalAutoRef = useRef<{ url: string; nonce: number } | null>(null);
  const detectVideoRef = useRef<(() => Promise<void>) | null>(null);
  const [newConns, setNewConns] = useState(8);
  const [savePath, setSavePath] = useState('');
  const [newQueueId, setNewQueueId] = useState('');
  const [adding, setAdding] = useState(false);
  // ---------- New Batch Download ----------
  const [showBatch, setShowBatch] = useState(false);
  const [batchUrl, setBatchUrl] = useState('');
  const [batchError, setBatchError] = useState('');
  const [batchMode, setBatchMode] = useState<BatchMode>('numbers');
  const [batchFromNum, setBatchFromNum] = useState('0');
  const [batchToNum, setBatchToNum] = useState('10');
  const [batchWildcard, setBatchWildcard] = useState('1');
  const [batchFromLetter, setBatchFromLetter] = useState('a');
  const [batchToLetter, setBatchToLetter] = useState('z');
  const [batchSavePath, setBatchSavePath] = useState('');
  const [batchConns, setBatchConns] = useState(8);
  const [batchStep, setBatchStep] = useState<1 | 2>(1);
  const [batchUrls, setBatchUrls] = useState<string[]>([]);
  const [batchRows, setBatchRows] = useState<BatchResolveRow[]>([]);
  const [batchResolving, setBatchResolving] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  // Video + audio (yt-dlp + ffmpeg, no quality cap): detected options for a page URL.
  // Progressive video entries carry a direct URL (segmented engine); split video
  // entries and all audio entries are downloaded by yt-dlp (needsMerge).
  const [videoFormats, setVideoFormats] = useState<VideoFormat[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoHint, setVideoHint] = useState('');
  const [videoDetail, setVideoDetail] = useState('');
  // True when the last probe failure is proxy-relevant (network/unreachable or
  // unknown error) — the UI then points at Settings > Proxy.
  const [videoProxyHint, setVideoProxyHint] = useState(false);
  // Raw error log is hidden behind a "Show details" toggle (not pasted inline).
  const [showVideoDetail, setShowVideoDetail] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const [selectedVideoHeight, setSelectedVideoHeight] = useState(0);
  const [selectedVideoNeedsMerge, setSelectedVideoNeedsMerge] = useState(false);
  const [selectedVideoKind, setSelectedVideoKind] = useState<'video' | 'audio' | ''>('');
  const [selectedVideoExt, setSelectedVideoExt] = useState('');
  const [selectedVideoEstimatedBytes, setSelectedVideoEstimatedBytes] = useState(0);
  const [videoSubtitles, setVideoSubtitles] = useState(false);
  const [videoQueueId, setVideoQueueId] = useState('');
  const [playlist, setPlaylist] = useState<{ title: string; count: number; entries: PlaylistEntry[] } | null>(null);
  const [playlistSelected, setPlaylistSelected] = useState<Set<string>>(new Set());
  const [playlistAdding, setPlaylistAdding] = useState(false);
  // Manual cookies.txt (shown only after yt-dlp reports a login/cookie error).
  // Auto-resolve first: probe/download try without cookies; paste or pick a file to retry.
  const [cookiesText, setCookiesText] = useState('');
  const [cookiesFile, setCookiesFile] = useState('');
  const [needsCookies, setNeedsCookies] = useState(false);
  const [cookieError, setCookieError] = useState('');
  const [binStatus, setBinStatus] = useState<BinaryStatus | null>(null);
  const [binRefreshing, setBinRefreshing] = useState(false);
  const [settings, setSettings] = useState<any>({ maxConnections: 8, maxConcurrentDownloads: 3, downloadDir: '', speedLimitKBps: 0, proxyMode: 'system', proxyType: 'http', proxyHost: '', proxyPort: 8080, proxyUser: '', proxyPass: '', proxyBypass: 'localhost,127.0.0.1,::1', closeAction: 'ask', theme: 'system', autoCaptureClipboard: true, autoRetryEnabled: true, maxRetries: 3, retryDelaySec: 5, checkUpdatesOnStart: true });
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string; updateAvailable: boolean; url: string; error?: string } | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [appVersion, setAppVersion] = useState('1.0.0');
  // Per-session dismissal for the update banner (reset when a newer tag appears).
  const [updateDismissed, setUpdateDismissed] = useState<string | null>(null);
  const showUpdateBanner = !!updateInfo?.updateAvailable && updateDismissed !== updateInfo.latest;

  // ---- dark mode (glass-blended): light / dark / system ----
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => readInitialTheme());
  const resolvedTheme = useMemo(() => resolveTheme(themeChoice), [themeChoice]);
  // Apply to <html data-theme> + persist locally (instant, no FOUC on next launch via index.html bootstrap).
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', resolvedTheme);
      localStorage.setItem(THEME_KEY, themeChoice);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolvedTheme === 'dark' ? '#080f20' : '#f2f7fd');
      else {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = resolvedTheme === 'dark' ? '#080f20' : '#f2f7fd';
        document.head.appendChild(m);
      }
    } catch {}
  }, [resolvedTheme, themeChoice]);
  // Follow the OS while in "system" mode.
  useEffect(() => {
    if (themeChoice !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      try {
        document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
      } catch {}
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themeChoice]);
  const applyThemeChoice = (next: ThemeChoice) => {
    const clean = normalizeTheme(next);
    setThemeChoice(clean);
    try { localStorage.setItem(THEME_KEY, clean); } catch {}
    // Keep backend settings in sync so the choice survives reinstalls/profiles
    // and the native window can match. Fire-and-forget for the topbar toggle.
    setSettings((prev: any) => ({ ...prev, theme: clean }));
    setDraftSettings((prev: any) => (prev ? { ...prev, theme: clean } : prev));
    try { window.jetro?.saveSettings({ theme: clean })?.catch(() => {}); } catch {}
  };
  const toggleTheme = () => applyThemeChoice(resolvedTheme === 'dark' ? 'light' : 'dark');

  // Persist viewing mode + details column layout (order + widths).
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);
  useEffect(() => {
    try { localStorage.setItem(DETAIL_LAYOUT_KEY, JSON.stringify(detailLayout)); } catch {}
  }, [detailLayout]);
  const setViewModeAndPersist = (m: ViewMode) => setViewMode(m);
  const moveDetailCol = (from: DetailColId, to: DetailColId, after = false) => {
    if (from === to) return;
    setDetailLayout((prev) => {
      const order = [...prev.order];
      const fi = order.indexOf(from);
      let ti = order.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      order.splice(fi, 1);
      // Removing an earlier item shifts the target down one slot.
      if (fi < ti) ti -= 1;
      order.splice(after ? ti + 1 : ti, 0, from);
      return { ...prev, order };
    });
  };
  const clearColDrop = () => {
    dragColRef.current = null;
    dropAfterRef.current = false;
    dropSideRef.current = null;
    setDropCol(null);
    setDropSide(null);
  };
  const beginColResize = (e: React.MouseEvent, col: DetailColId) => {
    e.preventDefault();
    e.stopPropagation();
    // Disable header dragging while resizing so the two gestures never fight.
    clearColDrop();
    const startX = e.clientX;
    const startW = detailWidths[col] ?? DETAIL_WIDTHS_DEFAULT[col];
    resizeRef.current = { col, startX, startW };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      // The handle sits on the inline-end edge (right in LTR, left in RTL),
      // so in RTL dragging left widens: flip the pointer delta.
      const dx = ev.clientX - r.startX;
      const next = Math.min(600, Math.max(DETAIL_MIN_WIDTH[r.col], Math.round(r.startW + (isRTL ? -dx : dx))));
      setDetailLayout((prev) => (prev.widths[r.col] === next ? prev : { ...prev, widths: { ...prev.widths, [r.col]: next } }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const detailGridTemplate = useMemo(
    () => `${detailOrder.map((c) => `${detailWidths[c] ?? DETAIL_WIDTHS_DEFAULT[c]}px`).join(' ')} 96px`,
    [detailOrder, detailWidths],
  );

  // settings draft + unsaved-changes guard (draft is edited, `settings` stays saved until Save)
  const [draftSettings, setDraftSettings] = useState<any | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Full app reset (danger zone at the end of Settings + confirm dialog).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  // queue context menu + modals
  const [ctx, setCtx] = useState<{ x: number; y: number; queueId: string | null } | null>(null);
  // download item right-click menu
  const [itemCtx, setItemCtx] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const ctxMenuRef = useContextMenuNudge(ctx);
  // Re-nudge when the queue count changes: the item menu lists queues
  // (move-to-queue), so its height depends on it.
  const itemMenuRef = useContextMenuNudge(itemCtx, [queues.length]);
  const [renameState, setRenameState] = useState<{ id: string; name: string; error: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [propsId, setPropsId] = useState<string | null>(null);
  // Per-download analytics modal (opened by double-click).
  const [analyticsId, setAnalyticsId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [pendingQueueMove, setPendingQueueMove] = useState<string | null>(null);
  // Where a newly created queue should land when opened from a dropdown
  // ("+ New queue…" inside New Download / video section). Null = default
  // behavior (sidebar: jump filter there; item rows use pendingQueueMove).
  const [queueCreateReturn, setQueueCreateReturn] = useState<null | 'newDownload' | 'video'>(null);
  const [showQueueModal, setShowQueueModal] = useState<null | { mode: 'create' | 'edit'; queueId?: string }>(null);
  const [qName, setQName] = useState('');
  const [qNameError, setQNameError] = useState('');
  const [qSchedOn, setQSchedOn] = useState(false);
  const [qStart, setQStart] = useState(QUEUE_SCHED_DEFAULT_START);
  const [qStop, setQStop] = useState(QUEUE_SCHED_DEFAULT_STOP);
  const [qSchedError, setQSchedError] = useState('');
  const [qPower, setQPower] = useState<QueuePowerAction>('nothing');
  // Per-queue power countdown (60s, cancellable) after a queue fully completes.
  const [powerDialog, setPowerDialog] = useState<{ queueId: string; queueName: string; action: QueuePowerAction; secondsLeft: number } | null>(null);

  // toolbar selection + queue dropdowns
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueMenu, setQueueMenu] = useState<null | 'start' | 'stop'>(null);

  // remove / delete confirmation ({ id, deleteFile }: deleteFile removes the file from disk)
  const [pendingRemove, setPendingRemove] = useState<{ id: string; deleteFile: boolean } | null>(null);

  // file-exists collision: target file already on disk, ask replace / rename / cancel
  const [pendingCollision, setPendingCollision] = useState<null | {
    kind: 'file' | 'video'; url: string; filename: string; dir: string; queueId: string; height: number; videoKind?: 'video' | 'audio'; estimatedBytes?: number;
  }>(null);

  // X-button close prompt (styled in-app dialog; main process asked via IPC).
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [closeRemember, setCloseRemember] = useState(false);

  // download-complete popup queue (shows newest completions one at a time)
  const [completedQueue, setCompletedQueue] = useState<Item[]>([]);
  const seenCompletedRef = useRef<Set<string>>(new Set());
  // Becomes true once the initial download list has been seeded into
  // seenCompletedRef, so pre-existing completions never trigger a popup.
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (!hasBackend()) {
      initialLoadDoneRef.current = true;
      return;
    }
    const seedSeen = (list: Item[]) => {
      list.forEach((i) => {
        if (i.status === 'completed') seenCompletedRef.current.add(i.id);
      });
    };
    window.jetro!.list().then((initial) => {
      seedSeen(initial);
      initialLoadDoneRef.current = true;
      setItems(initial);
    }).catch(() => {
      initialLoadDoneRef.current = true;
    });
    window.jetro!.getSettings().then((s) => {
      setSettings(stripGlobalScheduler(s));
      // Backend wins on first load when it has an explicit theme;
      // otherwise keep the localStorage / OS choice already applied.
      const t = (s as any)?.theme;
      if (t === 'light' || t === 'dark' || t === 'system') {
        setThemeChoice(t);
        try { localStorage.setItem(THEME_KEY, t); } catch {}
      }
      // Update check on startup (default ON).
      if ((s as any)?.checkUpdatesOnStart !== false) {
        setUpdateChecking(true);
        window.jetro!.checkUpdate?.().then((r) => {
          if (r) setUpdateInfo(r);
        }).catch(() => {}).finally(() => setUpdateChecking(false));
      }
    }).catch(() => {});
    window.jetro!.listQueues().then(setQueues).catch(() => {});
    window.jetro!.getVersion?.().then((v) => {
      if (v) setAppVersion(String(v).replace(/^v/i, ''));
    }).catch(() => {});
    const off1 = window.jetro!.onUpdate((incoming) => {
      if (!initialLoadDoneRef.current) {
        // First live payload arrived before list() resolved — its completed
        // items are pre-existing, so seed them instead of popping up.
        seedSeen(incoming);
        initialLoadDoneRef.current = true;
      }
      setItems(incoming);
    });
    const off2 = window.jetro!.onQueues(setQueues);
    const off3 = window.jetro!.onClipboardUrl?.((url) => {
      // Autofill only when the New Download dialog is already open — never auto-open.
      // Buffer the latest push so opening the dialog later can still use it as fallback.
      pendingClipboardRef.current = url;
      if (!showAddRef.current) return;
      if (settingsRef.current && settingsRef.current.autoCaptureClipboard === false) return;
      if (newUrlRef.current.trim()) return; // don't clobber what the user is editing
      setNewUrl(url);
      setUrlError('');
      filenameTouchedRef.current = false;
    });
    // Tray menu can change settings (close button) — stay in sync.
    const off4 = window.jetro!.onSettingsChanged?.((s) => {
      const clean = stripGlobalScheduler(s);
      setSettings(clean);
      setDraftSettings((prev: any) => (showSettingsRef.current && prev ? stripGlobalScheduler({ ...prev, ...clean }) : prev));
      const t = (s as any)?.theme;
      if (t === 'light' || t === 'dark' || t === 'system') setThemeChoice(t);
    });
    // Main process X-button request — show the styled close dialog.
    const off5 = window.jetro!.onCloseRequest?.(() => {
      setCloseRemember(false);
      setShowClosePrompt(true);
    });
    // Per-queue power action fired (all items completed) — 60s countdown.
    const off6 = window.jetro!.onQueuePower?.((info) => {
      const action = normalizeQueuePowerAction((info as any)?.action);
      if (action === 'nothing') return;
      setPowerDialog({
        queueId: String((info as any)?.queueId || ''),
        queueName: String((info as any)?.queueName || 'Queue'),
        action,
        secondsLeft: 60,
      });
    });
    // Browser extension (jetro://add?url=..): focus already handled main-side.
    // Open New Download pre-filled; auto-resolve runs in the effect below once
    // newUrl state has flushed. Explicit user intent — always replaces.
    const off7 = window.jetro!.onExternalUrl?.((info) => {
      const url = String((info as any)?.url || '').trim();
      if (!url || url.length > 2048 || /\s/.test(url)) return;
      pendingClipboardRef.current = url;
      filenameTouchedRef.current = false;
      setUrlError('');
      try {
        setSavePath(settingsRef.current?.downloadDir || '');
      } catch {}
      setNewQueueId('');
      setShowAdd(true);
      setNewUrl(url);
      externalAutoRef.current = { url, nonce: Date.now() + Math.random() };
    });
    return () => {
      off1();
      off2();
      off3?.();
      off4?.();
      off5?.();
      off6?.();
      off7?.();
    };
  }, []);
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);
  useEffect(() => {
    showAddRef.current = showAdd;
  }, [showAdd]);
  useEffect(() => {
    newUrlRef.current = newUrl;
  }, [newUrl]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEscape(!!ctx, () => setCtx(null));
  useEscape(!!(itemCtx || renameState || propsId || analyticsId), () => {
    if (renameState || propsId || analyticsId) return; // modals handle their own Escape
    setItemCtx(null);
  });
  // Close the item menu if its download disappears.
  useEffect(() => {
    if (!itemCtx) return;
    if (!items.some((i) => i.id === itemCtx.itemId)) setItemCtx(null);
  }, [items, itemCtx]);

  // Detect newly completed downloads and queue a popup.
  // Downloads already completed before this session was loaded are seeded
  // into seenCompletedRef above, so only fresh completions pop up.
  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    const newly = items.filter((i) => i.status === 'completed' && !seenCompletedRef.current.has(i.id));
    if (newly.length) {
      newly.forEach((i) => seenCompletedRef.current.add(i.id));
      setCompletedQueue((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        return [...prev, ...newly.filter((n) => !prevIds.has(n.id))];
      });
    }
    // prune ids for removed items
    if (seenCompletedRef.current.size > 500) {
      const alive = new Set(items.map((i) => i.id));
      seenCompletedRef.current.forEach((id) => {
        if (!alive.has(id)) seenCompletedRef.current.delete(id);
      });
    }
  }, [items]);

  // 60s countdown for per-queue power actions; fires once at zero.
  useEffect(() => {
    if (!powerDialog) return;
    if (powerDialog.secondsLeft <= 0) {
      const qid = powerDialog.queueId;
      setPowerDialog(null);
      try { window.jetro?.powerExecute?.(qid)?.catch(() => {}); } catch {}
      return;
    }
    const t = setTimeout(() => {
      setPowerDialog((prev) => (prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : prev));
    }, 1000);
    return () => clearTimeout(t);
  }, [powerDialog]);

  // Escape dismisses the complete popup
  useEscape(completedQueue.length > 0, () => setCompletedQueue((prev) => prev.slice(1)));

  const queueMap = useMemo(() => new Map(queues.map((q) => [q.id, q])), [queues]);
  const queueById = (id: string | null | undefined) => (id ? queueMap.get(id) : undefined);

  // Details sorting (header click toggles). Null = list order.
  const [sort, setSort] = useState<{ col: DetailColId | 'eta'; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const isQueue = filter.startsWith('queue:');
    const qid = isQueue ? filter.slice(6) : '';
    const list = items.filter((i) => {
      if (isQueue) {
        if ((i.queueId || null) !== qid) return false;
      } else {
        // Status filters
        if (filter === 'downloading' && i.status !== 'downloading') return false;
        if (filter === 'completed' && i.status !== 'completed') return false;
        if (filter === 'failed' && i.status !== 'error') return false;
        if (filter === 'paused' && i.status !== 'paused') return false;
        if (filter === 'queued' && i.status !== 'queued') return false;
        // Category filters
        if (filter === 'cat-video' && i.category !== 'video') return false;
        if (filter === 'cat-documents' && i.category !== 'document') return false;
        if (filter === 'cat-archives' && i.category !== 'compressed') return false;
        if (filter === 'cat-software' && i.category !== 'program') return false;
        if (filter === 'cat-others' && !(i.category === 'other' || i.category === 'audio')) return false;
      }
      if (q && !(i.filename + i.url).toLowerCase().includes(q)) return false;
      return true;
    });
    if (!sort) return list;
    const dir = sort.dir;
    const etaOf = (it: Item): number => {
      if (it.status === 'completed') return 0;
      // Prefer the stabilized long-window ETA; fall back to instantaneous.
      const stable = getSpeedStats(it.id).etaSec;
      if (stable != null && Number.isFinite(stable)) return Math.max(0, stable);
      const sp = Number(it.speedBps || 0);
      if (sp <= 0 || !it.totalBytes) return Number.POSITIVE_INFINITY;
      return Math.max(0, (it.totalBytes - it.downloadedBytes) / sp);
    };
    const val = (it: Item): number | string => {
      switch (sort.col) {
        case 'name': return (it.filename || '').toLowerCase();
        case 'queue': return (queueById(it.queueId)?.name || '').toLowerCase();
        case 'status': return itemPct(it);
        case 'size': return Number(it.totalBytes || it.downloadedBytes || 0);
        case 'speed': return Number(it.speedBps || 0);
        case 'lastTry': return lastTryOf(it);
        case 'eta': return etaOf(it);
        default: return 0;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
  }, [items, filter, query, sort, queues]);

  // Single-select: click selects one download, clicking it again deselects.
  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const totalSpeed = useMemo(
    () => items.reduce((a, b) => a + ((b.status === 'downloading' || b.status === 'merging') ? b.speedBps || 0 : 0), 0),
    [items]
  );
  const countMap = useMemo(() => {
    const m: Record<string, number> = {
      all: items.length,
      downloading: 0, completed: 0, failed: 0, paused: 0, queued: 0,
      'cat-video': 0, 'cat-documents': 0, 'cat-archives': 0, 'cat-software': 0, 'cat-others': 0,
    };
    const perQueue = new Map<string, number>();
    for (const i of items) {
      if (i.status === 'downloading' || i.status === 'merging') m.downloading++;
      else if (i.status === 'completed') m.completed++;
      else if (i.status === 'error') m.failed++;
      else if (i.status === 'paused') m.paused++;
      else if (i.status === 'queued') m.queued++;
      if (i.category === 'video') m['cat-video']++;
      else if (i.category === 'document') m['cat-documents']++;
      else if (i.category === 'compressed') m['cat-archives']++;
      else if (i.category === 'program') m['cat-software']++;
      else m['cat-others']++;
      const qk = `queue:${i.queueId || null}`;
      perQueue.set(qk, (perQueue.get(qk) || 0) + 1);
    }
    return { m, perQueue };
  }, [items]);
  const counts = (k: string) => {
    if (k in countMap.m) return countMap.m[k];
    if (k.startsWith('queue:')) {
      const qid = k.slice(6);
      // items with null queue are stored under "queue:null" but never queried as such
      if (!qid || qid === 'null') return items.filter((i) => !(i.queueId || null)).length;
      return countMap.perQueue.get(k) || 0;
    }
    return 0;
  };

  const chooseSaveFolder = async () => {
    if (!hasBackend()) return null;
    const picked = await window.jetro!.pickFolder(savePath || settings.downloadDir);
    if (picked) setSavePath(picked);
    return picked;
  };

  // ---------- New Batch Download logic ----------
  const batchValidation = useMemo(
    () => validateBatchInput(batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter, t.batchError),
    [batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter, t],
  );
  const batchPreviewUrls = useMemo(() => batchValidation.urls || [], [batchValidation]);
  const batchFirst = batchPreviewUrls[0] || '';
  const batchSecond = batchPreviewUrls[1] || batchPreviewUrls[0] || '';
  const batchLast = batchPreviewUrls.length ? batchPreviewUrls[batchPreviewUrls.length - 1] : '';
  const batchOkCount = useMemo(() => batchRows.filter((r) => r.ok).length, [batchRows]);
  const batchFailCount = useMemo(() => batchRows.filter((r) => !r.ok).length, [batchRows]);

  const openBatch = () => {
    setBatchUrl('');
    setBatchError('');
    setBatchMode('numbers');
    setBatchFromNum('0');
    setBatchToNum('10');
    setBatchWildcard('1');
    setBatchFromLetter('a');
    setBatchToLetter('z');
    setBatchSavePath(settings.downloadDir || '');
    setBatchConns(Math.min(32, Math.max(1, Number(settings.maxConnections) || 8)));
    setBatchStep(1);
    setBatchUrls([]);
    setBatchRows([]);
    setBatchResolving(false);
    setBatchAdding(false);
    setShowBatch(true);
  };

  const closeBatch = () => {
    if (batchResolving || batchAdding) return;
    setShowBatch(false);
    setBatchStep(1);
    setBatchError('');
    setBatchUrls([]);
    setBatchRows([]);
  };

  const runBatchResolve = async (urls: string[]) => {
    setBatchRows([]);
    if (!urls.length) return;
    setBatchResolving(true);
    try {
      if (hasBackend() && typeof (window.jetro as any)?.resolveBatch === 'function') {
        const rows = await (window.jetro as any).resolveBatch(urls);
        setBatchRows(Array.isArray(rows) ? rows : []);
      } else {
        // Web preview fallback: no probe, show URLs as pending rows.
        setBatchRows(
          urls.map((u) => ({
            url: u, ok: true, filename: guessNameFromUrl(u),
            totalBytes: 0, supportsRange: false, contentType: '',
          })),
        );
      }
    } catch (e: any) {
      setBatchError(e?.message || t.batch.couldNotResolve);
    } finally {
      setBatchResolving(false);
    }
  };

  const handleBatchOk = async () => {
    const v = validateBatchInput(batchUrl, batchMode, batchFromNum, batchToNum, batchWildcard, batchFromLetter, batchToLetter, t.batchError);
    if (v.error || !v.urls || !v.urls.length) {
      setBatchError(v.error || t.batch.nothingToAdd);
      return;
    }
    setBatchError('');
    setBatchUrls(v.urls);
    setBatchStep(2);
    await runBatchResolve(v.urls);
  };

  const handleBatchDownload = async () => {
    const valid = batchRows.filter((r) => r.ok).map((r) => r.url);
    const toAdd = valid.length ? valid : batchUrls;
    if (!toAdd.length) {
      setBatchError(t.batch.nothingToAdd);
      return;
    }
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    setBatchAdding(true);
    setBatchError('');
    try {
      const folder = (batchSavePath || settings.downloadDir || '').trim();
      if (typeof (window.jetro as any)?.addBatch === 'function') {
        const res = await (window.jetro as any).addBatch(toAdd, { dir: folder || undefined, connections: batchConns });
        // Jump to the new batch queue so its files aren't mixed with the rest.
        if (res?.queueId) setFilter(`queue:${res.queueId}`);
      } else {
        // Fallback for old preload: own queue, then add one by one, lowest first.
        const host = (() => {
          try { return new URL(toAdd[0]).hostname.replace(/^www\./i, ''); } catch { return ''; }
        })();
        const q = await window.jetro!.createQueue(
          host ? `Batch – ${host} (${toAdd.length} files)`.slice(0, 60) : `Batch (${toAdd.length} files)`,
        );
        for (const u of toAdd) {
          await window.jetro!.addDownload(u, {
            connections: batchConns,
            dir: folder || undefined,
            queueId: q?.id || null,
          });
        }
        if (q?.id) {
          try { await window.jetro!.startQueue(q.id); } catch {}
          setFilter(`queue:${q.id}`);
        }
      }
      setShowBatch(false);
      setBatchStep(1);
      setBatchUrls([]);
      setBatchRows([]);
    } catch (e: any) {
      setBatchError(e?.message || t.batch.couldNotAdd);
    } finally {
      setBatchAdding(false);
    }
  };

  // Best-known original file name for the link in the box (probe result wins,
  // otherwise the name guessed from the URL). '' when unknown.
  const getDetectedName = (): string => {
    if (probedOk && probedFilename) return probedFilename;
    const g = guessNameFromUrl(newUrl.trim());
    return g === FILENAME_FALLBACK ? '' : g;
  };

  // Returns the validated name, or null (after setting filenameError).
  const validateFilename = (name: string): string | null => {
    name = (name || '').trim();
    if (!name) {
      setFilenameError(t.filenameError.empty);
      return null;
    }
    if (name.length > 255) {
      setFilenameError(t.filenameError.tooLong);
      return null;
    }
    if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name)) {
      setFilenameError(t.filenameError.badChars);
      return null;
    }
    if (/[. ]$/.test(name)) {
      setFilenameError(t.filenameError.trailing);
      return null;
    }
    if (/^\.+$/.test(name)) {
      setFilenameError(t.filenameError.invalid);
      return null;
    }
    setFilenameError('');
    return name;
  };

  const resetAddDialog = () => {
    setPendingCollision(null);
    setNewUrl('');
    setUrlError('');
    setNewFilename('');
    setFilenameError('');
    setProbedFilename('');
    setProbedOk(false);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoSubtitles(false);
    setVideoQueueId('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    setVideoLoading(false);
    filenameTouchedRef.current = false;
    setCookiesText('');
    setCookiesFile('');
    setNeedsCookies(false);
    setCookieError('');
    setSavePath('');
    setNewQueueId('');
    setShowAdd(false);
  };

  const doAdd = async (u: string, finalName: string, presetSavePath?: string, presetQueueId?: string, replace = false) => {
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    setAdding(true);
    setUrlError('');
    try {
      // savePath is now a folder — the file name comes from the name box.
      const folder = (presetSavePath || savePath || settings.downloadDir || '').trim();
      const qid = presetQueueId !== undefined ? presetQueueId : newQueueId;
      await window.jetro!.addDownload(u, {
        connections: newConns,
        dir: folder || undefined,
        queueId: qid || null,
        filename: finalName,
        replace: replace || undefined,
      });
      resetAddDialog();
    } catch (e: any) {
      setUrlError(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).');
    } finally {
      setAdding(false);
    }
  };

  const startVideoDownload = async (pageUrl: string, filename: string, folder: string, height: number, kind: 'video' | 'audio' = 'video', replace = false, estimatedBytes?: number, queueId?: string) => {
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    setAdding(true);
    setUrlError('');
    try {
      await window.jetro!.downloadVideo({
        pageUrl,
        height: kind === 'audio' ? 0 : height || 0,
        kind,
        filename,
        dir: folder || undefined,
        queueId: queueId || videoQueueId || undefined,
        replace: replace || undefined,
        estimatedBytes: Math.max(0, Math.round(Number(estimatedBytes ?? selectedVideoEstimatedBytes ?? 0))) || undefined,
        subtitles: videoSubtitles || undefined,
        ...getCookieOpts(),
      });
      resetAddDialog();
    } catch (e: any) {
      const msg = String(e?.message || 'Video download failed.');
      setUrlError(msg);
      // Cookie import problems at download time keep the cookie box open.
      if (/cookie/i.test(msg)) {
        setNeedsCookies(true);
        setCookieError(msg);
      }
    } finally {
      setAdding(false);
    }
  };

  const startPlaylistDownload = async () => {
    if (!playlist || playlistSelected.size === 0) {
      setUrlError(t.newDownload.needEntry);
      return;
    }
    if (!selectedVideoKind) {
      setUrlError(t.newDownload.needEntryQuality);
      return;
    }
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    if (!cookiesReady()) return;
    setPlaylistAdding(true);
    setUrlError('');
    try {
      const folder = (savePath || settings.downloadDir || '').trim();
      const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const entries = playlist.entries.filter((en) => playlistSelected.has(String(en.url))).slice(0, 50);
      const isAudio = selectedVideoKind === 'audio';
      let added = 0;
      for (let idx = 0; idx < entries.length; idx++) {
        const en = entries[idx];
        const base = sanitizeVideoFilename(en.title || videoTitle || `video ${idx + 1}`, selectedVideoExt || (isAudio ? 'mp3' : 'mp4'));
        try {
          await window.jetro!.downloadVideo({
            pageUrl: en.url,
            height: isAudio ? 0 : selectedVideoHeight || 0,
            kind: isAudio ? 'audio' : 'video',
            filename: base,
            dir: folder || undefined,
            queueId: videoQueueId || undefined,
            batchId,
            batchIndex: idx,
            estimatedBytes: undefined,
            subtitles: videoSubtitles || undefined,
            ...getCookieOpts(),
          });
          added++;
        } catch {}
      }
      if (!added) {
        setUrlError(t.newDownload.couldNotAddPlaylist);
        return;
      }
      resetAddDialog();
    } finally {
      setPlaylistAdding(false);
    }
  };

  const findUniqueFilename = async (dir: string, name: string): Promise<string | null> => {
    const folder = (dir || settings.downloadDir || '').trim();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 100; i++) {
      const cand = `${base} (${i})${ext}`;
      try {
        const ex = await window.jetro!.fileExists(folder || undefined, cand);
        if (!ex?.exists) return cand;
      } catch {
        return cand;
      }
    }
    return null;
  };

  // Checks for an on-disk collision first; shows the replace/rename prompt
  // instead of silently overwriting. For videos url = page URL + height/kind.
  const requestAdd = async (u: string, finalName: string, presetSavePath?: string, presetQueueId?: string, extra?: { isVideo?: boolean; height?: number; videoKind?: 'video' | 'audio'; estimatedBytes?: number }) => {
    const folder = (presetSavePath || savePath || settings.downloadDir || '').trim();
    if (hasBackend() && finalName) {
      try {
        const ex = await window.jetro!.fileExists(folder || undefined, finalName);
        if (ex?.exists) {
          setPendingCollision({
            kind: extra?.isVideo ? 'video' : 'file',
            url: u,
            filename: finalName,
            dir: folder,
            queueId: presetQueueId !== undefined ? presetQueueId : newQueueId,
            height: extra?.height || 0,
            videoKind: extra?.videoKind || 'video',
            estimatedBytes: extra?.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0,
          });
          return;
        }
      } catch {}
    }
    if (extra?.isVideo) await startVideoDownload(u, finalName, folder, extra.height || 0, extra.videoKind || 'video', false, extra.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0);
    else await doAdd(u, finalName, presetSavePath, presetQueueId);
  };

  const resolveCollision = async (mode: 'replace' | 'rename') => {
    const c = pendingCollision;
    if (!c) return;
    setPendingCollision(null);
    let name = c.filename;
    if (mode === 'rename') {
      const unique = await findUniqueFilename(c.dir, c.filename);
      if (!unique) {
        setUrlError('Could not find a free file name in that folder.');
        return;
      }
      name = unique;
    }
    if (c.kind === 'video') await startVideoDownload(c.url, name, c.dir, c.height, c.videoKind || 'video', mode === 'replace', c.estimatedBytes ?? selectedVideoEstimatedBytes ?? 0);
    else await doAdd(c.url, name, c.dir || undefined, c.queueId, mode === 'replace');
  };

  const addDl = async (url?: string, presetSavePath?: string, presetQueueId?: string) => {
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    // Video/audio path: a quality was picked from probeVideo.
    // - Progressive video: direct media URL via the segmented engine (fast).
    // - Split video or any audio: page URL via yt-dlp (download+merge/extract).
    if (!url && isVideoPageUrl(newUrl)) {
      if (!selectedVideoKind && !selectedVideoHeight && !selectedVideoUrl) {
        setUrlError(t.newDownload.needQuality);
        return;
      }
      if (!cookiesReady()) return;
      const isAudio = selectedVideoKind === 'audio';
      const defaultExt = isAudio ? 'm4a' : 'mp4';
      const fallback = videoTitle ? sanitizeVideoFilename(videoTitle, extOf(newFilename) || defaultExt) : '';
      const checkedV = validateFilename((newFilename || '').trim() || fallback || (isAudio ? 'audio.m4a' : 'video.mp4'));
      if (!checkedV) return;
      if (isAudio || selectedVideoNeedsMerge || !selectedVideoUrl) {
        const folderV = (savePath || settings.downloadDir || '').trim();
        await requestAdd(newUrl.trim(), checkedV, folderV || undefined, undefined, { isVideo: true, height: selectedVideoHeight || 0, videoKind: isAudio ? 'audio' : 'video', estimatedBytes: selectedVideoEstimatedBytes || 0 });
        return;
      }
      let direct: string;
      try {
        direct = normalizeDownloadUrl(selectedVideoUrl, t.urlError);
      } catch (e: any) {
        setUrlError(e?.message || t.newDownload.linkExpired);
        return;
      }
      await requestAdd(direct, checkedV, presetSavePath, presetQueueId);
      return;
    }
    const raw = (url || newUrl).trim();
    if (!raw) {
      setUrlError(t.urlError.empty);
      return;
    }
    let u: string;
    try {
      u = normalizeDownloadUrl(raw, t.urlError);
    } catch (e: any) {
      setUrlError(e?.message || t.urlError.invalid);
      return;
    }
    if (!hasBackend()) { alert(t.common.runViaElectron); return; }
    // Make sure we know the original format before comparing: probe now if the
    // background probe hasn't answered yet (e.g. user clicked Download fast).
    // Untouched auto-fill follows the fresh probe result so a fast click on an
    // unedited name never triggers a bogus format warning.
    let wanted = (newFilename || '').trim();
    let detected = getDetectedName();
    if (!probedOk) {
      setAdding(true);
      try {
        const p = await window.jetro!.probe(u);
        if (p?.filename) {
          detected = p.filename;
          setProbedFilename(p.filename);
          setProbedOk(true);
          if (!filenameTouchedRef.current) {
            wanted = p.filename;
            setNewFilename(p.filename);
          }
        }
      } catch {}
      setAdding(false);
    }
    if (!wanted) {
      wanted = detected && detected !== FILENAME_FALLBACK ? detected : guessNameFromUrl(u);
    }
    const checked = validateFilename(wanted);
    if (!checked) return;
    const detExt = detected && detected !== FILENAME_FALLBACK ? extOf(detected) : '';
    const finalExt = extOf(checked);
    if (detExt && finalExt !== detExt) {
      // User is changing the format — ask for confirmation first.
      setPendingFormatConfirm({ url: u, finalName: checked, detectedName: detected, detExt, finalExt });
      return;
    }
    await requestAdd(u, checked, presetSavePath, presetQueueId);
  };

  const confirmFormatAnyway = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    await requestAdd(p.url, p.finalName);
  };

  const useOriginalFilename = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    setNewFilename(p.detectedName);
    setFilenameError('');
    filenameTouchedRef.current = true;
    await requestAdd(p.url, p.detectedName);
  };

  // Fresh file-name state every time the New Download dialog opens.
  useEffect(() => {
    if (!showAdd) return;
    setPendingCollision(null);
    setUrlError('');
    setFilenameError('');
    setNewFilename('');
    setProbedFilename('');
    setProbedOk(false);
    setPendingFormatConfirm(null);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setVideoLoading(false);
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoSubtitles(false);
    setVideoQueueId('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    filenameTouchedRef.current = false;
    setNeedsCookies(false);
    setCookieError('');
    setShowVideoDetail(false);
  }, [showAdd]);

  // Collapse the raw error log whenever a new resolve produces different
  // output (covers resetAddDialog, URL changes, and re-detects).
  useEffect(() => {
    setShowVideoDetail(false);
  }, [videoDetail]);

  // Autofill the address from clipboard when the New Download dialog opens.
  // Explicit paste-anywhere (see below) auto-opens the dialog; plain copies
  // never auto-open — the dialog is opened manually, then the current
  // clipboard URL (if valid) fills the address box.
  useEffect(() => {
    if (!showAdd) return;
    // Browser-extension handoff wins: onExternalUrl already put the resolved
    // link in the box — never let a slower clipboard read clobber it.
    if (externalAutoRef.current) return;
    if (settingsRef.current && settingsRef.current.autoCaptureClipboard === false) return;
    let cancelled = false;
    const isValidUrl = (t: string): boolean => {
      if (!t || t.length > 2048 || /\s/.test(t)) return false;
      try {
        normalizeDownloadUrl(t);
        return true;
      } catch {
        return false;
      }
    };
    const fill = (t: string) => {
      if (cancelled || !isValidUrl(t)) return false;
      setNewUrl(t);
      setUrlError('');
      filenameTouchedRef.current = false;
      return true;
    };
    (async () => {
      // Prefer a fresh read so a cleared/changed clipboard doesn't resurrect a stale URL.
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          const t = String(await navigator.clipboard.readText() || '').trim();
          if (!cancelled) {
            if (t) {
              fill(t);
              return;
            }
            // Clipboard readable but empty/non-URL: leave the box as-is.
            return;
          }
        } else {
          throw new Error('no clipboard api');
        }
      } catch {
        // Clipboard API blocked (permissions) — fall back to the last push from main.
        const buffered = String(pendingClipboardRef.current || '').trim();
        if (buffered) fill(buffered);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd]);

  // Pull the first valid download link out of pasted text (whole string first,
  // then whitespace-separated tokens — handles "check this out: example.com/a.zip").
  const extractPastedUrl = (text: string): string | null => {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.length <= 2048 && !/\s/.test(t)) {
      try {
        normalizeDownloadUrl(t);
        return t;
      } catch {
        // fall through to token scan
      }
    }
    const tokens = t.split(/[\s"'<>]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    for (const tok of tokens) {
      const clean = tok.replace(/^[(\[]+|[.,;:!?)\]]+$/g, '').trim();
      if (!clean || clean.length > 2048) continue;
      try {
        normalizeDownloadUrl(clean);
        return clean;
      } catch {
        // not a link — try next token
      }
    }
    return null;
  };

  // Paste-anywhere → New Download Link Address.
  // Ctrl+V / right-click Paste with a link outside of text fields opens the
  // New Download dialog (if closed) and puts the link in Link Address.
  // Pasting directly into Link Address or any other input keeps native
  // behavior so typing/searching/renaming is never hijacked.
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    };
    const isLinkAddress = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const input = el.closest('input');
      return !!input && input.getAttribute('placeholder') === 'example.com/file.zip';
    };
    const onPaste = (e: ClipboardEvent) => {
      // Direct pastes into Link Address already land there (see its onPaste cleaner).
      if (isLinkAddress(e.target)) return;
      // Never steal pastes meant for other text fields (search, file name,
      // save folder, batch link, cookies, queue names, ...).
      if (isEditable(e.target)) return;
      let raw = '';
      try {
        raw = String(e.clipboardData?.getData('text') || '');
      } catch {
        raw = '';
      }
      if (!raw.trim()) return;
      const url = extractPastedUrl(raw);
      if (!url) return;
      e.preventDefault();
      pendingClipboardRef.current = url;
      filenameTouchedRef.current = false;
      setUrlError('');
      if (!showAddRef.current) {
        try {
          setSavePath(settingsRef.current?.downloadDir || '');
        } catch {
          // keep current save path on failure
        }
        setNewQueueId('');
        setShowAdd(true);
      }
      setNewUrl(url);
    };
    window.addEventListener('paste', onPaste as EventListener);
    return () => window.removeEventListener('paste', onPaste as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear a previously picked video quality when the URL changes.
  // A new URL gets a fresh auto-resolve attempt, so hide the cookie box until
  // yt-dlp reports a login/cookie error for this URL (pasted cookies are kept).
  useEffect(() => {
    if (!showAdd) return;
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    setVideoFormats([]);
    setVideoHint('');
    setVideoDetail('');
    setVideoTitle('');
    setVideoProxyHint(false);
    setNeedsCookies(false);
    setCookieError('');
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setPlaylistAdding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newUrl]);

  const detectVideo = async () => {
    const raw = newUrl.trim();
    if (!raw || !hasBackend()) return;
    if (!cookiesReady()) return;
    setVideoLoading(true);
    setVideoHint('');
    setVideoDetail('');
    setVideoProxyHint(false);
    setCookieError('');
    setVideoFormats([]);
    setPlaylist(null);
    setPlaylistSelected(new Set());
    setSelectedVideoUrl('');
    setSelectedVideoHeight(0);
    setSelectedVideoNeedsMerge(false);
    setSelectedVideoKind('');
    setSelectedVideoExt('');
    setSelectedVideoEstimatedBytes(0);
    try {
      const r = await window.jetro!.probeVideo(raw, { ...getCookieOpts(), allowPlaylist: true });
      const fmts = Array.isArray(r?.formats) ? r.formats : [];
      const wantsCookies = !!(r as any)?.needsCookies;
      setNeedsCookies(wantsCookies);
      setCookieError(String((r as any)?.cookieError || ''));
      const pl = (r as any)?.playlist || null;
      if (pl && Array.isArray(pl.entries) && pl.entries.length > 1) {
        const entries = pl.entries.slice(0, 50);
        setPlaylist({ title: String(pl.title || ''), count: Number(pl.count || entries.length), entries });
        setPlaylistSelected(new Set(entries.map((en: any) => String(en.url))));
      }
      setVideoFormats(fmts);
      setVideoHint(String(r?.hint || ''));
      setVideoDetail(String((r as any)?.detail || ''));
      setVideoProxyHint(!!(r as any)?.proxyHint && fmts.length === 0);
      setVideoTitle(String((r as any)?.title || (pl as any)?.title || fmts[0]?.title || ''));
      if (fmts.length === 1) {
        const f = fmts[0];
        setSelectedVideoUrl(f.url || '');
        setSelectedVideoHeight(f.height || 0);
        setSelectedVideoNeedsMerge(!!f.needsMerge);
        setSelectedVideoKind(f.kind === 'audio' ? 'audio' : 'video');
        setSelectedVideoExt(String(f.ext || '').toLowerCase());
        setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
        if (!filenameTouchedRef.current) {
          const t = String((r as any)?.title || fmts[0]?.title || '');
          if (t) setNewFilename(sanitizeVideoFilename(t, f.ext));
        }
      } else if (!fmts.length && r?.hint) {
        setUrlError('');
      }
    } catch (e: any) {
      setVideoHint(t.newDownload.detectFailed);
      setVideoDetail('');
      setVideoProxyHint(true);
    } finally {
      setVideoLoading(false);
    }
  };

  // Latest detectVideo for the extension auto-resolve effect (avoids stale closure).
  detectVideoRef.current = detectVideo;

  // Extension arrival: New Download is open + newUrl has flushed → auto-resolve.
  // Video pages run yt-dlp Detect; direct files are covered by the debounced
  // probe effect below, so no extra work is needed for them here.
  useEffect(() => {
    if (!showAdd) return;
    const pending = externalAutoRef.current;
    if (!pending) return;
    if (newUrl.trim() !== pending.url.trim()) return;
    externalAutoRef.current = null;
    if (!isVideoPageUrl(pending.url)) return;
    const t = setTimeout(() => {
      try {
        detectVideoRef.current?.()?.catch(() => {});
      } catch {}
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd, newUrl]);

  // Video qualities are detected when the Detect button is clicked, plus
  // auto-detect for browser-extension arrivals (see effect above).

  // Manual login cookies (cookies.txt): only used after yt-dlp reports a login/
  // cookie error. Probe/download otherwise resolve automatically with no cookies.
  const getCookieOpts = (): { cookiesText?: string; cookiesFile?: string } => {
    const out: { cookiesText?: string; cookiesFile?: string } = {};
    const t = cookiesText.trim();
    if (t) out.cookiesText = t;
    const f = cookiesFile.trim();
    if (f) out.cookiesFile = f;
    return out;
  };

  // False (after showing an error) when the cookie box is open but empty.
  const cookiesReady = (): boolean => {
    if (needsCookies && !cookiesText.trim() && !cookiesFile.trim()) {
      setUrlError(t.newDownload.needCookies);
      return false;
    }
    return true;
  };

  // Auto-fill the file name box from the link: instant client-side guess first,
  // then the authoritative name from the backend probe (debounced). Never
  // overwrites a name the user typed themselves. Skipped for video pages —
  // the file name comes from the selected quality instead.
  useEffect(() => {
    if (!showAdd) return;
    const raw = newUrl.trim();
    if (!raw) {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    if (isVideoPageUrl(raw)) {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    if (!filenameTouchedRef.current) setNewFilename(guessNameFromUrl(raw));
    let candidate: string;
    try {
      candidate = normalizeDownloadUrl(raw);
    } catch {
      setProbedFilename('');
      setProbedOk(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!hasBackend()) return;
      try {
        const p = await window.jetro!.probe(candidate);
        if (cancelled || !p?.filename) return;
        setProbedFilename(p.filename);
        setProbedOk(true);
        if (!filenameTouchedRef.current) setNewFilename(p.filename);
      } catch {
        if (!cancelled) setProbedOk(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [newUrl, showAdd]);

  // Escape dismisses the format-confirm dialog (back to the New Download dialog).
  useEscape(!!pendingFormatConfirm, () => setPendingFormatConfirm(null));

  // Answer the main-process X-button request (styled close dialog).
  const decideClose = async (decision: 'minimize' | 'exit' | 'cancel') => {
    const remember = closeRemember;
    setShowClosePrompt(false);
    setCloseRemember(false);
    if (!hasBackend()) return;
    try {
      await window.jetro!.decideClose?.({ decision, remember });
    } catch {}
  };

  // Escape cancels the close dialog (stays open, same as Cancel).
  useEscape(showClosePrompt, () => {
    decideClose('cancel');
  });

  // ---------- queue actions (backend + web-preview fallback) ----------
  const refreshQueues = async () => {
    if (!hasBackend()) return;
    try {
      setQueues(await window.jetro!.listQueues());
    } catch {}
  };

  const handleCreateQueue = async (name: string) => {
    const clean = name.trim();
    if (!clean) {
      setQNameError(t.queueModal.nameEmpty);
      throw new Error(t.queueModal.nameEmpty);
    }
    if (hasBackend()) {
      const q = await window.jetro!.createQueue(clean);
      await refreshQueues();
      return q;
    }
    const q: Queue = {
      id: 'q' + Date.now().toString(36),
      name: clean,
      running: false,
      maxConcurrent: Math.min(10, Math.max(1, Math.round(Number(settings.maxConcurrentDownloads) || 3))),
      schedulerEnabled: false,
      scheduleStart: '22:00',
      scheduleStop: '07:00',
      createdAt: Date.now(),
      afterComplete: qPower,
      powerFiredAt: null,
    };
    setQueues((p) => [...p, q]);
    return q;
  };

  const handleStartStopQueue = async (q: Queue) => {
    if (hasBackend()) {
      if (q.running) await window.jetro!.stopQueue(q.id);
      else await window.jetro!.startQueue(q.id);
      await refreshQueues();
      return;
    }
    setQueues((p) => p.map((x) => (x.id === q.id ? { ...x, running: !x.running } : x)));
  };

  const handleDeleteQueue = async (q: Queue) => {
    if (!confirm(t.queueMenu.deleteConfirm(q.name))) return;
    if (hasBackend()) {
      await window.jetro!.deleteQueue(q.id);
      await refreshQueues();
    } else {
      setQueues((p) => p.filter((x) => x.id !== q.id));
      setItems((p) => p.map((it) => ((it.queueId || null) === q.id ? { ...it, queueId: null } : it)));
    }
    if (filter === `queue:${q.id}`) setFilter('all');
    setCtx(null);
  };

  const openCreateModal = () => {
    setQName('');
    setQNameError('');
    setQSchedOn(false);
    setQStart(QUEUE_SCHED_DEFAULT_START);
    setQStop(QUEUE_SCHED_DEFAULT_STOP);
    setQSchedError('');
    setQPower('nothing');
    setPendingQueueMove(null);
    setQueueCreateReturn(null);
    setShowQueueModal({ mode: 'create' });
    setCtx(null);
  };

  // Open the Create Queue modal from a queue dropdown ("+ New queue…").
  // returnTarget decides where the new queue id lands on save; moveItemId
  // moves an existing download into it (item rows).
  const openCreateQueueFor = (returnTarget: null | 'newDownload' | 'video', moveItemId?: string | null) => {
    setQName('');
    setQNameError('');
    setQSchedOn(false);
    setQStart(QUEUE_SCHED_DEFAULT_START);
    setQStop(QUEUE_SCHED_DEFAULT_STOP);
    setQSchedError('');
    setQPower('nothing');
    setPendingQueueMove(moveItemId || null);
    setQueueCreateReturn(returnTarget);
    setShowQueueModal({ mode: 'create' });
    setCtx(null);
    setItemCtx(null);
  };

  const openEditModal = (q: Queue) => {
    setQName(q.name);
    setQNameError('');
    setQSchedOn(!!q.schedulerEnabled);
    setQStart(normalizeTime24h(q.scheduleStart) || QUEUE_SCHED_DEFAULT_START);
    setQStop(normalizeTime24h(q.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP);
    setQSchedError('');
    setQPower(normalizeQueuePowerAction((q as any).afterComplete));
    setShowQueueModal({ mode: 'edit', queueId: q.id });
    setCtx(null);
  };

  const validateQueueSchedule = (enabled: boolean, startRaw: string, stopRaw: string): { start: string; stop: string; error: string } => {
    if (!enabled) return { start: QUEUE_SCHED_DEFAULT_START, stop: QUEUE_SCHED_DEFAULT_STOP, error: '' };
    const start = normalizeTime24h(startRaw);
    const stop = normalizeTime24h(stopRaw);
    if (!start || !stop) return { start: start || '', stop: stop || '', error: t.queueModal.scheduleError };
    return { start, stop, error: '' };
  };

  const saveQueueModal = async () => {
    const clean = qName.trim();
    if (!clean) {
      setQNameError(t.queueModal.nameEmpty);
      return;
    }
    setQNameError('');
    const sched = validateQueueSchedule(qSchedOn, qStart, qStop);
    if (sched.error) {
      setQSchedError(sched.error);
      return;
    }
    setQSchedError('');
    try {
      if (showQueueModal?.mode === 'create') {
        const q = await handleCreateQueue(clean);
        // apply extra fields if user changed them
        if (hasBackend() && q) {
          await window.jetro!.updateQueue(q.id, {
            schedulerEnabled: qSchedOn,
            scheduleStart: sched.start,
            scheduleStop: sched.stop,
            afterComplete: qPower,
          });
          await refreshQueues();
        } else if (q) {
          setQueues((p) => p.map((x) => (x.id === q.id ? { ...x, schedulerEnabled: qSchedOn, scheduleStart: sched.start, scheduleStop: sched.stop, afterComplete: qPower } : x)));
        }
        // Created from a download's right-click menu / item row dropdown: move in.
        if (q && pendingQueueMove) {
          await moveItemToQueue(pendingQueueMove, q.id);
          setPendingQueueMove(null);
          setQueueCreateReturn(null);
        } else if (q && queueCreateReturn === 'newDownload') {
          setNewQueueId(q.id);
          setQueueCreateReturn(null);
        } else if (q && queueCreateReturn === 'video') {
          setVideoQueueId(q.id);
          setQueueCreateReturn(null);
        } else if (q && !pendingQueueMove && !queueCreateReturn) {
          setFilter(`queue:${q.id}`);
        }
      } else if (showQueueModal?.mode === 'edit' && showQueueModal.queueId) {
        const id = showQueueModal.queueId;
        if (hasBackend()) {
          await window.jetro!.updateQueue(id, {
            name: clean,
            schedulerEnabled: qSchedOn,
            scheduleStart: sched.start,
            scheduleStop: sched.stop,
            afterComplete: qPower,
          });
          await refreshQueues();
        } else {
          setQueues((p) => p.map((x) => (x.id === id ? { ...x, name: clean, schedulerEnabled: qSchedOn, scheduleStart: sched.start, scheduleStop: sched.stop, afterComplete: qPower, powerFiredAt: null } : x)));
        }
      }
      setShowQueueModal(null);
    } catch (e: any) {
      const msg = e?.message || t.queueModal.couldNotSave;
      if (/HH:MM|24-hour|Start|Stop/i.test(msg)) setQSchedError(msg);
      else setQNameError(msg);
    }
  };

  const moveItemToQueue = async (itemId: string, queueId: string | null) => {
    if (hasBackend()) {
      try {
        await window.jetro!.moveToQueue(itemId, queueId);
      } catch (e: any) {
        alert(e?.message || t.itemMenu.couldNotMove);
      }
      return;
    }
    setItems((p) => p.map((it) => (it.id === itemId ? { ...it, queueId } : it)));
  };

  const openCtx = (e: React.MouseEvent, queueId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setItemCtx(null);
    // Clamp against the tallest the menu can be (scrollable), so a click near
    // the bottom edge still leaves the whole menu reachable.
    setCtx({ ...menuAnchor(e, false), queueId });
  };

  // ---------- download item right-click menu ----------
  const openItemCtx = (e: React.MouseEvent, it: Item) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(it.id);
    setCtx(null);
    setItemCtx({ ...menuAnchor(e, true), itemId: it.id });
  };

  const itemCtxItem = itemCtx ? items.find((i) => i.id === itemCtx.itemId) || null : null;

  const handleOpenItem = async (mode: 'open' | 'open-with' | 'folder') => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    try {
      if (mode === 'open') await window.jetro!.openFile(it.savePath);
      else if (mode === 'open-with') {
        const api: any = window.jetro as any;
        if (typeof api?.openWith === 'function') await api.openWith(it.savePath);
        else await window.jetro!.openFile(it.savePath);
      } else await window.jetro!.revealInFolder(it.savePath);
    } catch (e: any) {
      alert(e?.message || t.common.couldNotOpenFile);
    }
  };

  const openRenameModal = () => {
    const it = itemCtxItem;
    if (!it) return;
    setRenameState({ id: it.id, name: it.filename, error: '' });
    setItemCtx(null);
  };

  const saveRenameModal = async () => {
    if (!renameState || renaming) return;
    const name = (renameState.name || '').trim();
    if (!name) {
      setRenameState({ ...renameState, error: t.filenameError.empty });
      return;
    }
    if (name.length > 255) {
      setRenameState({ ...renameState, error: t.filenameError.tooLong });
      return;
    }
    if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name)) {
      setRenameState({ ...renameState, error: t.filenameError.badChars });
      return;
    }
    if (/[. ]$/.test(name)) {
      setRenameState({ ...renameState, error: t.filenameError.trailing });
      return;
    }
    if (/^\.+$/.test(name)) {
      setRenameState({ ...renameState, error: t.filenameError.invalid });
      return;
    }
    if (!hasBackend()) {
      setRenameState({ ...renameState, error: t.renameModal.needElectron });
      return;
    }
    setRenaming(true);
    try {
      await window.jetro!.renameDownload(renameState.id, name);
      setRenameState(null);
    } catch (e: any) {
      setRenameState({ ...renameState, error: e?.message || t.renameModal.couldNotRename });
    } finally {
      setRenaming(false);
    }
  };

  const handleRedownloadItem = async () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    try {
      await window.jetro!.redownload(it.id);
    } catch (e: any) {
      alert(e?.message || t.itemMenu.couldNotRestart);
    }
  };

  const handleRefreshItem = async () => {
    const it = itemCtxItem;
    if (!it || !hasBackend()) return;
    setRefreshingId(it.id);
    try {
      await window.jetro!.refreshDownload(it.id);
    } catch (e: any) {
      alert(e?.message || t.itemMenu.couldNotRefresh);
    } finally {
      setRefreshingId(null);
      setItemCtx(null);
    }
  };

  const handleRemoveItem = () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it) return;
    setSelectedId(it.id);
    setPendingRemove({ id: it.id, deleteFile: it.status === 'completed' });
  };

  const handleItemResumeStop = () => {
    const it = itemCtxItem;
    setItemCtx(null);
    if (!it || !hasBackend()) return;
    if (it.status === 'downloading' || it.status === 'merging' || it.status === 'queued') {
      window.jetro!.pause(it.id);
    } else if (it.status !== 'completed') {
      window.jetro!.resume(it.id);
    }
  };

  // ---------- external tools status in Settings ----------
  const refreshBinStatus = async () => {
    if (!hasBackend()) return;
    setBinRefreshing(true);
    try {
      setBinStatus(await window.jetro!.getBinaryStatus());
    } catch {}
    setBinRefreshing(false);
  };

  useEffect(() => {
    if (!showSettings || !hasBackend()) return;
    refreshBinStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // ---------- settings open / save / cancel with unsaved-changes guard ----------
  const openSettings = (opts?: { focusProxy?: boolean }) => {
    const copy = stripGlobalScheduler(JSON.parse(JSON.stringify(settings)));
    copy.theme = normalizeTheme(copy.theme);
    setDraftSettings(copy);
    setShowDiscardConfirm(false);
    setSettingsFocusProxy(!!opts?.focusProxy);
    setProxyHighlight(false);
    setShowSettings(true);
  };

  // Deep-link from New Download's proxy guidance: scroll the Proxy section
  // into view and flash a highlight so the user knows where to look.
  // The New Download dialog stays open underneath (Settings stacks on top).
  const openProxySettings = () => openSettings({ focusProxy: true });

  useEffect(() => {
    if (!showSettings || !settingsFocusProxy) return;
    setSettingsFocusProxy(false);
    setProxyHighlight(true);
    const t = setTimeout(() => {
      try {
        proxySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
    }, 60);
    const h = setTimeout(() => setProxyHighlight(false), 2400);
    return () => {
      clearTimeout(t);
      clearTimeout(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  const isSettingsDirty = useMemo(() => {
    if (!showSettings || !draftSettings) return false;
    try {
      return JSON.stringify(draftSettings) !== JSON.stringify(settings);
    } catch {
      return true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, draftSettings]);

  const attemptCloseSettings = () => {
    if (isSettingsDirty) {
      setShowDiscardConfirm(true);
    } else {
      setShowSettings(false);
      setDraftSettings(null);
    }
  };

  const saveSettingsAndClose = async () => {
    if (draftSettings) {
      const clean = stripGlobalScheduler({ ...draftSettings, theme: normalizeTheme(draftSettings.theme) });
      await window.jetro?.saveSettings(clean);
      setSettings(clean);
      setThemeChoice(clean.theme);
      try { localStorage.setItem(THEME_KEY, clean.theme); } catch {}
    }
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  const discardSettingsChanges = () => {
    // Revert the live theme preview back to the saved choice.
    const saved = normalizeTheme((settings as any)?.theme ?? themeChoice);
    setThemeChoice(saved);
    try { localStorage.setItem(THEME_KEY, saved); } catch {}
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  // Danger zone: wipe backend state (downloads, queues, settings) + local
  // UI prefs, then reload into a fresh-install state.
  const handleResetAll = async () => {
    if (resetting) return;
    setResetting(true);
    setResetError('');
    try {
      if (hasBackend()) await window.jetro!.resetAll();
      try {
        for (const k of [LANG_KEY, THEME_KEY, VIEW_MODE_KEY, DETAIL_LAYOUT_KEY, SPEED_HISTORY_KEY]) {
          localStorage.removeItem(k);
        }
      } catch {}
      window.location.reload();
    } catch (e: any) {
      setResetError(e?.message || String(e));
      setResetting(false);
    }
  };

  // Escape in Settings: dismiss reset/discard confirms first, otherwise attempt close (asks if dirty)
  useEscape(showSettings, () => {
    if (showResetConfirm) setShowResetConfirm(false);
    else if (showDiscardConfirm) setShowDiscardConfirm(false);
    else attemptCloseSettings();
  });

  const statusNav: { key: string; label: string; Icon: typeof FiInbox }[] = [
    { key: 'all', label: t.sidebar.all, Icon: FiInbox },
    { key: 'downloading', label: t.sidebar.downloading, Icon: FiArrowDown },
    { key: 'completed', label: t.sidebar.completed, Icon: FiCheckCircle },
    { key: 'failed', label: t.sidebar.failed, Icon: FiXCircle },
    { key: 'paused', label: t.sidebar.paused, Icon: FiPause },
    { key: 'queued', label: t.sidebar.queued, Icon: FiClock },
  ];

  const categoryNav: { key: string; label: string; Icon: typeof FiBox }[] = [
    { key: 'cat-video', label: t.sidebar.video, Icon: FiFilm },
    { key: 'cat-documents', label: t.sidebar.documents, Icon: FiFileText },
    { key: 'cat-archives', label: t.sidebar.archives, Icon: FiArchive },
    { key: 'cat-software', label: t.sidebar.software, Icon: FiDisc },
    { key: 'cat-others', label: t.sidebar.others, Icon: FiBox },
  ];

  const ctxQueue = ctx?.queueId ? queueById(ctx.queueId) : null;
  const completedPopup = completedQueue[0] || null;
  const dismissCompletedPopup = () => setCompletedQueue((prev) => prev.slice(1));

  // ---------- toolbar state ----------
  const selected = items.find((i) => i.id === selectedId) || null;
  const canResume = !!selected && (selected.status === 'paused' || selected.status === 'error');
  const canStop = !!selected && (selected.status === 'downloading' || selected.status === 'merging' || selected.status === 'queued');
  const canStopAll = items.some((i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'queued');

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  // remove-confirmation target (live item so progress stays fresh)
  const pendingRemoveItem = pendingRemove ? items.find((i) => i.id === pendingRemove.id) || null : null;

  // auto-dismiss the confirm dialog if the item disappears (or completes while
  // a cancel-confirm is open — a finished download needs no cancel prompt)
  useEffect(() => {
    if (!pendingRemove) return;
    const it = items.find((i) => i.id === pendingRemove.id);
    if (!it || (!pendingRemove.deleteFile && it.status === 'completed')) setPendingRemove(null);
  }, [items, pendingRemove]);

  // Escape dismisses the remove-confirm dialog
  useEscape(!!pendingRemove, () => setPendingRemove(null));

  // Escape dismisses rename / properties dialogs
  useEscape(!!(renameState || propsId), () => {
    if (renameState && !renaming) setRenameState(null);
    else if (propsId) setPropsId(null);
  });
  useEscape(!!analyticsId, () => setAnalyticsId(null));

  // Escape dismisses the file-exists dialog
  useEscape(!!pendingCollision, () => setPendingCollision(null));

  // close queue dropdown on escape
  useEscape(!!queueMenu, () => setQueueMenu(null));

  // Escape dismisses the batch dialogs (not while resolving/adding)
  useEscape(showBatch, () => closeBatch());

  const handleResumeSelected = () => {
    if (!canResume || !selected) return;
    window.jetro?.resume(selected.id);
  };
  const handleStopSelected = () => {
    if (!canStop || !selected) return;
    window.jetro?.pause(selected.id);
  };
  const handleStopAll = async () => {
    if (!canStopAll || !hasBackend()) return;
    const active = items.filter((i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'queued');
    for (const it of active) {
      try {
        await window.jetro!.pause(it.id);
      } catch {}
    }
  };

  return (
    <>
      <div className="app-bg" />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="logo"><img src={jetroLogo} alt="Jetro" className="logo-img" draggable={false} /><span className="logo-text">Jetro</span><span className="logo-version">v{updateInfo?.current || appVersion}</span><button className="logo-settings-btn" title={t.sidebar.settingsTitle} onClick={() => openSettings()}><FiSettings size={16} /></button></div>
          <div className="sidebar-nav">
            {statusNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div className="nav-section">{t.sidebar.categories}</div>
            {categoryNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div
              className="nav-section row-between"
              onContextMenu={(e) => openCtx(e, null)}
              title={t.sidebar.queueOptionsTitle}
            >
              <span>{t.sidebar.queues}</span>
              <button className="nav-add-btn" title={t.sidebar.createQueueTitle} onClick={openCreateModal}><FiPlus size={13} /></button>
            </div>
            {queues.map((q) => {
              const key = `queue:${q.id}`;
              const schedLabel = q.schedulerEnabled
                ? ` • ${(normalizeTime24h(q.scheduleStart) || QUEUE_SCHED_DEFAULT_START)}–${(normalizeTime24h(q.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP)}`
                : '';
              return (
                <div
                  key={q.id}
                  className={'nav-item' + (filter === key ? ' active' : '')}
                  onClick={() => setFilter(key)}
                  onContextMenu={(e) => openCtx(e, q.id)}
                  title={t.sidebar.queueTooltip(q.running ? t.sidebar.queueRunning : t.sidebar.queueStopped, schedLabel)}
                >
                  <span className={'queue-dot' + (q.running ? ' running' : '')} />
                  <span className="nav-label"><FiLayers className="nav-icon" />{q.name}</span>
                  <span className="nav-count">{counts(key)}</span>
                </div>
              );
            })}
          </div>
          <div className="sidebar-footer">
            <div className={'speed-meter' + (totalSpeed > 0 ? ' active' : '')}>
              <div className="speed-meter-icon"><FiArrowDown size={16} /></div>
              <div className="speed-meter-info">
                <div className="speed-meter-label">{t.sidebar.downloadSpeed}</div>
                <div className="speed-meter-value">{fmtSpeed(totalSpeed)}</div>
              </div>
              <span className={'speed-meter-dot' + (totalSpeed > 0 ? ' live' : '')} />
            </div>
            <div className="sidebar-path" dir="ltr"><FiHardDrive className="inline-icon" /> {settings.downloadDir || '…'}</div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <button className="btn btn-primary" onClick={() => { setSavePath(settings.downloadDir || ''); setNewQueueId(''); setUrlError(''); setShowAdd(true); }}><FiPlus className="btn-icon" /> {t.topbar.newDownload}</button>
            <button className="btn" title={t.topbar.newBatchTitle} onClick={openBatch}><FiLayers className="btn-icon" /> {t.topbar.newBatch}</button>
            <input className="search" dir="auto" placeholder={t.topbar.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
            <button
              className="theme-toggle"
              title={resolvedTheme === 'dark' ? t.topbar.toLight : t.topbar.toDark}
              aria-label={resolvedTheme === 'dark' ? t.topbar.toLight : t.topbar.toDark}
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? <FiSun size={17} /> : <FiMoon size={17} />}
            </button>
          </div>

          <div className="toolbar">
            <button className="btn" disabled={!canResume} title={canResume && selected ? t.toolbar.resumeTitleReady(selected.filename) : t.toolbar.resumeTitleIdle} onClick={handleResumeSelected}><FiPlay className="btn-icon" /> {t.common.resume}</button>
            <button className="btn" disabled={!canStop} title={canStop && selected ? t.toolbar.stopTitleReady(selected.filename) : t.toolbar.stopTitleIdle} onClick={handleStopSelected}><FiPause className="btn-icon" /> {t.common.stop}</button>
            <button className="btn" disabled={!canStopAll} title={canStopAll ? t.toolbar.stopAllReady : t.toolbar.stopAllIdle} onClick={handleStopAll}><FiSquare className="btn-icon" /> {t.toolbar.stopAll}</button>
            <span className="toolbar-sep" />
            <div className="toolbar-dropdown">
              <button className="btn" title={t.toolbar.startQueueTitle} onClick={() => setQueueMenu(queueMenu === 'start' ? null : 'start')}><FiPlay className="btn-icon" /> {t.toolbar.startQueue} <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'start' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">{t.toolbar.noQueues}</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={q.running}
                        title={q.running ? t.toolbar.alreadyRunning(q.name) : t.toolbar.startNamed(q.name)}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiPlay className="btn-icon" /> {q.name}{q.running ? t.common.runningSuffix : ''}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="toolbar-dropdown">
              <button className="btn" title={t.toolbar.stopQueueTitle} onClick={() => setQueueMenu(queueMenu === 'stop' ? null : 'stop')}><FiSquare className="btn-icon" /> {t.toolbar.stopQueue} <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'stop' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">{t.toolbar.noQueues}</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={!q.running}
                        title={q.running ? t.toolbar.stopNamed(q.name) : t.toolbar.notRunning(q.name)}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiSquare className="btn-icon" /> {q.name}{q.running ? '' : t.common.stoppedSuffix}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="toolbar-spacer" />
            <div className="view-toggle" role="radiogroup" aria-label={t.toolbar.viewModeLabel}>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'cards'}
                title={t.toolbar.cardView}
                className={'view-toggle-btn' + (viewMode === 'cards' ? ' active' : '')}
                onClick={() => setViewModeAndPersist('cards')}
              ><FiGrid size={15} /></button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'details'}
                title={t.toolbar.detailsView}
                className={'view-toggle-btn' + (viewMode === 'details' ? ' active' : '')}
                onClick={() => setViewModeAndPersist('details')}
              ><FiList size={15} /></button>
            </div>
          </div>

          {showUpdateBanner && updateInfo && (
            <div className="card" style={{ justifyContent: 'space-between', alignItems: 'center', borderColor: 'var(--green-soft-border)', background: 'var(--green-soft-bg)' }}>
              <div>
                <b><FiDownloadCloud className="inline-icon" /> {t.updateBanner.available(updateInfo.latest)}</b>{' '}
                <span className="queue-meta">{t.updateBanner.have(updateInfo.current)}</span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-small btn-primary" onClick={() => openExternalUrl(updateInfo.url || 'https://github.com/Erkalin/Jetro/releases')}><FiExternalLink className="btn-icon" /> {t.updateBanner.download}</button>
                <button className="btn btn-small" onClick={() => setUpdateDismissed(updateInfo.latest)}>{t.common.later}</button>
              </div>
            </div>
          )}
          <div
            className="list"
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={async (e) => {
              e.preventDefault();
              if (!hasBackend()) return;
              try {
                const texts: string[] = [];
                try {
                  const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                  if (uri) texts.push(...String(uri).split(/\s+/));
                } catch {}
                const files = Array.from(e.dataTransfer.files || []) as File[];
                for (const f of files) {
                  try {
                    const t = await f.text();
                    texts.push(...t.split(/\s+/));
                  } catch {}
                }
                const urls = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, 200);
                if (!urls.length) return;
                const valid: string[] = [];
                for (const u of urls) {
                  try { valid.push(normalizeDownloadUrl(u)); } catch {}
                }
                if (!valid.length) return;
                const dir = (settings.downloadDir || '').trim() || undefined;
                if (typeof (window.jetro as any)?.addBatch === 'function') {
                  await (window.jetro as any).addBatch(valid, { dir });
                } else {
                  for (const u of valid) {
                    try { await window.jetro!.addDownload(u, { dir: dir || undefined }); } catch {}
                  }
                }
              } catch {}
            }}
            title={t.list.dropTitle}
          >
            {filter.startsWith('queue:') && (
              <div className="card" style={{ justifyContent: 'space-between' }}>
                <div className="queue-header-info">
                  <b className="queue-title"><FiLayers className="inline-icon" /> {queueById(filter.slice(6))?.name || t.list.queueFallback}</b>
                  <span className={queueById(filter.slice(6))?.running ? 'badge green' : 'badge red'}>{queueById(filter.slice(6))?.running ? t.common.runningBadge : t.common.stoppedBadge}</span>
                  {normalizeQueuePowerAction(queueById(filter.slice(6))?.afterComplete) !== 'nothing' && (
                    <span className="badge">{t.list.onFinish(queuePowerLabel(queueById(filter.slice(6))?.afterComplete, t.power))}</span>
                  )}
                  <span className="queue-meta">
                    {t.common.files(counts(filter))}
                    {(() => {
                      const qd = queueById(filter.slice(6));
                      if (!qd?.schedulerEnabled) return '';
                      const s = normalizeTime24h(qd.scheduleStart) || QUEUE_SCHED_DEFAULT_START;
                      const e = normalizeTime24h(qd.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP;
                      return t.list.schedule(s, e);
                    })()}
                  </span>
                </div>
                <div className="row">
                  {queueById(filter.slice(6))?.running ? (
                    <button className="btn" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiSquare className="btn-icon" /> {t.common.stop}</button>
                  ) : (
                    <button className="btn btn-primary" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiPlay className="btn-icon" /> {t.common.start}</button>
                  )}
                  <button className="btn" onClick={() => queueById(filter.slice(6)) && openEditModal(queueById(filter.slice(6))!)}>{t.common.edit}</button>
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="card"><div className="empty" style={{ width: '100%' }}>
                <div className="empty-big"><FiDownloadCloud size={48} /></div>
                <div className="empty-title">{t.list.emptyTitle}</div>
                <div>{t.list.emptyHint(settings.maxConnections)}</div>
              </div></div>
            )}
            {viewMode === 'details' && filtered.length > 0 && (
              <div className="details-wrap">
                <div className="details-head" style={{ gridTemplateColumns: detailGridTemplate }}>
                  {detailOrder.map((col) => (
                    <div
                      key={col}
                      className={
                        'details-th' +
                        (dropCol === col ? (dropSide === 'right' ? ' drop-right' : ' drop-left') : '')
                      }
                      draggable
                      title={t.list.colSortTitle(t.detailCols[col])}
                      onClick={() => setSort((prev) => {
                        if (!prev || prev.col !== col) return { col, dir: 1 };
                        if (prev.dir === 1) return { col, dir: -1 };
                        return null;
                      })}
                      onDragStart={(e) => {
                        dragColRef.current = col;
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col); } catch {}
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!dragColRef.current || dragColRef.current === col) return;
                        // Position-aware insertion: which physical half of the
                        // target is the pointer over? In LTR the right half
                        // means "after"; in RTL the visual flow is mirrored.
                        const rect = e.currentTarget.getBoundingClientRect();
                        const visualAfter = rect.width > 0 && e.clientX - rect.left > rect.width / 2;
                        const side = visualAfter ? 'right' : 'left';
                        dropAfterRef.current = isRTL ? !visualAfter : visualAfter;
                        if (dropCol !== col) setDropCol(col);
                        if (dropSideRef.current !== side) {
                          dropSideRef.current = side;
                          setDropSide(side);
                        }
                      }}
                      onDragLeave={() => {
                        if (dropCol === col) {
                          dropSideRef.current = null;
                          setDropCol(null);
                          setDropSide(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragColRef.current || ((): DetailColId | null => {
                          try {
                            const v = e.dataTransfer.getData('text/plain');
                            return (DETAIL_COLS_DEFAULT as string[]).includes(v) ? (v as DetailColId) : null;
                          } catch { return null; }
                        })();
                        const after = dropAfterRef.current;
                        clearColDrop();
                        if (from) moveDetailCol(from, col, after);
                      }}
                      onDragEnd={() => {
                        clearColDrop();
                      }}
                    >
                      <span className="details-th-label">{t.detailCols[col]}{sort?.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
                      <span
                        className="details-resizer"
                        title={t.list.colResizeTitle(t.detailCols[col])}
                        onMouseDown={(e) => beginColResize(e, col)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ))}
                  <div className="details-th details-actions-head" title={t.list.actionsHead} />
                </div>
                <div className="details-body">
                  {filtered.map((it) => {
                    const completed = it.status === 'completed';
                    const active = it.status === 'downloading' || it.status === 'merging';
                    const lastTry = lastTryOf(it);
                    const statusText = fmtDetailStatus(it, t.status.completed);
                    const statusTitle = it.status === 'error' && it.error
                      ? t.list.statusTitle(statusLabel(it.status, t.status), it.error, itemPct(it).toFixed(2))
                      : t.list.statusTitle(statusLabel(it.status, t.status), '', itemPct(it).toFixed(2));
                    // Session-average fallback keeps ETA stable through brief stalls.
                    const speedStats = getSpeedStats(it.id);
                    return (
                      <div
                        key={it.id}
                        className={'details-row' + (selectedId === it.id ? ' selected' : '')}
                        style={{ gridTemplateColumns: detailGridTemplate }}
                        onClick={(e) => toggleSelect(e, it.id)}
                        onContextMenu={(e) => openItemCtx(e, it)}
                        onDoubleClick={() => setAnalyticsId(it.id)}
                        title={`${it.filename}\n${it.savePath}`}
                      >
                        {detailOrder.map((col) => {
                          if (col === 'name') {
                            return (
                              <div key={col} className="details-td details-name">
                                <OsFileIcon item={it} />
                                <span className="details-filename" title={`${it.filename}\n${it.savePath}`}>{it.filename}</span>
                              </div>
                            );
                          }
                          if (col === 'queue') {
                            return (
                              <div key={col} className="details-td" onClick={(e) => e.stopPropagation()}>
                                <select
                                  className="queue-select details-queue-select"
                                  title={it.queueId ? t.list.queueSelectIn(queueById(it.queueId)?.name || '') : t.list.queueSelectNone}
                                  value={it.queueId || ''}
                                  disabled={it.status === 'downloading' || it.status === 'merging'}
                                  onChange={(e) => {
                                    if (e.target.value === '__new__') openCreateQueueFor(null, it.id);
                                    else moveItemToQueue(it.id, e.target.value || null);
                                  }}
                                >
                                  <option value="">{t.list.noOption}</option>
                                  {queues.map((q) => (
                                    <option key={q.id} value={q.id}>{q.name}</option>
                                  ))}
                                  <option value="__new__">{t.common.newQueueOption}</option>
                                </select>
                              </div>
                            );
                          }
                          if (col === 'status') {
                            return (
                              <div key={col} className="details-td" title={statusTitle}>
                                <span className="details-status-dot" style={{ background: statusColor(it.status) }} />
                                <span className="details-status-text" style={{ color: statusColor(it.status) }}>{statusText}</span>
                              </div>
                            );
                          }
                          if (col === 'size') {
                            return (
                              <div
                                key={col}
                                className="details-td details-num"
                                title={it.totalBytesIsEstimate && !completed ? t.list.estimatedTitle : t.list.sizeTitle(it.downloadedBytes ? fmtBytes(it.downloadedBytes) : '0 B', it.totalBytes ? fmtSize(it.totalBytes, !!it.totalBytesIsEstimate) : '')}
                              >{fmtDetailSize(it)}</div>
                            );
                          }
                          if (col === 'speed') {
                            // When paused, freeze the last live speed instead of blanking to '—'.
                            const isPaused = it.status === 'paused';
                            let frozenBps = 0;
                            if (isPaused) {
                              const arr = speedStats.samples;
                              for (let i = arr.length - 1; i >= 0; i--) {
                                if (arr[i].bps > 0) { frozenBps = arr[i].bps; break; }
                              }
                            }
                            const speedText =
                              active
                                ? fmtSpeed(it.speedBps || 0)
                                : isPaused && frozenBps > 0
                                  ? fmtSpeed(frozenBps)
                                  : '—';
                            return (
                              <div key={col} className="details-td details-num" title={speedText === '—' ? t.list.idle : t.list.speedTitle(speedText)}>
                                {speedText}
                              </div>
                            );
                          }
                          if (col === 'eta') {
                            // Stabilized long-window ETA; instantaneous only as a
                            // warm-up fallback before the window fills.
                            // When paused, freeze the last known value.
                            const isPaused = it.status === 'paused';
                            const liveEta =
                              speedStats.etaSec != null
                                ? formatEtaSec(speedStats.etaSec)
                                : fmtEta(it, speedStats.avg);
                            const etaText = completed ? '—' : active || isPaused ? liveEta : '—';
                            return (
                              <div key={col} className="details-td details-num" title={etaText === '—' ? t.list.etaUnknown : t.list.etaTitle(etaText)}>
                                {etaText}
                              </div>
                            );
                          }
                          return (
                            <div key={col} className="details-td details-num" title={fmtLastTryTitle(lastTry, t.months.neverTried, localeName)}>
                              {fmtLastTry(lastTry, t.months.short, localeName)}
                            </div>
                          );
                        })}
                        <div className="details-td details-actions" onClick={(e) => e.stopPropagation()}>
                          {it.status === 'downloading' || it.status === 'merging' || it.status === 'queued'
                            ? <button className="icon-btn details-action" title={t.list.pauseTitle} onClick={() => window.jetro?.pause(it.id)}><FiPause size={13} /></button>
                            : !completed && <button className="icon-btn details-action" title={t.list.resumeTitle} onClick={() => window.jetro?.resume(it.id)}><FiPlay size={13} /></button>}
                          {completed ? (
                            <>
                              <button
                                className="icon-btn details-action"
                                title={t.list.openFolderTitle}
                                onClick={async () => {
                                  if (!hasBackend()) return;
                                  try { await window.jetro!.revealInFolder(it.savePath); } catch (e: any) { alert(e?.message || t.common.couldNotOpenFolder); }
                                }}
                              ><FiFolder size={13} /></button>
                              <button
                                className="icon-btn details-action danger"
                                title={t.list.deleteFileTitle}
                                onClick={() => setPendingRemove({ id: it.id, deleteFile: true })}
                              ><FiTrash2 size={13} /></button>
                            </>
                          ) : (
                            <button className="icon-btn details-action" title={t.list.removeTitle} onClick={() => setPendingRemove({ id: it.id, deleteFile: false })}><FiX size={13} /></button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {viewMode === 'cards' && filtered.map((it) => {
              const pct = it.totalBytes ? Math.min(100, (it.downloadedBytes / it.totalBytes) * 100) : 0;
              const completed = it.status === 'completed';
              const qNameOf = it.queueId ? queueById(it.queueId)?.name : null;
              return (
                <div
                  className={'card' + (selectedId === it.id ? ' selected' : '')}
                  key={it.id}
                  onClick={(e) => toggleSelect(e, it.id)}
                  onContextMenu={(e) => openItemCtx(e, it)}
                  onDoubleClick={() => setAnalyticsId(it.id)}
                >
                  <OsFileIcon item={it} />
                  <div className="card-body">
                    <div className="card-title" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
                    <div className="card-url" title={it.savePath}>{it.url}</div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }} /></div>
                    <div className="meta">
                      <span><b className="card-pct">{pct.toFixed(1)}%</b></span>
                      <span title={it.totalBytesIsEstimate && !completed ? t.list.estimatedTitle : undefined}>{fmtBytes(it.downloadedBytes)} / {fmtSize(it.totalBytes, !!it.totalBytesIsEstimate && !completed)}</span>
                      <span style={{ color: statusColor(it.status), fontWeight: 700 }}>{statusLabel(it.status, t.status)}</span>
                      <span className="badge"><FiZap className="inline-icon" /> {it.connections}x {it.supportsRange ? '' : t.list.cardSingle}</span>
                      {(it.via === 'ytdlp') && <span className="badge green">{it.audioOnly ? <><FiMusic className="inline-icon" /> {t.list.cardAudio}</> : <><FiFilm className="inline-icon" /> {t.list.cardVideo(it.videoHeight ? String(it.videoHeight) : '')}</>}</span>}
                      {qNameOf && <span className="badge green"><FiLayers className="inline-icon" /> {qNameOf}</span>}
                      {it.status === 'error' && <span className="badge red">{it.error}</span>}
                      <select
                        className="queue-select"
                        title={t.list.addMoveQueue}
                        value={it.queueId || ''}
                        disabled={it.status === 'downloading' || it.status === 'merging'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          if (e.target.value === '__new__') openCreateQueueFor(null, it.id);
                          else moveItemToQueue(it.id, e.target.value || null);
                        }}
                      >
                        <option value="">{t.common.noQueue}</option>
                        {queues.map((q) => (
                          <option key={q.id} value={q.id}>{q.name}</option>
                        ))}
                        <option value="__new__">{t.common.newQueueOption}</option>
                      </select>
                    </div>
                  </div>
                  <div className="actions" onClick={(e) => e.stopPropagation()}>
                    {it.status === 'downloading' || it.status === 'merging' || it.status === 'queued'
                      ? <button className="icon-btn" title={t.list.pauseTitle} onClick={() => window.jetro?.pause(it.id)}><FiPause size={15} /></button>
                      : !completed && <button className="icon-btn" title={t.list.resumeTitle} onClick={() => window.jetro?.resume(it.id)}><FiPlay size={15} /></button>}
                    {completed ? (
                      <>
                        <button
                          className="icon-btn"
                          title={t.list.openFolderTitle}
                          onClick={async () => {
                            if (!hasBackend()) return;
                            try {
                              await window.jetro!.revealInFolder(it.savePath);
                            } catch (e: any) {
                              alert(e?.message || t.common.couldNotOpenFolder);
                            }
                          }}
                        ><FiFolder size={15} /></button>
                        <button
                          className="icon-btn danger"
                          title={t.list.deleteFileTitle}
                          onClick={() => setPendingRemove({ id: it.id, deleteFile: true })}
                        ><FiTrash2 size={15} /></button>
                      </>
                    ) : (
                      <button className="icon-btn" title={t.list.removeTitle} onClick={() => setPendingRemove({ id: it.id, deleteFile: false })}><FiX size={15} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* queue right-click menu */}
      {ctx && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div ref={ctxMenuRef} className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            {ctx.queueId && ctxQueue ? (
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    handleStartStopQueue(ctxQueue);
                    setCtx(null);
                  }}
                ><span className="ctx-icon">{ctxQueue.running ? <FiSquare size={14} /> : <FiPlay size={14} />}</span> {ctxQueue.running ? t.queueMenu.stopQueue : t.queueMenu.startQueue}</button>
                <button className="ctx-item" onClick={() => openEditModal(ctxQueue)}><FiEdit2 size={14} /> {t.queueMenu.editSchedule}</button>
                <div className="ctx-sep" />
                <button className="ctx-item danger" onClick={() => handleDeleteQueue(ctxQueue)}><FiTrash2 size={14} /> {t.queueMenu.deleteQueue}</button>
                <div className="ctx-sep" />
              </>
            ) : (
              <div className="ctx-hint">{t.queueMenu.hint}</div>
            )}
            <button className="ctx-item" onClick={openCreateModal}><FiPlus size={14} /> {t.queueMenu.createNew}</button>
          </div>
        </>
      )}

      {/* download item right-click menu */}
      {itemCtx && itemCtxItem && (() => {
        const it = itemCtxItem;
        const completed = it.status === 'completed';
        const active = it.status === 'downloading' || it.status === 'merging';
        const queued = it.status === 'queued';
        const canResume = it.status === 'paused' || it.status === 'error';
        const canStop = active || queued;
        const isVideo = it.via === 'ytdlp';
        const inQueue = !!it.queueId;
        const queueName = it.queueId ? queueById(it.queueId)?.name : null;
        const refreshing = refreshingId === it.id;
        return (
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setItemCtx(null)}
              onContextMenu={(e) => { e.preventDefault(); setItemCtx(null); }}
            />
            <div ref={itemMenuRef} className="ctx-menu ctx-menu-item" style={{ left: itemCtx.x, top: itemCtx.y }}>
              <div className="ctx-hint ctx-filename" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
              <button
                className="ctx-item"
                disabled={!completed}
                title={completed ? t.itemMenu.openReady(it.filename) : t.itemMenu.openIdle}
                onClick={() => handleOpenItem('open')}
              ><FiFileText size={14} /> {t.itemMenu.open}</button>
              <button
                className="ctx-item"
                disabled={!completed}
                title={completed ? t.itemMenu.openWithReady : t.itemMenu.openWithIdle}
                onClick={() => handleOpenItem('open-with')}
              ><FiExternalLink size={14} /> {t.itemMenu.openWith}</button>
              <button
                className="ctx-item"
                title={t.itemMenu.openFolderTitle}
                onClick={() => handleOpenItem('folder')}
              ><FiFolder size={14} /> {t.itemMenu.openFolder}</button>
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                disabled={active}
                title={active ? t.itemMenu.renameIdle : t.itemMenu.renameReady(it.filename)}
                onClick={openRenameModal}
              ><FiEdit2 size={14} /> {t.itemMenu.rename}</button>
              <button
                className="ctx-item"
                disabled={active || queued}
                title={active || queued ? t.itemMenu.redownloadIdle : t.itemMenu.redownloadReady}
                onClick={handleRedownloadItem}
              ><FiRotateCcw size={14} /> {t.itemMenu.redownload}</button>
              {canStop ? (
                <button className="ctx-item" onClick={handleItemResumeStop}>
                  <FiPause size={14} /> {t.itemMenu.stopDownload}
                </button>
              ) : canResume ? (
                <button className="ctx-item" onClick={handleItemResumeStop}>
                  <FiPlay size={14} /> {t.itemMenu.resumeDownload}
                </button>
              ) : (
                <button
                  className="ctx-item"
                  disabled
                  title={completed ? t.itemMenu.resumeCompletedTitle : t.itemMenu.resumeDisabledTitle}
                ><FiPlay size={14} /> {t.itemMenu.resumeDownload}</button>
              )}
              <button
                className="ctx-item"
                disabled={active || isVideo || refreshing}
                title={isVideo ? t.itemMenu.refreshVideoTitle : active ? t.itemMenu.refreshActiveTitle : t.itemMenu.refreshIdleTitle}
                onClick={handleRefreshItem}
              ><FiRefreshCw size={14} /> {refreshing ? t.itemMenu.refreshing : t.itemMenu.refresh}</button>
              <button className="ctx-item danger" onClick={handleRemoveItem}>
                {completed ? <FiTrash2 size={14} /> : <FiX size={14} />} {t.common.remove}
              </button>
              <div className="ctx-sep" />
              {inQueue ? (
                <button
                  className="ctx-item"
                  disabled={active}
                  title={active ? t.itemMenu.removeFromQueueIdle : t.itemMenu.removeFromQueue(queueName || '')}
                  onClick={() => {
                    const id = it.id;
                    setItemCtx(null);
                    moveItemToQueue(id, null);
                  }}
                ><FiLayers size={14} /> {t.itemMenu.removeFromQueue(queueName || '')}</button>
              ) : (
                <>
                  <div className="ctx-hint">{t.itemMenu.addToQueue}</div>
                  <div className="ctx-queue-list">
                    {queues.length === 0 && <div className="ctx-hint">{t.toolbar.noQueues}</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={active}
                        title={active ? t.itemMenu.removeFromQueueIdle : t.itemMenu.moveTo(q.name)}
                        onClick={() => {
                          const id = it.id;
                          const qid = q.id;
                          setItemCtx(null);
                          moveItemToQueue(id, qid);
                        }}
                      ><FiLayers size={14} /> {q.name}{q.running ? '' : t.common.stoppedSuffix}</button>
                    ))}
                  </div>
                  <button
                    className="ctx-item"
                    onClick={() => {
                      setPendingQueueMove(it.id);
                      setQueueCreateReturn(null);
                      setItemCtx(null);
                      setQName('');
                      setQNameError('');
                      setQSchedOn(false);
                      setQStart(QUEUE_SCHED_DEFAULT_START);
                      setQStop(QUEUE_SCHED_DEFAULT_STOP);
                      setQSchedError('');
                      setQPower('nothing');
                      setShowQueueModal({ mode: 'create' });
                    }}
                  ><FiPlus size={14} /> {t.itemMenu.newQueue}</button>
                </>
              )}
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                title={t.itemMenu.detailsSpeedTitle}
                onClick={() => {
                  setAnalyticsId(it.id);
                  setItemCtx(null);
                }}
              ><FiActivity size={14} /> {t.itemMenu.detailsSpeed}</button>
              <button
                className="ctx-item"
                onClick={() => {
                  setPropsId(it.id);
                  setItemCtx(null);
                }}
              ><FiInfo size={14} /> {t.itemMenu.properties}</button>
            </div>
          </>
        );
      })()}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiPlus className="inline-icon" /> {t.newDownload.title}</h2>
            <p>{t.newDownload.introA}<br />{t.newDownload.introB}{' '}
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 'inherit' }}
                title={t.newDownload.introMoreTitle}
                onClick={() => openExternalUrl(SUPPORTED_SITES_URL)}
              >{t.newDownload.introMore}</button>{' '}
              {t.newDownload.introC}</p>
            <input
              className="input"
              autoFocus
              dir="ltr"
              placeholder={t.newDownload.urlPlaceholder}
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); if (urlError) setUrlError(''); }}
              onPaste={(e) => {
                // Pasted prose/whitespace ("check this: example.com/a.zip\n") is
                // cleaned to just the link so it lands ready in Link Address.
                try {
                  const raw = String(e.clipboardData?.getData('text') || '');
                  if (!raw || !/[\s"'<>]/.test(raw)) return; // single token: native is fine
                  const url = extractPastedUrl(raw);
                  if (url) {
                    e.preventDefault();
                    setNewUrl(url);
                    setUrlError('');
                    filenameTouchedRef.current = false;
                  }
                } catch {
                  // fall back to native paste
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
              style={urlError ? { borderColor: 'var(--red)' } : undefined}
            />
            {urlError && <div className="form-error">{urlError}</div>}
            {newUrl.trim() !== '' && (!isVideoPageUrl(newUrl) || !!selectedVideoKind || selectedVideoHeight > 0 || !!selectedVideoUrl) && (
              <>
                <label className="form-label">{t.newDownload.fileName}</label>
                <input
                  className="input"
                  dir="auto"
                  placeholder={probedFilename || t.newDownload.fileNamePlaceholder}
                  value={newFilename}
                  onChange={(e) => {
                    setNewFilename(e.target.value);
                    filenameTouchedRef.current = true;
                    if (filenameError) setFilenameError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
                  style={filenameError ? { borderColor: 'var(--red)' } : undefined}
                />
                {filenameError && <div className="form-error">{filenameError}</div>}
                {!filenameError && probedFilename !== '' && probedFilename !== newFilename.trim() && (
                  <div className="form-hint">{t.newDownload.detected(probedFilename)}</div>
                )}
              </>
            )}
            {newUrl.trim() !== '' && isVideoPageUrl(newUrl) && (
              <div className="video-box">
                <div className="video-box-desc">{t.newDownload.videoDesc}</div>
                <button className="btn btn-small" disabled={videoLoading} onClick={detectVideo}>
                  <FiFilm className="btn-icon" /> {videoLoading ? t.newDownload.detecting : videoFormats.length ? t.newDownload.detectAgain : t.newDownload.detectQualities}
                </button>
                {needsCookies && (
                  <div className="cookie-box">
                    <div className="cookie-box-title">{t.newDownload.cookieTitle}</div>
                    <label className="form-label-sm">{t.newDownload.cookiePasteLabel}</label>
                    <textarea
                      className="input"
                      dir="ltr"
                      rows={4}
                      placeholder={t.newDownload.cookiePastePlaceholder}
                      value={cookiesText}
                      onChange={(e) => { setCookiesText(e.target.value); if (cookieError) setCookieError(''); if (urlError) setUrlError(''); }}
                    />
                    <div className="cookie-or">{t.newDownload.cookieOr}</div>
                    <label className="form-label-sm">{t.newDownload.cookieFileLabel}</label>
                    <div className="row" style={{ alignItems: 'flex-end' }}>
                      <input
                        className="input"
                        dir="ltr"
                        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
                        placeholder={t.newDownload.cookieFilePlaceholder}
                        value={cookiesFile}
                        onChange={(e) => { setCookiesFile(e.target.value); if (cookieError) setCookieError(''); if (urlError) setUrlError(''); }}
                      />
                      <button
                        className="btn btn-small"
                        title={t.newDownload.cookiePickTitle}
                        onClick={async () => {
                          if (!hasBackend()) return;
                          const f = await window.jetro!.pickFile();
                          if (f) {
                            setCookiesFile(f);
                            if (cookieError) setCookieError('');
                            if (urlError) setUrlError('');
                          }
                        }}
                      >…</button>
                    </div>
                    {cookieError && <div className="form-error-mt">{cookieError}</div>}
                    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-small"
                        title={t.newDownload.cookieExtensionTitle}
                        onClick={async () => {
                          try {
                            if (window.jetro?.openExternal) await window.jetro.openExternal(COOKIE_EXPORTER_URL);
                            else window.open(COOKIE_EXPORTER_URL, '_blank', 'noopener');
                          } catch {
                            try { window.open(COOKIE_EXPORTER_URL, '_blank', 'noopener'); } catch {}
                          }
                        }}
                      ><MdExtension className="btn-icon" /> {t.newDownload.cookieExtension}</button>
                      <button className="btn btn-small btn-primary" disabled={videoLoading} onClick={detectVideo}>
                        <FiFilm className="btn-icon" /> {videoLoading ? t.newDownload.retrying : t.newDownload.retryCookies}
                      </button>
                    </div>
                  </div>
                )}
                {videoHint && !cookieError && <div className="video-hint">{videoTitle ? `${videoTitle} — ` : ''}{videoHint}</div>}
                {videoProxyHint && !videoLoading && videoFormats.length === 0 && (
                  <div className="proxy-hint-box" role="alert">
                    <div className="proxy-hint-text">
                      <FiGlobe className="inline-icon" /> {t.newDownload.detectProxyHint}
                    </div>
                    <div className="proxy-hint-current">
                      {t.settings.proxyMode}:{' '}
                      <b>
                        {settings?.proxyMode === 'custom'
                          ? t.settings.proxyCustom
                          : settings?.proxyMode === 'system'
                            ? t.settings.proxySystem
                            : t.settings.proxyNone}
                      </b>
                    </div>
                    <div className="row proxy-hint-actions">
                      <button type="button" className="btn btn-small btn-primary" onClick={openProxySettings}>
                        <FiSettings className="btn-icon" /> {t.newDownload.openProxySettings}
                      </button>
                      <button type="button" className="btn btn-small" disabled={videoLoading} onClick={detectVideo}>
                        <FiRefreshCw className="btn-icon" /> {t.newDownload.detectAgain}
                      </button>
                    </div>
                  </div>
                )}
                {videoDetail && (
                  <div className="video-detail-wrap">
                    <button className="link-btn" onClick={() => setShowVideoDetail((v) => !v)}>
                      {showVideoDetail ? t.newDownload.hideDetails : t.newDownload.showDetails}
                    </button>
                    {showVideoDetail && <pre className="video-detail-log">{videoDetail}</pre>}
                  </div>
                )}
                {videoFormats.filter((f) => (f.kind || 'video') !== 'audio').length > 0 && (
                  <>
                    <div className="video-group-label">{t.newDownload.videoGroup}</div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {videoFormats.filter((f) => (f.kind || 'video') !== 'audio').map((f) => {
                        const fKind = (f.kind || 'video') as 'video' | 'audio';
                        const active = selectedVideoKind === fKind && selectedVideoHeight === (f.height || 0) && selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'v-' + f.height + f.quality + (f.needsMerge ? '-m' : '')}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => {
                              setSelectedVideoUrl(f.url || '');
                              setSelectedVideoHeight(f.height || 0);
                              setSelectedVideoNeedsMerge(!!f.needsMerge);
                              setSelectedVideoKind('video');
                              setSelectedVideoExt(String(f.ext || '').toLowerCase());
                              setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
                              if (!filenameTouchedRef.current && videoTitle) setNewFilename(sanitizeVideoFilename(videoTitle, f.ext));
                            }}
                          >{f.height ? `${f.height}p` : f.quality} · {f.ext}{f.needsMerge ? t.newDownload.mergeSuffix : ''}{Number((f as any)?.estimatedBytes || 0) > 0 ? ` · ${fmtSize(Number((f as any).estimatedBytes), true)}` : ''}</button>
                        );
                      })}
                    </div>
                  </>
                )}
                {videoFormats.filter((f) => f.kind === 'audio').length > 0 && (
                  <>
                    <div className="video-group-label">{t.newDownload.audioGroup}</div>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {videoFormats.filter((f) => f.kind === 'audio').map((f) => {
                        const active = selectedVideoKind === 'audio' && selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'a-' + f.quality + f.ext}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => {
                              setSelectedVideoUrl('');
                              setSelectedVideoHeight(0);
                              setSelectedVideoNeedsMerge(true);
                              setSelectedVideoKind('audio');
                              setSelectedVideoExt(String(f.ext || '').toLowerCase());
                              setSelectedVideoEstimatedBytes(Math.max(0, Math.round(Number((f as any)?.estimatedBytes || 0))));
                              if (!filenameTouchedRef.current && videoTitle) setNewFilename(sanitizeVideoFilename(videoTitle, f.ext));
                              else if (filenameTouchedRef.current && newFilename && extOf(newFilename) !== String(f.ext || '').toLowerCase()) {
                                const base = newFilename.slice(0, newFilename.lastIndexOf('.') > 0 ? newFilename.lastIndexOf('.') : undefined);
                                setNewFilename(`${base}.${f.ext}`);
                              }
                            }}
                          >{f.abr ? `${f.ext} · ${Math.round(f.abr)}k` : `${f.quality} · ${f.ext}`}{Number((f as any)?.estimatedBytes || 0) > 0 ? ` · ${fmtSize(Number((f as any).estimatedBytes), true)}` : ''}</button>
                        );
                      })}
                    </div>
                  </>
                )}
                {!!selectedVideoKind && (
                  <div className="video-selected">
                    {selectedVideoKind === 'audio'
                      ? t.newDownload.selectedAudio(selectedVideoEstimatedBytes > 0 ? fmtSize(selectedVideoEstimatedBytes, true) : '')
                      : selectedVideoNeedsMerge || !selectedVideoUrl
                        ? t.newDownload.selectedMerge(selectedVideoHeight ? String(selectedVideoHeight) : '', selectedVideoEstimatedBytes > 0 ? fmtSize(selectedVideoEstimatedBytes, true) : '')
                        : t.newDownload.selectedDirect}
                  </div>
                )}
                {(videoFormats.length > 0 || playlist) && (
                  <div className="row select-row" style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 12 }}><input type="checkbox" checked={videoSubtitles} onChange={(e) => setVideoSubtitles(e.target.checked)} /> {t.newDownload.subtitles}</label>
                    <select className="input select-queue" value={videoQueueId} onChange={(e) => { if (e.target.value === '__new__') openCreateQueueFor('video'); else setVideoQueueId(e.target.value); }} title={t.newDownload.videoQueueTitle}>
                      <option value="">{t.common.noQueue}</option>
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.running ? t.common.runningSuffix : ''}</option>)}
                      <option value="__new__">{t.common.newQueueOption}</option>
                    </select>
                  </div>
                )}
                {playlist && playlist.entries.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="video-group-label">{t.newDownload.playlistGroup(playlist.count, playlist.count > 50 ? t.newDownload.playlistFirst50 : '', playlist.title)}</div>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <button className="btn btn-small" onClick={() => setPlaylistSelected(new Set(playlist.entries.map((en) => String(en.url))))}>{t.newDownload.selectAll}</button>
                      <button className="btn btn-small" onClick={() => setPlaylistSelected(new Set())}>{t.newDownload.clear}</button>
                      <span className="queue-meta">{t.newDownload.playlistSelected(playlistSelected.size)}</span>
                    </div>
                    <div className="ctx-queue-list" style={{ maxHeight: 180 }}>
                      {playlist.entries.map((en) => {
                        const key = String(en.url);
                        const on = playlistSelected.has(key);
                        return (
                          <label key={key} className="ctx-item" style={{ cursor: 'pointer' }} title={en.url}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => setPlaylistSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })}
                            />
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{en.title}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button className="btn btn-primary btn-small" style={{ marginTop: 8 }} disabled={playlistAdding || playlistSelected.size === 0 || !selectedVideoKind} onClick={startPlaylistDownload}>
                      {playlistAdding ? t.newDownload.playlistAdding : t.newDownload.playlistDownload(playlistSelected.size)}
                    </button>
                  </div>
                )}
              </div>
            )}
            <label className="form-label">{t.newDownload.saveFolder}</label>
            <div className="save-path-box">
              <input className="input" dir="ltr" placeholder={t.common.chooseFolder} value={savePath} onChange={(e) => setSavePath(e.target.value)} />
              <button className="btn" title={t.common.chooseFolderTitle} onClick={() => chooseSaveFolder()}><FiFolder size={16} /></button>
            </div>
            {isVideoPageUrl(newUrl) ? (
              <div className="queue-note">{t.newDownload.videoQueueNote}</div>
            ) : (
              <div className="row select-row">
                <select className="input select-conns" value={newConns} onChange={(e) => setNewConns(Number(e.target.value))}>
                  {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{t.common.connections(n)}</option>)}
                </select>
                <select className="input select-queue" value={newQueueId} onChange={(e) => { if (e.target.value === '__new__') openCreateQueueFor('newDownload'); else setNewQueueId(e.target.value); }} title={t.newDownload.videoQueueTitle}>
                  <option value="">{t.common.noQueue}</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>{q.name}{q.running ? t.common.runningSuffix : ''}</option>
                  ))}
                  <option value="__new__">{t.common.newQueueOption}</option>
                </select>
              </div>
            )}
            <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={async () => { try { const txt = await navigator.clipboard.readText(); if (txt) { setNewUrl(txt.trim()); setUrlError(''); filenameTouchedRef.current = false; } } catch {} }}><FiClipboard className="btn-icon" /> {t.common.pasteFromClipboard}</button>
            <div className="row modal-actions">
              <button className="btn" onClick={() => setShowAdd(false)}>{t.common.cancel}</button>
              <button className="btn btn-primary" disabled={adding} onClick={() => addDl()}>{adding ? t.newDownload.starting : t.common.download}</button>
            </div>
          </div>
        </div>
      )}

      {showBatch && batchStep === 1 && (
        <div className="modal-overlay" onClick={closeBatch}>
          <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiLayers className="inline-icon" /> {t.batch.title}</h2>
            <p>
              {t.batch.introA}{' '}
              {t.batch.introB}<b>*</b>{t.batch.introC}{' '}
              {t.batch.introExample} <code style={{ wordBreak: 'break-all' }}>{t.batch.introExampleUrl}</code> {t.batch.introExampleRest}
            </p>
            <label className="form-label">{t.batch.urlLabel}</label>
            <input
              className="input"
              autoFocus
              dir="ltr"
              placeholder={t.batch.urlPlaceholder}
              value={batchUrl}
              onChange={(e) => { setBatchUrl(e.target.value); if (batchError) setBatchError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleBatchOk(); }}
              style={batchError && !batchUrl.includes('*') ? { borderColor: 'var(--red)' } : undefined}
            />
            <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>{t.batch.replaceWith}</label>
            <div className="theme-segment" role="radiogroup" aria-label={t.batch.replaceWith}>
              {(['numbers', 'letters'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={batchMode === m}
                  className={batchMode === m ? 'active' : ''}
                  onClick={() => { setBatchMode(m); setBatchError(''); }}
                >{m === 'numbers' ? t.batch.numbers : t.batch.letters}</button>
              ))}
            </div>
            {batchMode === 'numbers' ? (
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label className="form-label">{t.batch.from}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={999999}
                    step={1}
                    value={batchFromNum}
                    onChange={(e) => { setBatchFromNum(e.target.value); if (batchError) setBatchError(''); }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">{t.batch.to}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={999999}
                    step={1}
                    value={batchToNum}
                    onChange={(e) => { setBatchToNum(e.target.value); if (batchError) setBatchError(''); }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">{t.batch.wildcard}</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={batchWildcard}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Numbers only, clamp 1–10 on blur/OK; allow typing.
                      if (v === '' || /^\d+$/.test(v)) setBatchWildcard(v);
                      if (batchError) setBatchError('');
                    }}
                    onBlur={() => {
                      const n = parseInt(batchWildcard, 10);
                      if (!Number.isFinite(n)) setBatchWildcard('1');
                      else setBatchWildcard(String(Math.min(10, Math.max(1, n))));
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label className="form-label">{t.batch.fromLetters}</label>
                  <div className="batch-stepper">
                    <input
                      className="input"
                      maxLength={1}
                      value={batchFromLetter}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1);
                        setBatchFromLetter(v || '');
                        if (batchError) setBatchError('');
                      }}
                      style={{ marginBottom: 0, textAlign: 'center' }}
                    />
                    <div className="batch-stepper-btns">
                      <button className="btn btn-small" title={t.batch.nextLetter} onClick={() => setBatchFromLetter((v) => stepLetter(v || 'a', 1))}>▲</button>
                      <button className="btn btn-small" title={t.batch.prevLetter} onClick={() => setBatchFromLetter((v) => stepLetter(v || 'a', -1))}>▼</button>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">{t.batch.toLetters}</label>
                  <div className="batch-stepper">
                    <input
                      className="input"
                      maxLength={1}
                      value={batchToLetter}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^A-Za-z]/g, '').slice(-1);
                        setBatchToLetter(v || '');
                        if (batchError) setBatchError('');
                      }}
                      style={{ marginBottom: 0, textAlign: 'center' }}
                    />
                    <div className="batch-stepper-btns">
                      <button className="btn btn-small" title={t.batch.nextLetter} onClick={() => setBatchToLetter((v) => stepLetter(v || 'z', 1))}>▲</button>
                      <button className="btn btn-small" title={t.batch.prevLetter} onClick={() => setBatchToLetter((v) => stepLetter(v || 'z', -1))}>▼</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="batch-preview">
              <label className="form-label">{t.batch.firstFile}</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchFirst} placeholder="—" title={batchFirst} />
              <label className="form-label">{t.batch.secondFile}</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchSecond} placeholder="—" title={batchSecond} />
              <div className="batch-ellipsis">…</div>
              <label className="form-label">{t.batch.lastFile}</label>
              <input className="input batch-preview-input" readOnly tabIndex={-1} value={batchLast} placeholder="—" title={batchLast} />
              {batchPreviewUrls.length > 0 && (
                <div className="form-hint" style={{ margin: '4px 0 0' }}>{t.batch.willAdd(batchPreviewUrls.length)}</div>
              )}
            </div>
            {batchValidation.error && batchUrl.trim() !== '' && (
              <div className="form-error" style={{ marginTop: 8 }}>{batchValidation.error}</div>
            )}
            {batchError && <div className="form-error" style={{ marginTop: 8 }}>{batchError}</div>}
            <label className="form-label">{t.batch.saveFolder}</label>
            <div className="save-path-box">
              <input className="input" dir="ltr" placeholder={t.common.chooseFolder} value={batchSavePath} onChange={(e) => setBatchSavePath(e.target.value)} />
              <button
                className="btn"
                title={t.common.chooseFolderTitle}
                onClick={async () => {
                  if (!hasBackend()) return;
                  const f = await window.jetro!.pickFolder(batchSavePath || settings.downloadDir);
                  if (f) setBatchSavePath(f);
                }}
              ><FiFolder size={16} /></button>
            </div>
            <label className="form-label">{t.batch.connsPerFile}</label>
            <select className="input select-single" value={batchConns} onChange={(e) => setBatchConns(Number(e.target.value))}>
              {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{t.common.connections(n)}</option>)}
            </select>
            <button
              className="btn"
              style={{ width: '100%', marginTop: 10 }}
              onClick={async () => {
                try {
                  const txt = await navigator.clipboard.readText();
                  if (txt) { setBatchUrl(txt.trim()); setBatchError(''); }
                } catch {}
              }}
            ><FiClipboard className="btn-icon" /> {t.common.pasteFromClipboard}</button>
            <div className="row modal-actions">
              <button className="btn" disabled={batchResolving} onClick={closeBatch}>{t.common.cancel}</button>
              <button
                className="btn btn-primary"
                disabled={batchResolving || !batchPreviewUrls.length}
                onClick={handleBatchOk}
              >{t.common.ok}</button>
            </div>
          </div>
        </div>
      )}

      {showBatch && batchStep === 2 && (
        <div className="modal-overlay" onClick={closeBatch}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiLayers className="inline-icon" /> {t.batch.linksTitle(batchUrls.length)}</h2>
            <p>
              {t.batch.linksIntroA}{' '}
              {t.batch.linksIntroB}{' '}
              {t.batch.simultaneous} <b>{Number(settings.maxConcurrentDownloads) || 3}</b> {t.batch.simultaneousHint}
            </p>
            {batchResolving && <div className="video-hint">{t.batch.resolving(batchUrls.length)}</div>}
            {!batchResolving && batchRows.length > 0 && (
              <div className="video-hint">
                {t.batch.resolveSummary(batchOkCount, batchFailCount)}
              </div>
            )}
            <div className="batch-list">
              {batchResolving && batchRows.length === 0 && (
                <div className="dropdown-empty">{t.batch.resolvingShort}</div>
              )}
              {batchRows.map((r, i) => (
                <div key={r.url + i} className="batch-row">
                  <span className="batch-num">{i + 1}</span>
                  <div className="batch-row-main">
                    <div className="batch-row-url" title={r.url}>{r.url}</div>
                    <div className="batch-row-meta">
                      {r.ok ? (
                        <>
                          <span className="badge green">OK</span>
                          <span className="batch-filename" title={r.filename}>{r.filename}</span>
                          <span>{r.totalBytes ? fmtBytes(r.totalBytes) : t.batch.sizeUnknown}</span>
                        </>
                      ) : (
                        <>
                          <span className="badge red">{t.batch.failed}</span>
                          <span className="batch-filename" title={r.error || t.batch.invalidLink}>{r.error || t.batch.invalidLink}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {batchError && <div className="form-error" style={{ marginTop: 8 }}>{batchError}</div>}
            <div className="row modal-actions" style={{ flexWrap: 'wrap' }}>
              <button className="btn" disabled={batchAdding || batchResolving} onClick={closeBatch}>{t.common.cancel}</button>
              <button className="btn" disabled={batchAdding || batchResolving} onClick={() => { if (!batchResolving && !batchAdding) setBatchStep(1); }}>{t.common.back}</button>
              <button
                className="btn btn-primary"
                disabled={batchAdding || batchResolving || batchOkCount === 0}
                onClick={handleBatchDownload}
              >{batchAdding ? t.batch.adding : t.batch.downloadCount(batchOkCount)}</button>
            </div>
          </div>
        </div>
      )}

      {pendingFormatConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPendingFormatConfirm(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiFileText className="inline-icon" /> {t.formatConfirm.title}</h2>
            <p>
              {t.formatConfirm.pointsTo} {pendingFormatConfirm.detExt ? <>{t.formatConfirm.aFile(pendingFormatConfirm.detExt)}</> : t.formatConfirm.noExt}{' '}
              (<b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.detectedName}</b>), {t.formatConfirm.butNamed}{' '}
              <b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.finalName}</b>
              {pendingFormatConfirm.finalExt ? '' : ` ${t.formatConfirm.noExtSuffix}`}. {t.formatConfirm.body}
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus disabled={adding} onClick={confirmFormatAnyway}>{adding ? t.newDownload.starting : t.formatConfirm.anyway}</button>
              <button className="btn" disabled={adding} onClick={useOriginalFilename}>{t.formatConfirm.useOriginal}</button>
              <button className="btn" disabled={adding} onClick={() => setPendingFormatConfirm(null)}>{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {pendingCollision && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPendingCollision(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiFileText className="inline-icon" /> {t.collision.title}</h2>
            <p>
              <b style={{ wordBreak: 'break-all' }}>{pendingCollision.filename}</b> {t.collision.bodyA}{' '}
              <b style={{ wordBreak: 'break-all' }} dir="ltr">{pendingCollision.dir || settings.downloadDir}</b>.
              {t.collision.bodyB}
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus disabled={adding} onClick={() => resolveCollision('replace')}>{t.collision.replace}</button>
              <button className="btn" disabled={adding} onClick={() => resolveCollision('rename')}>{t.collision.keepBoth}</button>
              <button className="btn" disabled={adding} onClick={() => setPendingCollision(null)}>{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {showQueueModal && (
        <div className="modal-overlay" onClick={() => { setShowQueueModal(null); setPendingQueueMove(null); setQueueCreateReturn(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{showQueueModal.mode === 'create' ? (<><FiPlus className="inline-icon" /> {t.queueModal.createTitle}</>) : (<><FiEdit2 className="inline-icon" /> {t.queueModal.editTitle}</>)}</h2>
            <p>{showQueueModal.mode === 'create' ? t.queueModal.createDesc : t.queueModal.editDesc}</p>
            <label style={{ fontSize: 12 }}>{t.queueModal.nameLabel}</label>
            <input
              className="input"
              autoFocus
              dir="auto"
              value={qName}
              onChange={(e) => {
                setQName(e.target.value);
                if (e.target.value.trim()) setQNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && qName.trim()) saveQueueModal();
              }}
              placeholder={t.queueModal.namePlaceholder}
              style={qNameError ? { borderColor: 'var(--red)' } : undefined}
            />
            {qNameError && <div className="form-error">{qNameError}</div>}
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={qSchedOn}
                onChange={(e) => {
                  setQSchedOn(e.target.checked);
                  setQSchedError('');
                }}
              /> {t.queueModal.scheduleToggle}
            </label>
            <div className="row" style={{ marginTop: 8, opacity: qSchedOn ? 1 : 0.45 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: qSchedOn ? undefined : 'var(--muted)' }}>{t.queueModal.startLabel}</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  placeholder="22:00"
                  value={qStart}
                  disabled={!qSchedOn}
                  onChange={(e) => {
                    setQStart(e.target.value);
                    if (qSchedError) setQSchedError('');
                  }}
                  style={qSchedError ? { borderColor: 'var(--red)' } : undefined}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: qSchedOn ? undefined : 'var(--muted)' }}>{t.queueModal.stopLabel}</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={5}
                  placeholder="07:00"
                  value={qStop}
                  disabled={!qSchedOn}
                  onChange={(e) => {
                    setQStop(e.target.value);
                    if (qSchedError) setQSchedError('');
                  }}
                  style={qSchedError ? { borderColor: 'var(--red)' } : undefined}
                />
              </div>
            </div>
            {qSchedError && <div className="form-error">{qSchedError}</div>}
            <label style={{ fontSize: 12, marginTop: 12, display: 'block' }}>{t.queueModal.powerLabel}</label>
            <select className="input" value={qPower} onChange={(e) => setQPower(normalizeQueuePowerAction(e.target.value))} title={t.queueModal.powerTitle}>
              {queuePowerOptions(t.power).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="form-hint" style={{ margin: '4px 0 0' }}>{t.queueModal.powerHint}</div>
            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                onClick={saveQueueModal}
                disabled={!qName.trim() || (qSchedOn && (!normalizeTime24h(qStart) || !normalizeTime24h(qStop)))}
              >
                {showQueueModal.mode === 'create' ? t.queueModal.create : t.queueModal.save}
              </button>
              <button className="btn" onClick={() => { setShowQueueModal(null); setPendingQueueMove(null); setQueueCreateReturn(null); }}>{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && draftSettings && (
        <div className="modal-overlay" onClick={attemptCloseSettings}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiSettings className="inline-icon" /> {t.settings.title}</h2>
            <p>{t.settings.subtitle}</p>
            <label style={{ fontSize: 12 }}>{t.settings.downloadFolder}</label>
            <div className="row dir-row">
              <input className="input" dir="ltr" value={draftSettings.downloadDir} onChange={(e) => setDraftSettings({ ...draftSettings, downloadDir: e.target.value })} />
              <button className="btn" title={t.common.chooseFolderTitle} onClick={async () => { const f = await window.jetro?.pickFolder(); if (f) setDraftSettings((s: any) => ({ ...s, downloadDir: f })); }}><FiFolder size={16} /></button>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>{t.settings.connections}</label>
                <select
                  className="input"
                  value={normalizeConnectionOption(draftSettings.maxConnections)}
                  onChange={(e) => setDraftSettings({ ...draftSettings, maxConnections: Number(e.target.value) })}
                >
                  {CONNECTION_OPTIONS.map((n) => <option key={n} value={n}>{t.common.connections(n)}</option>)}
                  {!CONNECTION_OPTIONS.includes(normalizeConnectionOption(draftSettings.maxConnections)) && (
                    <option value={normalizeConnectionOption(draftSettings.maxConnections)}>{t.common.connections(normalizeConnectionOption(draftSettings.maxConnections))}</option>
                  )}
                </select></div>
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>{t.settings.concurrent}</label>
                <input className="input" type="number" min={1} max={10} value={draftSettings.maxConcurrentDownloads} onChange={(e) => setDraftSettings({ ...draftSettings, maxConcurrentDownloads: Number(e.target.value) })} /></div>
            </div>
            <label style={{ fontSize: 12 }}>{t.settings.speedLimit}</label>
            <select
              className="input"
              value={Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))}
              onChange={(e) => setDraftSettings({ ...draftSettings, speedLimitKBps: Number(e.target.value) })}
            >
              {speedLimitOptions(t.speedLimit).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!speedLimitOptions(t.speedLimit).some((o) => o.value === Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))) && (
                <option value={Math.max(0, Math.round(Number(draftSettings.speedLimitKBps) || 0))}>
                  {speedLimitLabel(draftSettings.speedLimitKBps, t.speedLimit)}
                </option>
              )}
            </select>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!draftSettings.autoCaptureClipboard} onChange={(e) => setDraftSettings({ ...draftSettings, autoCaptureClipboard: e.target.checked })} /> {t.settings.clipboard}</label>
            <div className="settings-section">
              <h3 className="settings-section-title"><FiRotateCcw className="inline-icon" /> {t.settings.retrySection}</h3>
              <p className="settings-section-sub">{t.settings.retrySub}</p>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={draftSettings.autoRetryEnabled !== false} onChange={(e) => setDraftSettings({ ...draftSettings, autoRetryEnabled: e.target.checked })} /> {t.settings.retryToggle}</label>
              <div className="row">
                <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>{t.settings.maxRetries}</label>
                  <input className="input" type="number" min={0} max={10} value={Math.min(10, Math.max(0, Math.round(Number(draftSettings.maxRetries ?? 3))))} onChange={(e) => setDraftSettings({ ...draftSettings, maxRetries: Number(e.target.value) })} /></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>{t.settings.baseDelay}</label>
                  <input className="input" type="number" min={1} max={300} value={Math.min(300, Math.max(1, Math.round(Number(draftSettings.retryDelaySec ?? 5))))} onChange={(e) => setDraftSettings({ ...draftSettings, retryDelaySec: Number(e.target.value) })} /></div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiBox className="inline-icon" /> {t.settings.appSection}</h3>
              <p className="settings-section-sub">{t.settings.appSub}</p>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>{t.language.label}</label>
              <div className="theme-segment lang-segment" data-active={lang} role="radiogroup" aria-label={t.language.label}>
                {([
                  { key: 'en', label: t.language.english },
                  { key: 'fa', label: t.language.persian },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={lang === key}
                    className={lang === key ? 'active' : ''}
                    onClick={() => setLang(key)}
                  ><span key={label} className="lang-label">{label}</span></button>
                ))}
              </div>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>{t.settings.appearance}</label>
              <div className="theme-segment" role="radiogroup" aria-label={t.settings.appearance}>
                {([
                  { key: 'light', label: t.settings.light, Icon: FiSun },
                  { key: 'dark', label: t.settings.dark, Icon: FiMoon },
                  { key: 'system', label: t.settings.system, Icon: FiMonitor },
                ] as const).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={normalizeTheme(draftSettings.theme) === key}
                    className={normalizeTheme(draftSettings.theme) === key ? 'active' : ''}
                    onClick={() => {
                      setDraftSettings({ ...draftSettings, theme: key });
                      // Live preview without waiting for Save.
                      setThemeChoice(key);
                      try { localStorage.setItem(THEME_KEY, key); } catch {}
                    }}
                  ><Icon size={14} /> {label}</button>
                ))}
              </div>
              <label style={{ fontSize: 12 }}>{t.settings.closeAction}</label>
              <select
                className="input"
                value={draftSettings.closeAction || 'ask'}
                onChange={(e) => setDraftSettings({ ...draftSettings, closeAction: e.target.value })}
              >
                <option value="ask">{t.settings.ask}</option>
                <option value="minimize">{t.settings.minimize}</option>
                <option value="exit">{t.settings.exit}</option>
              </select>
            </div>

            <div
              ref={proxySectionRef}
              className={'settings-section' + (proxyHighlight ? ' settings-section-highlight' : '')}
            >
              <h3 className="settings-section-title"><FiGlobe className="inline-icon" /> {t.settings.proxySection}</h3>
              <p className="settings-section-sub">{t.settings.proxySub}</p>
              <label style={{ fontSize: 12 }}>{t.settings.proxyMode}</label>
              <select
                className="input"
                value={draftSettings.proxyMode || 'none'}
                onChange={(e) => setDraftSettings({ ...draftSettings, proxyMode: e.target.value })}
              >
                <option value="none">{t.settings.proxyNone}</option>
                <option value="system">{t.settings.proxySystem}</option>
                <option value="custom">{t.settings.proxyCustom}</option>
              </select>

              {(draftSettings.proxyMode || 'none') === 'custom' && (
                <>
                  <div className="row select-row">
                    <div className="proxy-type-wrap">
                      <label style={{ fontSize: 12 }}>{t.settings.proxyType}</label>
                      <select className="input" value={draftSettings.proxyType || 'http'} onChange={(e) => setDraftSettings({ ...draftSettings, proxyType: e.target.value })}>
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks4">SOCKS4</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>
                    <div className="proxy-host-wrap">
                      <label style={{ fontSize: 12 }}>{t.settings.proxyHost}</label>
                      <input className="input" placeholder={t.settings.proxyHostPlaceholder} value={draftSettings.proxyHost || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyHost: e.target.value })} />
                    </div>
                    <div className="proxy-port-wrap">
                      <label style={{ fontSize: 12 }}>{t.settings.proxyPort}</label>
                      <input className="input" type="number" min={1} max={65535} value={draftSettings.proxyPort || 8080} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPort: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>{t.settings.proxyUser}</label>
                      <input className="input" autoComplete="off" value={draftSettings.proxyUser || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyUser: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>{t.settings.proxyPass}</label>
                      <input className="input" type="password" autoComplete="new-password" value={draftSettings.proxyPass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPass: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {(draftSettings.proxyMode || 'none') !== 'none' && (
                <>
                  <label style={{ fontSize: 12 }}>{t.settings.proxyBypass}</label>
                  <input className="input" placeholder={t.settings.proxyBypassPlaceholder} value={draftSettings.proxyBypass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyBypass: e.target.value })} />
                </>
              )}
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiTool className="inline-icon" /> {t.settings.othersSection}</h3>
              <p className="settings-section-sub">{t.settings.othersSub}</p>
              <div className="vpn-status-box">
                <span className={'vpn-pill ' + (binStatus ? (binStatus.available ? 'on' : 'off') : '')}>
                  {binStatus ? (binStatus.available ? t.settings.ytdlp(binStatus.version || '') : t.settings.ytdlpMissing) : t.settings.checking}
                </span>
                <button
                  className="btn btn-small"
                  disabled={binRefreshing}
                  onClick={refreshBinStatus}
                >{binRefreshing ? t.settings.checkingBtn : t.common.refresh}</button>
                <button
                  className="btn btn-small"
                  title={binStatus?.path ? t.settings.openFolderTitle : t.settings.toolUnknown}
                  disabled={!binStatus?.path}
                  onClick={async () => {
                    if (!binStatus?.path || !hasBackend()) return;
                    try {
                      await window.jetro!.revealInFolder(binStatus.path);
                    } catch (e: any) {
                      alert(e?.message || t.common.couldNotOpenFolder);
                    }
                  }}
                ><FiFolder className="btn-icon" /></button>
              </div>
              {binStatus?.path && <div className="settings-muted"><code style={{ wordBreak: 'break-all' }}>{binStatus.path}</code></div>}
              <label style={{ fontSize: 13, marginTop: 10, display: 'block' }}><input type="checkbox" checked={draftSettings.checkUpdatesOnStart !== false} onChange={(e) => setDraftSettings({ ...draftSettings, checkUpdatesOnStart: e.target.checked })} /> {t.settings.updatesToggle}</label>
              <div className="vpn-status-box" style={{ marginTop: 8 }}>
                <span className={'vpn-pill ' + (updateInfo ? (updateInfo.updateAvailable ? 'off' : 'on') : '')}>
                  {updateChecking ? t.settings.checking : updateInfo ? (updateInfo.updateAvailable ? t.settings.updateAvailable(updateInfo.latest, updateInfo.current) : t.settings.upToDate(updateInfo.current)) : t.settings.notChecked}
                </span>
                <button
                  className="btn btn-small"
                  disabled={updateChecking}
                  onClick={async () => {
                    if (!hasBackend()) return;
                    setUpdateChecking(true);
                    try {
                      const r = await window.jetro!.checkUpdate?.();
                      if (r) setUpdateInfo(r);
                    } catch {}
                    setUpdateChecking(false);
                  }}
                >{updateChecking ? t.settings.checkingBtn : t.settings.checkNow}</button>
                {updateInfo?.updateAvailable && (
                  <button className="btn btn-small btn-primary" onClick={() => openExternalUrl(updateInfo.url || 'https://github.com/Erkalin/Jetro/releases')}>{t.settings.updateDownload}</button>
                )}
              </div>
              {updateInfo?.error && <div className="settings-muted">{updateInfo.error}</div>}
            </div>

            <div className="settings-section">
              <div className="danger-zone">
                <div className="danger-zone-text">
                  <h3 className="danger-zone-title">{t.settings.dangerSection}</h3>
                  <p className="danger-zone-sub">{t.settings.dangerSub}</p>
                </div>
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => { setResetError(''); setShowResetConfirm(true); }}
                ><FiTrash2 className="btn-icon" /> {t.settings.resetAll}</button>
              </div>
            </div>

            <div className="row modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={attemptCloseSettings}>{t.common.cancel}</button>
              <button className="btn btn-primary" onClick={saveSettingsAndClose}>{t.common.save}</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && showDiscardConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setShowDiscardConfirm(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiXCircle className="inline-icon" /> {t.discard.title}</h2>
            <p>{t.discard.body}</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setShowDiscardConfirm(false)}>{t.discard.keep}</button>
              <button className="btn btn-danger" onClick={discardSettingsChanges}>{t.discard.discard}</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && showResetConfirm && (
        <div className="modal-overlay" style={{ zIndex: 65 }} onClick={() => { if (!resetting) setShowResetConfirm(false); }}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiTrash2 className="inline-icon" /> {t.resetConfirm.title}</h2>
            <p>{t.resetConfirm.body}</p>
            {resetError && <div className="form-error">{resetError}</div>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" autoFocus disabled={resetting} onClick={() => setShowResetConfirm(false)}>{t.common.cancel}</button>
              <button className="btn btn-danger" disabled={resetting} onClick={handleResetAll}>{resetting ? t.resetConfirm.resetting : t.resetConfirm.confirm}</button>
            </div>
          </div>
        </div>
      )}

      {showClosePrompt && (
        <div className="modal-overlay" style={{ zIndex: 70 }} onClick={() => decideClose('cancel')}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiXCircle className="inline-icon" /> {t.closePrompt.title}</h2>
            <p>{t.closePrompt.body}</p>
            <p className="settings-section-sub">{t.closePrompt.sub}</p>
            <label style={{ fontSize: 13, display: 'block' }}>
              <input type="checkbox" checked={closeRemember} onChange={(e) => setCloseRemember(e.target.checked)} /> {t.closePrompt.remember}
            </label>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus onClick={() => decideClose('minimize')}>{t.closePrompt.minimize}</button>
              <button className="btn btn-danger" onClick={() => decideClose('exit')}>{t.closePrompt.exit}</button>
              <button className="btn" onClick={() => decideClose('cancel')}>{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {powerDialog && (
        <div className="modal-overlay" style={{ zIndex: 75 }}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{t.powerDialog.title(queuePowerLabel(powerDialog.action, t.power), powerDialog.secondsLeft)}</h2>
            <p>{t.powerDialog.body(powerDialog.queueName, queuePowerLabel(powerDialog.action, t.power))}</p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                autoFocus
                onClick={async () => {
                  try { await window.jetro?.powerExecute?.(powerDialog.queueId); } catch {}
                  setPowerDialog(null);
                }}
              >{t.powerDialog.now(queuePowerLabel(powerDialog.action, t.power))}</button>
              <button
                className="btn"
                onClick={async () => {
                  try { await window.jetro?.powerCancel?.(powerDialog.queueId); } catch {}
                  setPowerDialog(null);
                }}
              >{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {completedPopup && (
        <div className="modal-overlay complete-overlay" onClick={dismissCompletedPopup}>
          <div className="modal complete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="complete-glow" />
            <button className="complete-close" title={t.complete.dismissTitle} onClick={dismissCompletedPopup}><FiX size={16} /></button>
            <div className="complete-icon"><FiCheckCircle size={34} /></div>
            <h2 className="complete-title">{t.complete.title}</h2>
            <p className="complete-sub">{t.complete.sub}</p>
            <div className="complete-file">
              <div className="complete-file-icon"><OsFileIcon item={completedPopup} /></div>
              <div className="complete-file-info">
                <div className="complete-file-name" title={`${completedPopup.filename}\n${completedPopup.savePath}`}>{completedPopup.filename}</div>
                <div className="complete-file-meta">
                  <span>{fmtBytes(completedPopup.totalBytes || completedPopup.downloadedBytes)}</span>
                  <span className="complete-dot-sep">•</span>
                  <span className="complete-file-path" title={completedPopup.savePath}>{completedPopup.savePath}</span>
                </div>
              </div>
            </div>
            {completedQueue.length > 1 && (
              <div className="complete-more">{t.complete.more(completedQueue.length - 1)}</div>
            )}
            <div className="row complete-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.openFile(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || t.common.couldNotOpenFile);
                  }
                  dismissCompletedPopup();
                }}
              ><FiFileText className="btn-icon" /> {t.complete.openFile}</button>
              <button
                className="btn"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.revealInFolder(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || t.common.couldNotOpenFolder);
                  }
                  dismissCompletedPopup();
                }}
              ><FiFolder className="btn-icon" /> {t.complete.openFolder}</button>
            </div>
            <button className="complete-dismiss" onClick={dismissCompletedPopup}>{t.common.dismiss}</button>
          </div>
        </div>
      )}

      {pendingRemoveItem && pendingRemove && (
        <div className="modal-overlay" onClick={() => setPendingRemove(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {pendingRemove.deleteFile ? (
                <><FiTrash2 className="inline-icon" /> {t.removeConfirm.deleteTitle}</>
              ) : (
                <><FiXCircle className="inline-icon" /> {t.removeConfirm.cancelTitle}</>
              )}
            </h2>
            <p>
              {pendingRemove.deleteFile
                ? t.removeConfirm.deleteBody
                : t.removeConfirm.cancelBody}
            </p>
            <div className="complete-file">
              <div className="complete-file-icon"><OsFileIcon item={pendingRemoveItem} /></div>
              <div className="complete-file-info">
                <div className="complete-file-name" title={`${pendingRemoveItem.filename}\n${pendingRemoveItem.savePath}`}>{pendingRemoveItem.filename}</div>
                <div className="complete-file-meta">
                  {pendingRemove.deleteFile ? (
                    <>
                      <span>{fmtSize(pendingRemoveItem.totalBytes || pendingRemoveItem.downloadedBytes, !!pendingRemoveItem.totalBytesIsEstimate && pendingRemoveItem.status !== 'completed')}</span>
                      <span className="complete-dot-sep">•</span>
                      <span className="complete-file-path" title={pendingRemoveItem.savePath}>{pendingRemoveItem.savePath}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: statusColor(pendingRemoveItem.status), fontWeight: 700 }}>{statusLabel(pendingRemoveItem.status, t.status)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{pendingRemoveItem.totalBytes ? `${Math.min(100, (pendingRemoveItem.downloadedBytes / pendingRemoveItem.totalBytes) * 100).toFixed(1)}%` : fmtBytes(pendingRemoveItem.downloadedBytes)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{fmtBytes(pendingRemoveItem.downloadedBytes)} / {fmtSize(pendingRemoveItem.totalBytes, !!pendingRemoveItem.totalBytesIsEstimate && pendingRemoveItem.status !== 'completed')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setPendingRemove(null)}>
                {pendingRemove.deleteFile ? t.removeConfirm.keepFile : t.removeConfirm.keepDownloading}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  window.jetro?.remove(pendingRemoveItem.id, pendingRemove.deleteFile);
                  setPendingRemove(null);
                }}
              >{pendingRemove.deleteFile ? t.removeConfirm.deleteFile : t.removeConfirm.removeDownload}</button>
            </div>
          </div>
        </div>
      )}

      {renameState && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => { if (!renaming) setRenameState(null); }}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiEdit2 className="inline-icon" /> {t.renameModal.title}</h2>
            <p>{t.renameModal.body}</p>
            <label className="form-label">{t.renameModal.label}</label>
            <input
              className="input"
              autoFocus
              dir="auto"
              value={renameState.name}
              onChange={(e) => setRenameState({ ...renameState, name: e.target.value, error: '' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRenameModal();
                if (e.key === 'Escape' && !renaming) setRenameState(null);
              }}
              style={renameState.error ? { borderColor: 'var(--red)' } : undefined}
            />
            {renameState.error && <div className="form-error">{renameState.error}</div>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={renaming} onClick={() => setRenameState(null)}>{t.common.cancel}</button>
              <button className="btn btn-primary" disabled={renaming || !renameState.name.trim()} onClick={saveRenameModal}>
                {renaming ? t.renameModal.renaming : t.common.rename}
              </button>
            </div>
          </div>
        </div>
      )}

      {analyticsId && (() => {
        const it = items.find((x) => x.id === analyticsId) || null;
        if (!it) return null;
        return (
          <DownloadAnalytics
            item={it}
            queueName={it.queueId ? queueById(it.queueId)?.name || null : null}
            stats={getSpeedStats(it.id)}
            onClose={() => setAnalyticsId(null)}
          />
        );
      })()}

      {propsId && (() => {
        const it = items.find((x) => x.id === propsId) || null;
        if (!it) return null;
        const pct = it.totalBytes ? Math.min(100, (it.downloadedBytes / it.totalBytes) * 100) : 0;
        const qn = it.queueId ? queueById(it.queueId)?.name : null;
        const rows: [string, string, boolean?][] = [
          [t.props.fileName, it.filename],
          [t.props.url, it.url, true],
          [t.props.savePath, it.savePath, true],
          [t.props.status, `${statusLabel(it.status, t.status)}${it.status !== 'completed' ? ` — ${pct.toFixed(2)}%` : ''}`],
          [t.props.size, it.status === 'completed'
            ? fmtBytes(it.totalBytes || it.downloadedBytes)
            : `${fmtBytes(it.downloadedBytes)} / ${fmtSize(it.totalBytes, !!it.totalBytesIsEstimate)}`, true],
          [t.props.speed, (it.status === 'downloading' || it.status === 'merging') ? fmtSpeed(it.speedBps || 0) : '—', true],
          [t.props.connections, `${it.connections}x${it.supportsRange ? '' : t.props.singleConn}`],
          [t.props.category, it.category || t.props.other],
          [t.props.queue, qn || t.common.noQueue],
          [t.props.created, it.createdAt ? new Date(it.createdAt).toLocaleString(localeName) : '—'],
          [t.props.lastTry, fmtLastTryTitle(lastTryOf(it), t.months.neverTried, localeName)],
        ];
        if (it.via === 'ytdlp') rows.push([t.props.source, it.audioOnly ? t.props.audioSrc : t.props.videoSrc(it.videoHeight || 0)]);
        if (it.error) rows.push([t.props.error, it.error]);
        return (
          <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPropsId(null)}>
            <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title"><FiInfo className="inline-icon" /> {t.props.title}</h2>
              <div className="complete-file" style={{ marginBottom: 12 }}>
                <div className="complete-file-icon"><OsFileIcon item={it} /></div>
                <div className="complete-file-info">
                  <div className="complete-file-name" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
                  <div className="complete-file-meta">
                    <span style={{ color: statusColor(it.status), fontWeight: 700 }}>{statusLabel(it.status, t.status)}</span>
                    <span className="complete-dot-sep">•</span>
                    <span>{pct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="props-table">
                {rows.map(([k, v, ltr]) => (
                  <div className="props-row" key={k}>
                    <div className="props-key">{k}</div>
                    <div className="props-val" dir={ltr ? 'ltr' : undefined} title={v}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 16 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!hasBackend()) return;
                    try { await window.jetro!.revealInFolder(it.savePath); } catch (e: any) { alert(e?.message || t.common.couldNotOpenFolder); }
                  }}
                ><FiFolder className="btn-icon" /> {t.complete.openFolder}</button>
                <button className="btn btn-primary" autoFocus onClick={() => setPropsId(null)}>{t.common.close}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
