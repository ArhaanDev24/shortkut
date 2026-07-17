import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('key:set', provider, key),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  listOllamaModels: (baseUrl: string) => ipcRenderer.invoke('ollama:models', baseUrl),
  testConnection: (settings: unknown, key: string | null) =>
    ipcRenderer.invoke('connection:test', settings, key),
  permissionsStatus: () => ipcRenderer.invoke('permissions:status'),
  requestPermission: (kind: string) => ipcRenderer.invoke('permissions:request', kind),

  listChats: () => ipcRenderer.invoke('chats:list'),
  getChat: (id: string) => ipcRenderer.invoke('chats:get', id),
  deleteChat: (id: string) => ipcRenderer.invoke('chats:delete', id),
  renameChat: (id: string, title: string) => ipcRenderer.invoke('chats:rename', id, title),
  getStats: () => ipcRenderer.invoke('stats:get'),
  // File.path is gone in modern Electron; this is the sanctioned way to get a dropped file's path.
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  sendMessage: (chatId: string, text: string) => ipcRenderer.send('chat:send', chatId, text),
  stop: () => ipcRenderer.send('chat:stop'),
  respondApproval: (id: string, approved: boolean) => ipcRenderer.send('approval:respond', id, approved),

  onAgentEvent: (cb: (chatId: string, event: unknown) => void) => {
    const listener = (_e: unknown, chatId: string, event: unknown): void => cb(chatId, event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  }
}

contextBridge.exposeInMainWorld('shortkut', api)

export type ShortKutApi = typeof api
