import type { ManagedSession } from './types'

const DEVTOOLS_BRIDGE_SCRIPT = `
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
`

export class DevtoolsManager {
  async ensureDevTools(session: ManagedSession): Promise<void> {
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

  async injectBridge(session: ManagedSession): Promise<void> {
    if (session.devtoolsBridgeInjected) {
      return
    }

    try {
      await session.devtoolsView.webContents.executeJavaScript(DEVTOOLS_BRIDGE_SCRIPT, true)
      session.devtoolsBridgeInjected = true
    } catch (error) {
      console.error('Failed to inject devtools bridge', {
        sessionId: session.id,
        error
      })
    }
  }
}
