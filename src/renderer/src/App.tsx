import { FormEvent, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionInfo } from '../../shared/session'

function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [urlInput, setUrlInput] = useState('')
  const mobileViewportRef = useRef<HTMLDivElement | null>(null)
  const devtoolsViewportRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(
    () => sessions.find((session) => session.isActive) ?? sessions[0] ?? null,
    [sessions]
  )

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionsChanged((incomingSessions: SessionInfo[]) => {
      startTransition(() => {
        setSessions(incomingSessions)
      })
    })

    void window.electronAPI.getSessions().then((incomingSessions: SessionInfo[]) => {
      startTransition(() => {
        setSessions(incomingSessions)
      })
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (activeSession) {
      setUrlInput(activeSession.url)
    }
  }, [activeSession?.id, activeSession?.url])

  useLayoutEffect(() => {
    let rafId = 0
    let nestedRafId = 0
    let timeoutId = 0

    const syncLayout = () => {
      const mobileRect = mobileViewportRef.current?.getBoundingClientRect()
      const devtoolsRect = devtoolsViewportRef.current?.getBoundingClientRect()

      if (!mobileRect || !devtoolsRect) {
        return
      }

      window.electronAPI.setLayout({
        mobileViewport: {
          x: mobileRect.x,
          y: mobileRect.y,
          width: mobileRect.width,
          height: mobileRect.height
        },
        devtoolsViewport: {
          x: devtoolsRect.x,
          y: devtoolsRect.y,
          width: devtoolsRect.width,
          height: devtoolsRect.height
        }
      })
    }

    syncLayout()
    rafId = window.requestAnimationFrame(syncLayout)
    nestedRafId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(syncLayout)
    })
    timeoutId = window.setTimeout(syncLayout, 80)

    const observer = new ResizeObserver(() => syncLayout())
    if (mobileViewportRef.current) {
      observer.observe(mobileViewportRef.current)
    }
    if (devtoolsViewportRef.current) {
      observer.observe(devtoolsViewportRef.current)
    }
    window.addEventListener('resize', syncLayout)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.cancelAnimationFrame(nestedRafId)
      window.clearTimeout(timeoutId)
      observer.disconnect()
      window.removeEventListener('resize', syncLayout)
    }
  }, [activeSession?.id, sessions.length])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeSession) {
      return
    }

    await window.electronAPI.navigateSession(activeSession.id, urlInput)
  }

  const createNewSession = async () => {
    await window.electronAPI.createSession(urlInput || undefined)
  }

  const visibleStack = sessions.slice(0, 4)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <strong>WebView Stack</strong>
            <p>Electron + React 19 + embedded DevTools</p>
          </div>
        </div>

        <div className="tabs">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`tab ${session.isActive ? 'active' : ''}`}
              onClick={() => void window.electronAPI.activateSession(session.id)}
              type="button"
            >
              <span>{session.title || new URL(session.url).hostname}</span>
              {session.isLoading ? <i className="tab-loading" /> : null}
              <em
                onClick={(event) => {
                  event.stopPropagation()
                  void window.electronAPI.closeSession(session.id)
                }}
              >
                ×
              </em>
            </button>
          ))}

          <button className="tab add-tab" onClick={createNewSession} type="button">
            +
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="mobile-panel">
          <div className="stack-backdrop">
            {visibleStack.map((session, index) => {
              const reverseIndex = visibleStack.length - index - 1
              return (
                <div
                  key={session.id}
                  className={`stack-card ${session.isActive ? 'active' : ''}`}
                  style={{
                    transform: `translate(${reverseIndex * 18}px, ${reverseIndex * 12}px) scale(${
                      1 - reverseIndex * 0.03
                    })`
                  }}
                >
                  <div className="stack-card-top">
                    <span />
                    <b>{session.title}</b>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="device-shell">
            <div className="device-notch" />
            <div className="device-screen" ref={mobileViewportRef} />
            <div className="device-home-indicator" />
          </div>
        </section>

        <section className="side-panel">
          <div className="controls-panel">
            <form className="url-form" onSubmit={handleSubmit}>
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com"
                spellCheck={false}
              />
              <button type="submit">加载</button>
            </form>

            <div className="action-row">
              <button
                onClick={() => activeSession && void window.electronAPI.goBack(activeSession.id)}
                disabled={!activeSession?.canGoBack}
                type="button"
              >
                后退
              </button>
              <button
                onClick={() => activeSession && void window.electronAPI.goForward(activeSession.id)}
                disabled={!activeSession?.canGoForward}
                type="button"
              >
                前进
              </button>
              <button onClick={() => activeSession && void window.electronAPI.reload(activeSession.id)} type="button">
                刷新
              </button>
              <button onClick={createNewSession} type="button">
                新建
              </button>
              <button
                className={activeSession?.inspectMode ? 'inspect active' : 'inspect'}
                onClick={() =>
                  activeSession &&
                  void window.electronAPI.setInspectMode(activeSession.id, !activeSession.inspectMode)
                }
                type="button"
              >
                {activeSession?.inspectMode ? '退出检查' : '检查元素'}
              </button>
            </div>

            <div className="status-row">
              <span className="status-pill">{activeSession?.inspectMode ? 'Mouse Inspect' : 'Touch Emulation'}</span>
              <span>{activeSession?.url ?? 'No active webview'}</span>
            </div>
          </div>

          <div className="devtools-panel">
            <div className="panel-header">
              <strong>DevTools</strong>
              <span>{activeSession?.title ?? 'Waiting for webview'}</span>
            </div>
            <div className="devtools-viewport" ref={devtoolsViewportRef} />
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
