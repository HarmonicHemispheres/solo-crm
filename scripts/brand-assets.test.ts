import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T-260828-16: the installer's welcome bitmap is an NSIS MUI image, which
 * requires classic 24-bit BMP3 (BITMAPINFOHEADER, no alpha channel) at an
 * exact pixel size — a 32-bit BMP, or a BMP of the wrong dimensions, renders
 * as a black/garbled block at install time rather than failing the build
 * (see the task's Risks section). This test reads the actual bytes of the
 * committed binaries — not the generator script's own idea of what it wrote
 * — so a wrong-format regeneration fails this gate instead of shipping
 * silently.
 *
 * T-260828-45: shape (header fields) isn't enough — a regeneration on a
 * HiDPI display with the device scale factor unpinned produces a BMP with a
 * correct header and byte count but wrong pixel content, so the pixel
 * content block below checks actual colour, not just structure. This is
 * also where installerHeader.bmp was dropped: it painted as a dark slab
 * against MUI's white header strip, and package.json no longer wires it.
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

type Rgb = [number, number, number]

/**
 * Read one pixel's colour from a 24bpp BMP3 buffer (bottom-up row order,
 * BGR triples, each row padded to a 4-byte boundary — see bgraToBmp24 in
 * brand-assets.mjs, which writes exactly this layout). (x, y) are in
 * top-down image coordinates, matching how the source SVG is authored.
 *
 * T-260828-45: this is what a header/byte-count check cannot catch. A
 * generator run under an unpinned device scale factor produces a BMP with
 * the right dimensions and the right total size (bgraToBmp24 always emits
 * exactly width*height pixels) but reads the wrong bytes into them — the
 * header is correct and the picture is garbage. Sampling actual pixel
 * colour is the only check that sees the difference.
 */
function readBmpPixel(buf: Buffer, header: BmpHeader, x: number, y: number): Rgb {
  const rowBytes = header.width * 3
  const rowPadded = Math.ceil(rowBytes / 4) * 4
  const dataOffset = buf.readUInt32LE(10)
  const srcRow = header.height - 1 - y // bottom-up storage
  const idx = dataOffset + srcRow * rowPadded + x * 3
  return [buf[idx + 2], buf[idx + 1], buf[idx]] // stored B,G,R -> R,G,B
}

/**
 * Anti-aliasing shifts a handful of levels between Chromium versions even
 * on an identical flat-colour region, so this compares within a tolerance
 * rather than requiring an exact match (see this task's Risks section) —
 * loose enough to absorb that, tight enough that a scale-factor
 * misindexing (which lands on entirely unrelated image content, not a
 * slightly-off shade of the same colour) still fails it.
 */
function expectColorNear(actual: Rgb, expected: Rgb, path: string, label: string): void {
  const [r, g, b] = actual
  const [er, eg, eb] = expected
  const delta = Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb))
  expect(
    delta,
    `${path}: ${label} — expected rgb(${expected.join(',')}), got rgb(${actual.join(',')})`
  ).toBeLessThanOrEqual(6)
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
  const path = resolve(buildDir, 'installerSidebar.bmp')
  const header = readBmpHeader(path)

  it('is exactly 164 x 314', () => {
    expect(header.width).toBe(164)
    expect(header.height).toBe(314)
  })

  it('is 24 bits per pixel, uncompressed (no alpha channel)', () => {
    expect(header.bitsPerPixel).toBe(24)
    expect(header.compression).toBe(0) // BI_RGB
  })

  // T-260828-45: content, not just shape. A generator run with the device
  // scale factor unpinned produces a file that is the right size with the
  // wrong picture in it — see readBmpPixel's doc comment above. These
  // sample points are flat interior regions (checked several pixels deep
  // on every side), not edges, so ordinary anti-aliasing can't trip them.
  describe('pixel content', () => {
    const buf = readFileSync(path)

    it('the obsidian ground reads correctly in a corner clear of any artwork', () => {
      // (10, 10): top-left corner, well outside the cadence-ring mark
      // (which starts around x=26/y=43) and the wordmark below it.
      expectColorNear(readBmpPixel(buf, header, 10, 10), [0x0b, 0x0e, 0x14], path, 'ground at (10,10)')
    })

    it('the cadence ring reads as verdigris on its stroked arc', () => {
      // (113, 99): the ring's 3 o'clock point (see solocrm-sidebar.svg's
      // <circle cx="48" cy="48" r="34"> under its translate/scale chain),
      // squarely inside the dashed arc's stroked (not gapped) portion and
      // several pixels from either edge of the ~5px-wide stroke.
      expectColorNear(readBmpPixel(buf, header, 113, 99), [0x5b, 0xa4, 0xa4], path, 'ring at (113,99)')
    })
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

  // T-260828-45: no "build/" prefix — directories.buildResources already
  // defaults to "build", so app-builder-lib resolves these against it
  // (falling back to projectDir) without the path being spelled out here.
  it('wires icon.ico as the app icon and installer/uninstaller icon', () => {
    expect(pkg.build.win.icon).toBe('icon.ico')
    expect(pkg.build.nsis.installerIcon).toBe('icon.ico')
    expect(pkg.build.nsis.uninstallerIcon).toBe('icon.ico')
  })

  it('wires the sidebar banner, reused for the uninstaller', () => {
    expect(pkg.build.nsis.installerSidebar).toBe('installerSidebar.bmp')
    expect(pkg.build.nsis.uninstallerSidebar).toBe('installerSidebar.bmp')
  })

  // T-260828-45: installerHeader was dropped rather than fixed — the
  // artwork is full-bleed obsidian and MUI_HEADERIMAGE_RIGHT paints it as a
  // dark slab at the right end of an otherwise-white header strip. MUI's
  // default (no header image) replaces it.
  it('does not wire a header image', () => {
    expect(pkg.build.nsis.installerHeader).toBeUndefined()
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
