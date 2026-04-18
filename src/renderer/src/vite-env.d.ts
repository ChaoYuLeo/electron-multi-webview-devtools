/// <reference types="vite/client" />

import type { LayoutPayload, SessionInfo } from '../../shared/session'

type ElectronApi = {
  getSessions: () => Promise<SessionInfo[]>
  createSession: (url?: string) => Promise<SessionInfo>
  navigateSession: (id: string, url: string) => Promise<SessionInfo | null>
  activateSession: (id: string) => Promise<SessionInfo[]>
  closeSession: (id: string) => Promise<SessionInfo[]>
  goBack: (id: string) => Promise<SessionInfo[]>
  goForward: (id: string) => Promise<SessionInfo[]>
  reload: (id: string) => Promise<SessionInfo[]>
  setInspectMode: (id: string, enabled: boolean) => Promise<SessionInfo[]>
  setLayout: (payload: LayoutPayload) => void
  onSessionsChanged: (listener: (sessions: SessionInfo[]) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronApi
  }
}

export {}
