import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiArchive, FiArrowDown, FiBox, FiCheckCircle, FiChevronDown, FiClipboard,
  FiClock, FiCpu, FiDisc, FiDownloadCloud, FiEdit2, FiEye, FiEyeOff, FiFileText, FiFilm,
  FiFolder, FiGlobe, FiHardDrive, FiInbox, FiLayers, FiMusic, FiPause, FiPlay,
  FiPlus, FiSettings, FiShield, FiSquare, FiTrash2, FiX, FiXCircle, FiZap,
} from 'react-icons/fi';
import jetroLogo from './assets/Jetro-notext.png';

interface Item {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: string;
  speedBps: number;
  connections: number;
  supportsRange: boolean;
  error?: string;
  category: string;
  queueId?: string | null;
}

interface Queue {
  id: string;
  name: string;
  running: boolean;
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
}

function fmtBytes(n: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
function fmtSpeed(bps: number) {
  if (!bps) return '0 KB/s';
  return fmtBytes(bps) + '/s';
}
function statusLabel(status: string) {
  switch (status) {
    case 'downloading': return 'Downloading';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'paused': return 'Paused';
    case 'queued': return 'Queued';
    case 'merging': return 'Merging';
    default: return status;
  }
}
function statusColor(status: string) {
  switch (status) {
    case 'downloading': return '#16a34a';
    case 'completed': return '#1976d2';
    case 'error': return '#dc2626';
    case 'paused': return '#ca8a04';
    default: return '#64748b';
  }
}
function CategoryIcon({ cat, size = 20 }: { cat: string; size?: number }) {
  const map: Record<string, typeof FiBox> = {
    video: FiFilm,
    audio: FiMusic,
    compressed: FiArchive,
    document: FiFileText,
    program: FiCpu,
    other: FiBox,
  };
  const Icon = map[cat] || FiBox;
  return <Icon size={size} className="file-fallback-icon" />;
}
function guessNameFromUrl(url: string): string {
  const tryParse = (candidate: string) => {
    const u = new URL(candidate);
    const base = decodeURIComponent(u.pathname.split('/').pop() || '').split('?')[0];
    if (base && base.includes('.')) return base.replace(/[<>:"/\\|?*]/g, '_');
    return null;
  };
  try {
    const name = tryParse(url);
    if (name) return name;
  } catch {}
  try {
    const name = tryParse(`https://${url}`);
    if (name) return name;
  } catch {}
  return 'download.bin';
}

function isValidDownloadHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');
  if (!h || h.length > 253) return false;
  if (h === 'localhost') return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    return h.split('.').every((p) => {
      if (!p || p.length > 3 || !/^\d+$/.test(p)) return false;
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
  if (h.includes(':')) {
    return /^[0-9a-f:]+$/i.test(h) && h.includes(':');
  }
  if (!h.includes('.')) return false;
  if (h.includes('_') || h.includes(' ') || h.includes('/')) return false;
  const labels = h.split('.');
  if (labels.some((l) => !l || l.length > 63)) return false;
  const labelRe = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => labelRe.test(l))) return false;
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/[a-z]/.test(tld)) return false;
  return true;
}

/**
 * Accept bare domains (e.g. `abcdef.xyz/file.zip`) as well as full URLs.
 * Missing scheme defaults to https://. Throws a user-facing error otherwise.
 */
function normalizeDownloadUrl(raw: string): string {
  const input = String(raw || '').trim();
  if (!input) throw new Error('Please enter a download link.');
  if (input.length > 2048 || /\s/.test(input)) {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
  if (!hasScheme) {
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(input);
    if (schemeMatch) {
      const scheme = schemeMatch[1];
      const after = input.slice(schemeMatch[0].length);
      // Don't mistake host:port for a scheme (localhost:3000/x, example.com:8080/x).
      const looksLikeHostPort =
        /^\d+(\/|$|\?|#)/.test(after) || scheme.includes('.') || scheme.toLowerCase() === 'localhost';
      if (!looksLikeHostPort) {
        throw new Error('Only http:// and https:// links are supported.');
      }
    }
  }
  const candidate = hasScheme ? input : input.startsWith('//') ? `https:${input}` : `https://${input}`;
  // Guard against WHATWG URL parsing all-numeric hosts as IPv4
  // (e.g. "123.456" becomes 123.0.1.200): reject numeric hosts that
  // aren't valid 4-part IPv4 before parsing.
  let rawHost = candidate.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  if (rawHost.startsWith('[')) {
    const end = rawHost.indexOf(']');
    rawHost = end === -1 ? rawHost : rawHost.slice(1, end);
  } else if (!rawHost.includes(':') || /:\d*$/.test(rawHost)) {
    rawHost = rawHost.replace(/:\d*$/, '');
  }
  if (!rawHost.includes(':') && /^[\d.]+$/.test(rawHost)) {
    const parts = rawHost.split('.');
    const validIpv4 =
      parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    if (!validIpv4) {
      throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
    }
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are supported.');
  }
  if (!u.hostname || !isValidDownloadHost(u.hostname)) {
    throw new Error('Please enter a valid link (e.g. example.com/file.zip).');
  }
  return candidate;
}

const FILENAME_FALLBACK = 'download.bin';

/** Extension (format) of a file name, lowercased and without the dot. '' if none. */
function extOf(name: string): string {
  const base = (name.split(/[\\/]/).pop() || '').trim();
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

const hasBackend = () => typeof window !== 'undefined' && !!window.jetro;

// OS file icon — same icon File Explorer shows, via Electron app.getFileIcon.
function OsFileIcon({ item }: { item: Item }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!hasBackend()) return;
    window
      .jetro!.getFileIcon(item.savePath, item.filename)
      .then((d) => {
        if (alive) setSrc(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.savePath, item.filename]);
  if (src) {
    return (
      <div className="file-icon">
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  return <div className="file-icon"><CategoryIcon cat={item.category} /></div>;
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
  const [newConns, setNewConns] = useState(8);
  const [savePath, setSavePath] = useState('');
  const [newQueueId, setNewQueueId] = useState('');
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<any>({ maxConnections: 8, maxConcurrentDownloads: 3, downloadDir: '', speedLimitKBps: 0, schedulerEnabled: false, schedulerStart: '01:00', schedulerStop: '07:00', proxyMode: 'none', proxyType: 'http', proxyHost: '', proxyPort: 8080, proxyUser: '', proxyPass: '', proxyBypass: 'localhost,127.0.0.1,::1', vpnKillSwitch: false });

  // proxy / VPN diagnostics in Settings
  const [vpnStatus, setVpnStatus] = useState<any>(null);
  const [vpnLoading, setVpnLoading] = useState(false);
  const [showPublicIp, setShowPublicIp] = useState(false);

  // settings draft + unsaved-changes guard (draft is edited, `settings` stays saved until Save)
  const [draftSettings, setDraftSettings] = useState<any | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // queue context menu + modals
  const [ctx, setCtx] = useState<{ x: number; y: number; queueId: string | null } | null>(null);
  const [showQueueModal, setShowQueueModal] = useState<null | { mode: 'create' | 'edit'; queueId?: string }>(null);
  const [qName, setQName] = useState('');
  const [qNameError, setQNameError] = useState('');
  const [qConcurrent, setQConcurrent] = useState(2);
  const [qSchedOn, setQSchedOn] = useState(false);
  const [qStart, setQStart] = useState('22:00');
  const [qStop, setQStop] = useState('07:00');

  // toolbar selection + queue dropdowns
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueMenu, setQueueMenu] = useState<null | 'start' | 'stop'>(null);

  // remove / delete confirmation ({ id, deleteFile }: deleteFile removes the file from disk)
  const [pendingRemove, setPendingRemove] = useState<{ id: string; deleteFile: boolean } | null>(null);

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
    window.jetro!.getSettings().then(setSettings).catch(() => {});
    window.jetro!.listQueues().then(setQueues).catch(() => {});
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
    return () => {
      off1();
      off2();
    };
  }, []);

  // close context menu on escape / resize
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);

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

  // Escape dismisses the complete popup
  useEffect(() => {
    if (completedQueue.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCompletedQueue((prev) => prev.slice(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [completedQueue.length]);

  const queueById = (id: string | null | undefined) => queues.find((q) => q.id === id);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filter.startsWith('queue:')) {
        const qid = filter.slice(6);
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
      if (query && !(i.filename + i.url).toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, query]);

  const totalSpeed = items.filter((i) => i.status === 'downloading').reduce((a, b) => a + (b.speedBps || 0), 0);
  const counts = (k: string) => {
    if (k === 'all') return items.length;
    if (k === 'downloading') return items.filter((i) => i.status === 'downloading').length;
    if (k === 'completed') return items.filter((i) => i.status === 'completed').length;
    if (k === 'failed') return items.filter((i) => i.status === 'error').length;
    if (k === 'paused') return items.filter((i) => i.status === 'paused').length;
    if (k === 'queued') return items.filter((i) => i.status === 'queued').length;
    if (k === 'cat-video') return items.filter((i) => i.category === 'video').length;
    if (k === 'cat-documents') return items.filter((i) => i.category === 'document').length;
    if (k === 'cat-archives') return items.filter((i) => i.category === 'compressed').length;
    if (k === 'cat-software') return items.filter((i) => i.category === 'program').length;
    if (k === 'cat-others') return items.filter((i) => i.category === 'other' || i.category === 'audio').length;
    if (k.startsWith('queue:')) {
      const qid = k.slice(6);
      return items.filter((i) => (i.queueId || null) === qid).length;
    }
    return 0;
  };

  const chooseSaveFolder = async () => {
    if (!hasBackend()) return null;
    const picked = await window.jetro!.pickFolder(savePath || settings.downloadDir);
    if (picked) setSavePath(picked);
    return picked;
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
      setFilenameError('Please enter a file name.');
      return null;
    }
    if (name.length > 255) {
      setFilenameError('File name is too long (max 255 characters).');
      return null;
    }
    if (/[<>:"/\\|?*]/.test(name) || /[\x00-\x1f]/.test(name)) {
      setFilenameError('File name can\'t contain any of these characters: < > : " / \\ | ? *');
      return null;
    }
    if (/[. ]$/.test(name)) {
      setFilenameError('File name can\'t end with a space or dot.');
      return null;
    }
    if (/^\.+$/.test(name)) {
      setFilenameError('Please enter a valid file name.');
      return null;
    }
    setFilenameError('');
    return name;
  };

  const doAdd = async (u: string, finalName: string, presetSavePath?: string, presetQueueId?: string) => {
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
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
      });
      setNewUrl('');
      setUrlError('');
      setNewFilename('');
      setFilenameError('');
      setProbedFilename('');
      setProbedOk(false);
      filenameTouchedRef.current = false;
      setSavePath('');
      setNewQueueId('');
      setShowAdd(false);
    } catch (e: any) {
      setUrlError(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).');
    } finally {
      setAdding(false);
    }
  };

  const addDl = async (url?: string, presetSavePath?: string, presetQueueId?: string) => {
    const raw = (url || newUrl).trim();
    if (!raw) {
      setUrlError('Please enter a download link.');
      return;
    }
    let u: string;
    try {
      u = normalizeDownloadUrl(raw);
    } catch (e: any) {
      setUrlError(e?.message || 'Please enter a valid link (e.g. example.com/file.zip).');
      return;
    }
    if (!hasBackend()) { alert('Run via Electron (npm run app:dev) for real downloads.'); return; }
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
    await doAdd(u, checked, presetSavePath, presetQueueId);
  };

  const confirmFormatAnyway = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    await doAdd(p.url, p.finalName);
  };

  const useOriginalFilename = async () => {
    const p = pendingFormatConfirm;
    if (!p) return;
    setPendingFormatConfirm(null);
    setNewFilename(p.detectedName);
    setFilenameError('');
    filenameTouchedRef.current = true;
    await doAdd(p.url, p.detectedName);
  };

  // Fresh file-name state every time the New Download dialog opens.
  useEffect(() => {
    if (!showAdd) return;
    setUrlError('');
    setFilenameError('');
    setNewFilename('');
    setProbedFilename('');
    setProbedOk(false);
    setPendingFormatConfirm(null);
    filenameTouchedRef.current = false;
  }, [showAdd]);

  // Auto-fill the file name box from the link: instant client-side guess first,
  // then the authoritative name from the backend probe (debounced). Never
  // overwrites a name the user typed themselves.
  useEffect(() => {
    if (!showAdd) return;
    const raw = newUrl.trim();
    if (!raw) {
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
  useEffect(() => {
    if (!pendingFormatConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingFormatConfirm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingFormatConfirm]);

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
      setQNameError('Queue name cannot be empty');
      throw new Error('Queue name cannot be empty');
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
      maxConcurrent: 2,
      schedulerEnabled: false,
      scheduleStart: '22:00',
      scheduleStop: '07:00',
      createdAt: Date.now(),
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
    if (!confirm(`Delete queue "${q.name}"?\nIts files will be kept under No queue (paused).`)) return;
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
    setQConcurrent(Math.min(5, Math.max(1, settings.maxConcurrentDownloads || 2)));
    setQSchedOn(false);
    setQStart('22:00');
    setQStop('07:00');
    setShowQueueModal({ mode: 'create' });
    setCtx(null);
  };

  const openEditModal = (q: Queue) => {
    setQName(q.name);
    setQNameError('');
    setQConcurrent(q.maxConcurrent);
    setQSchedOn(!!q.schedulerEnabled);
    setQStart(q.scheduleStart);
    setQStop(q.scheduleStop);
    setShowQueueModal({ mode: 'edit', queueId: q.id });
    setCtx(null);
  };

  const saveQueueModal = async () => {
    const clean = qName.trim();
    if (!clean) {
      setQNameError('Queue name cannot be empty');
      return;
    }
    setQNameError('');
    try {
      if (showQueueModal?.mode === 'create') {
        const q = await handleCreateQueue(clean);
        // apply extra fields if user changed them
        if (hasBackend() && q) {
          await window.jetro!.updateQueue(q.id, {
            maxConcurrent: qConcurrent,
            schedulerEnabled: qSchedOn,
            scheduleStart: qStart,
            scheduleStop: qStop,
          });
          await refreshQueues();
        } else if (q) {
          setQueues((p) => p.map((x) => (x.id === q.id ? { ...x, maxConcurrent: qConcurrent, schedulerEnabled: qSchedOn, scheduleStart: qStart, scheduleStop: qStop } : x)));
        }
        if (q) setFilter(`queue:${q.id}`);
      } else if (showQueueModal?.mode === 'edit' && showQueueModal.queueId) {
        const id = showQueueModal.queueId;
        if (hasBackend()) {
          await window.jetro!.updateQueue(id, {
            name: clean,
            maxConcurrent: qConcurrent,
            schedulerEnabled: qSchedOn,
            scheduleStart: qStart,
            scheduleStop: qStop,
          });
          await refreshQueues();
        } else {
          setQueues((p) => p.map((x) => (x.id === id ? { ...x, name: clean, maxConcurrent: qConcurrent, schedulerEnabled: qSchedOn, scheduleStart: qStart, scheduleStop: qStop } : x)));
        }
      }
      setShowQueueModal(null);
    } catch (e: any) {
      setQNameError(e?.message || 'Could not save queue');
    }
  };

  const moveItemToQueue = async (itemId: string, queueId: string | null) => {
    if (hasBackend()) {
      try {
        await window.jetro!.moveToQueue(itemId, queueId);
      } catch (e: any) {
        alert(e?.message || 'Could not move (maybe downloading). Pause it first.');
      }
      return;
    }
    setItems((p) => p.map((it) => (it.id === itemId ? { ...it, queueId } : it)));
  };

  const openCtx = (e: React.MouseEvent, queueId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 230;
    const h = 190;
    const x = Math.min(e.clientX, window.innerWidth - w - 12);
    const y = Math.min(e.clientY, window.innerHeight - h - 12);
    setCtx({ x, y, queueId });
  };

  // ---------- proxy / VPN diagnostics ----------
  const refreshVpnStatus = async () => {
    if (!hasBackend()) return;
    setVpnLoading(true);
    try {
      setVpnStatus(await window.jetro!.getVpnStatus());
    } catch {}
    setVpnLoading(false);
  };

  useEffect(() => {
    if (!showSettings || !hasBackend()) return;
    refreshVpnStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // ---------- settings open / save / cancel with unsaved-changes guard ----------
  const openSettings = () => {
    setDraftSettings(JSON.parse(JSON.stringify(settings)));
    setShowDiscardConfirm(false);
    setShowSettings(true);
  };

  const isSettingsDirty =
    showSettings &&
    draftSettings &&
    JSON.stringify(draftSettings) !== JSON.stringify(settings);

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
      await window.jetro?.saveSettings(draftSettings);
      setSettings(draftSettings);
    }
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  const discardSettingsChanges = () => {
    setShowDiscardConfirm(false);
    setShowSettings(false);
    setDraftSettings(null);
  };

  // Escape in Settings: dismiss discard-confirm first, otherwise attempt close (asks if dirty)
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showDiscardConfirm) setShowDiscardConfirm(false);
      else attemptCloseSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, showDiscardConfirm, draftSettings, settings]);

  const statusNav: { key: string; label: string; Icon: typeof FiInbox }[] = [
    { key: 'all', label: 'All', Icon: FiInbox },
    { key: 'downloading', label: 'Downloading', Icon: FiArrowDown },
    { key: 'completed', label: 'Completed', Icon: FiCheckCircle },
    { key: 'failed', label: 'Failed', Icon: FiXCircle },
    { key: 'paused', label: 'Paused', Icon: FiPause },
    { key: 'queued', label: 'Queued', Icon: FiClock },
  ];

  const categoryNav: { key: string; label: string; Icon: typeof FiBox }[] = [
    { key: 'cat-video', label: 'Video', Icon: FiFilm },
    { key: 'cat-documents', label: 'Documents', Icon: FiFileText },
    { key: 'cat-archives', label: 'Archives', Icon: FiArchive },
    { key: 'cat-software', label: 'Software', Icon: FiDisc },
    { key: 'cat-others', label: 'Others', Icon: FiBox },
  ];

  const ctxQueue = ctx?.queueId ? queueById(ctx.queueId) : null;
  const completedPopup = completedQueue[0] || null;
  const dismissCompletedPopup = () => setCompletedQueue((prev) => prev.slice(1));

  // ---------- toolbar state ----------
  const selected = items.find((i) => i.id === selectedId) || null;
  const canResume = !!selected && (selected.status === 'paused' || selected.status === 'error');
  const canStop = !!selected && (selected.status === 'downloading' || selected.status === 'queued');
  const canStopAll = items.some((i) => i.status === 'downloading' || i.status === 'queued');

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
  useEffect(() => {
    if (!pendingRemove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingRemove(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingRemove]);

  // close queue dropdown on escape
  useEffect(() => {
    if (!queueMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQueueMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queueMenu]);

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
    const active = items.filter((i) => i.status === 'downloading' || i.status === 'queued');
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
          <div className="logo"><img src={jetroLogo} alt="Jetro" className="logo-img" draggable={false} /><span className="logo-text">Jetro</span><span className="logo-version">v0.1</span><button className="logo-settings-btn" title="Settings" onClick={openSettings}><FiSettings size={16} /></button></div>
          <div className="sidebar-nav">
            {statusNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div className="nav-section">Categories</div>
            {categoryNav.map(({ key, label, Icon }) => (
              <div key={key} className={'nav-item' + (filter === key ? ' active' : '')} onClick={() => setFilter(key)}>
                <span className="nav-label"><Icon className="nav-icon" />{label}</span>
                <span className="nav-count">{counts(key)}</span>
              </div>
            ))}
            <div
              className="nav-section row-between"
              onContextMenu={(e) => openCtx(e, null)}
              title="Right-click for queue options"
            >
              <span>Queues</span>
              <button className="nav-add-btn" title="Create new queue" onClick={openCreateModal}><FiPlus size={13} /></button>
            </div>
            {queues.map((q) => {
              const key = `queue:${q.id}`;
              return (
                <div
                  key={q.id}
                  className={'nav-item' + (filter === key ? ' active' : '')}
                  onClick={() => setFilter(key)}
                  onContextMenu={(e) => openCtx(e, q.id)}
                  title={`Right-click: Start/Stop, Edit, Delete\n${q.running ? 'Running' : 'Stopped'} • ${q.maxConcurrent} concurrent${q.schedulerEnabled ? ` • ${q.scheduleStart}–${q.scheduleStop}` : ''}`}
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
                <div className="speed-meter-label">Download speed</div>
                <div className="speed-meter-value">{fmtSpeed(totalSpeed)}</div>
              </div>
              <span className={'speed-meter-dot' + (totalSpeed > 0 ? ' live' : '')} />
            </div>
            <div className="sidebar-path"><FiHardDrive className="inline-icon" /> {settings.downloadDir || '…'}</div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <button className="btn btn-primary" onClick={() => { setSavePath(settings.downloadDir || ''); setNewQueueId(''); setUrlError(''); setShowAdd(true); }}><FiPlus className="btn-icon" /> New Download</button>
            <input className="search" placeholder="Search downloads…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="toolbar">
            <button className="btn" disabled={!canResume} title={canResume ? `Resume ${selected?.filename}` : 'Select a paused or failed download'} onClick={handleResumeSelected}><FiPlay className="btn-icon" /> Resume</button>
            <button className="btn" disabled={!canStop} title={canStop ? `Stop ${selected?.filename}` : 'Select an active download'} onClick={handleStopSelected}><FiPause className="btn-icon" /> Stop</button>
            <button className="btn" disabled={!canStopAll} title={canStopAll ? 'Stop all active downloads' : 'No active downloads'} onClick={handleStopAll}><FiSquare className="btn-icon" /> Stop All</button>
            <span className="toolbar-sep" />
            <div className="toolbar-dropdown">
              <button className="btn" title="Start a queue" onClick={() => setQueueMenu(queueMenu === 'start' ? null : 'start')}><FiPlay className="btn-icon" /> Start Queue <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'start' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">No queues yet</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={q.running}
                        title={q.running ? `"${q.name}" is already running` : `Start "${q.name}"`}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiPlay className="btn-icon" /> {q.name}{q.running ? ' (running)' : ''}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="toolbar-dropdown">
              <button className="btn" title="Stop a running queue" onClick={() => setQueueMenu(queueMenu === 'stop' ? null : 'stop')}><FiSquare className="btn-icon" /> Stop Queue <FiChevronDown className="btn-icon" /></button>
              {queueMenu === 'stop' && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setQueueMenu(null)} />
                  <div className="dropdown-menu">
                    {queues.length === 0 && <div className="dropdown-empty">No queues yet</div>}
                    {queues.map((q) => (
                      <button
                        key={q.id}
                        className="ctx-item"
                        disabled={!q.running}
                        title={q.running ? `Stop "${q.name}"` : `"${q.name}" is not running`}
                        onClick={() => {
                          handleStartStopQueue(q);
                          setQueueMenu(null);
                        }}
                      ><FiSquare className="btn-icon" /> {q.name}{q.running ? '' : ' (stopped)'}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="list">
            {filter.startsWith('queue:') && (
              <div className="card" style={{ justifyContent: 'space-between' }}>
                <div>
                  <b className="queue-title"><FiLayers className="inline-icon" /> {queueById(filter.slice(6))?.name || 'Queue'}</b>{' '}
                  <span className="badge green">{queueById(filter.slice(6))?.running ? 'Running' : 'Stopped'}</span>{' '}
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {counts(filter)} files
                    {queueById(filter.slice(6))?.schedulerEnabled
                      ? ` • schedule ${queueById(filter.slice(6))?.scheduleStart}–${queueById(filter.slice(6))?.scheduleStop}`
                      : ''}
                  </span>
                </div>
                <div className="row">
                  {queueById(filter.slice(6))?.running ? (
                    <button className="btn" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiSquare className="btn-icon" /> Stop</button>
                  ) : (
                    <button className="btn btn-primary" onClick={() => queueById(filter.slice(6)) && handleStartStopQueue(queueById(filter.slice(6))!)}><FiPlay className="btn-icon" /> Start</button>
                  )}
                  <button className="btn" onClick={() => queueById(filter.slice(6)) && openEditModal(queueById(filter.slice(6))!)}>Edit</button>
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="card"><div className="empty" style={{ width: '100%' }}>
                <div className="empty-big"><FiDownloadCloud size={48} /></div>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>No downloads here</div>
                <div>Paste a link — Jetro will ask where to save and split it into {settings.maxConnections} parallel segments for faster downloads.</div>
              </div></div>
            )}
            {filtered.map((it) => {
              const pct = it.totalBytes ? Math.min(100, (it.downloadedBytes / it.totalBytes) * 100) : 0;
              const completed = it.status === 'completed';
              const qNameOf = it.queueId ? queueById(it.queueId)?.name : null;
              return (
                <div
                  className={'card' + (selectedId === it.id ? ' selected' : '')}
                  key={it.id}
                  onClick={() => setSelectedId((prev) => (prev === it.id ? null : it.id))}
                >
                  <OsFileIcon item={it} />
                  <div className="card-body">
                    <div className="card-title" title={`${it.filename}\n${it.savePath}`}>{it.filename}</div>
                    <div className="card-url" title={it.savePath}>{it.url}</div>
                    <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }} /></div>
                    <div className="meta">
                      <span><b style={{ color: '#0f172a' }}>{pct.toFixed(1)}%</b></span>
                      <span>{fmtBytes(it.downloadedBytes)} / {fmtBytes(it.totalBytes)}</span>
                      <span style={{ color: statusColor(it.status), fontWeight: 700 }}>{statusLabel(it.status)}</span>
                      <span className="badge"><FiZap className="inline-icon" /> {it.connections}x {it.supportsRange ? '' : '• single'}</span>
                      {qNameOf && <span className="badge green"><FiLayers className="inline-icon" /> {qNameOf}</span>}
                      {it.status === 'error' && <span className="badge red">{it.error}</span>}
                      <select
                        className="queue-select"
                        title="Add / move to queue"
                        value={it.queueId || ''}
                        disabled={it.status === 'downloading'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => moveItemToQueue(it.id, e.target.value || null)}
                      >
                        <option value="">No queue</option>
                        {queues.map((q) => (
                          <option key={q.id} value={q.id}>{q.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="actions" onClick={(e) => e.stopPropagation()}>
                    {it.status === 'downloading' || it.status === 'queued'
                      ? <button className="icon-btn" title="Pause" onClick={() => window.jetro?.pause(it.id)}><FiPause size={15} /></button>
                      : !completed && <button className="icon-btn" title="Resume" onClick={() => window.jetro?.resume(it.id)}><FiPlay size={15} /></button>}
                    {completed ? (
                      <>
                        <button
                          className="icon-btn"
                          title="Open containing folder"
                          onClick={async () => {
                            if (!hasBackend()) return;
                            try {
                              await window.jetro!.revealInFolder(it.savePath);
                            } catch (e: any) {
                              alert(e?.message || 'Could not open folder');
                            }
                          }}
                        ><FiFolder size={15} /></button>
                        <button
                          className="icon-btn danger"
                          title="Delete file and remove from list"
                          onClick={() => setPendingRemove({ id: it.id, deleteFile: true })}
                        ><FiTrash2 size={15} /></button>
                      </>
                    ) : (
                      <button className="icon-btn" title="Remove" onClick={() => setPendingRemove({ id: it.id, deleteFile: false })}><FiX size={15} /></button>
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
          <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            {ctx.queueId && ctxQueue ? (
              <>
                <button
                  className="ctx-item"
                  onClick={() => {
                    handleStartStopQueue(ctxQueue);
                    setCtx(null);
                  }}
                ><span className="ctx-icon">{ctxQueue.running ? <FiSquare size={14} /> : <FiPlay size={14} />}</span> {ctxQueue.running ? 'Stop queue' : 'Start queue'}</button>
                <button className="ctx-item" onClick={() => openEditModal(ctxQueue)}><FiEdit2 size={14} /> Edit Queue / Schedule</button>
                <div className="ctx-sep" />
                <button className="ctx-item danger" onClick={() => handleDeleteQueue(ctxQueue)}><FiTrash2 size={14} /> Delete queue</button>
                <div className="ctx-sep" />
              </>
            ) : (
              <div style={{ padding: '6px 12px', fontSize: 12, color: '#64748b' }}>Queue options</div>
            )}
            <button className="ctx-item" onClick={openCreateModal}><FiPlus size={14} /> Create New Queue</button>
          </div>
        </>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiPlus className="inline-icon" /> New download</h2>
            <p>Paste a link — rename the file below if you like, then choose where to save it.</p>
            <input
              className="input"
              autoFocus
              placeholder="example.com/file.zip"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); if (urlError) setUrlError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
              style={urlError ? { borderColor: '#dc2626' } : undefined}
            />
            {urlError && <div style={{ fontSize: 12, color: '#dc2626', margin: '-6px 0 10px' }}>{urlError}</div>}
            {newUrl.trim() !== '' && (
              <>
                <label style={{ fontSize: 12, color: '#64748b' }}>File name</label>
                <input
                  className="input"
                  placeholder={probedFilename || 'e.g. Mr Robot.mp4'}
                  value={newFilename}
                  onChange={(e) => {
                    setNewFilename(e.target.value);
                    filenameTouchedRef.current = true;
                    if (filenameError) setFilenameError('');
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addDl(); }}
                  style={filenameError ? { borderColor: '#dc2626' } : undefined}
                />
                {filenameError && <div style={{ fontSize: 12, color: '#dc2626', margin: '-6px 0 10px' }}>{filenameError}</div>}
                {!filenameError && probedFilename !== '' && probedFilename !== newFilename.trim() && (
                  <div style={{ fontSize: 12, color: '#64748b', margin: '-6px 0 10px' }}>Detected: {probedFilename}</div>
                )}
              </>
            )}
            <label style={{ fontSize: 12, color: '#64748b' }}>Save to folder</label>
            <div className="save-path-box">
              <input className="input" placeholder="Choose a folder…" value={savePath} onChange={(e) => setSavePath(e.target.value)} />
              <button className="btn" title="Choose folder" onClick={() => chooseSaveFolder()}>…</button>
            </div>
            <div className="row">
              <select className="input" style={{ flex: 1, minWidth: 0, marginBottom: 0 }} value={newConns} onChange={(e) => setNewConns(Number(e.target.value))}>
                {[1, 4, 8, 16, 32].map((n) => <option key={n} value={n}>{n} connections</option>)}
              </select>
              <select className="input" style={{ flex: 1, minWidth: 0, marginBottom: 0 }} value={newQueueId} onChange={(e) => setNewQueueId(e.target.value)} title="Add to queue">
                <option value="">No queue</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>{q.name}{q.running ? ' (running)' : ''}</option>
                ))}
              </select>
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) { setNewUrl(t.trim()); setUrlError(''); filenameTouchedRef.current = false; } } catch {} }}><FiClipboard className="btn-icon" /> Paste from clipboard</button>
            <div className="row modal-actions">
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={adding} onClick={() => addDl()}>{adding ? 'Starting…' : 'Download'}</button>
            </div>
          </div>
        </div>
      )}

      {pendingFormatConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setPendingFormatConfirm(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiFileText className="inline-icon" /> Change file format?</h2>
            <p>
              The link points to {pendingFormatConfirm.detExt ? <>a <b>.{pendingFormatConfirm.detExt}</b> file</> : 'a file with no extension'}{' '}
              (<b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.detectedName}</b>), but you named it{' '}
              <b style={{ wordBreak: 'break-all' }}>{pendingFormatConfirm.finalName}</b>
              {pendingFormatConfirm.finalExt ? '' : ' (no extension)'}. The downloaded content
              stays the same — only the name changes, and your system may no longer recognize how to open it.
            </p>
            <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" autoFocus disabled={adding} onClick={confirmFormatAnyway}>{adding ? 'Starting…' : 'Download anyway'}</button>
              <button className="btn" disabled={adding} onClick={useOriginalFilename}>Use original name</button>
              <button className="btn" disabled={adding} onClick={() => setPendingFormatConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showQueueModal && (
        <div className="modal-overlay" onClick={() => setShowQueueModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{showQueueModal.mode === 'create' ? (<><FiPlus className="inline-icon" /> Create New Queue</>) : (<><FiEdit2 className="inline-icon" /> Edit Queue / Schedule</>)}</h2>
            <p>{showQueueModal.mode === 'create' ? 'Group downloads and start them together, optionally on a schedule.' : 'Rename, limit concurrency, or schedule this queue.'}</p>
            <label style={{ fontSize: 12 }}>Queue name *</label>
            <input
              className="input"
              autoFocus
              value={qName}
              onChange={(e) => {
                setQName(e.target.value);
                if (e.target.value.trim()) setQNameError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && qName.trim()) saveQueueModal();
              }}
              placeholder="e.g. Night batch"
              style={qNameError ? { borderColor: '#dc2626' } : undefined}
            />
            {qNameError && <div style={{ fontSize: 12, color: '#dc2626', margin: '-6px 0 10px' }}>{qNameError}</div>}
            <label style={{ fontSize: 12 }}>Max concurrent downloads in this queue</label>
            <input className="input" type="number" min={1} max={10} value={qConcurrent} onChange={(e) => setQConcurrent(Number(e.target.value))} />
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={qSchedOn} onChange={(e) => setQSchedOn(e.target.checked)} /> Run only on schedule
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Start</label>
                <input className="input" type="time" value={qStart} disabled={!qSchedOn} onChange={(e) => setQStart(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12 }}>Stop</label>
                <input className="input" type="time" value={qStop} disabled={!qSchedOn} onChange={(e) => setQStop(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={saveQueueModal} disabled={!qName.trim()}>
                {showQueueModal.mode === 'create' ? 'Create queue' : 'Save changes'}
              </button>
              <button className="btn" onClick={() => setShowQueueModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && draftSettings && (
        <div className="modal-overlay" onClick={attemptCloseSettings}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiSettings className="inline-icon" /> Settings</h2>
            <p>Queue, speed limit, proxy & VPN.</p>
            <label style={{ fontSize: 12 }}>Default download folder</label>
            <div className="row">
              <input className="input" value={draftSettings.downloadDir} onChange={(e) => setDraftSettings({ ...draftSettings, downloadDir: e.target.value })} />
              <button className="btn" onClick={async () => { const f = await window.jetro?.pickFolder(); if (f) setDraftSettings((s: any) => ({ ...s, downloadDir: f })); }}>…</button>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Connections (1–32)</label>
                <input className="input" type="number" min={1} max={32} value={draftSettings.maxConnections} onChange={(e) => setDraftSettings({ ...draftSettings, maxConnections: Number(e.target.value) })} /></div>
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Concurrent downloads</label>
                <input className="input" type="number" min={1} max={10} value={draftSettings.maxConcurrentDownloads} onChange={(e) => setDraftSettings({ ...draftSettings, maxConcurrentDownloads: Number(e.target.value) })} /></div>
            </div>
            <label style={{ fontSize: 12 }}>Speed limit KB/s (0 = unlimited)</label>
            <input className="input" type="number" value={draftSettings.speedLimitKBps} onChange={(e) => setDraftSettings({ ...draftSettings, speedLimitKBps: Number(e.target.value) })} />
            <div className="row">
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Schedule start</label>
                <input className="input" value={draftSettings.schedulerStart} onChange={(e) => setDraftSettings({ ...draftSettings, schedulerStart: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Schedule stop</label>
                <input className="input" value={draftSettings.schedulerStop} onChange={(e) => setDraftSettings({ ...draftSettings, schedulerStop: e.target.value })} /></div>
            </div>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!draftSettings.schedulerEnabled} onChange={(e) => setDraftSettings({ ...draftSettings, schedulerEnabled: e.target.checked })} /> Scheduler enabled &nbsp;</label>
            <label style={{ fontSize: 13, marginLeft: 12 }}><input type="checkbox" checked={!!draftSettings.autoCaptureClipboard} onChange={(e) => setDraftSettings({ ...draftSettings, autoCaptureClipboard: e.target.checked })} /> Clipboard auto-capture</label>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiGlobe className="inline-icon" /> Proxy</h3>
              <p className="settings-section-sub">Route all download traffic through a proxy. Applies to new requests immediately.</p>
              <label style={{ fontSize: 12 }}>Proxy mode</label>
              <select
                className="input"
                value={draftSettings.proxyMode || 'none'}
                onChange={(e) => setDraftSettings({ ...draftSettings, proxyMode: e.target.value })}
              >
                <option value="none">No proxy (direct connection)</option>
                <option value="system">Use system proxy</option>
                <option value="custom">Custom proxy</option>
              </select>

              {(draftSettings.proxyMode || 'none') === 'custom' && (
                <>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Type</label>
                      <select className="input" value={draftSettings.proxyType || 'http'} onChange={(e) => setDraftSettings({ ...draftSettings, proxyType: e.target.value })}>
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks4">SOCKS4</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 12 }}>Host</label>
                      <input className="input" placeholder="proxy.example.com" value={draftSettings.proxyHost || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyHost: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Port</label>
                      <input className="input" type="number" min={1} max={65535} value={draftSettings.proxyPort || 8080} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPort: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="row">
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Username (optional)</label>
                      <input className="input" autoComplete="off" value={draftSettings.proxyUser || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyUser: e.target.value })} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Password (optional)</label>
                      <input className="input" type="password" autoComplete="new-password" value={draftSettings.proxyPass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyPass: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {(draftSettings.proxyMode || 'none') !== 'none' && (
                <>
                  <label style={{ fontSize: 12 }}>Bypass (comma-separated, always skips localhost)</label>
                  <input className="input" placeholder="localhost,127.0.0.1,::1" value={draftSettings.proxyBypass || ''} onChange={(e) => setDraftSettings({ ...draftSettings, proxyBypass: e.target.value })} />
                </>
              )}
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title"><FiShield className="inline-icon" /> VPN</h3>
              <p className="settings-section-sub">Jetro uses your system VPN (Windows VPN, WireGuard, OpenVPN app). Connect outside Jetro — Jetro detects the tunnel and can stop downloads if it drops.</p>
              <div className="vpn-status-box">
                <span className={'vpn-pill ' + (vpnStatus ? (vpnStatus.vpnDetected ? 'on' : 'off') : '')}>
                  {vpnStatus ? (vpnStatus.vpnDetected ? '● VPN connected' : '○ No VPN detected') : '… checking'}
                </span>
                <button className="btn btn-small" disabled={vpnLoading} onClick={refreshVpnStatus}>{vpnLoading ? 'Checking…' : 'Refresh'}</button>
              </div>
              {vpnStatus && (
                <div className="settings-muted">
                  <div className="ip-row">
                    <span>Public IP:</span>
                    <button
                      className="icon-btn ip-eye"
                      title={showPublicIp ? 'Hide public IP' : 'Show public IP'}
                      onClick={() => setShowPublicIp((v) => !v)}
                    >{showPublicIp ? <FiEyeOff size={14} /> : <FiEye size={14} />}</button>
                    <code className={showPublicIp ? '' : 'ip-blurred'}>{vpnStatus.publicIp || ('unavailable' + (vpnStatus.ipError ? ` (${vpnStatus.ipError})` : ''))}</code>
                  </div>
                  {vpnStatus.interfaces?.length > 0 && (
                    <div>Tunnel: <code>{vpnStatus.interfaces.map((i: any) => `${i.name} (${i.addresses.join(', ')})`).join(' • ')}</code></div>
                  )}
                </div>
              )}
              <label style={{ fontSize: 13, marginTop: 8, display: 'block' }}>
                <input type="checkbox" checked={!!draftSettings.vpnKillSwitch} onChange={(e) => setDraftSettings({ ...draftSettings, vpnKillSwitch: e.target.checked })} /> VPN kill-switch — auto-pause downloads if the VPN tunnel drops
              </label>
            </div>

            <div className="row modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={attemptCloseSettings}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSettingsAndClose}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && showDiscardConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }} onClick={() => setShowDiscardConfirm(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title"><FiXCircle className="inline-icon" /> Discard unsaved changes?</h2>
            <p>You have unsaved changes in Settings. If you cancel now, your changes will be lost.</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setShowDiscardConfirm(false)}>Keep editing</button>
              <button className="btn btn-danger" onClick={discardSettingsChanges}>Discard changes</button>
            </div>
          </div>
        </div>
      )}

      {completedPopup && (
        <div className="modal-overlay complete-overlay" onClick={dismissCompletedPopup}>
          <div className="modal complete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="complete-glow" />
            <button className="complete-close" title="Dismiss" onClick={dismissCompletedPopup}><FiX size={16} /></button>
            <div className="complete-icon"><FiCheckCircle size={34} /></div>
            <h2 className="complete-title">Download complete</h2>
            <p className="complete-sub">Your file is ready</p>
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
              <div className="complete-more">+{completedQueue.length - 1} more finished</div>
            )}
            <div className="row complete-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.openFile(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || 'Could not open file');
                  }
                  dismissCompletedPopup();
                }}
              ><FiFileText className="btn-icon" /> Open file</button>
              <button
                className="btn"
                onClick={async () => {
                  if (!hasBackend()) { dismissCompletedPopup(); return; }
                  try {
                    await window.jetro!.revealInFolder(completedPopup.savePath);
                  } catch (e: any) {
                    alert(e?.message || 'Could not open folder');
                  }
                  dismissCompletedPopup();
                }}
              ><FiFolder className="btn-icon" /> Open folder</button>
            </div>
            <button className="complete-dismiss" onClick={dismissCompletedPopup}>Dismiss</button>
          </div>
        </div>
      )}

      {pendingRemoveItem && pendingRemove && (
        <div className="modal-overlay" onClick={() => setPendingRemove(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {pendingRemove.deleteFile ? (
                <><FiTrash2 className="inline-icon" /> Delete download?</>
              ) : (
                <><FiXCircle className="inline-icon" /> Cancel download?</>
              )}
            </h2>
            <p>
              {pendingRemove.deleteFile
                ? 'This will delete the downloaded file from your disk and remove it from the list. This cannot be undone.'
                : 'This download is not complete yet. Removing it will stop the download and discard its progress.'}
            </p>
            <div className="complete-file">
              <div className="complete-file-icon"><OsFileIcon item={pendingRemoveItem} /></div>
              <div className="complete-file-info">
                <div className="complete-file-name" title={`${pendingRemoveItem.filename}\n${pendingRemoveItem.savePath}`}>{pendingRemoveItem.filename}</div>
                <div className="complete-file-meta">
                  {pendingRemove.deleteFile ? (
                    <>
                      <span>{fmtBytes(pendingRemoveItem.totalBytes || pendingRemoveItem.downloadedBytes)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span className="complete-file-path" title={pendingRemoveItem.savePath}>{pendingRemoveItem.savePath}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: statusColor(pendingRemoveItem.status), fontWeight: 700 }}>{statusLabel(pendingRemoveItem.status)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{pendingRemoveItem.totalBytes ? `${Math.min(100, (pendingRemoveItem.downloadedBytes / pendingRemoveItem.totalBytes) * 100).toFixed(1)}%` : fmtBytes(pendingRemoveItem.downloadedBytes)}</span>
                      <span className="complete-dot-sep">•</span>
                      <span>{fmtBytes(pendingRemoveItem.downloadedBytes)} / {fmtBytes(pendingRemoveItem.totalBytes)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" autoFocus onClick={() => setPendingRemove(null)}>
                {pendingRemove.deleteFile ? 'Keep file' : 'Keep downloading'}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  window.jetro?.remove(pendingRemoveItem.id, pendingRemove.deleteFile);
                  setPendingRemove(null);
                }}
              >{pendingRemove.deleteFile ? 'Delete file' : 'Remove download'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
