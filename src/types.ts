export interface Item {
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
  via?: string;
  videoHeight?: number;
  audioOnly?: boolean;
  totalBytesIsEstimate?: boolean;
  createdAt?: number;
  /** Last attempt timestamp (backend). Falls back to createdAt for old rows. */
  lastTryAt?: number;
  attempts?: number;
  nextRetryAt?: number | null;
  subtitles?: boolean;
}

export type QueuePowerAction = 'nothing' | 'sleep' | 'hibernate' | 'shutdown' | 'restart';

export interface Queue {
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

export type ThemeChoice = 'light' | 'dark' | 'system';

export type ViewMode = 'cards' | 'details';

export type DetailColId = 'name' | 'queue' | 'status' | 'size' | 'speed' | 'eta' | 'lastTry';

export type BatchMode = 'numbers' | 'letters';
