interface QueueItem {
  id: string;
  name: string;
  running: boolean;
  maxConcurrent: number;
  schedulerEnabled: boolean;
  scheduleStart: string;
  scheduleStop: string;
  createdAt: number;
}

interface JetroAPI {
  addDownload: (url: string, opts?: any) => Promise<any>;
  probe: (url: string) => Promise<{ totalBytes: number; supportsRange: boolean; filename: string; contentType: string }>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string, deleteFile?: boolean) => Promise<void>;
  moveToQueue: (id: string, queueId?: string | null) => Promise<any>;
  list: () => Promise<any[]>;
  getSettings: () => Promise<any>;
  saveSettings: (s: any) => Promise<any>;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  pickSave: (suggestedName?: string) => Promise<string | null>;
  getFileIcon: (savePath?: string, filename?: string) => Promise<string | null>;
  revealInFolder: (savePath: string) => Promise<boolean>;
  openFile: (savePath: string) => Promise<boolean>;
  resolveProxy: (targetUrl: string) => Promise<{ proxyUrl: string | null; source: string; raw?: string | null }>;
  testProxy: (testUrl?: string, override?: any) => Promise<any>;
  getPublicIp: () => Promise<{ ip: string; via: string | null; source: string }>;
  getVpnStatus: () => Promise<{
    vpnDetected: boolean;
    interfaces: { name: string; addresses: string[] }[];
    totalInterfaces: number;
    publicIp: string | null;
    ipError: string | null;
    killSwitch: boolean;
  }>;
  probeVideo: (url: string) => Promise<any>;
  listQueues: () => Promise<QueueItem[]>;
  createQueue: (name?: string) => Promise<QueueItem>;
  updateQueue: (id: string, patch: Partial<QueueItem>) => Promise<QueueItem>;
  deleteQueue: (id: string) => Promise<boolean>;
  startQueue: (id: string) => Promise<QueueItem>;
  stopQueue: (id: string) => Promise<QueueItem>;
  onUpdate: (cb: (items: any[]) => void) => () => void;
  onQueues: (cb: (queues: QueueItem[]) => void) => () => void;
}
declare global {
  interface Window {
    jetro?: JetroAPI;
  }
}
export {};
