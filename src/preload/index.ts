import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutPayload, SessionInfo } from '../shared/session'

const electronApi = {
  getSessions: () => ipcRenderer.invoke('app:get-sessions'),
  createSession: (url?: string) => ipcRenderer.invoke('app:create-session', url),
  navigateSession: (id: string, url: string) => ipcRenderer.invoke('app:navigate-session', { id, url }),
  activateSession: (id: string) => ipcRenderer.invoke('app:activate-session', id),
  closeSession: (id: string) => ipcRenderer.invoke('app:close-session', id),
  goBack: (id: string) => ipcRenderer.invoke('app:go-back', id),
  goForward: (id: string) => ipcRenderer.invoke('app:go-forward', id),
  reload: (id: string) => ipcRenderer.invoke('app:reload', id),
  setInspectMode: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('app:set-inspect-mode', { id, enabled }),
  setLayout: (payload: LayoutPayload) => ipcRenderer.send('app:set-layout', payload),
  onSessionsChanged: (listener: (sessions: SessionInfo[]) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sessions: SessionInfo[]) => listener(sessions)
    ipcRenderer.on('app:sessions-changed', wrapped)
    return () => {
      ipcRenderer.removeListener('app:sessions-changed', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronApi)

declare global {
  interface Window {
    electronAPI: typeof electronApi
  }
}
