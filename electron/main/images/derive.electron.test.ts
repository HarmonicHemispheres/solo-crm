import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Same gap as renderer-globals.test.ts's header comment: under plain Node
// (vitest) node_modules/electron/index.js exports the string path to the
// Electron binary rather than the real API — used below only to spawn it.
import electronPath from 'electron'
import { describe, expect, it } from 'vitest'
import { compileToCommonJs } from '../test-support/compile-to-cjs'

/**
 * The one test that runs the **real** deriver (ADR-015 §3). Every repository
 * test injects a fake, because `nativeImage` does not exist outside a genuine
 * Electron process — so without this file nothing at all would check that the
 * derivative the whole design rests on can actually be produced, and the first
 * evidence either way would be an operator's blank card.
 *
 * The claims it settles, each of which ADR-015 asserts from a measurement
 * rather than from a specification:
 *
 * - `createFromBuffer` decodes PNG and JPEG, and comes back `isEmpty()` for a
 *   valid GIF — the measured fact the accepted set is narrowed on. If a later
 *   Electron starts decoding GIF, the assertion below is where that shows up,
 *   and `COMPANY_IMAGE_CONTENT_TYPES` becomes revisable on evidence.
 * - A logo comes out PNG and a banner JPEG **regardless of the original's
 *   format**, which is what lets `thumb_content_type` be asserted from the
 *   slot rather than sniffed.
 * - The fit rule holds through a real resize, and never upscales.
 *
 * Same spawn technique as `renderer-globals.test.ts` (ELECTRON_RUN_AS_NODE
 * unset for the child so `require('electron')` resolves to the real API
 * instead of this sandboxed dev environment's Node stand-in), with
 * `compile-to-cjs.ts`'s transpile-and-require-graph so the harness runs the
 * *real* `derive.ts` rather than a hand-reimplementation of it.
 */

const here = dirname(fileURLToPath(import.meta.url))

interface DerivedReport {
  sourceWidth: number
  sourceHeight: number
  thumbContentType: string
  thumbWidth: number
  thumbHeight: number
  /** The first three bytes of the encoded derivative — enough to name the format. */
  thumbMagic: number[]
  thumbByteLength: number
}

interface HarnessResult {
  /** A 1200x400 PNG, derived for each slot. */
  bannerFromPng: DerivedReport
  logoFromPng: DerivedReport
  /** The same picture re-encoded as JPEG first, so "the slot decides the format" is tested against both inputs. */
  bannerFromJpeg: DerivedReport
  /** 64x64 — under the logo box, so it must come back unchanged in size. */
  smallLogo: DerivedReport
  /** `null` for anything that did not decode. */
  fromGif: null | DerivedReport
  fromGarbage: null | DerivedReport
}

function runHarness(): HarnessResult {
  const electronBinary = electronPath as unknown as string
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-derive-'))
  const harnessPath = join(dir, 'harness.cjs')
  const resultPath = join(dir, 'result.json')
  const compiled = compileToCommonJs(join(here, 'derive.ts'))

  writeFileSync(
    harnessPath,
    [
      `const { app, nativeImage } = require('electron')`,
      `const { writeFileSync } = require('node:fs')`,
      `const { nativeImageDeriver } = require(${JSON.stringify(compiled.entryPath)})`,
      // A real raster built from raw BGRA and encoded by the same library, so
      // the fixtures are genuine files rather than checked-in blobs.
      `function solid(width, height) {`,
      `  const pixels = Buffer.alloc(width * height * 4)`,
      `  for (let i = 0; i < pixels.length; i += 4) {`,
      `    pixels[i] = (i / 4) % 251; pixels[i + 1] = (i / 8) % 241; pixels[i + 2] = (i / 16) % 239; pixels[i + 3] = 255`,
      `  }`,
      `  return nativeImage.createFromBitmap(pixels, { width, height })`,
      `}`,
      `function report(derived) {`,
      `  if (derived === null) return null`,
      `  const bytes = Buffer.from(derived.thumbnail.bytes)`,
      `  return {`,
      `    sourceWidth: derived.source.width,`,
      `    sourceHeight: derived.source.height,`,
      `    thumbContentType: derived.thumbnail.contentType,`,
      `    thumbWidth: derived.thumbnail.size.width,`,
      `    thumbHeight: derived.thumbnail.size.height,`,
      `    thumbMagic: [bytes[0], bytes[1], bytes[2]],`,
      `    thumbByteLength: bytes.length`,
      `  }`,
      `}`,
      `app.whenReady().then(() => {`,
      `  const widePng = solid(1200, 400).toPNG()`,
      `  const wideJpeg = solid(1200, 400).toJPEG(90)`,
      `  const smallPng = solid(64, 64).toPNG()`,
      `  const gif = Buffer.from('R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAI=', 'base64')`,
      `  const garbage = Buffer.from('this is definitely not an image at all', 'utf-8')`,
      `  const result = {`,
      `    bannerFromPng: report(nativeImageDeriver(widePng, 'banner')),`,
      `    logoFromPng: report(nativeImageDeriver(widePng, 'logo')),`,
      `    bannerFromJpeg: report(nativeImageDeriver(wideJpeg, 'banner')),`,
      `    smallLogo: report(nativeImageDeriver(smallPng, 'logo')),`,
      `    fromGif: report(nativeImageDeriver(gif, 'logo')),`,
      `    fromGarbage: report(nativeImageDeriver(garbage, 'logo'))`,
      `  }`,
      `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result))`,
      `  app.exit(0)`,
      `}).catch((error) => {`,
      `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String((error && error.stack) || error) }))`,
      `  app.exit(1)`,
      `})`
    ].join('\n'),
    'utf-8'
  )

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const run = spawnSync(electronBinary, [harnessPath], { encoding: 'utf-8', env, timeout: 80_000 })

  let parsed: HarnessResult | { error: string }
  try {
    parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as HarnessResult | { error: string }
  } catch {
    throw new Error(
      `derive harness produced no readable result.\n` +
        `status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error)}\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`
    )
  } finally {
    for (const generatedPath of compiled.generatedPaths) rmSync(generatedPath, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }

  if ('error' in parsed) throw new Error(`derive harness failed inside Electron: ${parsed.error}`)
  return parsed
}

const PNG_MAGIC = [0x89, 0x50, 0x4e]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

describe('nativeImageDeriver inside a real Electron process', () => {
  it(
    'derives the slot’s box and format from a real PNG and a real JPEG, never upscales, and refuses what it cannot decode',
    () => {
      const result = runHarness()

      // A 3:1 source in a 480x270 box is 480x160 — ADR-015 §3's own worked
      // example, here through a real decode-resize-encode rather than through
      // the arithmetic alone (`dimensions.test.ts` covers that separately).
      expect(result.bannerFromPng.sourceWidth).toBe(1200)
      expect(result.bannerFromPng.sourceHeight).toBe(400)
      expect(result.bannerFromPng.thumbWidth).toBe(480)
      expect(result.bannerFromPng.thumbHeight).toBe(160)
      expect(result.bannerFromPng.thumbContentType).toBe('image/jpeg')
      expect(result.bannerFromPng.thumbMagic).toEqual(JPEG_MAGIC)
      expect(result.bannerFromPng.thumbByteLength).toBeGreaterThan(0)

      // The same source into the other slot: 96x32, and PNG.
      expect(result.logoFromPng.thumbWidth).toBe(96)
      expect(result.logoFromPng.thumbHeight).toBe(32)
      expect(result.logoFromPng.thumbContentType).toBe('image/png')
      expect(result.logoFromPng.thumbMagic).toEqual(PNG_MAGIC)

      // The format is a function of the slot and nothing else — which is what
      // lets `thumb_content_type` be asserted rather than sniffed.
      expect(result.bannerFromJpeg.thumbContentType).toBe('image/jpeg')
      expect(result.bannerFromJpeg.thumbMagic).toEqual(JPEG_MAGIC)
      expect(result.bannerFromJpeg.thumbWidth).toBe(480)

      // Never upscaled: a 64px mark stays 64px, and still goes through the
      // encode step.
      expect(result.smallLogo.sourceWidth).toBe(64)
      expect(result.smallLogo.thumbWidth).toBe(64)
      expect(result.smallLogo.thumbHeight).toBe(64)
      expect(result.smallLogo.thumbMagic).toEqual(PNG_MAGIC)

      // The measured fact ADR-015 §5 narrows the accepted set on: a *valid*
      // GIF does not decode from a buffer, so a GIF slot could only ever have
      // been a slot with no derivative.
      expect(result.fromGif).toBeNull()
      expect(result.fromGarbage).toBeNull()
    },
    // Bounded by the spawnSync `timeout` above at 80s; this budget is that
    // plus headroom for the compile step and the harness around it, matching
    // renderer-globals.test.ts's reasoning for the same kind of boot. This
    // file runs in the serial `runtime-boot-node` project (vitest.config.ts),
    // so it does not compete with the rest of the suite for CPU.
    90_000
  )
})
