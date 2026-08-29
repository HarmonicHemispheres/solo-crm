import type { FaviconContentType } from '../../shared/favicons'

/**
 * Content-type detection from the bytes' own magic numbers.
 *
 * The `Content-Type` header is *not* used, anywhere, ever. The host is
 * arbitrary and user-supplied (whatever URL was pasted into a link), the bytes
 * end up in a `data:` URL the renderer displays, and a header is a claim the
 * sender makes about itself. `text/html` served as `image/png`, or an SVG
 * served as `image/x-icon`, would both sail through a header check and neither
 * survives this one.
 *
 * The consequence is deliberate and stated in `electron/shared/favicons.ts`:
 * a format not on `FAVICON_CONTENT_TYPES` — SVG very much included — returns
 * `null` here, is never stored, and the link renders its per-kind fallback.
 * Nothing is converted or re-encoded (this task's Scope: "no resizing, no
 * format conversion"); sniffing only decides whether to keep the bytes as
 * they arrived.
 */

/** Longest signature below is WebP's `RIFF????WEBP` at 12 bytes — nothing shorter than this can be identified. */
const MIN_SNIFFABLE_BYTES = 12

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

const ICO = [0x00, 0x00, 0x01, 0x00] as const
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const GIF = [0x47, 0x49, 0x46, 0x38] as const
const JPEG = [0xff, 0xd8, 0xff] as const
const BMP = [0x42, 0x4d] as const
const RIFF = [0x52, 0x49, 0x46, 0x46] as const
const WEBP = [0x57, 0x45, 0x42, 0x50] as const

/**
 * The image type these bytes actually are, or `null` for anything not on
 * `FAVICON_CONTENT_TYPES`.
 *
 * ICO is checked first and by its full four-byte header (`00 00 01 00` —
 * reserved, then type 1) rather than a two-byte prefix: `00 00` alone is not
 * distinctive, and a truncated response of two zero bytes would otherwise be
 * stored as a valid icon and render as a broken image forever.
 */
export function sniffImageContentType(bytes: Uint8Array): FaviconContentType | null {
  if (bytes.length < MIN_SNIFFABLE_BYTES) return null
  if (startsWith(bytes, ICO)) return 'image/x-icon'
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, GIF)) return 'image/gif'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  // RIFF containers hold more than WebP (WAV, AVI); bytes 8-11 name the form.
  if (startsWith(bytes, RIFF) && WEBP.every((byte, index) => bytes[8 + index] === byte)) return 'image/webp'
  if (startsWith(bytes, BMP)) return 'image/bmp'
  return null
}
