import { nativeImage } from 'electron'
import {
  COMPANY_IMAGE_THUMBNAILS,
  type CompanyImageContentType,
  type CompanyImageSlot
} from '../../shared/company-images'
import type { PixelSize } from './dimensions'

/**
 * The downscaled derivative every company image is stored beside (ADR-015 §3)
 * — generated **once, in main, at write time**, because that is where the
 * bytes already are and because the alternative (deriving on read) decodes and
 * resizes 120 images on every load of the companies grid, having first read
 * the originals it exists to avoid reading.
 *
 * ## Why this is its own module, injected rather than imported
 *
 * The API is Electron's own `nativeImage`: `createFromBuffer` decodes,
 * `isEmpty()` says whether it did, `getSize()` gives the source's pixels,
 * `resize()` scales and `toPNG()`/`toJPEG()` encode. It adds no dependency —
 * this is Chromium's decoder, already in the process.
 *
 * But `electron` under plain-Node vitest resolves to a *string path* to the
 * binary, so `nativeImage` is `undefined` there and every repository test that
 * wrote an image would need a real Electron process to run. So the repository
 * takes an `ImageDeriver` as an injected dependency defaulting to
 * `nativeImageDeriver` — the same structural-injection pattern
 * `branding/picker.ts` uses for `dialog`. Repository tests inject a fake; the
 * real one is exercised by `derive.electron.test.ts`, which boots a throwaway
 * Electron.
 *
 * ## What a deriver does not do
 *
 * It does not enforce the byte cap, sniff the format, or bound the pixel
 * count. Those all run in the repository, before this is called, precisely
 * because a fake deriver must not be able to replace them (see
 * `dimensions.ts`'s header). A deriver decodes bytes it has already been told
 * are a bounded PNG or JPEG, and answers `null` if the decode comes back
 * empty anyway — a malformed raster that sniffed correctly, which is refused
 * rather than passed to the renderer.
 */

/** One slot's stored pair: the source's own pixel size, and the derivative to store beside it. */
export interface DerivedImage {
  /** The original's pixel dimensions, from the decoder rather than from the header parse — stored so a view can reserve the banner's box with `aspect-ratio` before the image decodes. */
  readonly source: PixelSize
  readonly thumbnail: {
    readonly bytes: Uint8Array
    /** Asserted from the slot, never sniffed: every write goes through the same encode step. */
    readonly contentType: CompanyImageContentType
    readonly size: PixelSize
  }
}

/**
 * Decode, resize, encode. `null` means the bytes did not decode — the caller
 * turns that into a refusal.
 */
export type ImageDeriver = (bytes: Uint8Array, slot: CompanyImageSlot) => DerivedImage | null

/**
 * The target size for a source of `size` fitted inside `box`:
 * `scale = min(1, boxWidth / width, boxHeight / height)`, rounded, never below
 * 1 px, aspect preserved and **never upscaled** — a 64 px logo stays 64 px.
 *
 * Exported so the rule can be asserted without a decoder: it is the half of
 * the derivative spec that is arithmetic rather than image handling.
 */
export function fitWithin(size: PixelSize, box: { boxWidth: number; boxHeight: number }): PixelSize {
  const scale = Math.min(1, box.boxWidth / size.width, box.boxHeight / size.height)
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

/**
 * The real deriver, backed by `nativeImage`. Only ever called inside a genuine
 * Electron process — under vitest's `node` pool `nativeImage` is `undefined`
 * and every test injects a fake instead.
 *
 * The resize runs even when `fitWithin` returns the source's own size, so the
 * derivative's format is a function of the slot and nothing else. That is what
 * lets `thumb_content_type` be asserted rather than sniffed: a PNG banner and
 * a JPEG banner both come out of here as JPEG.
 */
export const nativeImageDeriver: ImageDeriver = (bytes, slot) => {
  const spec = COMPANY_IMAGE_THUMBNAILS[slot]
  const image = nativeImage.createFromBuffer(Buffer.from(bytes))
  if (image.isEmpty()) return null

  const source = image.getSize()
  if (source.width <= 0 || source.height <= 0) return null

  const target = fitWithin(source, spec)
  const resized = image.resize({ width: target.width, height: target.height, quality: 'best' })
  const encoded =
    spec.contentType === 'image/png' ? resized.toPNG() : resized.toJPEG(spec.quality ?? 75)
  // An encoder that produced nothing would otherwise be stored as a zero-byte
  // NOT NULL blob and render as a broken image forever.
  if (encoded.length === 0) return null

  return {
    source,
    thumbnail: { bytes: new Uint8Array(encoded), contentType: spec.contentType, size: target }
  }
}
