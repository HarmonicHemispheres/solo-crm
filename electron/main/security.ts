import type { WebPreferences } from 'electron'

/**
 * The webPreferences every BrowserWindow this app creates must use. Every
 * flag is stated explicitly, even where it matches Electron's current
 * default — defaults shift between majors (`sandbox` flipped to true-by-
 * default in Electron 20; `nodeIntegration` and `contextIsolation` have each
 * flipped their own defaults in past majors), so a value that happens to be
 * safe today is exactly the kind of thing nobody notices changing under it.
 * See AGENTS.md: "the renderer never touches SQLite or the filesystem" is a
 * property of this object, not a convention.
 *
 * `enableRemoteModule` is deliberately absent, not set to `false`: Electron
 * removed it from `WebPreferences` entirely (the old `remote` module is now
 * the separate, opt-in `@electron/remote` package, which this app does not
 * depend on), so there is no flag left to turn off — omission is the off
 * state. The `Pick<WebPreferences, ...>` type below still validates every
 * key against Electron's real type, so a stray `enableRemoteModule: false`
 * would fail to typecheck rather than silently doing nothing.
 *
 * All three of `contextIsolation`, `nodeIntegration` and `sandbox` matter,
 * but not symmetrically (verified against a real Electron 44 instance, see
 * renderer-globals.test.ts): with `sandbox: true` stated explicitly, as it
 * is here, the renderer process never loads the Node.js engine at all, and
 * `window.require`/`process`/`module` stay undefined regardless of what
 * `contextIsolation` or `nodeIntegration` are set to — `sandbox` alone
 * settles it. Only with `sandbox: false` does the outcome start depending on
 * the other two, and even then it takes `nodeIntegration: true` *and*
 * `contextIsolation: false` together to actually leak Node globals onto
 * `window`; `contextIsolation: true` keeps them off `window` even with
 * `nodeIntegration: true`. None of that changes what belongs here — every
 * flag is still stated at its safe value — but it does mean the one-line
 * "flip contextIsolation, watch the test fail" story this task started with
 * doesn't hold with `sandbox` already pinned true: flipping `contextIsolation`
 * alone leaves the assertion passing.
 */
export const SECURE_WEB_PREFERENCES: Pick<
  WebPreferences,
  'contextIsolation' | 'nodeIntegration' | 'sandbox' | 'webSecurity'
> = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // Explicit, not an override: `true` is Electron's own default. Stating it
  // keeps this object self-describing instead of leaving webSecurity as the
  // one flag a reader has to go check Electron's docs to be sure of.
  webSecurity: true
}

function toWebSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.origin
}

/**
 * Builds the `Content-Security-Policy` header value.
 *
 * Production (`devServerOrigin` is `null`) admits no remote origin in any
 * directive — every source list is `'self'` or a `'none'`/keyword. A remote
 * `<script src>` is refused by `script-src 'self'` and Chromium logs the
 * refusal to the renderer's devtools console on its own; nothing here needs
 * to wire that up separately.
 *
 * Development additionally allows the Vite dev server's own origin (the page
 * itself is loaded from it — electron-vite sets `ELECTRON_RENDERER_URL`) and
 * that origin's HMR websocket, which needs a distinct `ws:`/`wss:` entry
 * because a scheme change is not covered by `'self'`. `script-src` also gets
 * `'unsafe-inline'` in dev only: `@vitejs/plugin-react` injects its Fast
 * Refresh preamble as an inline `<script>`, which a stricter policy would
 * block outright and break HMR. None of this admits any origin other than
 * the dev server's own — it stays origin-restricted rather than disabled.
 */
export function buildContentSecurityPolicy(devServerOrigin: string | null): string {
  if (!devServerOrigin) {
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join('; ')
  }

  const wsOrigin = toWebSocketOrigin(devServerOrigin)
  return [
    `default-src 'self' ${devServerOrigin}`,
    `script-src 'self' 'unsafe-inline' ${devServerOrigin}`,
    `style-src 'self' 'unsafe-inline' ${devServerOrigin}`,
    `img-src 'self' data: ${devServerOrigin}`,
    `font-src 'self' ${devServerOrigin}`,
    `connect-src 'self' ${devServerOrigin} ${wsOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/**
 * The slice of `Electron.Session` that installing the CSP needs. Kept
 * narrow and structural (rather than importing `Session` as a value) so
 * this stays testable with a plain fake object — `electron` cannot be
 * imported as a value outside a real Electron process (see
 * `renderer-globals.test.ts` for why), and this module has no other reason
 * to need it.
 */
export interface CspSession {
  webRequest: {
    onHeadersReceived(
      listener: (
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders: Record<string, string[]> }) => void
      ) => void
    ): void
  }
}

/**
 * Installs the CSP as a response header on every request the session makes.
 * This covers both the dev server's `http://` responses and the packaged
 * app's `file://` load, unlike a `<meta>` tag in `index.html`, which only
 * covers the latter and can't vary between dev and prod without templating
 * the HTML at build time. `onHeadersReceived` keeps only its most recent
 * listener per session — calling this again just replaces it, so it is safe
 * to call once per app rather than needing to be guarded against re-entry.
 */
export function installContentSecurityPolicy(session: CspSession, devServerOrigin: string | null): void {
  const csp = buildContentSecurityPolicy(devServerOrigin)
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

/**
 * True when `url` stays inside the app the window was loaded with — the dev
 * server's own origin in development, or the `file://` tree the packaged
 * app ships in production. Everything else (a client's website, a Drive
 * link pasted into the app per §6.10, a `mailto:`) is external.
 *
 * `file:` URLs don't carry a comparable origin the way `http(s)://` ones do
 * (Chromium treats each as its own opaque origin), so when the app itself
 * was loaded from `file:`, any `file:` target counts as internal — nothing
 * in this app renders arbitrary local files, so nothing else would ever
 * present one.
 */
export function isInternalUrl(url: string, appUrl: string): boolean {
  let target: URL
  let app: URL
  try {
    target = new URL(url)
    app = new URL(appUrl)
  } catch {
    return false
  }

  if (app.protocol === 'file:') {
    return target.protocol === 'file:'
  }

  return target.origin === app.origin
}

/**
 * The slice of `Electron.WebContents` that wiring the navigation guards
 * needs — see `CspSession` above for why this is a narrow structural type
 * rather than the real `WebContents` value type.
 */
export interface NavigableWebContents {
  on(event: 'will-navigate', listener: (event: { url: string; preventDefault: () => void }) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void
}

/**
 * Refuses any navigation or `window.open()` that would leave the app and
 * hands the URL to the system browser instead. Company websites and Drive
 * links are pasted into this app by design (§6.10), so this path runs in
 * normal use, not as an edge case.
 *
 * `will-navigate` does not fire for the SPA's own client-side routing
 * (`pushState` / hash changes) or for a same-URL reload — Electron only
 * emits it for a real cross-document navigation — so this cannot block the
 * app's own in-app route changes; it only ever sees navigations that would
 * actually leave the loaded document.
 */
export function registerNavigationGuards(
  webContents: NavigableWebContents,
  appUrl: string,
  openExternal: (url: string) => void
): void {
  webContents.on('will-navigate', (event) => {
    if (!isInternalUrl(event.url, appUrl)) {
      event.preventDefault()
      openExternal(event.url)
    }
  })

  webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url, appUrl)) {
      openExternal(url)
    }
    return { action: 'deny' }
  })
}
