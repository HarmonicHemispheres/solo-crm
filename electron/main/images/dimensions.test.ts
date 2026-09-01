import { describe, expect, it } from 'vitest'
import { fitWithin } from './derive'
import { readDeclaredPixelSize } from './dimensions'

/**
 * The two halves of ADR-015 §3/§5 that are arithmetic rather than image
 * handling, and so can be asserted without a decoder: the header read that
 * bounds a decode before it happens, and the fit rule the derivative's target
 * size comes from.
 *
 * `fitWithin` lives in `derive.ts` beside the deriver that uses it.
 * Importing that module here is safe under the plain-Node pool for
 * `branding/picker.ts`'s reason: `electron` resolves to a string path, so the
 * `nativeImage` binding is `undefined` — harmless as long as nothing calls it,
 * and nothing here does.
 */

function png(width: number, height: number, corrupt?: (bytes: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  corrupt?.(bytes)
  return bytes
}

/** A JPEG with `segments` worth of APP/COM padding in front of its SOF, so the marker walk is genuinely walking. */
function jpeg(width: number, height: number, options: { marker?: number; segments?: number } = {}): Uint8Array {
  const marker = options.marker ?? 0xc0
  const parts: number[] = [0xff, 0xd8]
  for (let i = 0; i < (options.segments ?? 1); i += 1) {
    parts.push(0xff, 0xe0 + (i % 16), 0x00, 0x06, 0x00, 0x00, 0x00, 0x00)
  }
  parts.push(
    0xff,
    marker,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01
  )
  parts.push(0xff, 0xd9)
  return new Uint8Array(parts)
}

describe('readDeclaredPixelSize: PNG', () => {
  it('reads IHDR’s big-endian width and height', () => {
    expect(readDeclaredPixelSize(png(2400, 800), 'image/png')).toEqual({ width: 2400, height: 800 })
  })

  it('reads a size no byte cap could have bounded', () => {
    // 400 megapixels described by 64 bytes — the case the guard exists for.
    expect(readDeclaredPixelSize(png(20_000, 20_000), 'image/png')).toEqual({ width: 20_000, height: 20_000 })
  })

  it('reads a width past 2^31 without going negative', () => {
    expect(readDeclaredPixelSize(png(0x8000_0001, 4), 'image/png')?.width).toBe(0x8000_0001)
  })

  it('answers null when the first chunk is not IHDR, when it is truncated, and when a dimension is zero', () => {
    expect(readDeclaredPixelSize(png(8, 8, (b) => b.set([0x49, 0x45, 0x4e, 0x44], 12)), 'image/png')).toBeNull()
    expect(readDeclaredPixelSize(png(8, 8).subarray(0, 20), 'image/png')).toBeNull()
    expect(readDeclaredPixelSize(png(0, 8), 'image/png')).toBeNull()
  })
})

describe('readDeclaredPixelSize: JPEG', () => {
  it('finds the SOF behind however many APPn segments precede it, and reads height before width', () => {
    expect(readDeclaredPixelSize(jpeg(2400, 800, { segments: 6 }), 'image/jpeg')).toEqual({
      width: 2400,
      height: 800
    })
  })

  it('reads progressive (FFC2) as well as baseline (FFC0) and extended (FFC1)', () => {
    for (const marker of [0xc0, 0xc1, 0xc2]) {
      expect(readDeclaredPixelSize(jpeg(640, 480, { marker }), 'image/jpeg')).toEqual({ width: 640, height: 480 })
    }
  })

  it('does not mistake a Huffman table (FFC4) for a frame header', () => {
    // FFC4 shares the `FFCx` prefix and nothing else — reading its payload as
    // a frame would produce dimensions out of a code-length table.
    expect(readDeclaredPixelSize(jpeg(640, 480, { marker: 0xc4 }), 'image/jpeg')).toBeNull()
  })

  it('answers null for a file with no frame header at all', () => {
    expect(readDeclaredPixelSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull()
  })

  it('answers null rather than looping on a segment whose length word is nonsense', () => {
    expect(readDeclaredPixelSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]), 'image/jpeg')).toBeNull()
  })
})

describe('fitWithin: the derivative’s target size', () => {
  it('scales a wide banner down to the box’s width, aspect preserved', () => {
    // ADR-015's own example: a 3:1 banner becomes 480 x 160.
    expect(fitWithin({ width: 2400, height: 800 }, { boxWidth: 480, boxHeight: 270 })).toEqual({
      width: 480,
      height: 160
    })
  })

  it('scales by whichever side binds first', () => {
    expect(fitWithin({ width: 1000, height: 2000 }, { boxWidth: 480, boxHeight: 270 })).toEqual({
      width: 135,
      height: 270
    })
  })

  it('never upscales — a 64 px logo stays 64 px', () => {
    expect(fitWithin({ width: 64, height: 64 }, { boxWidth: 96, boxHeight: 96 })).toEqual({ width: 64, height: 64 })
  })

  it('never rounds a dimension away to zero', () => {
    expect(fitWithin({ width: 4000, height: 1 }, { boxWidth: 96, boxHeight: 96 })).toEqual({ width: 96, height: 1 })
  })

  it('leaves an image already exactly the box alone', () => {
    expect(fitWithin({ width: 96, height: 96 }, { boxWidth: 96, boxHeight: 96 })).toEqual({ width: 96, height: 96 })
  })
})
