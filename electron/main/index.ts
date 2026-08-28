import { join } from 'node:path'
import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { closeDatabase, openDatabase } from './db/connection'
import { SECURE_WEB_PREFERENCES, installContentSecurityPolicy, registerNavigationGuards } from './security'

/** The dev server's own origin in development, or `null` in a packaged build. */
function devServerUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL ?? null
}

/** The origin `isInternalUrl` compares navigations against. */
function appUrl(): string {
  // In production the window loads a `file://` path; `isInternalUrl` treats
  // any `file:` target as internal once the app itself is on `file:`, so the
  // exact path here doesn't matter beyond carrying that protocol.
  return devServerUrl() ?? 'file:///'
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // Forced to CJS output with a .cjs extension (electron.vite.config.ts):
      // package.json is "type": "module", and an ESM preload only loads when
      // sandbox:false — it throws "Cannot use import statement outside a
      // module" under Electron's default sandboxed renderer, and
      // permanently now that sandbox is on above.
      preload: join(__dirname, '../preload/index.cjs')
    }
  })

  registerNavigationGuards(mainWindow.webContents, appUrl(), (url) => {
    shell.openExternal(url).catch((error: unknown) => {
      console.error('[main] failed to open external URL:', error)
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev so the window loads the
  // Vite dev server (HMR); a packaged build loads the built renderer HTML.
  const rendererUrl = devServerUrl()
  const loadPromise = rendererUrl
    ? mainWindow.loadURL(rendererUrl)
    : mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  loadPromise.catch((error: unknown) => {
    console.error('[main] failed to load renderer:', error)
  })
}

app
  .whenReady()
  .then(() => {
    // Installed once, before any window is created: every BrowserWindow this
    // app opens uses the default session unless it opts into a partition,
    // and onHeadersReceived keeps only its most recent listener per session,
    // so registering this again per-window would just overwrite itself with
    // an identical policy.
    installContentSecurityPolicy(session.defaultSession, devServerUrl())

    // Opened once, here, before any window: `openDatabase()` (in
    // electron/main/db/connection.ts) is the only place a Database
    // connection is constructed anywhere in this app, and this is its one
    // call site. T-260828-06's sync-folder guard and T-260828-07's migration
    // runner both land inside `openDatabase`/immediately after it, not here.
    openDatabase()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    // Without the explicit exit this path leaves a zombie: no window was
    // ever created, so `window-all-closed` never fires and the process
    // lingers invisibly with a broken database or session.
    console.error('[main] app failed to start:', error)
    dialog.showErrorBox(
      'Solo CRM could not start',
      error instanceof Error ? error.message : String(error)
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// `before-quit`, not `window-all-closed`: on macOS the app can stay alive
// with no windows open (the handler above only quits elsewhere), and the
// connection still needs to close — checkpointing WAL back into
// `solocrm.db` — whenever the app itself actually exits, on every platform.
app.on('before-quit', () => {
  closeDatabase()
})
