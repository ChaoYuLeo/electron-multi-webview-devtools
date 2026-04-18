import type { LayoutPayload } from '../shared/session'

export const INITIAL_URL = 'https://example.com'

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

export const INITIAL_LAYOUT: LayoutPayload = {
  mobileViewport: { x: 0, y: 0, width: 0, height: 0 },
  devtoolsViewport: { x: 0, y: 0, width: 0, height: 0 }
}
