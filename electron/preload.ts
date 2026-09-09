import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jetro', {
  addDownload: (url: string, opts?: any) => ipcRenderer.invoke('dl:add', url, opts),
  probe: (url: string) => ipcRenderer.invoke('dl:probe', url),
  pause: (id: string) => ipcRenderer.invoke('dl:pause', id),
  resume: (id: string) => ipcRenderer.invoke('dl:resume', id),
  remove: (id: string, deleteFile?: boolean) => ipcRenderer.invoke('dl:remove', id, deleteFile),
  moveToQueue: (id: string, queueId?: string | null) => ipcRenderer.invoke('dl:move', id, queueId),
  list: () => ipcRenderer.invoke('dl:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: any) => ipcRenderer.invoke('settings:save', s),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke('dialog:folder', defaultPath),
  pickSave: (suggestedName?: string) => ipcRenderer.invoke('dialog:save', suggestedName),
  getFileIcon: (savePath?: string, filename?: string) =>
    ipcRenderer.invoke('file:icon', savePath, filename),
  revealInFolder: (savePath: string) => ipcRenderer.invoke('file:reveal', savePath),
  openFile: (savePath: string) => ipcRenderer.invoke('file:open', savePath),
  resolveProxy: (targetUrl: string) => ipcRenderer.invoke('proxy:resolve', targetUrl),
  testProxy: (testUrl?: string, override?: any) => ipcRenderer.invoke('proxy:test', testUrl, override),
  getPublicIp: () => ipcRenderer.invoke('net:public-ip'),
  getVpnStatus: () => ipcRenderer.invoke('vpn:status'),
  probeVideo: (url: string) => ipcRenderer.invoke('video:probe', url),
  listQueues: () => ipcRenderer.invoke('queue:list'),
  createQueue: (name?: string) => ipcRenderer.invoke('queue:create', name),
  updateQueue: (id: string, patch: any) => ipcRenderer.invoke('queue:update', id, patch),
  deleteQueue: (id: string) => ipcRenderer.invoke('queue:delete', id),
  startQueue: (id: string) => ipcRenderer.invoke('queue:start', id),
  stopQueue: (id: string) => ipcRenderer.invoke('queue:stop', id),
  onUpdate: (cb: (items: any[]) => void) => {
    const fn = (_: any, items: any[]) => cb(items);
    ipcRenderer.on('dl:update', fn);
    return () => ipcRenderer.removeListener('dl:update', fn);
  },
  onQueues: (cb: (queues: any[]) => void) => {
    const fn = (_: any, queues: any[]) => cb(queues);
    ipcRenderer.on('queue:update', fn);
    return () => ipcRenderer.removeListener('queue:update', fn);
  },
});
