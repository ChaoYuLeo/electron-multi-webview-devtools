import { app, BrowserWindow, ipcMain, shell, WebContentsView } from 'electron'
import { join } from 'node:path'
import type { LayoutPayload, LayoutRect, SessionInfo } from '../shared/session'

type ManagedSession = {
  id: string
  order: number
  contentView: WebContentsView
  devtoolsView: WebContentsView
  info: SessionInfo
  debuggerAttached: boolean
  debuggerInitializing?: Promise<void>
  overlayEnabled: boolean
  cursorCssKey?: string
  devtoolsInitialized: boolean
  devtoolsBridgeInjected: boolean
}

const INITIAL_URL = 'https://example.com'
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

let mainWindow: BrowserWindow | null = null
let sessionCounter = 1
let activeSessionId: string | null = null
let currentLayout: LayoutPayload = {
  mobileViewport: { x: 0, y: 0, width: 0, height: 0 },
  devtoolsViewport: { x: 0, y: 0, width: 0, height: 0 }
}

const sessions = new Map<string, ManagedSession>()

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return INITIAL_URL
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

function getSessionList(): SessionInfo[] {
  return [...sessions.values()]
    .sort((left, right) => left.order - right.order)
    .map((session) => ({
      ...session.info,
      isActive: session.id === activeSessionId
    }))
}

function emitSessionsChanged(): void {
  if (!mainWindow) {
    return
  }

  mainWindow.webContents.send('app:sessions-changed', getSessionList())
}

function ensureViewAttached(window: BrowserWindow, view: WebContentsView): void {
  if (!window.contentView.children.includes(view)) {
    window.contentView.addChildView(view)
  }
}

function detachView(window: BrowserWindow, view: WebContentsView): void {
  if (window.contentView.children.includes(view)) {
    window.contentView.removeChildView(view)
  }
}

async function ensureDebugger(session: ManagedSession): Promise<void> {
  const { debugger: debuggerApi } = session.contentView.webContents

  if (debuggerApi.isAttached()) {
    session.debuggerAttached = true
    if (session.overlayEnabled) {
      return
    }
  }

  if (session.debuggerInitializing) {
    await session.debuggerInitializing
    return
  }

  session.debuggerInitializing = (async () => {
    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach('1.3')
      }
      session.debuggerAttached = true

      if (!session.overlayEnabled) {
        await debuggerApi.sendCommand('DOM.enable')
        await debuggerApi.sendCommand('Overlay.enable')
        session.overlayEnabled = true
      }
    } catch (error) {
      session.debuggerAttached = debuggerApi.isAttached()
      console.error('Failed to attach debugger', error)
    } finally {
      session.debuggerInitializing = undefined
    }
  })()

  await session.debuggerInitializing
}

async function applyCursorStyle(session: ManagedSession, touchMode: boolean): Promise<void> {
  const webContents = session.contentView.webContents

  try {
    if (session.cursorCssKey) {
      await webContents.removeInsertedCSS(session.cursorCssKey)
      session.cursorCssKey = undefined
    }

    const css = touchMode
      ? 'html, body, body * { cursor: default !important; }'
      : 'html, body, body * { cursor: crosshair !important; }'

    session.cursorCssKey = await webContents.insertCSS(css)
  } catch (error) {
    console.error('Failed to apply cursor style', error)
  }
}

async function applyInputMode(session: ManagedSession, touchMode: boolean): Promise<void> {
  await ensureDebugger(session)

  if (!session.debuggerAttached) {
    return
  }

  try {
    if (touchMode) {
      await session.contentView.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1
      })
    } else {
      await session.contentView.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: false
      })
    }

    if (touchMode) {
      await session.contentView.webContents.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', {
        enabled: true,
        configuration: 'mobile'
      })
    } else {
      await session.contentView.webContents.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', {
        enabled: false
      })
    }
    await applyCursorStyle(session, touchMode)
  } catch (error) {
    console.error('Failed to switch input mode', error)
  }
}

async function applyMobileMetrics(session: ManagedSession, viewport: LayoutRect = currentLayout.mobileViewport): Promise<void> {
  await ensureDebugger(session)

  if (!session.debuggerAttached) {
    return
  }

  const width = Math.max(320, Math.round(viewport.width) || 390)
  const height = Math.max(480, Math.round(viewport.height) || 844)

  try {
    await session.contentView.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 0,
      mobile: true,
      screenWidth: width,
      screenHeight: height,
      positionX: 0,
      positionY: 0,
      scale: 1
    })
    await session.contentView.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: MOBILE_USER_AGENT,
      platform: 'iPhone'
    })
  } catch (error) {
    console.error('Failed to apply mobile metrics', error)
  }
}

async function updateSessionEmulation(
  session: ManagedSession,
  viewport: LayoutRect = currentLayout.mobileViewport
): Promise<void> {
  await applyMobileMetrics(session, viewport)
  await applyInputMode(session, !session.info.inspectMode)
}

function updateInspectState(session: ManagedSession, enabled: boolean): void {
  if (session.info.inspectMode === enabled) {
    return
  }

  session.info.inspectMode = enabled
  emitSessionsChanged()
}

async function setInspectMode(session: ManagedSession, enabled: boolean, syncOverlay = true): Promise<void> {
  await ensureDebugger(session)

  if (!session.debuggerAttached) {
    return
  }

  updateInspectState(session, enabled)

  try {
    await applyInputMode(session, !enabled)
    if (syncOverlay) {
      await session.contentView.webContents.debugger.sendCommand('Overlay.setInspectMode', {
        mode: enabled ? 'searchForNode' : 'none',
        highlightConfig: {
          showInfo: true,
          showStyles: true,
          showAccessibilityInfo: true,
          contentColor: { r: 66, g: 133, b: 244, a: 0.2 },
          paddingColor: { r: 15, g: 98, b: 254, a: 0.15 },
          borderColor: { r: 15, g: 98, b: 254, a: 0.8 },
          marginColor: { r: 245, g: 158, b: 11, a: 0.35 }
        }
      })
    }
  } catch (error) {
    console.error('Failed to set inspect mode', error)
  }
}

function bindSessionEvents(session: ManagedSession): void {
  const { webContents } = session.contentView
  const devtoolsContents = session.devtoolsView.webContents

  const updateNavigationState = () => {
    const history = webContents.navigationHistory
    session.info.url = webContents.getURL() || session.info.url
    session.info.title = webContents.getTitle() || session.info.title
    session.info.canGoBack = history.canGoBack()
    session.info.canGoForward = history.canGoForward()
    emitSessionsChanged()
  }

  webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    updateNavigationState()
  })
  webContents.on('did-start-loading', () => {
    session.info.isLoading = true
    emitSessionsChanged()
  })
  webContents.on('did-stop-loading', () => {
    session.info.isLoading = false
    updateNavigationState()
  })
  webContents.on('did-finish-load', async () => {
    updateNavigationState()
    await ensureDevTools(session)
    await updateSessionEmulation(session)
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
    await ensureDevTools(session)
    await updateSessionEmulation(session)
  })
  webContents.setWindowOpenHandler(({ url }) => {
    void createSession(url, true)
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
      await setInspectMode(session, true, false)
      return
    }

    if (method === 'Overlay.inspectModeCanceled' || method === 'Overlay.inspectNodeRequested') {
      await setInspectMode(session, false, false)
    }
  })

  devtoolsContents.on('did-finish-load', () => {
    void injectDevToolsBridge(session)
  })
  devtoolsContents.on('console-message', async (event) => {
    if (event.message === '__ELE_DEVTOOLS_INSPECT__:on') {
      await setInspectMode(session, true, false)
    }
    if (event.message === '__ELE_DEVTOOLS_INSPECT__:off') {
      await setInspectMode(session, false, false)
    }
  })
}

async function ensureDevTools(session: ManagedSession): Promise<void> {
  if (session.devtoolsInitialized) {
    return
  }

  try {
    session.contentView.webContents.setDevToolsWebContents(session.devtoolsView.webContents)
    session.contentView.webContents.openDevTools({ mode: 'detach', activate: false })
    session.devtoolsInitialized = true
  } catch (error) {
    console.error('Failed to initialize devtools', {
      sessionId: session.id,
      error
    })
  }
}

async function injectDevToolsBridge(session: ManagedSession): Promise<void> {
  if (session.devtoolsBridgeInjected) {
    return
  }

  try {
    await session.devtoolsView.webContents.executeJavaScript(
      `
        (() => {
          const token = '__ELE_DEVTOOLS_INSPECT__:'
          if (window.__eleDevtoolsInspectBridgeInstalled) {
            return
          }

          window.__eleDevtoolsInspectBridgeInstalled = true
          let lastState
          let scheduled = false

          const keywords = [
            'select an element',
            'inspect mode',
            'inspect',
            'choose an element',
            'pick an element',
            'select mode',
            '检查元素',
            '选择元素',
            '选取元素',
            '选择网页中的元素',
            '选择页面中的元素'
          ]

          const getElementText = (element) => {
            if (!element || typeof element.getAttribute !== 'function') {
              return ''
            }

            return [
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              element.getAttribute('data-tooltip'),
              element.getAttribute('aria-description'),
              element.textContent
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
          }

          const matchesInspectButton = (element) => {
            const text = getElementText(element)
            return keywords.some((keyword) => text.includes(keyword))
          }

          const collectRoots = () => {
            const roots = [document]
            const queue = [document]

            while (queue.length > 0) {
              const root = queue.shift()
              const elements = root.querySelectorAll ? root.querySelectorAll('*') : []
              for (const element of elements) {
                if (element.shadowRoot) {
                  roots.push(element.shadowRoot)
                  queue.push(element.shadowRoot)
                }
              }
            }

            return roots
          }

          const findInspectButton = () => {
            const selectors = 'button,[role="button"],[aria-pressed],[aria-checked]'
            for (const root of collectRoots()) {
              const candidates = [...root.querySelectorAll(selectors)]
              const exactPressed = candidates.find(
                (element) => element.getAttribute('aria-pressed') !== null && matchesInspectButton(element)
              )
              if (exactPressed) {
                return exactPressed
              }

              const exactChecked = candidates.find(
                (element) => element.getAttribute('aria-checked') !== null && matchesInspectButton(element)
              )
              if (exactChecked) {
                return exactChecked
              }

              const fuzzy = candidates.find((element) => matchesInspectButton(element))
              if (fuzzy) {
                return fuzzy
              }
            }

            return null
          }

          const emitState = (nextState) => {
            if (nextState !== lastState) {
              lastState = nextState
              console.info(token + (nextState ? 'on' : 'off'))
            }
          }

          const readState = () => {
            scheduled = false
            const button = findInspectButton()
            const nextState =
              button?.getAttribute('aria-pressed') === 'true' ||
              button?.getAttribute('aria-checked') === 'true' ||
              button?.classList?.contains('toggled-on') ||
              button?.classList?.contains('active') ||
              false

            emitState(nextState)
          }

          const scheduleRead = () => {
            if (scheduled) {
              return
            }

            scheduled = true
            window.setTimeout(readState, 0)
          }

          const handlePotentialInspectTrigger = (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
            const matched = path.find((item) => item instanceof Element && matchesInspectButton(item))

            if (!matched) {
              return
            }

            // DevTools toggles inspect mode immediately on native button click.
            // Switch the hosted page to mouse mode right away instead of waiting
            // for a protocol event that Electron may not surface.
            window.setTimeout(() => {
              const isPressed =
                matched.getAttribute('aria-pressed') === 'true' ||
                matched.getAttribute('aria-checked') === 'true' ||
                matched.classList.contains('toggled-on') ||
                matched.classList.contains('active')

              emitState(!isPressed)
              scheduleRead()
            }, 0)
          }

          document.addEventListener('click', handlePotentialInspectTrigger, true)
          document.addEventListener(
            'keydown',
            (event) => {
              const isInspectShortcut =
                (event.key === 'c' || event.key === 'C') &&
                ((event.metaKey && event.altKey) || (event.ctrlKey && event.shiftKey))

              if (!isInspectShortcut) {
                return
              }

              window.setTimeout(() => {
                emitState(!(lastState ?? false))
                scheduleRead()
              }, 0)
            },
            true
          )

          for (const root of collectRoots()) {
            new MutationObserver(scheduleRead).observe(root, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ['aria-pressed', 'aria-checked', 'aria-label', 'title', 'class']
            })
          }

          readState()
        })();
      `,
      true
    )
    session.devtoolsBridgeInjected = true
  } catch (error) {
    console.error('Failed to inject devtools bridge', {
      sessionId: session.id,
      error
    })
  }
}

function syncAttachedViews(): void {
  if (!mainWindow) {
    return
  }

  for (const session of sessions.values()) {
    detachView(mainWindow, session.contentView)
    detachView(mainWindow, session.devtoolsView)
  }

  if (!activeSessionId) {
    return
  }

  const activeSession = sessions.get(activeSessionId)
  if (!activeSession) {
    return
  }

  const { mobileViewport, devtoolsViewport } = currentLayout

  if (mobileViewport.width <= 0 || mobileViewport.height <= 0) {
    return
  }

  const orderedSessions = [...sessions.values()].sort((left, right) => left.order - right.order)
  const previewSessions = orderedSessions.filter((session) => session.id !== activeSessionId).slice(-3)

  for (const [index, session] of previewSessions.entries()) {
    const depth = previewSessions.length - index
    const previewBounds = {
      x: mobileViewport.x + depth * 18,
      y: mobileViewport.y + depth * 12,
      width: Math.max(320, mobileViewport.width - depth * 36),
      height: Math.max(480, mobileViewport.height - depth * 24)
    }

    ensureViewAttached(mainWindow, session.contentView)
    session.contentView.setBounds({
      x: Math.round(previewBounds.x),
      y: Math.round(previewBounds.y),
      width: Math.round(previewBounds.width),
      height: Math.round(previewBounds.height)
    })
    void updateSessionEmulation(session, previewBounds)
  }

  ensureViewAttached(mainWindow, activeSession.contentView)
  activeSession.contentView.setBounds({
    x: Math.round(mobileViewport.x),
    y: Math.round(mobileViewport.y),
    width: Math.round(mobileViewport.width),
    height: Math.round(mobileViewport.height)
  })

  if (devtoolsViewport.width > 0 && devtoolsViewport.height > 0) {
    ensureViewAttached(mainWindow, activeSession.devtoolsView)
    activeSession.devtoolsView.setBounds({
      x: Math.round(devtoolsViewport.x),
      y: Math.round(devtoolsViewport.y),
      width: Math.round(devtoolsViewport.width),
      height: Math.round(devtoolsViewport.height)
    })
  }

  void updateSessionEmulation(activeSession, mobileViewport)
}

async function createSession(url?: string, shouldActivate = true): Promise<SessionInfo> {
  const id = `wv-${sessionCounter}`
  sessionCounter += 1

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
    order: sessionCounter,
    contentView,
    devtoolsView,
    debuggerAttached: false,
    overlayEnabled: false,
    devtoolsInitialized: false,
    devtoolsBridgeInjected: false,
    info: {
      id,
      title: 'New WebView',
      url: normalizeUrl(url ?? INITIAL_URL),
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      inspectMode: false,
      isActive: false
    }
  }

  bindSessionEvents(session)
  contentView.webContents.setUserAgent(MOBILE_USER_AGENT)

  sessions.set(id, session)

  if (shouldActivate || !activeSessionId) {
    activeSessionId = id
  }

  emitSessionsChanged()
  syncAttachedViews()

  await contentView.webContents.loadURL(session.info.url)

  emitSessionsChanged()
  return getSessionList().find((item) => item.id === id) as SessionInfo
}

async function activateSession(id: string): Promise<SessionInfo[]> {
  if (!sessions.has(id)) {
    return getSessionList()
  }

  activeSessionId = id
  syncAttachedViews()
  emitSessionsChanged()
  return getSessionList()
}

async function navigateSession(id: string, url: string): Promise<SessionInfo | null> {
  const session = sessions.get(id)
  if (!session) {
    return null
  }

  session.info.url = normalizeUrl(url)
  session.info.isLoading = true
  emitSessionsChanged()
  await session.contentView.webContents.loadURL(session.info.url)
  return getSessionList().find((item) => item.id === id) ?? null
}

function closeSession(id: string): SessionInfo[] {
  const session = sessions.get(id)
  if (!session) {
    return getSessionList()
  }

  session.contentView.webContents.closeDevTools()
  session.contentView.webContents.close()
  session.devtoolsView.webContents.close()
  sessions.delete(id)

  if (activeSessionId === id) {
    activeSessionId = getSessionList()[0]?.id ?? null
  }

  if (!activeSessionId && sessions.size === 0) {
    void createSession(INITIAL_URL, true)
  }

  syncAttachedViews()
  emitSessionsChanged()
  return getSessionList()
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#06121f',
    title: 'Electron Multi WebView DevTools',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('resize', syncAttachedViews)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  void createSession(INITIAL_URL, true)
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.electron-multi-webview-devtools.app')
  ipcMain.handle('app:get-sessions', () => getSessionList())
  ipcMain.handle('app:create-session', (_event, url?: string) => createSession(url, true))
  ipcMain.handle('app:navigate-session', (_event, payload: { id: string; url: string }) =>
    navigateSession(payload.id, payload.url)
  )
  ipcMain.handle('app:activate-session', (_event, id: string) => activateSession(id))
  ipcMain.handle('app:close-session', (_event, id: string) => closeSession(id))
  ipcMain.handle('app:go-back', async (_event, id: string) => {
    const session = sessions.get(id)
    if (session?.contentView.webContents.navigationHistory.canGoBack()) {
      session.contentView.webContents.navigationHistory.goBack()
    }
    return getSessionList()
  })
  ipcMain.handle('app:go-forward', async (_event, id: string) => {
    const session = sessions.get(id)
    if (session?.contentView.webContents.navigationHistory.canGoForward()) {
      session.contentView.webContents.navigationHistory.goForward()
    }
    return getSessionList()
  })
  ipcMain.handle('app:reload', async (_event, id: string) => {
    const session = sessions.get(id)
    session?.contentView.webContents.reload()
    return getSessionList()
  })
  ipcMain.handle('app:set-inspect-mode', async (_event, payload: { id: string; enabled: boolean }) => {
    const session = sessions.get(payload.id)
    if (!session) {
      return getSessionList()
    }
    await setInspectMode(session, payload.enabled)
    return getSessionList()
  })
  ipcMain.on('app:set-layout', (_event, payload: LayoutPayload) => {
    currentLayout = payload
    syncAttachedViews()
  })

  void createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
