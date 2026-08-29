// Regenerates the committed installer/icon binaries under build/ from the
// SVG sources in assets/. Run by hand, not part of `npm run dist`:
//
//   node_modules/electron/dist/electron.exe scripts/brand-assets.mjs
//
// (invoke via the electron binary directly, or `npx electron
// scripts/brand-assets.mjs` — it must run as an Electron main process, not
// plain Node, because it uses BrowserWindow + nativeImage to rasterize.)
//
// Rasterizer: Electron's own bundled Chromium, via a hidden BrowserWindow
// and webContents.capturePage(). T-260828-16's scope rules out adding a
// standalone SVG rasterizer (sharp can't write BMP; a canvas/resvg package
// would be a new devDependency for a script that runs a handful of times a
// year) — Electron is already a devDependency and renders these SVGs with a
// real browser engine, so nothing new is added.
//
// Outputs:
//   build/icon.ico              — 16/24/32/48/64/128/256, from assets/solocrm-mark.svg
//   build/installerSidebar.bmp  — 164x314, 24bpp, from assets/solocrm-sidebar.svg
//
// (T-260828-45: installerHeader.bmp was dropped — full-bleed obsidian painted
// as a dark slab at the right end of MUI's white header strip, per
// MUI_HEADERIMAGE_RIGHT. package.json no longer sets nsis.installerHeader, so
// MUI falls back to its default text-only header instead.)
//
// NSIS's MUI welcome bitmap requires classic 24-bit BMP3 (BITMAPINFOHEADER,
// no alpha channel) — a 32-bit BMP renders as a black or garbled block at
// install time, not a build-time failure. See this task's Risks section.
// That's why the BMP writer below hand-builds a BITMAPFILEHEADER + 40-byte
// BITMAPINFOHEADER and drops the alpha byte from every pixel, rather than
// reusing any higher-level image encoder.

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const assetsDir = resolve(root, 'assets')
const buildDir = resolve(root, 'build')

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]

app.disableHardwareAcceleration()
// This is a one-shot batch renderer, not a real app — no GPU process is
// available on a headless/CI box, and the software (CPU) compositing path
// Electron falls back to renders these SVGs pixel-identically anyway.
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
// Pin the capture to 1x regardless of the host display's DPI setting.
// webContents.capturePage() returns a bitmap at the window's actual
// deviceScaleFactor — on a HiDPI display that's a 2x (or higher) physical
// pixel buffer, while crop() above works in DIP and bgraToBmp24() below
// assumes the buffer it receives is exactly `width` x `height` at 1x. Left
// unpinned, a regeneration on a HiDPI laptop produces a BMP with the
// correct byte count and header (bgraToBmp24 always emits width*height
// pixels) but garbled content, because it reads a 1x-sized window into a
// buffer that is really 2x-sized. Chromium reads switches from a
// process-wide map keyed by name, so this appendSwitch wins even if the
// script is invoked with an explicit --force-device-scale-factor of its
// own (e.g. to simulate a HiDPI box for testing) — the value set here,
// applied after Electron's own argv parsing, is the one Chromium sees.
app.commandLine.appendSwitch('force-device-scale-factor', '1')

// A single hidden window, reused for every render below. In this
// environment (no real GPU/compositor — see the --disable-gpu switches
// above), a *second* BrowserWindow reliably fails to load anything
// (net::ERR_FAILED) once a first one has been created and captured, even
// after the first is destroyed. Reusing one window and reloading its
// content per asset (transparent: true throughout — that only enables an
// alpha channel, it doesn't stop opaque CSS backgrounds from painting
// fully, so the BMP renders below are unaffected) sidesteps that entirely.
let sharedWindow

function getWindow(width, height) {
  if (!sharedWindow) {
    sharedWindow = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      useContentSize: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: false }
    })
  } else {
    sharedWindow.setContentSize(width, height)
  }
  return sharedWindow
}

/**
 * Render an SVG string to a nativeImage at exactly `width` x `height` CSS
 * pixels. `background` is the CSS background painted behind the SVG —
 * 'transparent' preserves alpha (for the icon), a hex color flattens it
 * (required for the BMP outputs, which must carry no alpha channel).
 */
async function renderSvg(svgMarkup, { width, height, background }) {
  const win = getWindow(width, height)
  const html = `<html><body style="margin:0;padding:0;width:${width}px;height:${height}px;background:${background};display:flex;align-items:center;justify-content:center;overflow:hidden">${svgMarkup}</body></html>`
  // A data: URL works for small markup, but the wordmark paths below push
  // this well past the length where loadURL() started failing with a bare
  // ERR_FAILED in testing — a temp file sidesteps any URL-length limit.
  const tmpFile = resolve(tmpdir(), `solocrm-brand-asset-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(tmpFile, html, 'utf8')
  try {
    await win.loadFile(tmpFile)
  } finally {
    rmSync(tmpFile, { force: true })
  }
  // Two animation-frame round trips: SVG layout/paint has settled by the
  // time the second one fires. A fixed setTimeout would work but ties
  // correctness to a guessed duration instead of the renderer's own clock.
  await win.webContents.executeJavaScript(
    'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'
  )
  const captured = await win.webContents.capturePage()
  // Some platforms hand back a few extra rows/columns of window chrome
  // beyond the requested content size (observed: exact width, +26px
  // height, even with frame:false) — crop to the requested size rather
  // than trust capturePage()'s reported size.
  return captured.crop({ x: 0, y: 0, width, height })
}

/** Override the root <svg>'s width/height attributes; viewBox (and so the
 * artwork's proportions) is untouched — this only changes the raster size
 * Chromium renders at. */
function sizedSvg(svgMarkup, width, height) {
  return svgMarkup
    .replace(/(<svg[^>]*?\swidth=")[^"]*(")/, `$1${width}$2`)
    .replace(/(<svg[^>]*?\sheight=")[^"]*(")/, `$1${height}$2`)
}

function readAsset(name) {
  return readFileSync(resolve(assetsDir, name), 'utf8')
}

// ---- BMP (24bpp BITMAPINFOHEADER, no alpha) -------------------------------

function bgraToBmp24(bgra, width, height) {
  // Defense in depth alongside the force-device-scale-factor pin above: if
  // a future Electron version ever hands back a differently-scaled buffer
  // despite that pin, fail loudly here instead of silently emitting a
  // correctly-sized, wrong-content BMP (the exact failure this task exists
  // to close off).
  const expectedBytes = width * height * 4
  if (bgra.length !== expectedBytes) {
    throw new Error(
      `bgraToBmp24: expected a ${width}x${height} BGRA buffer (${expectedBytes} bytes) but got ` +
        `${bgra.length} bytes — the capture ran at an unexpected device scale factor`
    )
  }
  const rowBytes = width * 3
  const rowPadded = Math.ceil(rowBytes / 4) * 4
  const pixelDataSize = rowPadded * height
  const fileHeaderSize = 14
  const infoHeaderSize = 40
  const fileSize = fileHeaderSize + infoHeaderSize + pixelDataSize

  const buf = Buffer.alloc(fileSize)
  let o = 0

  // BITMAPFILEHEADER
  buf.write('BM', o, 'ascii')
  o += 2
  buf.writeUInt32LE(fileSize, o)
  o += 4
  buf.writeUInt32LE(0, o) // reserved
  o += 4
  buf.writeUInt32LE(fileHeaderSize + infoHeaderSize, o) // pixel data offset
  o += 4

  // BITMAPINFOHEADER (BMP3)
  buf.writeUInt32LE(infoHeaderSize, o)
  o += 4
  buf.writeInt32LE(width, o)
  o += 4
  buf.writeInt32LE(height, o) // positive => bottom-up row order
  o += 4
  buf.writeUInt16LE(1, o) // planes
  o += 2
  buf.writeUInt16LE(24, o) // bits per pixel
  o += 2
  buf.writeUInt32LE(0, o) // compression: BI_RGB
  o += 4
  buf.writeUInt32LE(pixelDataSize, o)
  o += 4
  buf.writeInt32LE(2835, o) // ~72 DPI
  o += 4
  buf.writeInt32LE(2835, o)
  o += 4
  buf.writeUInt32LE(0, o) // colors used
  o += 4
  buf.writeUInt32LE(0, o) // colors important
  o += 4

  // Pixel data: bottom-up, BGR, each row padded to a 4-byte boundary.
  // `bgra` is top-down BGRA (Electron nativeImage.toBitmap() order).
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y // flip to bottom-up
    const rowStart = o + y * rowPadded
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcRow * width + x) * 4
      const dstIdx = rowStart + x * 3
      buf[dstIdx] = bgra[srcIdx] // B
      buf[dstIdx + 1] = bgra[srcIdx + 1] // G
      buf[dstIdx + 2] = bgra[srcIdx + 2] // R
      // alpha (srcIdx + 3) intentionally dropped
    }
  }

  return buf
}

// ---- ICO (PNG-compressed entries, valid since Windows Vista) --------------

function buildIco(entries) {
  // entries: [{ size, png: Buffer }], largest-quality PNG per size.
  const dirSize = 6 + 16 * entries.length
  const chunks = [Buffer.alloc(dirSize)]
  const dir = chunks[0]

  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type: 1 = icon
  dir.writeUInt16LE(entries.length, 4)

  let offset = dirSize
  entries.forEach((entry, i) => {
    const base = 6 + i * 16
    const dim = entry.size >= 256 ? 0 : entry.size // 0 means 256 in ICO
    dir.writeUInt8(dim, base) // width
    dir.writeUInt8(dim, base + 1) // height
    dir.writeUInt8(0, base + 2) // color count (0 = >=256 colors)
    dir.writeUInt8(0, base + 3) // reserved
    dir.writeUInt16LE(1, base + 4) // color planes
    dir.writeUInt16LE(32, base + 6) // bits per pixel
    dir.writeUInt32LE(entry.png.length, base + 8) // size of image data
    dir.writeUInt32LE(offset, base + 12) // offset of image data
    offset += entry.png.length
    chunks.push(entry.png)
  })

  return Buffer.concat(chunks)
}

async function main() {
  mkdirSync(buildDir, { recursive: true })

  // --- icon.ico ---
  const markSvg = readAsset('solocrm-mark.svg')
  const iconMaster = await renderSvg(sizedSvg(markSvg, 512, 512), {
    width: 512,
    height: 512,
    background: 'transparent'
  })
  const iconEntries = ICON_SIZES.map((size) => ({
    size,
    png: iconMaster.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }))
  writeFileSync(resolve(buildDir, 'icon.ico'), buildIco(iconEntries))
  console.log('wrote build/icon.ico —', ICON_SIZES.join('/'))

  // --- installerSidebar.bmp (164 x 314, reused as uninstallerSidebar) ---
  const sidebarSvg = readAsset('solocrm-sidebar.svg')
  const sidebarImage = await renderSvg(sidebarSvg, {
    width: 164,
    height: 314,
    background: '#0B0E14'
  })
  writeFileSync(
    resolve(buildDir, 'installerSidebar.bmp'),
    bgraToBmp24(sidebarImage.toBitmap(), 164, 314)
  )
  console.log('wrote build/installerSidebar.bmp — 164x314 24bpp')

  if (sharedWindow) sharedWindow.destroy()
  app.exit(0)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(err)
    app.exit(1)
  })
})
