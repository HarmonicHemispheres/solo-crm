import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      // package.json is "type": "module", so electron-vite emits the preload
      // bundle as .mjs (an ESM .js file can't contain CJS require() output).
      preload: join(__dirname, '../preload/index.mjs')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev so the window loads the
  // Vite dev server (HMR); a packaged build loads the built renderer HTML.
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
