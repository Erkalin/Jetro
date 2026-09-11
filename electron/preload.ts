import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('jetro', {
  addDownload: (url: string, opts?: any) => ipcRenderer.invoke('dl:add', url, opts),
  probe: (url: string) => ipcRenderer.invoke('dl:probe', url),
  resolveBatch: (urls: string[]) => ipcRenderer.invoke('batch:resolve', urls),
  addBatch: (urls: string[], opts?: any) => ipcRenderer.invoke('batch:add', urls, opts),
  pause: (id: string) => ipcRenderer.invoke('dl:pause', id),
  resume: (id: string) => ipcRenderer.invoke('dl:resume', id),
  remove: (id: string, deleteFile?: boolean) => ipcRenderer.invoke('dl:remove', id, deleteFile),
  moveToQueue: (id: string, queueId?: string | null) => ipcRenderer.invoke('dl:move', id, queueId),
  list: () => ipcRenderer.invoke('dl:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: any) => ipcRenderer.invoke('settings:save', s),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke('dialog:folder', defaultPath),
  pickFile: () => ipcRenderer.invoke('dialog:file'),
  fileExists: (dir?: string, filename?: string) =>
    ipcRenderer.invoke('file:exists', dir, filename),
  getFileIcon: (savePath?: string, filename?: string) =>
    ipcRenderer.invoke('file:icon', savePath, filename),
  revealInFolder: (savePath: string) => ipcRenderer.invoke('file:reveal', savePath),
  openFile: (savePath: string) => ipcRenderer.invoke('file:open', savePath),
  openWith: (savePath: string) => ipcRenderer.invoke('file:open-with', savePath),
  renameDownload: (id: string, newName: string) => ipcRenderer.invoke('dl:rename', id, newName),
  redownload: (id: string) => ipcRenderer.invoke('dl:redownload', id),
  refreshDownload: (id: string) => ipcRenderer.invoke('dl:refresh', id),
  probeVideo: (url: string, opts?: any) => ipcRenderer.invoke('video:probe', url, opts),
  downloadVideo: (opts: any) =>
    ipcRenderer.invoke('video:download', opts),
  getBinaryStatus: () => ipcRenderer.invoke('binaries:status'),
  updateYtDlp: () => ipcRenderer.invoke('binaries:update-ytdlp'),
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
  onClipboardUrl: (cb: (url: string) => void) => {
    const fn = (_: any, url: string) => cb(url);
    ipcRenderer.on('clipboard-url', fn);
    return () => ipcRenderer.removeListener('clipboard-url', fn);
  },
  onSettingsChanged: (cb: (s: any) => void) => {
    const fn = (_: any, s: any) => cb(s);
    ipcRenderer.on('settings:changed', fn);
    return () => ipcRenderer.removeListener('settings:changed', fn);
  },
  onCloseRequest: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('app:close-request', fn);
    return () => ipcRenderer.removeListener('app:close-request', fn);
  },
  decideClose: (opts: { decision: 'minimize' | 'exit' | 'cancel'; remember?: boolean }) =>
    ipcRenderer.invoke('app:close-decision', opts),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-url', url),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  powerExecute: (queueId: string) => ipcRenderer.invoke('power:execute', queueId),
  powerCancel: (queueId: string) => ipcRenderer.invoke('power:cancel', queueId),
  onQueuePower: (cb: (info: { queueId: string; queueName: string; action: string }) => void) => {
    const fn = (_: any, info: any) => cb(info);
    ipcRenderer.on('queue:power-ready', fn);
    return () => ipcRenderer.removeListener('queue:power-ready', fn);
  },
});
