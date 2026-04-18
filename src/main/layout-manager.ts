import type { BrowserWindow } from 'electron'
import type { LayoutRect } from '../shared/session'
import { MainState } from './state'
import type { ManagedSession } from './types'

type UpdateSessionEmulation = (session: ManagedSession, viewport?: LayoutRect) => Promise<void>

export class LayoutManager {
  private readonly state: MainState
  private readonly updateSessionEmulation: UpdateSessionEmulation

  constructor(state: MainState, updateSessionEmulation: UpdateSessionEmulation) {
    this.state = state
    this.updateSessionEmulation = updateSessionEmulation
  }

  syncAttachedViews(): void {
    const window = this.state.getWindow()
    if (!window) {
      return
    }

    for (const session of this.state.getOrderedSessions()) {
      this.detachView(window, session.contentView)
      this.detachView(window, session.devtoolsView)
    }

    const activeSessionId = this.state.getActiveSessionId()
    if (!activeSessionId) {
      return
    }

    const activeSession = this.state.getSession(activeSessionId)
    if (!activeSession) {
      return
    }

    const { mobileViewport, devtoolsViewport } = this.state.getLayout()
    if (mobileViewport.width <= 0 || mobileViewport.height <= 0) {
      return
    }

    const previewSessions = this.state
      .getOrderedSessions()
      .filter((session) => session.id !== activeSessionId)
      .slice(-3)

    for (const [index, session] of previewSessions.entries()) {
      const depth = previewSessions.length - index
      const previewBounds = {
        x: mobileViewport.x + depth * 18,
        y: mobileViewport.y + depth * 12,
        width: Math.max(320, mobileViewport.width - depth * 36),
        height: Math.max(480, mobileViewport.height - depth * 24)
      }

      this.ensureViewAttached(window, session.contentView)
      session.contentView.setBounds({
        x: Math.round(previewBounds.x),
        y: Math.round(previewBounds.y),
        width: Math.round(previewBounds.width),
        height: Math.round(previewBounds.height)
      })
      void this.updateSessionEmulation(session, previewBounds)
    }

    this.ensureViewAttached(window, activeSession.contentView)
    activeSession.contentView.setBounds({
      x: Math.round(mobileViewport.x),
      y: Math.round(mobileViewport.y),
      width: Math.round(mobileViewport.width),
      height: Math.round(mobileViewport.height)
    })

    if (devtoolsViewport.width > 0 && devtoolsViewport.height > 0) {
      this.ensureViewAttached(window, activeSession.devtoolsView)
      activeSession.devtoolsView.setBounds({
        x: Math.round(devtoolsViewport.x),
        y: Math.round(devtoolsViewport.y),
        width: Math.round(devtoolsViewport.width),
        height: Math.round(devtoolsViewport.height)
      })
    }

    void this.updateSessionEmulation(activeSession, mobileViewport)
  }

  private ensureViewAttached(window: BrowserWindow, view: Electron.WebContentsView): void {
    if (!window.contentView.children.includes(view)) {
      window.contentView.addChildView(view)
    }
  }

  private detachView(window: BrowserWindow, view: Electron.WebContentsView): void {
    if (window.contentView.children.includes(view)) {
      window.contentView.removeChildView(view)
    }
  }
}
