import { shell, WebContentsView } from 'electron'
import type { SessionInfo } from '../shared/session'
import { INITIAL_URL, MOBILE_USER_AGENT } from './constants'
import { DevtoolsManager } from './devtools-manager'
import { EmulationManager } from './emulation-manager'
import { MainState } from './state'
import type { ManagedSession } from './types'

type SessionManagerOptions = {
  state: MainState
  emitSessionsChanged: () => void
  syncAttachedViews: () => void
  emulation: EmulationManager
  devtools: DevtoolsManager
}

export class SessionManager {
  private readonly state: MainState
  private readonly emitSessionsChanged: () => void
  private readonly syncAttachedViews: () => void
  private readonly emulation: EmulationManager
  private readonly devtools: DevtoolsManager

  constructor(options: SessionManagerOptions) {
    this.state = options.state
    this.emitSessionsChanged = options.emitSessionsChanged
    this.syncAttachedViews = options.syncAttachedViews
    this.emulation = options.emulation
    this.devtools = options.devtools
  }

  async createSession(url?: string, shouldActivate = true): Promise<SessionInfo> {
    const { id, order } = this.state.nextSessionIdentity()
    const contentView = new WebContentsView({
      webPreferences: {
        sandbox: false,
        contextIsolation: true
      }
    })
    const devtoolsView = new WebContentsView({
      webPreferences: {
        sandbox: false,
        contextIsolation: true
      }
    })

    const session: ManagedSession = {
      id,
      order,
      contentView,
      devtoolsView,
      debuggerAttached: false,
      overlayEnabled: false,
      devtoolsInitialized: false,
      devtoolsBridgeInjected: false,
      info: {
        id,
        title: 'New WebView',
        url: this.normalizeUrl(url ?? INITIAL_URL),
        isLoading: true,
        canGoBack: false,
        canGoForward: false,
        inspectMode: false,
        isActive: false
      }
    }

    this.bindSessionEvents(session)
    contentView.webContents.setUserAgent(MOBILE_USER_AGENT)

    this.state.addSession(session)
    if (shouldActivate || !this.state.getActiveSessionId()) {
      this.state.setActiveSessionId(id)
    }

    this.emitSessionsChanged()
    this.syncAttachedViews()

    await contentView.webContents.loadURL(session.info.url)

    this.emitSessionsChanged()
    return this.state.getSessionInfo(id) as SessionInfo
  }

  async activateSession(id: string): Promise<SessionInfo[]> {
    if (!this.state.getSession(id)) {
      return this.state.getSessionList()
    }

    this.state.setActiveSessionId(id)
    this.syncAttachedViews()
    this.emitSessionsChanged()
    return this.state.getSessionList()
  }

  async navigateSession(id: string, url: string): Promise<SessionInfo | null> {
    const session = this.state.getSession(id)
    if (!session) {
      return null
    }

    session.info.url = this.normalizeUrl(url)
    session.info.isLoading = true
    this.emitSessionsChanged()
    await session.contentView.webContents.loadURL(session.info.url)
    return this.state.getSessionInfo(id)
  }

  closeSession(id: string): SessionInfo[] {
    const session = this.state.getSession(id)
    if (!session) {
      return this.state.getSessionList()
    }

    session.contentView.webContents.closeDevTools()
    session.contentView.webContents.close()
    session.devtoolsView.webContents.close()
    this.state.deleteSession(id)

    if (this.state.getActiveSessionId() === id) {
      this.state.setActiveSessionId(this.state.getSessionList()[0]?.id ?? null)
    }

    if (!this.state.getActiveSessionId() && this.state.getSessionCount() === 0) {
      void this.createSession(INITIAL_URL, true)
    }

    this.syncAttachedViews()
    this.emitSessionsChanged()
    return this.state.getSessionList()
  }

  goBack(id: string): SessionInfo[] {
    const session = this.state.getSession(id)
    if (session?.contentView.webContents.navigationHistory.canGoBack()) {
      session.contentView.webContents.navigationHistory.goBack()
    }
    return this.state.getSessionList()
  }

  goForward(id: string): SessionInfo[] {
    const session = this.state.getSession(id)
    if (session?.contentView.webContents.navigationHistory.canGoForward()) {
      session.contentView.webContents.navigationHistory.goForward()
    }
    return this.state.getSessionList()
  }

  reload(id: string): SessionInfo[] {
    this.state.getSession(id)?.contentView.webContents.reload()
    return this.state.getSessionList()
  }

  private normalizeUrl(input: string): string {
    const trimmed = input.trim()
    if (!trimmed) {
      return INITIAL_URL
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return trimmed
    }

    return `https://${trimmed}`
  }

  private bindSessionEvents(session: ManagedSession): void {
    const { webContents } = session.contentView
    const devtoolsContents = session.devtoolsView.webContents

    const updateNavigationState = () => {
      const history = webContents.navigationHistory
      session.info.url = webContents.getURL() || session.info.url
      session.info.title = webContents.getTitle() || session.info.title
      session.info.canGoBack = history.canGoBack()
      session.info.canGoForward = history.canGoForward()
      this.emitSessionsChanged()
    }

    webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      updateNavigationState()
    })
    webContents.on('did-start-loading', () => {
      session.info.isLoading = true
      this.emitSessionsChanged()
    })
    webContents.on('did-stop-loading', () => {
      session.info.isLoading = false
      updateNavigationState()
    })
    webContents.on('did-finish-load', async () => {
      updateNavigationState()
      await this.devtools.ensureDevTools(session)
      await this.emulation.updateSessionEmulation(session)
    })
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return
      }

      console.error('WebContents load failed', {
        sessionId: session.id,
        errorCode,
        errorDescription,
        validatedURL
      })
    })
    webContents.on('did-navigate', updateNavigationState)
    webContents.on('did-navigate-in-page', updateNavigationState)
    webContents.on('dom-ready', async () => {
      await this.devtools.ensureDevTools(session)
      await this.emulation.updateSessionEmulation(session)
    })
    webContents.setWindowOpenHandler(({ url }) => {
      void this.createSession(url, true)
      return { action: 'deny' }
    })
    webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return
      }

      event.preventDefault()
      void shell.openExternal(url)
    })
    webContents.debugger.on('detach', () => {
      session.debuggerAttached = false
      session.overlayEnabled = false
      session.debuggerInitializing = undefined
    })
    webContents.debugger.on('message', async (_event, method) => {
      if (method === 'Overlay.nodeHighlightRequested') {
        await this.emulation.setInspectMode(session, true, false)
        return
      }

      if (method === 'Overlay.inspectModeCanceled' || method === 'Overlay.inspectNodeRequested') {
        await this.emulation.setInspectMode(session, false, false)
      }
    })

    devtoolsContents.on('did-finish-load', () => {
      void this.devtools.injectBridge(session)
    })
    devtoolsContents.on('console-message', async (event) => {
      if (event.message === '__ELE_DEVTOOLS_INSPECT__:on') {
        await this.emulation.setInspectMode(session, true, false)
      }
      if (event.message === '__ELE_DEVTOOLS_INSPECT__:off') {
        await this.emulation.setInspectMode(session, false, false)
      }
    })
  }
}
