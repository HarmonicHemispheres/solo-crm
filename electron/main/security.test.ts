import { describe, expect, it, vi } from 'vitest'
import {
  SECURE_WEB_PREFERENCES,
  buildContentSecurityPolicy,
  installContentSecurityPolicy,
  isInternalUrl,
  registerNavigationGuards
} from './security'

describe('SECURE_WEB_PREFERENCES', () => {
  it('turns on context isolation and the sandbox, and turns off node integration', () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
  })

  it("never sets enableRemoteModule — Electron removed the option, this only guards a future re-add", () => {
    expect(SECURE_WEB_PREFERENCES).not.toHaveProperty('enableRemoteModule')
  })
})

describe('buildContentSecurityPolicy', () => {
  it('production policy admits no remote origin anywhere', () => {
    const csp = buildContentSecurityPolicy(null)
    expect(csp).toContain("default-src 'self'")
    // No http(s)/ws(s) origin anywhere in the policy — every source is
    // 'self', 'unsafe-inline', 'none', or the data: scheme for images.
    expect(csp).not.toMatch(/(https?|wss?):\/\//)
  })

  it('production policy restricts plugins, base tag and form targets', () => {
    const csp = buildContentSecurityPolicy(null)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
  })

  it('dev policy allows the dev server origin and its websocket, not an arbitrary remote origin', () => {
    const csp = buildContentSecurityPolicy('http://localhost:5173')
    expect(csp).toContain('http://localhost:5173')
    expect(csp).toContain('ws://localhost:5173')
    expect(csp).not.toContain('evil.example')
  })

  it('derives a wss:// websocket origin from an https dev server', () => {
    const csp = buildContentSecurityPolicy('https://localhost:5173')
    expect(csp).toContain('wss://localhost:5173')
    expect(csp).not.toContain('ws://localhost:5173')
  })
})

describe('installContentSecurityPolicy', () => {
  it('sets the Content-Security-Policy response header without dropping existing headers', () => {
    const listeners: Array<
      (details: { responseHeaders?: Record<string, string[]> }, callback: (response: unknown) => void) => void
    > = []
    const session = {
      webRequest: {
        onHeadersReceived: vi.fn((listener: (typeof listeners)[number]) => {
          listeners.push(listener)
        })
      }
    }

    installContentSecurityPolicy(session, null)

    expect(session.webRequest.onHeadersReceived).toHaveBeenCalledOnce()
    const callback = vi.fn()
    listeners[0]!({ responseHeaders: { 'X-Existing': ['1'] } }, callback)

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Existing': ['1'],
        'Content-Security-Policy': [buildContentSecurityPolicy(null)]
      }
    })
  })
})

describe('isInternalUrl', () => {
  it('treats a same-origin http URL, including a different path, as internal', () => {
    expect(isInternalUrl('http://localhost:5173/clients/123', 'http://localhost:5173/')).toBe(true)
  })

  it('treats a different origin as external', () => {
    expect(isInternalUrl('https://client-example.com', 'http://localhost:5173/')).toBe(false)
  })

  it('treats a different port on the same host as external', () => {
    expect(isInternalUrl('http://localhost:9999/', 'http://localhost:5173/')).toBe(false)
  })

  it('treats any file: URL as internal when the app itself loaded from file:', () => {
    const appUrl = 'file:///C:/app/out/renderer/index.html'
    expect(isInternalUrl('file:///C:/app/out/renderer/other.html', appUrl)).toBe(true)
  })

  it('treats a remote URL as external when the app loaded from file:', () => {
    const appUrl = 'file:///C:/app/out/renderer/index.html'
    expect(isInternalUrl('https://client-example.com', appUrl)).toBe(false)
  })

  it('is not fooled by an unparseable URL', () => {
    expect(isInternalUrl('not a url', 'http://localhost:5173/')).toBe(false)
  })
})

describe('registerNavigationGuards', () => {
  type WillNavigateListener = (event: { url: string; preventDefault: () => void }) => void
  type WindowOpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' }

  function fakeWebContents() {
    let willNavigate: WillNavigateListener | null = null
    let windowOpenHandler: WindowOpenHandler | null = null
    return {
      on: vi.fn((_event: 'will-navigate', listener: WillNavigateListener) => {
        willNavigate = listener
      }),
      setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
        windowOpenHandler = handler
      }),
      emitWillNavigate(event: { url: string; preventDefault: () => void }) {
        willNavigate?.(event)
      },
      openWindow(url: string) {
        return windowOpenHandler?.({ url })
      }
    }
  }

  it('lets an in-app navigation through untouched', () => {
    const webContents = fakeWebContents()
    const openExternal = vi.fn()
    registerNavigationGuards(webContents, 'http://localhost:5173/', openExternal)

    const preventDefault = vi.fn()
    webContents.emitWillNavigate({ url: 'http://localhost:5173/clients/123', preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('prevents an external navigation and hands it to the system browser', () => {
    const webContents = fakeWebContents()
    const openExternal = vi.fn()
    registerNavigationGuards(webContents, 'http://localhost:5173/', openExternal)

    const preventDefault = vi.fn()
    webContents.emitWillNavigate({ url: 'https://client-example.com', preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://client-example.com')
  })

  it('denies window.open for an external URL and opens it in the system browser instead', () => {
    const webContents = fakeWebContents()
    const openExternal = vi.fn()
    registerNavigationGuards(webContents, 'http://localhost:5173/', openExternal)

    const response = webContents.openWindow('https://client-example.com')

    expect(response).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://client-example.com')
  })

  it('denies window.open for an in-app URL too, without calling openExternal', () => {
    const webContents = fakeWebContents()
    const openExternal = vi.fn()
    registerNavigationGuards(webContents, 'http://localhost:5173/', openExternal)

    const response = webContents.openWindow('http://localhost:5173/clients/123')

    expect(response).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
