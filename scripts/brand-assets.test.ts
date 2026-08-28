import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T-260828-16: the installer's welcome/header bitmaps are NSIS MUI images,
 * which require classic 24-bit BMP3 (BITMAPINFOHEADER, no alpha channel) at
 * an exact pixel size — a 32-bit BMP, or a BMP of the wrong dimensions,
 * renders as a black/garbled block at install time rather than failing the
 * build (see the task's Risks section). This test reads the actual bytes of
 * the committed binaries — not the generator script's own idea of what it
 * wrote — so a wrong-format regeneration fails this gate instead of
 * shipping silently.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const buildDir = resolve(root, 'build')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface BmpHeader {
  width: number
  height: number
  bitsPerPixel: number
  compression: number
}

function readBmpHeader(path: string): BmpHeader {
  const buf = readFileSync(path)
  expect(buf.subarray(0, 2).toString('ascii'), `${path}: BITMAPFILEHEADER magic`).toBe('BM')
  const headerSize = buf.readUInt32LE(14)
  // 40 is BITMAPINFOHEADER's own size field — this is what "BMP3" means:
  // the classic Windows 3.x info header, not BITMAPV4HEADER (108) or
  // BITMAPV5HEADER (124), which carry alpha-mask fields NSIS's MUI does
  // not expect.
  expect(headerSize, `${path}: BITMAPINFOHEADER size (BMP3 = 40)`).toBe(40)
  return {
    width: buf.readInt32LE(18),
    height: buf.readInt32LE(22),
    bitsPerPixel: buf.readUInt16LE(28),
    compression: buf.readUInt32LE(30)
  }
}

interface IcoEntry {
  width: number
  height: number
  isPng: boolean
}

function readIcoEntries(path: string): IcoEntry[] {
  const buf = readFileSync(path)
  expect(buf.readUInt16LE(0), `${path}: ICONDIR reserved`).toBe(0)
  expect(buf.readUInt16LE(2), `${path}: ICONDIR type (1 = icon)`).toBe(1)
  const count = buf.readUInt16LE(4)
  const entries: IcoEntry[] = []
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16
    // A 0 byte means 256 — ICONDIRENTRY can't encode 256 in a single byte.
    const rawWidth = buf.readUInt8(base)
    const rawHeight = buf.readUInt8(base + 1)
    const size = buf.readUInt32LE(base + 8)
    const offset = buf.readUInt32LE(base + 12)
    const isPng = buf.subarray(offset, offset + 8).equals(PNG_SIGNATURE)
    entries.push({
      width: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      isPng
    })
    void size
  }
  return entries
}

describe('build/installerSidebar.bmp', () => {
  const header = readBmpHeader(resolve(buildDir, 'installerSidebar.bmp'))

  it('is exactly 164 x 314', () => {
    expect(header.width).toBe(164)
    expect(header.height).toBe(314)
  })

  it('is 24 bits per pixel, uncompressed (no alpha channel)', () => {
    expect(header.bitsPerPixel).toBe(24)
    expect(header.compression).toBe(0) // BI_RGB
  })
})

describe('build/installerHeader.bmp', () => {
  const header = readBmpHeader(resolve(buildDir, 'installerHeader.bmp'))

  it('is exactly 150 x 57', () => {
    expect(header.width).toBe(150)
    expect(header.height).toBe(57)
  })

  it('is 24 bits per pixel, uncompressed (no alpha channel)', () => {
    expect(header.bitsPerPixel).toBe(24)
    expect(header.compression).toBe(0)
  })
})

describe('build/icon.ico', () => {
  const entries = readIcoEntries(resolve(buildDir, 'icon.ico'))

  it('contains a 256 x 256 entry', () => {
    const entry = entries.find((e) => e.width === 256 && e.height === 256)
    expect(entry, 'no 256x256 entry in icon.ico').toBeDefined()
  })

  it('every entry decodes as PNG-compressed image data', () => {
    // Required for the 256 entry (BMP/DIB can't hold it); done uniformly
    // for every size here since that's what the generator emits.
    for (const entry of entries) {
      expect(entry.isPng, `${entry.width}x${entry.height} entry is not PNG data`).toBe(true)
    }
  })

  it('covers the full multi-resolution set electron-builder/Windows expects', () => {
    const sizes = entries.map((e) => e.width).sort((a, b) => a - b)
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})

describe('package.json build config', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
    build: {
      win: { icon: string }
      nsis: Record<string, unknown>
    }
  }

  it('wires build/icon.ico as the app icon and installer/uninstaller icon', () => {
    expect(pkg.build.win.icon).toBe('build/icon.ico')
    expect(pkg.build.nsis.installerIcon).toBe('build/icon.ico')
    expect(pkg.build.nsis.uninstallerIcon).toBe('build/icon.ico')
  })

  it('wires the sidebar banner, reused for the uninstaller', () => {
    expect(pkg.build.nsis.installerSidebar).toBe('build/installerSidebar.bmp')
    expect(pkg.build.nsis.uninstallerSidebar).toBe('build/installerSidebar.bmp')
  })

  it('wires the header lockup', () => {
    expect(pkg.build.nsis.installerHeader).toBe('build/installerHeader.bmp')
  })

  it('turns off oneClick, which is required for the sidebar banner to show at all', () => {
    // installerSidebar (MUI_WELCOMEFINISHPAGE_BITMAP) is assisted-installer
    // only — a one-click installer never shows the welcome page it lives
    // on, so this being false is not optional polish, it's what makes
    // installerSidebar do anything.
    expect(pkg.build.nsis.oneClick).toBe(false)
  })

  it('enables the assisted-installer options this scope calls for', () => {
    expect(pkg.build.nsis.allowToChangeInstallationDirectory).toBe(true)
    expect(pkg.build.nsis.perMachine).toBe(false)
    expect(pkg.build.nsis.createDesktopShortcut).toBe(true)
    expect(typeof pkg.build.nsis.shortcutName).toBe('string')
    expect(typeof pkg.build.nsis.uninstallDisplayName).toBe('string')
  })
})
