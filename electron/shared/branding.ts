import { z } from 'zod'
import { FAVICON_CONTENT_TYPES } from './favicons'
import { timestampSchema } from './types'

/**
 * The operator's own icon and wordmark (T-260829-04) — the shared vocabulary
 * both sides of the IPC boundary name, as PURE zod plus string constants with
 * no Node imports, the same discipline every `electron/shared/**` module
 * follows (see `electron/shared/links.ts`'s header for why: this file is
 * typechecked under both `tsconfig.node.json` and `tsconfig.web.json`).
 *
 * ## Two slots, and absence is the default
 *
 * The rail's brand block has exactly two images in it: a small square mark and
 * a wordmark beside it. So there are two slots and there will never be a
 * third without a migration and a decision, which is why `BRANDING_SLOTS` is a
 * closed `as const` tuple rather than an open string.
 *
 * A slot with no row means "use the built-in default". The absence *is* the
 * default — there is no `useDefault: true` column, no `enabled` flag, and so
 * no second piece of state that can disagree with the first. Clearing a slot
 * is a `DELETE`, not a write of a sentinel.
 *
 * ## Raster only — SVG is refused
 *
 * `electron/shared/favicons.ts:40-52` argues this for bytes fetched from an
 * arbitrary host: SVG is a scriptable document format, and admitting an
 * arbitrary document into a `data:` URL the app then renders is a strictly
 * larger surface than admitting its pixels.
 *
 * Here the argument is *stronger*, not weaker, even though the bytes come
 * from the operator's own disk rather than the network. A favicon renders in
 * a link row; the brand block renders in the app's own chrome, inside the
 * app's own origin, on every view. The operator picking the file is not a
 * guarantee about the file — a logo arrives by email from a designer, or out
 * of a brand kit downloaded from a vendor — and "the user chose it" has never
 * been a sound reason to widen what a renderer will parse.
 *
 * The accepted set is therefore exactly the raster set already declared for
 * favicons, and it is decided by magic number in
 * `electron/main/favicons/sniff.ts` — never by file extension, never by
 * anything the renderer says the file is.
 */

/**
 * The two slots, in the order the rail renders them. Closed by construction:
 * `brandingSlotSchema` below is derived from this tuple, so a slot name that
 * is not one of these fails at the wire as well as at `tsc`.
 */
export const BRANDING_SLOTS = ['icon', 'logo'] as const
export type BrandingSlot = (typeof BRANDING_SLOTS)[number]

export const brandingSlotSchema = z.enum(BRANDING_SLOTS)

/**
 * The image formats an operator-supplied brand image may be — the same raster
 * set as `FAVICON_CONTENT_TYPES`, aliased rather than re-listed so the two
 * cannot drift into disagreeing about what `sniffImageContentType` can
 * return. That function's return type *is* `FaviconContentType`; a second
 * literal union here would be a copy that compiles until someone adds a
 * format to one of them.
 *
 * SVG is absent on purpose — see this file's header.
 */
export const BRANDING_CONTENT_TYPES = FAVICON_CONTENT_TYPES
export type BrandingContentType = (typeof BRANDING_CONTENT_TYPES)[number]

/**
 * 512 KB per slot, and the cap exists for a reason that is about *when* these
 * bytes are read rather than about disk: both slots are read on every app
 * start to paint the rail, and they are base64-inflated (a third larger) on
 * the way across IPC. Two slots at this cap is roughly 1.4 MB of string
 * arriving before the first view renders — noticeable, bounded, and
 * recoverable. Ten times that would be a slow start nobody would attribute to
 * their logo.
 *
 * The number is a compromise and is revisable (ADR-012): a 512 KB PNG is a
 * generously large wordmark, and anything larger is almost always an
 * unoptimised export rather than a real requirement. It is declared here, once,
 * so the repository that enforces it and any future UI that warns before a pick
 * quote the same figure.
 */
export const BRANDING_MAX_BYTES = 512 * 1024

/**
 * One slot's state, as a discriminated union in which both branches are
 * immediate — the same shape and the same reason as `faviconResultSchema`:
 * `absent` is an *answer* the rail renders its built-in default against right
 * now, never a pending read.
 *
 * `dataUrl` rather than raw bytes, for the reason
 * `electron/shared/favicons.ts` gives: the renderer's CSP is
 * `img-src 'self' data:` (`electron/main/security.ts`) with no `blob:`, so a
 * `URL.createObjectURL` round trip would be refused by the very page that has
 * to display it.
 */
export const brandingSlotStateSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('present'),
      slot: brandingSlotSchema,
      contentType: z.enum(BRANDING_CONTENT_TYPES),
      /** `data:<contentType>;base64,<bytes>` — directly usable as an `<img src>` under the renderer's CSP. */
      dataUrl: z.string().min(1),
      /** The stored blob's length in bytes, before base64. Never recomputed from `dataUrl`. */
      byteLength: z.number().int().positive().max(BRANDING_MAX_BYTES),
      updatedAt: timestampSchema
    })
    .strict(),
  z
    .object({
      state: z.literal('absent'),
      slot: brandingSlotSchema
    })
    .strict()
])
export type BrandingSlotState = z.infer<typeof brandingSlotStateSchema>

/**
 * Both slots together — what the shell asks for once on load, rather than two
 * reads it would have to sequence. Keyed by slot so a caller indexes rather
 * than searching an array, and total by construction: a slot added to
 * `BRANDING_SLOTS` without a branch here fails `tsc`.
 */
const brandingSnapshotShape = {
  icon: brandingSlotStateSchema,
  logo: brandingSlotStateSchema
} satisfies Record<BrandingSlot, typeof brandingSlotStateSchema>

export const brandingSnapshotSchema = z.object(brandingSnapshotShape).strict()
export type BrandingSnapshot = z.infer<typeof brandingSnapshotSchema>
