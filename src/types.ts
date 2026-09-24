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
  queueOrder?: number;
  via?: string;
  videoHeight?: number;
  audioOnly?: boolean;
  totalBytesIsEstimate?: boolean;
  createdAt?: number;
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
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
  afterComplete?: QueuePowerAction;
  powerFiredAt?: number | null;
  startOnStartup?: boolean;
  startAtEnabled?: boolean;
  stopAtEnabled?: boolean;
  scheduleMode?: QueueScheduleMode;
  onceDate?: string;
  weekdays?: boolean[];
  retriesPerFile?: number | null;
  openWhenDone?: string;
  exitAppWhenDone?: boolean;
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

export type ThemeChoice = ThemeId;

export type ViewMode = 'cards' | 'details';

export type DetailColId = 'name' | 'queue' | 'status' | 'size' | 'speed' | 'eta' | 'lastTry';

export type BatchMode = 'numbers' | 'letters';
