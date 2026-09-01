import { z } from 'zod'
import type { FaviconContentType } from './favicons'

/**
 * A company's own logo and banner (T-260901-08, ADR-015) — the shared
 * vocabulary both sides of the IPC boundary name, as PURE zod plus constants
 * with no Node imports, the same discipline every `electron/shared/**` module
 * follows (see `electron/shared/links.ts`'s header for why: this file is
 * typechecked under both `tsconfig.node.json` and `tsconfig.web.json`).
 *
 * ## Two slots per company, and absence is the default
 *
 * A company has one logo and one banner. A slot with no row means "draw the
 * derived mark" — `hue(name)` and `initials(name)`, computed at render time
 * and stored nowhere (requirements §6.2). The absence *is* the default: there
 * is no `enabled` flag and no sentinel row, so clearing a slot is a `DELETE`
 * and there is no second piece of state that can disagree with the bytes.
 *
 * ## Why this is not `electron/shared/branding.ts` re-exported
 *
 * ADR-012 stores the *workspace's* own mark and wordmark, and bounds itself to
 * "two rows at most, ever" — an argument made entirely from read timing at app
 * start. Per-company images break that argument's premise: sixty companies
 * with two slots each is 120 blobs, and the companies grid wants all of them
 * at once. ADR-015 answers that with a stored derivative (below) which is the
 * only thing a list ever reads, and with its own caps — deliberately separate
 * numbers, because tying them would mean raising one to raise the other.
 */

/**
 * The two slots, in the order a company detail page paints them. Closed by
 * construction: `companyImageSlotSchema` is derived from this tuple, so a slot
 * name that is not one of these fails at the wire as well as at `tsc`.
 */
export const COMPANY_IMAGE_SLOTS = ['logo', 'banner'] as const
export type CompanyImageSlot = (typeof COMPANY_IMAGE_SLOTS)[number]

export const companyImageSlotSchema = z.enum(COMPANY_IMAGE_SLOTS)

/**
 * PNG and JPEG, and nothing else — narrower than `BRANDING_CONTENT_TYPES`'
 * raster set, for a reason that did not exist there (ADR-015 §5).
 *
 * A company image gets a downscaled derivative generated at write time, a
 * derivative needs a decoder, and the decoder this app has without a new
 * dependency is Electron's `nativeImage`, whose `createFromBuffer` decodes PNG
 * and JPEG and nothing else — measured as well as read: a valid GIF and a
 * valid BMP each come back `isEmpty()`. Accepting WEBP, GIF, BMP or ICO would
 * mean either a second decoder or a slot with no derivative, and a slot with
 * no derivative is the naive whole-originals list read arriving one format at
 * a time.
 *
 * SVG is absent for `electron/shared/branding.ts`'s reason, which is
 * *stronger* here: SVG is a scriptable document, and a banner renders across
 * the whole companies grid — sixty of them, from sixty sources, on one screen.
 *
 * Declared as a **subset of the sniffer's own union** rather than as fresh
 * literals: `sniffImageContentType` returns `FaviconContentType`, and
 * `satisfies` makes this fail to compile the day it stops being able to return
 * one of these two. Re-listing the strings is the mistake that compiles.
 */
export const COMPANY_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg'
] as const satisfies readonly FaviconContentType[]
export type CompanyImageContentType = (typeof COMPANY_IMAGE_CONTENT_TYPES)[number]

export const companyImageContentTypeSchema = z.enum(COMPANY_IMAGE_CONTENT_TYPES)

/**
 * The byte cap per slot, keyed by slot so the picker's stat-before-read bound,
 * the repository's post-read check and any UI that quotes a limit read the
 * same number (ADR-015 §4).
 *
 * - `logo` — 512 KB, ADR-012's figure for the same kind of image (a mark), and
 *   revisable for the same reason.
 * - `banner` — 1 MB. The detail header renders it across the full page width;
 *   a 2400 px-wide JPEG at quality 85 measures ~430 KB, so 1 MB is a generous
 *   export and anything larger is an unoptimised one.
 *
 * These caps are **not** arguing about list timing — the derivative below took
 * that argument away from them. They bound the detail page's single read of
 * the originals, the decode below, and how far the database can grow.
 */
export const COMPANY_IMAGE_MAX_BYTES = {
  logo: 512 * 1024,
  banner: 1024 * 1024
} as const satisfies Record<CompanyImageSlot, number>

/**
 * The pixel-count ceiling, checked from the container's own header **before
 * anything is decoded** (ADR-015 §5).
 *
 * A byte cap does not bound a decode: a 1 MB PNG can legitimately describe a
 * 256-megapixel image, and `createFromBuffer` allocates the whole bitmap. 16.8
 * million pixels — 4096 × 4096 equivalent — bounds the transient decode at
 * 64 MB of RGBA. A 6000 × 1500 banner is 9 MP and passes; this is a guard
 * against decompression bombs, not against photographs.
 */
export const COMPANY_IMAGE_MAX_PIXELS = 16_777_216

/** The box a slot's derivative fits inside, and the format it is encoded as. */
export interface CompanyImageThumbnailSpec {
  /** The derivative fits *inside* this box, aspect preserved, never upscaled. */
  readonly boxWidth: number
  readonly boxHeight: number
  /** Asserted rather than sniffed: every write goes through the same encode step, so this is a function of the slot and nothing else. */
  readonly contentType: CompanyImageContentType
  /** JPEG quality, present only for the slot encoded as JPEG. */
  readonly quality?: number
}

/**
 * The derivative each slot gets, generated once in main at write time and read
 * by the companies grid instead of the original — the decision ADR-015 exists
 * for.
 *
 * | Slot | Fits inside | Encoded as | Why |
 * |---|---|---|---|
 * | `logo` | 96 × 96 | PNG | alpha preserved — a mark sits on a surface |
 * | `banner` | 480 × 270 | JPEG q75 | opaque — a wash under a gradient |
 *
 * Fit means `scale = min(1, boxWidth / width, boxHeight / height)`, target
 * `round(width × scale) × round(height × scale)` (never below 1 px). **Never
 * upscaled**: a 64 px logo stays 64 px, and a 3:1 banner becomes 480 × 160.
 *
 * Measured (ADR-015 §3): a 60-company grid with every slot filled transfers
 * about 1.5 MB of base64 in one message and cannot exceed 9.0 MB even if every
 * image is pure noise — against the 83.9 MB reading the originals would cost.
 */
export const COMPANY_IMAGE_THUMBNAILS = {
  logo: { boxWidth: 96, boxHeight: 96, contentType: 'image/png' },
  banner: { boxWidth: 480, boxHeight: 270, contentType: 'image/jpeg', quality: 75 }
} as const satisfies Record<CompanyImageSlot, CompanyImageThumbnailSpec>
