import { ALLOWED_LINK_URL_SCHEMES, tryParseLinkUrl } from '../../shared/links'
import type { FaviconContentType } from '../../shared/favicons'
import { sniffImageContentType } from './sniff'

/**
 * The app's first and only outbound request to an arbitrary host
 * (T-260828-49). Everything about this file is a bound on what that request
 * can cost or reach.
 *
 * ## The one-line implementation this file exists instead of
 *
 * A search engine's favicon endpoint, handed a `?domain=` query, is one line,
 * works immediately, and ships every domain this consultancy works with to a
 * third party. (Its actual URL is not written out here — `no-third-party.test.ts`
 * scans every file under `electron/` for exactly those service hosts, and a
 * prose mention would be indistinguishable from a call site to a checker whose
 * whole value is that it cannot tell the difference and does not try.)
 * AGENTS.md names it as a standing gotcha, under things that are
 * *silently wrong rather than loudly broken*: "Never call a third-party
 * favicon service. It leaks every client URL and breaks offline. Main fetches
 * once and caches in the `favicons` table." Every request this module makes
 * goes to the host named in the link and nowhere else — asserted in
 * `no-third-party.test.ts` both by scanning the source for a service host and
 * by recording the URL actually handed to `fetch`, because "we checked the
 * diff" is exactly how this comes back later.
 *
 * ## Which hosts are fetched at all — the SSRF decision
 *
 * The host comes from whatever URL the user pasted, so it can name
 * `localhost`, a private range, or a cloud metadata endpoint
 * (`169.254.169.254`). This task's Risks require the decision to be recorded
 * rather than defaulted into, so: **`isFetchableHost` refuses every IP-literal
 * host outright**, along with `localhost`, the `.localhost` and `.local`
 * suffixes, and any single-label (dotless) intranet name. Refusing all IP
 * literals rather than enumerating the private ranges is the narrower rule
 * *and* the simpler one — it closes the whole class, including the metadata
 * endpoints and anything IPv6 escapes an enumeration with — and it costs
 * nothing a real link needs, because a link to a service addressed only by IP
 * has no favicon worth the request anyway. Such a URL answers
 * `unsupported-url`, terminally.
 *
 * What this does **not** do is resolve the host and check where it points, so
 * a public name resolving into a private range is still fetched. That is
 * accepted, explicitly: this is a single-user local-first app, the "attacker"
 * would be the user pasting a URL into their own CRM, and the response never
 * reaches them as anything but pixels that pass `sniffImageContentType`. The
 * exposure is a request the user's own machine could have made anyway; the
 * cost of closing it is a resolve-then-pin fetch stack this app has no other
 * use for.
 *
 * ## The three bounds
 *
 * A timeout, a response size cap, and a redirect limit — all main-side
 * constants, none of them nameable by a caller, for the same reason
 * `db:query`'s row cap is not in its request shape.
 */

/** Per-request wall clock. Long enough for a slow host on a slow connection, short enough that a page of links opening offline is not a visible stall — nothing blocks on this anyway (`service.ts` answers from cache and fetches behind it). */
export const FAVICON_TIMEOUT_MS = 5_000

/** Hard ceiling on any single response body. A favicon that is not comfortably inside this is not a favicon; the cap is what stops an arbitrary host returning a gigabyte at the user's own machine (this task's Risks). */
export const FAVICON_MAX_BYTES = 128 * 1024

/** How far a redirect chain may go before it is abandoned. Three hops covers the ordinary `http -> https -> www -> cdn` shape and terminates a loop. */
export const FAVICON_MAX_REDIRECTS = 3

/** Separate, larger cap for the HTML page read when `/favicon.ico` misses — a home page is legitimately bigger than an icon, and only its `<head>` is wanted. */
export const FAVICON_HTML_MAX_BYTES = 256 * 1024

/** Why a fetch produced no icon. Every one of these is recorded as a failure and retried no sooner than `service.ts`'s retry window. */
export type FaviconFetchFailure =
  | 'unsupported-url'
  | 'network-error'
  | 'timeout'
  | 'http-error'
  | 'too-large'
  | 'too-many-redirects'
  | 'not-an-image'

export type FaviconFetchOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly contentType: FaviconContentType; readonly source: string }
  | { readonly ok: false; readonly reason: FaviconFetchFailure }

/** Injected so tests drive real code with a recorded `fetch` rather than mocking the module under test. Production passes nothing and gets `globalThis.fetch`. */
export interface FaviconFetchDeps {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly maxBytes?: number
}

/**
 * True only for a public, DNS-named `http:`/`https:` host — see this file's
 * header for why every IP literal is refused rather than only the private
 * ranges.
 *
 * `host` is `URL#hostname`, so an IPv6 literal arrives already unbracketed
 * and an IPv4 literal already normalised.
 */
export function isFetchableHost(host: string): boolean {
  // A fully-qualified spelling (`localhost.`) keeps its trailing dot through
  // the URL parser and resolves to the same address; strip it before every
  // rule below so a one-character suffix cannot bypass them (T-260901-21).
  const lower = host.toLowerCase().replace(/\.$/, '')
  if (lower.length === 0) return false
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return false
  // Any IPv6 literal: `URL#hostname` gives these unbracketed, and a colon
  // cannot appear in a DNS name.
  if (lower.includes(':')) return false
  // Any IPv4 literal, dotted-quad. Other integer forms (`0x7f000001`,
  // `2130706433`) are normalised to dotted-quad by the WHATWG URL parser
  // before they reach here, so this one shape covers them all.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) return false
  // A single-label name is an intranet host (`intranet`, `router`), never a
  // registrable public domain.
  if (!lower.includes('.')) return false
  return true
}

/** The origin whose favicon is wanted, or `null` for a URL this app will never fetch — an unparseable string, a non-`http(s)` scheme (`file:`, `javascript:`), or a host `isFetchableHost` refuses. */
export function faviconOriginFor(url: string): URL | null {
  const parsed = tryParseLinkUrl(url)
  if (!parsed) return null
  if (!(ALLOWED_LINK_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) return null
  if (!isFetchableHost(parsed.hostname)) return null
  return new URL(`${parsed.protocol}//${parsed.host}/`)
}

interface BoundedResponse {
  readonly bytes: Uint8Array
  readonly finalUrl: string
}

type BoundedOutcome = { readonly ok: true; readonly value: BoundedResponse } | { readonly ok: false; readonly reason: FaviconFetchFailure }

/**
 * Reads a body with the size cap applied *as it streams*, not after. Checking
 * `content-length` alone would trust a header; reading fully and then
 * measuring would already have paid for the gigabyte. The reader is cancelled
 * the moment the accumulated length crosses the cap.
 */
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null

  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    return buffer.length > maxBytes ? null : buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * One GET, with the redirect chain walked by hand.
 *
 * `redirect: 'manual'` rather than `'follow'` is the whole point: the platform
 * would follow a chain of any length to any target, including one that leaves
 * `http(s)` or lands on `localhost`. Every hop here is re-parsed and
 * re-validated through `faviconOriginFor`'s own rules, so a public host cannot
 * redirect the fetch onto a private one, and the chain terminates at
 * `maxRedirects` rather than at whatever the remote server has patience for.
 */
async function fetchBounded(target: URL, maxBytes: number, deps: FaviconFetchDeps): Promise<BoundedOutcome> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const timeoutMs = deps.timeoutMs ?? FAVICON_TIMEOUT_MS
  const maxRedirects = deps.maxRedirects ?? FAVICON_MAX_REDIRECTS

  let current = target
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController()
    // One deadline per hop, and it covers the body as well as the headers
    // (T-260901-21): `fetch` resolves once the status line and headers are
    // in, and a host that answers 200 and then trickles or stalls the body
    // used to hold `readBounded` open for the life of the process — with
    // `service.ts`'s in-flight entry for that host never clearing, so every
    // later lookup on it answered `fetching` until restart.
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let response: Response
      try {
        response = await doFetch(current.href, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          // No cookies, no credentials, no referrer: this request identifies
          // nothing about the user, and must not tell the remote host which
          // page it was made from.
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: { accept: 'image/*,text/html;q=0.5' }
        })
      } catch {
        // The only signal in play is this loop's own timer, so an aborted
        // controller means the deadline passed; anything else that threw is the
        // network refusing, DNS failing, or TLS not negotiating.
        return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network-error' }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return { ok: false, reason: 'http-error' }
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          return { ok: false, reason: 'http-error' }
        }
        // Same rules as the original target: scheme allowlist plus the
        // public-host rule. A redirect is a new request, not a continuation.
        if (!faviconOriginFor(next.href)) return { ok: false, reason: 'unsupported-url' }
        current = next
        continue
      }

      if (!response.ok) return { ok: false, reason: 'http-error' }

      let bytes: Uint8Array | null
      try {
        bytes = await readBounded(response, maxBytes)
      } catch {
        // The body stream rejects when the signal aborts mid-read; anything
        // else is the connection dropping partway through.
        return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'network-error' }
      }
      if (!bytes) return { ok: false, reason: 'too-large' }
      return { ok: true, value: { bytes, finalUrl: current.href } }
    } finally {
      clearTimeout(timer)
    }
  }

  return { ok: false, reason: 'too-many-redirects' }
}

/**
 * `<link rel="icon" href="...">` from a page's HTML, resolved against the
 * page's own URL.
 *
 * A regex, not a parser: the app carries no HTML parser and has no other
 * reason to, this reads one attribute out of a `<head>`, and the failure mode
 * of getting it wrong is a missed favicon and a fallback icon — not a
 * security boundary. Every candidate is re-validated through
 * `faviconOriginFor` before it is fetched, so a crafted `href` buys the page
 * nothing this module would not have allowed anyway.
 *
 * Candidates are returned in document order and capped, so a page declaring
 * forty icon sizes costs at most `MAX_DECLARED_ICONS` requests rather than
 * forty.
 */
const MAX_DECLARED_ICONS = 2
const LINK_TAG = /<link\b[^>]*>/gi
const REL_ATTR = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i
const HREF_ATTR = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i

function attributeValue(match: RegExpMatchArray | null): string | null {
  if (!match) return null
  return match[2] ?? match[3] ?? match[4] ?? null
}

export function declaredIconUrls(html: string, pageUrl: URL): URL[] {
  const found: URL[] = []
  for (const tag of html.match(LINK_TAG) ?? []) {
    const rel = attributeValue(tag.match(REL_ATTR))
    if (!rel) continue
    // `rel` is a space-separated token list. `icon` and the legacy
    // `shortcut icon` are the standard spellings; `apple-touch-icon`,
    // `mask-icon` and `fluid-icon` are the common vendor ones, and all of
    // them are still just "here is this site's icon". Matched on whole
    // tokens, never as a substring, so a `rel="iconography"` is not one.
    const tokens = rel.toLowerCase().split(/\s+/)
    if (!tokens.some((token) => token === 'icon' || token === 'shortcut' || token.endsWith('-icon'))) continue
    const href = attributeValue(tag.match(HREF_ATTR))
    if (!href) continue
    try {
      found.push(new URL(href, pageUrl))
    } catch {
      continue
    }
    if (found.length >= MAX_DECLARED_ICONS) break
  }
  return found
}

/**
 * Fetch one host's favicon, from that host and nowhere else.
 *
 * `/favicon.ico` is tried first — one request, and the one that succeeds for
 * most hosts — and only if it does not yield a recognised image is the page
 * itself read for a declared `<link rel="icon">`. The reverse order would
 * cost every host an HTML read it usually does not need. Worst case is
 * `1 + 1 + MAX_DECLARED_ICONS` requests for a single host, once, ever
 * (`service.ts` records the outcome either way).
 *
 * `origin` must already have come from `faviconOriginFor`; passing anything
 * else is caught here anyway, since every fetch below re-validates its target.
 */
export async function fetchFavicon(origin: URL, deps: FaviconFetchDeps = {}): Promise<FaviconFetchOutcome> {
  if (!faviconOriginFor(origin.href)) return { ok: false, reason: 'unsupported-url' }
  const maxBytes = deps.maxBytes ?? FAVICON_MAX_BYTES

  const direct = await fetchBounded(new URL('/favicon.ico', origin), maxBytes, deps)
  if (direct.ok) {
    const contentType = sniffImageContentType(direct.value.bytes)
    if (contentType) return { ok: true, bytes: direct.value.bytes, contentType, source: direct.value.finalUrl }
  }

  const page = await fetchBounded(origin, deps.maxBytes ?? FAVICON_HTML_MAX_BYTES, deps)
  if (!page.ok) return { ok: false, reason: direct.ok ? page.reason : direct.reason }

  const html = new TextDecoder('utf-8', { fatal: false }).decode(page.value.bytes)
  const candidates = declaredIconUrls(html, new URL(page.value.finalUrl))
  for (const candidate of candidates) {
    if (!faviconOriginFor(candidate.href)) continue
    const icon = await fetchBounded(candidate, maxBytes, deps)
    if (!icon.ok) continue
    const contentType = sniffImageContentType(icon.value.bytes)
    if (contentType) return { ok: true, bytes: icon.value.bytes, contentType, source: icon.value.finalUrl }
  }

  return { ok: false, reason: 'not-an-image' }
}
