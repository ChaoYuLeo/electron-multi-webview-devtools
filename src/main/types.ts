import { WebContentsView } from 'electron'
import type { SessionInfo } from '../shared/session'

export type ManagedSession = {
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
