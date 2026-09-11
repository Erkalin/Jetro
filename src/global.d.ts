type QueuePowerAction = 'nothing' | 'sleep' | 'hibernate' | 'shutdown' | 'restart';

interface QueueItem {
  id: string;
  name: string;
  running: boolean;
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
  afterComplete?: QueuePowerAction;
  powerFiredAt?: number | null;
}

declare global {
  interface PlaylistEntry {
    index: number;
    id: string;
    title: string;
    duration?: number;
    url: string;
  }
  interface BatchResolveRow {
    url: string;
    ok: boolean;
    filename: string;
    totalBytes: number;
    supportsRange: boolean;
    contentType: string;
    error?: string;
  }

  interface VideoFormat {
    kind?: 'video' | 'audio';
    quality: string;
    url: string;
    ext: string;
    height: number;
    needsMerge: boolean;
    title?: string;
    abr?: number;
    acodec?: string;
    fps?: number;
    /** Combined download size estimate (video+audio for merges). 0 = unknown. */
    estimatedBytes?: number;
    /** True when any component is filesize_approx / bitrate-derived (final may be larger). */
    estimatedApprox?: boolean;
  }

  interface BinaryStatus {
    available: boolean;
    path: string | null;
    version: string | null;
    ffmpeg: string | null;
    ffmpegPath: string;
    ffprobe: string | null;
    ffprobePath: string;
    quickjs: string | null;
    quickjsPath: string | null;
    userPath: string;
    bundled: string | null;
  }
}

interface JetroAPI {
  addDownload: (url: string, opts?: any) => Promise<any>;
  probe: (url: string) => Promise<{ totalBytes: number; supportsRange: boolean; filename: string; contentType: string }>;
  resolveBatch: (urls: string[]) => Promise<BatchResolveRow[]>;
  addBatch: (urls: string[], opts?: any) => Promise<{ batchId: string; queueId: string; queueName: string; count: number; ids: string[] }>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string, deleteFile?: boolean) => Promise<void>;
  moveToQueue: (id: string, queueId?: string | null) => Promise<any>;
  list: () => Promise<any[]>;
  getSettings: () => Promise<any>;
  saveSettings: (s: any) => Promise<any>;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  pickFile: () => Promise<string | null>;
  fileExists: (dir?: string, filename?: string) => Promise<{ exists: boolean; path: string; size?: number }>;
  getFileIcon: (savePath?: string, filename?: string) => Promise<string | null>;
  revealInFolder: (savePath: string) => Promise<boolean>;
  openFile: (savePath: string) => Promise<boolean>;
  openWith: (savePath: string) => Promise<boolean>;
  renameDownload: (id: string, newName: string) => Promise<any>;
  redownload: (id: string) => Promise<any>;
  refreshDownload: (id: string) => Promise<any>;
  probeVideo: (url: string, opts?: any) => Promise<{ formats: VideoFormat[]; hint: string; title?: string; detail?: string; needsCookies?: boolean; cookieError?: string; playlist?: { title: string; count: number; entries: PlaylistEntry[] } }>;
  downloadVideo: (opts: any) => Promise<any>;
  getBinaryStatus: () => Promise<BinaryStatus>;
  updateYtDlp: () => Promise<{ ok: boolean; version?: string; error?: string }>;
  listQueues: () => Promise<QueueItem[]>;
  createQueue: (name?: string) => Promise<QueueItem>;
  updateQueue: (id: string, patch: Partial<QueueItem>) => Promise<QueueItem>;
  deleteQueue: (id: string) => Promise<boolean>;
  startQueue: (id: string) => Promise<QueueItem>;
  stopQueue: (id: string) => Promise<QueueItem>;
  onUpdate: (cb: (items: any[]) => void) => () => void;
  onQueues: (cb: (queues: QueueItem[]) => void) => () => void;
  onClipboardUrl: (cb: (url: string) => void) => () => void;
  onSettingsChanged?: (cb: (s: any) => void) => () => void;
  onCloseRequest?: (cb: () => void) => () => void;
  decideClose?: (opts: { decision: 'minimize' | 'exit' | 'cancel'; remember?: boolean }) => Promise<any>;
  openExternal?: (url: string) => Promise<boolean>;
  checkUpdate?: () => Promise<{ current: string; latest: string; updateAvailable: boolean; url: string; error?: string }>;
  powerExecute?: (queueId: string) => Promise<any>;
  powerCancel?: (queueId: string) => Promise<any>;
  onQueuePower?: (cb: (info: { queueId: string; queueName: string; action: string }) => void) => () => void;
}
declare global {
  interface Window {
    jetro?: JetroAPI;
  }
}
export {};
