export type SessionInfo = {
  id: string
  title: string
  url: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  inspectMode: boolean
  isActive: boolean
}

export type LayoutRect = {
  x: number
  y: number
  width: number
  height: number
}

export type LayoutPayload = {
  mobileViewport: LayoutRect
  devtoolsViewport: LayoutRect
}
