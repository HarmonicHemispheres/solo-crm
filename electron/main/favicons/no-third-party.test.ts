import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetchFavicon } from './fetch'
import { icoBytes, pngBytes, recordingFetch } from './test-support/recording-fetch'

/**
 * AGENTS.md, under things that are *silently wrong rather than loudly
 * broken*:
 *
 * > **Never call a third-party favicon service.** It leaks every client URL
 * > and breaks offline. Main fetches once and caches in the `favicons` table.
 *
 * `https://www.google.com/s2/favicons?domain=…` is one line, works
 * immediately, and quietly ships every client domain this consultancy works
 * with to a third party. T-260828-49's Acceptance is explicit that a
 * reviewer's eye is not the guard here — "asserted by a test over the source
 * *and* over the actual request target, not by reading the diff", because "we
 * checked the diff" is exactly how this comes back later.
 *
 * So this file asserts both halves:
 *
 * 1. **Source.** No file under `electron/` mentions any known favicon
 *    service host, so the one-line version cannot be added anywhere in the
 *    app — including in a view, an integration, or a helper that has nothing
 *    to do with this directory.
 * 2. **Behaviour.** The real fetcher, driven against a recording `fetch`,
 *    only ever asks for URLs whose host is the link's own host or a host the
 *    link's own host redirected it to. A service call would show up as a
 *    recorded URL on somebody else's domain.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ELECTRON_ROOT = resolve(HERE, '..', '..')
const THIS_FILE = resolve(HERE, 'no-third-party.test.ts')

/**
 * Every third-party favicon service this codebase must never call. Substring
 * matches, case-insensitively, because the failure this guards against is
 * somebody pasting one of these URLs in — not somebody assembling one from
 * fragments.
 */
const FORBIDDEN_SERVICE_MARKERS = [
  's2/favicons',
  'faviconV2',
  'icons.duckduckgo.com',
  'favicons.githubusercontent.com',
  'besticon',
  'icon.horse',
  'favicongrabber.com',
  'faviconkit.com',
  'statvoo.com',
  'allesedv.com',
  'logo.clearbit.com',
  'unavatar.io',
  'google.com/s2'
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.(ts|tsx|css|html)$/.test(entry)) out.push(full)
  }
  return out
}

describe('the source: no third-party favicon service appears anywhere under electron/', () => {
  const files = sourceFiles(ELECTRON_ROOT).filter((file) => file !== THIS_FILE)

  it('finds files to check at all — an empty scan would pass vacuously', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(FORBIDDEN_SERVICE_MARKERS)('no file mentions %s', (marker) => {
    const offenders = files
      .filter((file) => readFileSync(file, 'utf-8').toLowerCase().includes(marker.toLowerCase()))
      .map((file) => relative(ELECTRON_ROOT, file).split(sep).join('/'))
    expect(offenders).toEqual([])
  })
})

/**
 * The renderer half of "the renderer issues no fetch" (this task's
 * Acceptance). Its companion — that the renderer's only route to a favicon is
 * `window.crm`, and that what comes back is a definite answer — is asserted
 * from the renderer side in
 * `electron/renderer/lib/favicon-boundary.test.ts`. The *scan* has to live
 * over here rather than beside it: ESLint's `no-renderer-node-access` forbids
 * a renderer module importing `node:fs`, which is the rule working, not a
 * rule to carve an exception out of.
 */
describe('the renderer makes no network request of its own', () => {
  const RENDERER_ROOT = join(ELECTRON_ROOT, 'renderer')
  const rendererFiles = sourceFiles(RENDERER_ROOT).filter((file) => /\.(ts|tsx)$/.test(file))

  /**
   * Every way a renderer module could put a request on the network itself.
   * A remote `<img src>` is deliberately not on the list: the CSP is
   * `img-src 'self' data:` (`electron/main/security.ts`), so the page refuses
   * a remote image URL outright, and the `data:` URL `favicons:get` hands
   * back reaches no network at all.
   */
  const NETWORK_CALL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
    ['fetch(', /(?<![.\w])fetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['navigator.sendBeacon', /sendBeacon\s*\(/],
    ['EventSource', /new\s+EventSource/],
    ['WebSocket', /new\s+WebSocket/],
    ['import() of a URL', /import\s*\(\s*['"]https?:/]
  ]

  it('finds renderer sources to check — an empty scan would pass vacuously', () => {
    expect(rendererFiles.length).toBeGreaterThan(20)
  })

  it.each(NETWORK_CALL_PATTERNS)('no renderer module uses %s', (_label, pattern) => {
    const offenders = rendererFiles
      .filter((file) => pattern.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(ELECTRON_ROOT, file).split(sep).join('/'))
    expect(offenders).toEqual([])
  })
})

describe('the behaviour: every request goes to the link`s own host', () => {
  const LINKS = [
    'https://www.notion.so/team/roadmap',
    'https://github.com/magicpill/solo-crm/pull/1',
    'https://acme-consulting.example.org/proposals/2026.pdf'
  ]

  it.each(LINKS)('fetching %s contacts that host and no other', async (link) => {
    const origin = new URL(link)
    const recorder = recordingFetch({ [`${origin.origin}/favicon.ico`]: { body: icoBytes() } })

    await fetchFavicon(new URL(origin.origin + '/'), { fetch: recorder.fetch })

    expect(recorder.calls.length).toBeGreaterThan(0)
    for (const call of recorder.calls) {
      expect(new URL(call).hostname).toBe(origin.hostname)
    }
  })

  it('the HTML fallback path stays on the link`s host chain too', async () => {
    const recorder = recordingFetch({
      'https://example.com/favicon.ico': { status: 404 },
      'https://example.com/': { body: '<link rel="icon" href="https://cdn.example.com/brand.png">' },
      'https://cdn.example.com/brand.png': { body: pngBytes() }
    })

    await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })

    // `cdn.example.com` is reached only because `example.com` named it in its
    // own markup. Every host contacted is one the link's host chose.
    expect(recorder.calls).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://cdn.example.com/brand.png'
    ])
  })

  it('a host that has no icon produces no request to anybody else — a miss is a miss, never a service lookup', async () => {
    const recorder = recordingFetch({})
    const outcome = await fetchFavicon(new URL('https://barren.example.com/'), { fetch: recorder.fetch })

    expect(outcome.ok).toBe(false)
    for (const call of recorder.calls) {
      expect(new URL(call).hostname).toBe('barren.example.com')
    }
  })
})
