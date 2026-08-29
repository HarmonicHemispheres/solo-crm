import type Database from 'better-sqlite3'
import type { FaviconAbsenceReason, FaviconResult } from '../../shared/favicons'
import { formatTimestamp, parseTimestamp } from '../../shared/format'
import type { Timestamp } from '../../shared/types'
import { faviconOriginFor, fetchFavicon, type FaviconFetchDeps } from './fetch'
import { readCachedFavicon, recordFaviconFailure, recordFaviconSuccess } from './store'
import { sniffImageContentType } from './sniff'

/**
 * What `favicons:get` actually does (T-260828-49).
 *
 * ## The shape decision: answer now, fetch behind
 *
 * `getFavicon` is **synchronous** and reads only the cache. It never awaits a
 * network call, so a company page with twelve links gets twelve immediate
 * answers whether the machine is online, offline, or behind a captive portal.
 * When the cache has nothing to say and the host has not been tried recently,
 * it *starts* a fetch and returns `{ state: 'none', reason: 'fetching' }` —
 * the fetch's result lands in the table for the next read, and no caller ever
 * holds a promise that resolves when the network does.
 *
 * That is the difference between this and the obvious implementation, and it
 * is what T-260828-50 needs: a row can render its per-kind fallback on first
 * paint and swap in a real icon on a later read, rather than reflowing when
 * each of twelve promises settles at its own moment (this task's Risks:
 * "Fetching on render").
 *
 * ## Fetched once per host
 *
 * `IN_FLIGHT` holds one promise per host for as long as a fetch is running, so
 * twelve links to the same host — or twelve reads of the same link — issue one
 * request between them, not twelve. Once the outcome is recorded, the cache
 * itself is the dedupe: a success is never re-fetched, and a failure is not
 * re-tried until `FAVICON_RETRY_AFTER_MS` has passed.
 */

/**
 * How long a recorded failure suppresses further attempts.
 *
 * Not "never": a host that was down, misconfigured, or simply not yet built
 * when the link was pasted would otherwise never get an icon for the life of
 * the database, and there is no other event that would clear the row. A day is
 * long enough that a dead host costs one request between one working session
 * and the next, and short enough that fixing a site shows up the following day
 * without anyone knowing this cache exists.
 */
export const FAVICON_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

/** One entry per host with a fetch in flight. Module-level, matching the single-process, single-database assumption every repository here already makes. */
const IN_FLIGHT = new Map<string, Promise<void>>()

/** The `none` branch, built in one place so `retryAfter` is never accidentally omitted — the schema requires it present and null, not absent (see `electron/shared/favicons.ts`). */
function absent(reason: FaviconAbsenceReason, retryAfter: Timestamp | null): FaviconResult {
  return { state: 'none', reason, retryAfter }
}

/**
 * The cached icon for a link's URL, or a stated reason there is none — always
 * immediately, never a pending fetch. See this file's header.
 *
 * `deps` exists for tests, which pass a recorded `fetch`; production calls
 * this with the database alone.
 */
export function getFavicon(db: Database.Database, url: string, deps: FaviconFetchDeps = {}): FaviconResult {
  const origin = faviconOriginFor(url)
  // Terminal: a `file:`, `javascript:` or IP-literal URL is never fetched and
  // waiting changes nothing, so there is no retry instant to name.
  if (!origin) return absent('unsupported-url', null)

  const host = origin.hostname
  const cached = readCachedFavicon(db, host)

  if (cached?.bytes) {
    const contentType = sniffImageContentType(cached.bytes)
    if (contentType) {
      return {
        state: 'ready',
        contentType,
        dataUrl: `data:${contentType};base64,${Buffer.from(cached.bytes).toString('base64')}`,
        fetchedAt: cached.fetchedAt
      }
    }
    // Bytes that no longer sniff as an image cannot have been written by
    // `recordFaviconSuccess` (it only ever stores what sniffed clean), so this
    // is a hand-edited or corrupted row. Treat it as a failure whose retry
    // window is measured from its own timestamp rather than serving a
    // `data:` URL of unknown content to the renderer.
  }

  if (cached) {
    const retryAt = parseTimestamp(cached.fetchedAt).getTime() + FAVICON_RETRY_AFTER_MS
    if (Date.now() < retryAt) return absent('unavailable', formatTimestamp(new Date(retryAt)))
  }

  if (IN_FLIGHT.has(host)) return absent('fetching', null)

  startFetch(db, origin, deps)
  return absent(cached ? 'unavailable' : 'never-fetched', null)
}

/**
 * Kicks off the one fetch this host is allowed and records whatever comes
 * back — a success or, for every failure mode `fetchFavicon` distinguishes, a
 * failure row carrying the instant it happened.
 *
 * Nothing here rejects. A rejected promise nobody awaits is an unhandled
 * rejection that would take the main process's warning path in development
 * and tell the user nothing in production; a favicon that did not arrive is
 * not an error condition, it is the `unavailable` branch of an answer the
 * renderer already knows how to draw.
 */
function startFetch(db: Database.Database, origin: URL, deps: FaviconFetchDeps): void {
  const host = origin.hostname
  const running = (async () => {
    try {
      const outcome = await fetchFavicon(origin, deps)
      if (outcome.ok) recordFaviconSuccess(db, host, outcome.bytes)
      else recordFaviconFailure(db, host)
    } catch {
      // A closed database, a disk error — the fetch attempt is over either
      // way, and the next read will simply find no row and try again.
    } finally {
      IN_FLIGHT.delete(host)
    }
  })()
  IN_FLIGHT.set(host, running)
}

/**
 * Awaits every fetch currently in flight.
 *
 * Exported for tests, which need the background work to be *observable*
 * rather than raced against — "issue one request for twelve links" is only
 * assertable if the test can wait for that one request to finish. Loops
 * because a settling fetch cannot start another one, but a test may have
 * called `getFavicon` for several hosts at once.
 */
export async function awaitPendingFavicons(): Promise<void> {
  while (IN_FLIGHT.size > 0) {
    await Promise.all([...IN_FLIGHT.values()])
  }
}

/** Test-only reset of the in-flight map. Never called by production code; the map is otherwise self-clearing. */
export function resetPendingFavicons(): void {
  IN_FLIGHT.clear()
}
