import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { LayoutPayload } from '../shared/session'
import { INITIAL_URL } from './constants'
import { DevtoolsManager } from './devtools-manager'
import { EmulationManager } from './emulation-manager'
import { LayoutManager } from './layout-manager'
import { SessionManager } from './session-manager'
import { MainState } from './state'

export class MainApp {
  private readonly state = new MainState()
  private readonly emulation = new EmulationManager({
    emitSessionsChanged: () => this.emitSessionsChanged(),
    getDefaultViewport: () => this.state.getLayout().mobileViewport
  })
  private readonly devtools = new DevtoolsManager()
  private readonly layout = new LayoutManager(this.state, (session, viewport) =>
    this.emulation.updateSessionEmulation(session, viewport)
  )
  private readonly sessions = new SessionManager({
    state: this.state,
    emitSessionsChanged: () => this.emitSessionsChanged(),
    syncAttachedViews: () => this.layout.syncAttachedViews(),
    emulation: this.emulation,
    devtools: this.devtools
  })

  start(): void {
    app.whenReady().then(() => {
      app.setAppUserModelId('com.electron-multi-webview-devtools.app')
      this.registerIpcHandlers()
      void this.createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void this.createWindow()
        }
      })
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })
  }

  private emitSessionsChanged(): void {
    const window = this.state.getWindow()
    if (!window) {
      return
    }

    window.webContents.send('app:sessions-changed', this.state.getSessionList())
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('app:get-sessions', () => this.state.getSessionList())
    ipcMain.handle('app:create-session', (_event, url?: string) => this.sessions.createSession(url, true))
    ipcMain.handle('app:navigate-session', (_event, payload: { id: string; url: string }) =>
      this.sessions.navigateSession(payload.id, payload.url)
    )
    ipcMain.handle('app:activate-session', (_event, id: string) => this.sessions.activateSession(id))
    ipcMain.handle('app:close-session', (_event, id: string) => this.sessions.closeSession(id))
    ipcMain.handle('app:go-back', (_event, id: string) => this.sessions.goBack(id))
    ipcMain.handle('app:go-forward', (_event, id: string) => this.sessions.goForward(id))
    ipcMain.handle('app:reload', (_event, id: string) => this.sessions.reload(id))
    ipcMain.handle('app:set-inspect-mode', async (_event, payload: { id: string; enabled: boolean }) => {
      const session = this.state.getSession(payload.id)
      if (!session) {
        return this.state.getSessionList()
      }

      await this.emulation.setInspectMode(session, payload.enabled)
      return this.state.getSessionList()
    })
    ipcMain.on('app:set-layout', (_event, payload: LayoutPayload) => {
      this.state.setLayout(payload)
      this.layout.syncAttachedViews()
    })
  }

  private async createWindow(): Promise<void> {
    const mainWindow = new BrowserWindow({
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

    this.state.setWindow(mainWindow)

    mainWindow.on('resize', () => {
      this.layout.syncAttachedViews()
    })
    mainWindow.on('closed', () => {
      this.state.setWindow(null)
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    void this.sessions.createSession(INITIAL_URL, true)
  }
}
