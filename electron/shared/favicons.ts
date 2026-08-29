import { z } from 'zod'
import type { LinkKind } from './links'
import { timestampSchema } from './types'

/**
 * The favicon read's wire contract (T-260828-49, plan item P1-19) and the
 * per-kind fallback icon set, as PURE zod plus string constants with no Node
 * imports — the same discipline every `electron/shared/**` module follows
 * (see `electron/shared/links.ts`'s header for why: this file is typechecked
 * under both `tsconfig.node.json` and `tsconfig.web.json`).
 *
 * ## Absence is an answer, never a wait
 *
 * The single shape decision this whole module is built around. A company page
 * with a dozen links asks for a dozen favicons the instant it opens; if the
 * read channel answered by *starting* a fetch and resolving when the network
 * did, opening that page offline would be twelve five-second timeouts and
 * twelve rows that reflow when each one finally lands (T-260828-49's Risks:
 * "Fetching on render").
 *
 * So `faviconResultSchema` below is a discriminated union in which **both
 * branches are immediate**. `state: 'ready'` carries a cached icon;
 * `state: 'none'` carries a *reason* the row can render against right now —
 * the per-kind fallback below — and nothing about it is pending. Main may
 * decide to go and fetch in the background after answering, but that is main's
 * business and the renderer never waits on it. T-260828-50 renders a row from
 * whichever branch it gets, once, with no layout shift either way.
 *
 * ## A data URL, not bytes
 *
 * `ready` carries a `data:` URL rather than the raw blob. Two reasons, both
 * about the sink rather than the wire: the renderer's CSP is
 * `img-src 'self' data:` (`electron/main/security.ts`) — no `blob:` — so a
 * `URL.createObjectURL` round trip would be refused by the page that has to
 * display it; and the bytes came from an arbitrary user-supplied host, so the
 * fewer places they exist as bytes the better. Main sniffs the format, refuses
 * anything it does not recognise, and hands over a string the `<img>` can use.
 */

/**
 * The image formats a cached favicon may be. Deliberately raster-only:
 * SVG is a scriptable document format, and while `<img>` does not run script
 * in an SVG it loads, admitting an arbitrary host's markup into a `data:` URL
 * this app then renders is a strictly larger surface than admitting its
 * pixels. A host that serves only an SVG icon falls back to its kind icon
 * below — the same outcome as a host with no icon at all, which is a
 * cosmetic loss and not a broken row.
 *
 * These are the types `electron/main/favicons/sniff.ts` derives from the
 * bytes' own magic numbers. The `Content-Type` header an arbitrary host sends
 * is never trusted for this and never stored.
 */
export const FAVICON_CONTENT_TYPES = ['image/x-icon', 'image/png', 'image/gif', 'image/jpeg', 'image/webp', 'image/bmp'] as const
export type FaviconContentType = (typeof FAVICON_CONTENT_TYPES)[number]

/**
 * Why there is no icon — always one of these four, never an absent field and
 * never a pending promise.
 *
 * - `never-fetched` — nothing has been tried for this host yet. Main has
 *   scheduled one; asking again later may well get `ready`.
 * - `fetching` — a fetch for this host is in flight *right now*, started by
 *   an earlier read. Distinguished from `never-fetched` purely so a caller
 *   can tell "come back" from "come back, something is happening".
 * - `unavailable` — a fetch was tried and failed (or returned something that
 *   was not a recognised image). `retryAfter` says when a fresh attempt
 *   becomes allowed; until then, every read answers `unavailable` from the
 *   cache without touching the network. A dead host costs one request a day,
 *   not one per render (this task's Acceptance).
 * - `unsupported-url` — the link's URL is not something this app will ever
 *   fetch: a scheme outside `http:`/`https:`, an unparseable URL, or a host
 *   in the non-public space `isFetchableHost` refuses. Terminal — no retry
 *   is scheduled and `retryAfter` is null, because nothing about waiting
 *   would change the answer.
 */
export const FAVICON_ABSENCE_REASONS = ['never-fetched', 'fetching', 'unavailable', 'unsupported-url'] as const
export type FaviconAbsenceReason = (typeof FAVICON_ABSENCE_REASONS)[number]

/** `favicons:get`'s request: the link's own URL. Main derives the host and applies the scheme allowlist — the renderer parses nothing and decides nothing. */
export const faviconRequestSchema = z
  .object({
    /**
     * Bounded so a pathological string cannot be handed to the URL parser
     * on the main thread. 2048 is the conventional practical URL ceiling;
     * `links.url` has no such column limit, so a longer URL answers
     * `unsupported-url` rather than being refused at the wire — absence is
     * an answer here too.
     */
    url: z.string().min(1).max(8192)
  })
  .strict()
export type FaviconRequest = z.infer<typeof faviconRequestSchema>

/**
 * Both branches resolve immediately — see this file's header. `retryAfter` is
 * present on every `none` (null except for `unavailable`) rather than
 * optional, so a caller destructuring it never has to distinguish "absent"
 * from "not applicable".
 */
export const faviconResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      contentType: z.enum(FAVICON_CONTENT_TYPES),
      /** `data:<contentType>;base64,<bytes>` — directly usable as an `<img src>` under the renderer's `img-src 'self' data:` CSP. */
      dataUrl: z.string().min(1),
      fetchedAt: timestampSchema
    })
    .strict(),
  z
    .object({
      state: z.literal('none'),
      reason: z.enum(FAVICON_ABSENCE_REASONS),
      /** The instant a fresh attempt becomes allowed. Non-null only for `unavailable`. */
      retryAfter: timestampSchema.nullable()
    })
    .strict()
])
export type FaviconResult = z.infer<typeof faviconResultSchema>

/**
 * The per-kind fallback set (this task's Scope: "with the network off, links
 * still render"). Inline SVG markup rather than files on disk, for the same
 * reason the icons are per-*kind* rather than per-host: they must be present
 * with no network, no cache and no filesystem read, and a string compiled
 * into the bundle is the only form that is unconditionally all three.
 *
 * Every path is stroked in `currentColor` on a 24-unit grid, so a row inherits
 * its own text colour and these need no palette of their own in either theme.
 * The shapes are deliberately generic marks, not vendor logos: shipping
 * Notion's, GitHub's or Stripe's actual trademark in the bundle is a licensing
 * question this task has no reason to open, and the mark only has to say
 * "this is a document / a repository / a payment" while the real favicon is
 * absent.
 *
 * Keyed by `LinkKind` (`electron/shared/links.ts`) so it is exhaustive by
 * construction — a kind added there without an icon here fails `tsc`.
 */
export const FAVICON_FALLBACK_ICONS: Record<LinkKind, string> = {
  // A folder — Drive.
  drive:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  // A page with ruled lines — Notion.
  notion:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h9l5 5v13H5Z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 16h4.5"/></svg>',
  // A branch — GitHub.
  github:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="5.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/><circle cx="17" cy="8.5" r="2.5"/><path d="M7 8v8"/><path d="M17 11v1.5a3.5 3.5 0 0 1-3.5 3.5H10"/></svg>',
  // Overlapping frames — Figma.
  figma:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/></svg>',
  // A card — Stripe.
  stripe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 14.5h4"/></svg>',
  // A page with a folded corner — a PDF.
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5"/><path d="M9.5 17v-4.5h1.5a1.25 1.25 0 0 1 0 2.5H9.5"/></svg>',
  // A speech bubble — Slack.
  slack:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-4.3A7.5 7.5 0 1 1 20.5 12.5Z"/></svg>',
  // A globe — anything else.
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/></svg>'
}
