import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      // Forced to CJS output with a .cjs extension (electron.vite.config.ts):
      // package.json is "type": "module", and an ESM preload only loads when
      // sandbox:false — it throws "Cannot use import statement outside a
      // module" under Electron's default sandboxed renderer, and
      // permanently once T-260828-04 turns the sandbox on.
      preload: join(__dirname, '../preload/index.cjs')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev so the window loads the
  // Vite dev server (HMR); a packaged build loads the built renderer HTML.
  const loadPromise = process.env.ELECTRON_RENDERER_URL
    ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    : mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  loadPromise.catch((error: unknown) => {
    console.error('[main] failed to load renderer:', error)
  })
}

app
  .whenReady()
  .then(() => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('[main] app failed to become ready:', error)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
