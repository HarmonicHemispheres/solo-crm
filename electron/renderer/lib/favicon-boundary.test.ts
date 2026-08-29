import { describe, expect, it } from 'vitest'
import { CHANNEL_NAMES } from '../../shared/ipc-types'
import { FAVICON_FALLBACK_ICONS, faviconResultSchema } from '../../shared/favicons'
import { LINK_KINDS } from '../../shared/links'
import { stubCrm } from './test-support/stub-crm'

/**
 * T-260828-49's acceptance criterion asserted from **this** side: "The
 * renderer issues no fetch — asserted from the renderer side, since
 * `contextIsolation` and the preload boundary are what make this true."
 *
 * Two halves, in two files, because ESLint's `no-renderer-node-access` rule
 * forbids a renderer module from importing `node:fs` — correctly, and this
 * test is not the exception worth carving out:
 *
 * - **Here**: the renderer's only route to a favicon is `window.crm`, and
 *   what it gets back is a definite answer on the first call rather than
 *   something to wait on. Plus the offline half — a fallback per link kind,
 *   present with no network at all.
 * - **`electron/main/favicons/no-third-party.test.ts`**: the source scan over
 *   `electron/renderer/**` proving no renderer module reaches a network by
 *   any of the half-dozen browser APIs that could. It reads files off disk,
 *   so it runs in the node pool — and it is why the APIs it looks for are not
 *   named here in prose: the scan cannot tell a mention from a call site, and
 *   the value of a checker that does not try is that nobody can talk their
 *   way past it.
 */

describe('the renderer asks main, and main answers', () => {
  it('exposes a favicon channel on the typed bridge', () => {
    expect(CHANNEL_NAMES).toContain('favicons:get')
  })

  it('gets a definite answer on the first call, never a pending one', async () => {
    const crm = stubCrm()
    const result = await crm['favicons:get']({ url: 'https://www.notion.so/team/roadmap' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Parses as one of exactly two branches — `ready` with something an
      // `<img>` can use, or `none` with a stated reason. There is no third,
      // pending state a row would have to reflow around when it settles.
      const parsed = faviconResultSchema.parse(result.data)
      expect(parsed.state === 'ready' || parsed.state === 'none').toBe(true)
      if (parsed.state === 'none') expect(parsed.reason).toBeTruthy()
    }
  })

  it('a `ready` answer is a data: URL, which is what the renderer`s own CSP allows', async () => {
    const crm = stubCrm({
      'favicons:get': async () => ({
        ok: true as const,
        data: {
          state: 'ready' as const,
          contentType: 'image/png' as const,
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          fetchedAt: '2026-08-29T00:00:00.000Z'
        }
      })
    })
    const result = await crm['favicons:get']({ url: 'https://example.com/x' })
    expect(result.ok).toBe(true)
    if (result.ok && result.data.state === 'ready') {
      // `img-src 'self' data:` (electron/main/security.ts) — a blob: or remote
      // URL would be refused by the page that has to display it.
      expect(result.data.dataUrl.startsWith('data:')).toBe(true)
    }
  })
})

describe('the offline case has something to draw', () => {
  it('carries a fallback icon for every link kind', () => {
    for (const kind of LINK_KINDS) {
      const icon = FAVICON_FALLBACK_ICONS[kind]
      expect(icon.startsWith('<svg')).toBe(true)
      expect(icon).toContain('currentColor')
    }
    expect(Object.keys(FAVICON_FALLBACK_ICONS).sort()).toEqual([...LINK_KINDS].sort())
  })

  it('the fallbacks need no network, no cache and no filesystem — they are strings in the bundle', () => {
    for (const icon of Object.values(FAVICON_FALLBACK_ICONS)) {
      expect(icon).not.toMatch(/https?:\/\//)
      expect(icon).not.toContain('<script')
      expect(icon).not.toContain('<image')
    }
  })
})
