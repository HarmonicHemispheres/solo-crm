/**
 * The favicon cache (T-260828-49, plan item P1-19) — one entry point for the
 * IPC layer, so `registry.ts` imports a behaviour and not a file layout.
 *
 * Read `fetch.ts`'s header before changing anything here: it carries the
 * AGENTS.md constraint this whole directory exists to honour ("Never call a
 * third-party favicon service"), the SSRF decision, and the three bounds on
 * the app's only outbound request to an arbitrary host.
 */
export { awaitPendingFavicons, FAVICON_RETRY_AFTER_MS, getFavicon, resetPendingFavicons } from './service'
export { FAVICON_MAX_BYTES, FAVICON_MAX_REDIRECTS, FAVICON_TIMEOUT_MS, faviconOriginFor, isFetchableHost } from './fetch'
export { sniffImageContentType } from './sniff'
