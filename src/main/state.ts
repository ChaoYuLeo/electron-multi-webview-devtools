import type { BrowserWindow } from 'electron'
import type { LayoutPayload, SessionInfo } from '../shared/session'
import { INITIAL_LAYOUT } from './constants'
import type { ManagedSession } from './types'

export class MainState {
  private mainWindow: BrowserWindow | null = null
  private sessionCounter = 1
  private activeSessionId: string | null = null
  private currentLayout: LayoutPayload = INITIAL_LAYOUT
  private readonly sessions = new Map<string, ManagedSession>()

  getWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  setWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  nextSessionIdentity(): { id: string; order: number } {
    const order = this.sessionCounter
    this.sessionCounter += 1
    return {
      id: `wv-${order}`,
      order
    }
  }

  getLayout(): LayoutPayload {
    return this.currentLayout
  }

  setLayout(layout: LayoutPayload): void {
    this.currentLayout = layout
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  setActiveSessionId(id: string | null): void {
    this.activeSessionId = id
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id)
  }

  addSession(session: ManagedSession): void {
    this.sessions.set(session.id, session)
  }

  deleteSession(id: string): void {
    this.sessions.delete(id)
  }

  getSessionCount(): number {
    return this.sessions.size
  }

  getOrderedSessions(): ManagedSession[] {
    return [...this.sessions.values()].sort((left, right) => left.order - right.order)
  }

  getSessionList(): SessionInfo[] {
    return this.getOrderedSessions().map((session) => ({
      ...session.info,
      isActive: session.id === this.activeSessionId
    }))
  }

  getSessionInfo(id: string): SessionInfo | null {
    return this.getSessionList().find((session) => session.id === id) ?? null
  }
}
