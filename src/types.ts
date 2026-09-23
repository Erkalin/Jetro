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
  /** Position inside its queue (lower = higher priority). Defaults to createdAt order. */
  queueOrder?: number;
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

export type QueueScheduleMode = 'once' | 'daily';

export interface Queue {
  id: string;
  name: string;
  running: boolean;
  /** How many files of this queue download at the same time (1-10, default 1). */
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
  afterComplete?: QueuePowerAction;
  powerFiredAt?: number | null;
  /** Start downloads automatically when the app launches. */
  startOnStartup?: boolean;
  /** Whether the start-time gate is enabled ("Start download at"). */
  startAtEnabled?: boolean;
  /** Whether the stop-time gate is enabled ("Stop download at"). */
  stopAtEnabled?: boolean;
  /** Once vs daily schedule. */
  scheduleMode?: QueueScheduleMode;
  /** Once date as YYYY-MM-DD (used when scheduleMode === 'once'). */
  onceDate?: string;
  /** 7 weekday flags Sun..Sat (used when scheduleMode === 'daily'). */
  weekdays?: boolean[];
  /** Per-file retries override (null = use global settings). */
  retriesPerFile?: number | null;
  /** Absolute path opened when the queue finishes. */
  openWhenDone?: string;
  /** Quit the app when the queue finishes. */
  exitAppWhenDone?: boolean;
  /** Force running processes to terminate on shutdown/restart. */
  forceTerminate?: boolean;
}

export type ThemeId =
  | 'jetro'
  | 'midnight'
  | 'system'
  | 'gray'
  | 'silver'
  | 'crimson'
  | 'coral'
  | 'amber'
  | 'teal'
  | 'navy'
  | 'turquoise'
  | 'indigo'
  | 'aqua'
  | 'nord'
  | 'dracula'
  | 'solarized'
  | 'forest'
  | 'blossom'
  | 'espresso'
  | 'lavender'
  | 'ember'
  | 'pistachio'
  | 'ruby'
  | 'scarlet'
  | 'gold'
  | 'hunter'
  | 'clover';

/** Kept for backward compatibility — identical to ThemeId. */
export type ThemeChoice = ThemeId;

export type ViewMode = 'cards' | 'details';

export type DetailColId = 'name' | 'queue' | 'status' | 'size' | 'speed' | 'eta' | 'lastTry';

export type BatchMode = 'numbers' | 'letters';
