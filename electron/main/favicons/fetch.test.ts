import { describe, expect, it } from 'vitest'
import {
  declaredIconUrls,
  FAVICON_MAX_BYTES,
  faviconOriginFor,
  fetchFavicon,
  isFetchableHost
} from './fetch'
import { icoBytes, pngBytes, recordingFetch } from './test-support/recording-fetch'

/**
 * The fetcher, driven end to end against a recording `fetch` (see
 * `test-support/recording-fetch.ts`) rather than a mock of itself — the
 * redirect walk, the size cap and the timeout are the behaviour under test,
 * so stubbing them out would leave nothing.
 */

describe('isFetchableHost: which hosts this app will ever contact', () => {
  it('accepts an ordinary public, DNS-named host', () => {
    for (const host of ['example.com', 'www.notion.so', 'sub.domain.example.co.uk']) {
      expect(isFetchableHost(host)).toBe(true)
    }
  })

  it('refuses loopback and intranet names', () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'intranet', '']) {
      expect(isFetchableHost(host)).toBe(false)
    }
  })

  it('refuses every IPv4 literal, private and public alike — the whole class, not an enumeration of ranges', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '172.16.4.4', '192.168.1.1', '169.254.169.254', '8.8.8.8']) {
      expect(isFetchableHost(host)).toBe(false)
    }
  })

  it('refuses IPv6 literals', () => {
    for (const host of ['::1', 'fd00::1', 'fe80::1', '2001:4860:4860::8888']) {
      expect(isFetchableHost(host)).toBe(false)
    }
  })

  it('refuses the cloud metadata endpoint however it is spelled — the URL parser normalises every integer form to dotted-quad first', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://2852039166/latest/meta-data/',
      'http://0xa9fea9fe/latest/meta-data/'
    ]) {
      expect(faviconOriginFor(url)).toBeNull()
    }
  })
})

describe('faviconOriginFor: only http(s), only a fetchable host', () => {
  it('reduces a deep link to its origin', () => {
    expect(faviconOriginFor('https://www.notion.so/team/page?x=1#frag')?.href).toBe('https://www.notion.so/')
  })

  it('keeps a non-default port, which is part of the origin', () => {
    expect(faviconOriginFor('https://example.com:8443/x')?.href).toBe('https://example.com:8443/')
  })

  it('refuses a file: or javascript: URL', () => {
    expect(faviconOriginFor('file:///C:/Users/robby/secret.txt')).toBeNull()
    expect(faviconOriginFor('javascript:alert(1)')).toBeNull()
    expect(faviconOriginFor('data:text/html,<script>1</script>')).toBeNull()
  })

  it('refuses a string that is not a URL at all', () => {
    expect(faviconOriginFor('not a url')).toBeNull()
    expect(faviconOriginFor('')).toBeNull()
  })
})

describe('fetchFavicon: the request goes to the link`s own host and nowhere else', () => {
  it('takes /favicon.ico in one request when the host serves one', async () => {
    const recorder = recordingFetch({ 'https://example.com/favicon.ico': { body: icoBytes() } })
    const outcome = await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.contentType).toBe('image/x-icon')
    expect(recorder.calls).toEqual(['https://example.com/favicon.ico'])
  })

  it('falls back to the <link rel="icon"> the page declares', async () => {
    const recorder = recordingFetch({
      'https://example.com/favicon.ico': { status: 404 },
      'https://example.com/': {
        body: '<!doctype html><html><head><link rel="shortcut icon" href="/assets/brand.png"></head></html>'
      },
      'https://example.com/assets/brand.png': { body: pngBytes() }
    })
    const outcome = await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.contentType).toBe('image/png')
    expect(recorder.calls).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/',
      'https://example.com/assets/brand.png'
    ])
  })

  it('fails rather than storing a body that is not a recognised image', async () => {
    const recorder = recordingFetch({
      'https://example.com/favicon.ico': { body: '<!doctype html><html>nope</html>' },
      'https://example.com/': { body: '<html><head></head></html>' }
    })
    const outcome = await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })
    expect(outcome).toEqual({ ok: false, reason: 'not-an-image' })
  })

  it('reports a network error rather than throwing — an offline machine is a result, not a crash', async () => {
    const recorder = recordingFetch({
      'https://example.com/favicon.ico': { networkError: true },
      'https://example.com/': { networkError: true }
    })
    await expect(fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })).resolves.toEqual({
      ok: false,
      reason: 'network-error'
    })
  })
})

describe('the three bounds', () => {
  it('a host that never responds is ended by the timeout', async () => {
    const recorder = recordingFetch({
      'https://slow.example.com/favicon.ico': { hang: true },
      'https://slow.example.com/': { hang: true }
    })
    const started = Date.now()
    const outcome = await fetchFavicon(new URL('https://slow.example.com/'), { fetch: recorder.fetch, timeoutMs: 40 })

    expect(outcome).toEqual({ ok: false, reason: 'timeout' })
    // Both attempts time out, so the whole call is bounded by roughly two
    // budgets — the point being that it is bounded at all, in tens of
    // milliseconds rather than whenever the remote host gives up.
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('a very large body is cut off at the size cap, mid-stream', async () => {
    const chunk = new Uint8Array(1024)
    chunk.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    // 40 KiB of body against a 4 KiB cap — and streamed, so the cap has to
    // stop the read rather than measure the result.
    const recorder = recordingFetch({
      'https://huge.example.com/favicon.ico': { chunks: Array.from({ length: 40 }, () => chunk) },
      'https://huge.example.com/': { chunks: Array.from({ length: 40 }, () => chunk) }
    })
    const outcome = await fetchFavicon(new URL('https://huge.example.com/'), { fetch: recorder.fetch, maxBytes: 4096 })
    expect(outcome).toEqual({ ok: false, reason: 'too-large' })
  })

  it('refuses a body whose declared content-length is over the cap without reading it', async () => {
    const recorder = recordingFetch({
      'https://huge.example.com/favicon.ico': {
        headers: { 'content-length': String(FAVICON_MAX_BYTES * 4) },
        body: pngBytes()
      },
      'https://huge.example.com/': { status: 404 }
    })
    const outcome = await fetchFavicon(new URL('https://huge.example.com/'), { fetch: recorder.fetch })
    expect(outcome.ok).toBe(false)
  })

  it('a redirect chain terminates at the limit rather than following indefinitely', async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> }> = {}
    // A loop: every hop redirects to the next, forever.
    for (let i = 0; i < 20; i += 1) {
      routes[`https://loop.example.com/hop${i}`] = {
        status: 302,
        headers: { location: `https://loop.example.com/hop${i + 1}` }
      }
    }
    routes['https://loop.example.com/favicon.ico'] = { status: 302, headers: { location: 'https://loop.example.com/hop0' } }
    routes['https://loop.example.com/'] = { status: 302, headers: { location: 'https://loop.example.com/hop0' } }

    const recorder = recordingFetch(routes)
    const outcome = await fetchFavicon(new URL('https://loop.example.com/'), { fetch: recorder.fetch, maxRedirects: 3 })

    expect(outcome).toEqual({ ok: false, reason: 'too-many-redirects' })
    // Four requests per attempt (the original plus three hops), two attempts —
    // never the twenty the loop offers.
    expect(recorder.calls).toHaveLength(8)
  })

  it('follows a redirect within the limit', async () => {
    const recorder = recordingFetch({
      'https://example.com/favicon.ico': { status: 301, headers: { location: 'https://cdn.example.com/icon.png' } },
      'https://cdn.example.com/icon.png': { body: pngBytes() }
    })
    const outcome = await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.source).toBe('https://cdn.example.com/icon.png')
  })

  it('refuses a redirect that leaves http(s) or lands on a host the allowlist refuses', async () => {
    for (const location of ['file:///C:/Windows/win.ini', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/x']) {
      const recorder = recordingFetch({
        'https://example.com/favicon.ico': { status: 302, headers: { location } },
        'https://example.com/': { status: 302, headers: { location } }
      })
      const outcome = await fetchFavicon(new URL('https://example.com/'), { fetch: recorder.fetch })
      expect(outcome).toEqual({ ok: false, reason: 'unsupported-url' })
      // The refused target was never requested — the chain stopped at the hop
      // that named it.
      expect(recorder.calls).not.toContain(location)
    }
  })
})

describe('declaredIconUrls', () => {
  it('resolves relative and absolute hrefs against the page URL, in document order', () => {
    const html = `
      <link rel="stylesheet" href="/style.css">
      <link rel="icon" href="/a.png">
      <link rel="apple-touch-icon" href="https://cdn.example.com/b.png">
    `
    expect(declaredIconUrls(html, new URL('https://example.com/page')).map((u) => u.href)).toEqual([
      'https://example.com/a.png',
      'https://cdn.example.com/b.png'
    ])
  })

  it('caps how many icons one page can ask for', () => {
    const html = Array.from({ length: 40 }, (_, i) => `<link rel="icon" href="/i${i}.png">`).join('')
    expect(declaredIconUrls(html, new URL('https://example.com/')).length).toBeLessThanOrEqual(2)
  })
})
