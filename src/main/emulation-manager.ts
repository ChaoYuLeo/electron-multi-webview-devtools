import type { LayoutRect } from '../shared/session'
import { MOBILE_USER_AGENT } from './constants'
import type { ManagedSession } from './types'

type EmulationManagerOptions = {
  emitSessionsChanged: () => void
  getDefaultViewport: () => LayoutRect
}

export class EmulationManager {
  private readonly emitSessionsChanged: () => void
  private readonly getDefaultViewport: () => LayoutRect

  constructor(options: EmulationManagerOptions) {
    this.emitSessionsChanged = options.emitSessionsChanged
    this.getDefaultViewport = options.getDefaultViewport
  }

  async updateSessionEmulation(
    session: ManagedSession,
    viewport: LayoutRect = this.getDefaultViewport()
  ): Promise<void> {
    await this.applyMobileMetrics(session, viewport)
    await this.applyInputMode(session, !session.info.inspectMode)
  }

  async setInspectMode(session: ManagedSession, enabled: boolean, syncOverlay = true): Promise<void> {
    await this.ensureDebugger(session)

    if (!session.debuggerAttached) {
      return
    }

    this.updateInspectState(session, enabled)

    try {
      await this.applyInputMode(session, !enabled)
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

  async ensureDebugger(session: ManagedSession): Promise<void> {
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

  private updateInspectState(session: ManagedSession, enabled: boolean): void {
    if (session.info.inspectMode === enabled) {
      return
    }

    session.info.inspectMode = enabled
    this.emitSessionsChanged()
  }

  private async applyInputMode(session: ManagedSession, touchMode: boolean): Promise<void> {
    await this.ensureDebugger(session)

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

      await this.applyCursorStyle(session, touchMode)
    } catch (error) {
      console.error('Failed to switch input mode', error)
    }
  }

  private async applyCursorStyle(session: ManagedSession, touchMode: boolean): Promise<void> {
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

  private async applyMobileMetrics(
    session: ManagedSession,
    viewport: LayoutRect = this.getDefaultViewport()
  ): Promise<void> {
    await this.ensureDebugger(session)

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
}
