import type { CompanyImageContentType } from '../../shared/company-images'

/**
 * The pixel dimensions a PNG or JPEG **declares in its own container header**,
 * read without decoding anything (ADR-015 §5).
 *
 * ## Why this exists at all
 *
 * A byte cap does not bound a decode. A 1 MB PNG can legitimately describe a
 * 256-megapixel image and a 1 MB JPEG a larger one, and `nativeImage`'s
 * `createFromBuffer` allocates the whole bitmap before anything gets a chance
 * to object. So the order is: byte cap, magic-number sniff, **then this**, and
 * only then a decode — with an image over `COMPANY_IMAGE_MAX_PIXELS` refused
 * before `nativeImage` is ever handed the buffer.
 *
 * That is why this is a separate module from `derive.ts` and not a method on
 * the deriver: the deriver is injectable so repository tests can run without a
 * real Electron process, and a guard that lived inside it would be replaced by
 * every fake. This one is pure, has no Node or Electron imports, and runs for
 * every write regardless of which deriver is in play.
 *
 * ## What it deliberately does not do
 *
 * It does not validate the rest of the file. A header claiming 8 × 8 in front
 * of garbage still passes here and is then refused by the decode, which is the
 * correct division: this bounds the decode's *cost*, the decode decides
 * whether the bytes are an image. `null` — no readable header — is a refusal
 * too, because dimensions that cannot be read cannot be bounded.
 */

export interface PixelSize {
  readonly width: number
  readonly height: number
}

/** PNG signature (8 bytes) + IHDR length/type (8) puts width at 16 and height at 20. */
const PNG_IHDR_TYPE_OFFSET = 12
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20
/** `IHDR` as ASCII — the first chunk of every PNG, by the format's own rule. */
const IHDR = [0x49, 0x48, 0x44, 0x52] as const

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24 >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
  )
}

/**
 * PNG's IHDR is fixed at bytes 16-23, big-endian, and the format requires it
 * to be the first chunk — so this is a constant-offset read, not a scan. A
 * file whose 13th-16th bytes are not `IHDR` is not a PNG whatever its
 * signature says.
 */
function readPngSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < PNG_HEIGHT_OFFSET + 4) return null
  if (!IHDR.every((byte, index) => bytes[PNG_IHDR_TYPE_OFFSET + index] === byte)) return null
  const width = readUint32BE(bytes, PNG_WIDTH_OFFSET)
  const height = readUint32BE(bytes, PNG_HEIGHT_OFFSET)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * JPEG has no fixed header position: dimensions live in the first Start Of
 * Frame segment, which sits after however many APPn/COM/DQT/DHT segments the
 * encoder chose to emit. So this walks the marker chain.
 *
 * ADR-015 names `FFC0`/`FFC1`/`FFC2` — baseline, extended sequential and
 * progressive, which is everything Chromium's decoder handles. The set below
 * is the whole SOF family minus the three `FFCx` markers that are *not* frame
 * headers (`C4` DHT, `C8` JPG, `CC` DAC); every member shares the identical
 * segment layout, so reading them all is the same code and refuses fewer
 * files for the wrong reason. A frame this app cannot decode is still refused
 * — by the decode, on what it is, rather than here on a header this function
 * declined to parse.
 */
function isStartOfFrame(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function readJpegSize(bytes: Uint8Array): PixelSize | null {
  // Past the SOI (`FFD8`) the file is a chain of `FF <marker> <length:2>
  // <payload>` segments.
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    // Fill bytes: any number of 0xFF may pad the gap before a marker.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Standalone markers carry no length word at all.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3]
    // A segment's length word counts itself; anything under two bytes is
    // malformed and would make this loop stand still.
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      // marker(2) + length(2) + precision(1), then height then width, both
      // big-endian 16-bit — height first, which is the ordering that catches
      // out anyone who assumes otherwise.
      if (offset + 9 > bytes.length) return null
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) + bytes[offset + 8]
      if (width <= 0 || height <= 0) return null
      return { width, height }
    }
    offset += 2 + length
  }
  return null
}

/**
 * The dimensions these bytes declare, or `null` when no header could be read.
 *
 * `contentType` is the **sniffed** type (`sniffImageContentType`), never a
 * caller's claim about the file — which is what makes choosing a parser here
 * safe.
 */
export function readDeclaredPixelSize(bytes: Uint8Array, contentType: CompanyImageContentType): PixelSize | null {
  return contentType === 'image/png' ? readPngSize(bytes) : readJpegSize(bytes)
}
