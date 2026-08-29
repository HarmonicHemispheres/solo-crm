import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../db/connection'
import { faviconResultSchema } from '../../shared/favicons'
import { awaitPendingFavicons, FAVICON_RETRY_AFTER_MS, getFavicon, resetPendingFavicons } from './service'
import { readCachedFavicon, recordFaviconFailure } from './store'
import { icoBytes, recordingFetch } from './test-support/recording-fetch'

/**
 * Every test here runs against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — the same discipline
 * `db/repositories/links.test.ts` and its siblings follow — with a recording
 * `fetch` standing in for the network. Nothing in the module under test is
 * mocked: the "one request per host" claim is asserted by *counting the
 * requests*, which is only meaningful if the real fetcher is doing the
 * requesting (this task's Acceptance says exactly that: "not by observing a
 * cache field").
 */

async function withDatabase(fn: (db: Database.Database) => Promise<void> | void): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-favicons-'))
  try {
    openDatabase({ userDataDir: tmpDir })
    await fn(getDatabase())
  } finally {
    await awaitPendingFavicons()
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

afterEach(() => {
  resetPendingFavicons()
  closeDatabase()
})

const ICO_ROUTE = { 'https://example.com/favicon.ico': { body: icoBytes() } }

describe('getFavicon answers immediately — absence is an answer, never a wait', () => {
  it('returns a definite `none` on the very first read, and only then goes looking', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch(ICO_ROUTE)
      const first = getFavicon(db, 'https://example.com/docs/page', { fetch: recorder.fetch })

      // Synchronous by construction: the value is in hand before the fetch
      // that was just started has had a chance to finish.
      expect(first).toEqual({ state: 'none', reason: 'never-fetched', retryAfter: null })
      expect(faviconResultSchema.parse(first)).toEqual(first)

      await awaitPendingFavicons()
      const second = getFavicon(db, 'https://example.com/docs/page', { fetch: recorder.fetch })
      expect(second.state).toBe('ready')
      if (second.state === 'ready') {
        expect(second.contentType).toBe('image/x-icon')
        expect(second.dataUrl.startsWith('data:image/x-icon;base64,')).toBe(true)
        expect(faviconResultSchema.parse(second)).toEqual(second)
      }
    })
  })

  it('stores the bytes exactly as they arrived — no resizing, no re-encoding', async () => {
    await withDatabase(async (db) => {
      const original = icoBytes()
      original.set([0x11, 0x22, 0x33, 0x44], 32)
      const recorder = recordingFetch({ 'https://example.com/favicon.ico': { body: original } })

      getFavicon(db, 'https://example.com/x', { fetch: recorder.fetch })
      await awaitPendingFavicons()

      const cached = readCachedFavicon(db, 'example.com')
      expect(cached?.bytes).not.toBeNull()
      expect(Buffer.from(cached?.bytes ?? new Uint8Array(0)).equals(Buffer.from(original))).toBe(true)

      const ready = getFavicon(db, 'https://example.com/x', { fetch: recorder.fetch })
      expect(ready.state).toBe('ready')
      if (ready.state === 'ready') {
        const encoded = ready.dataUrl.slice(ready.dataUrl.indexOf(',') + 1)
        expect(Buffer.from(encoded, 'base64').equals(Buffer.from(original))).toBe(true)
      }
    })
  })

  it('every branch it can return satisfies the wire schema', async () => {
    await withDatabase((db) => {
      for (const url of ['file:///C:/secret.txt', 'javascript:alert(1)', 'http://localhost/x', 'not a url']) {
        const result = getFavicon(db, url, { fetch: recordingFetch({}).fetch })
        expect(() => faviconResultSchema.parse(result)).not.toThrow()
      }
    })
  })
})

describe('fetched once per host', () => {
  it('a second link to the same host issues no request — counted, not inferred', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch(ICO_ROUTE)

      getFavicon(db, 'https://example.com/one', { fetch: recorder.fetch })
      await awaitPendingFavicons()
      const requestsAfterFirst = recorder.calls.length
      expect(requestsAfterFirst).toBe(1)

      // Three more links to the same host, at three different paths.
      for (const path of ['/two', '/three/deep', '/four?q=1']) {
        const result = getFavicon(db, `https://example.com${path}`, { fetch: recorder.fetch })
        expect(result.state).toBe('ready')
      }
      await awaitPendingFavicons()

      expect(recorder.calls).toHaveLength(requestsAfterFirst)
    })
  })

  it('twelve simultaneous reads of one host collapse into one fetch', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch(ICO_ROUTE)
      const results = Array.from({ length: 12 }, (_, i) => getFavicon(db, `https://example.com/link-${i}`, { fetch: recorder.fetch }))

      // The first read starts the fetch; the other eleven see it in flight.
      expect(results[0]).toEqual({ state: 'none', reason: 'never-fetched', retryAfter: null })
      for (const result of results.slice(1)) {
        expect(result).toEqual({ state: 'none', reason: 'fetching', retryAfter: null })
      }

      await awaitPendingFavicons()
      expect(recorder.calls).toEqual(['https://example.com/favicon.ico'])
    })
  })
})

describe('a failure is recorded, with its instant, and not retried on every render', () => {
  it('records the failure and then answers `unavailable` from the cache without touching the network', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch({})

      getFavicon(db, 'https://nothing-here.example.com/x', { fetch: recorder.fetch })
      await awaitPendingFavicons()
      const requestsAfterFirst = recorder.calls.length
      expect(requestsAfterFirst).toBeGreaterThan(0)

      const cached = readCachedFavicon(db, 'nothing-here.example.com')
      expect(cached).not.toBeNull()
      expect(cached?.bytes).toBeNull()
      expect(cached?.fetchedAt).toBeTruthy()

      for (let render = 0; render < 10; render += 1) {
        const result = getFavicon(db, 'https://nothing-here.example.com/x', { fetch: recorder.fetch })
        expect(result.state).toBe('none')
        if (result.state === 'none') {
          expect(result.reason).toBe('unavailable')
          expect(result.retryAfter).toBeTruthy()
        }
      }
      await awaitPendingFavicons()
      expect(recorder.calls).toHaveLength(requestsAfterFirst)
    })
  })

  it('retries once the recorded window has passed — a failure suppresses, it does not condemn', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch(ICO_ROUTE)

      // A failure recorded well over the retry window ago, written straight
      // through the store so no clock has to be faked.
      const stale = new Date(Date.now() - FAVICON_RETRY_AFTER_MS - 60_000).toISOString()
      recordFaviconFailure(db, 'example.com')
      db.prepare('UPDATE favicons SET fetched_at = ? WHERE host = ?').run(stale, 'example.com')

      const result = getFavicon(db, 'https://example.com/x', { fetch: recorder.fetch })
      expect(result).toEqual({ state: 'none', reason: 'unavailable', retryAfter: null })

      await awaitPendingFavicons()
      expect(recorder.calls).toEqual(['https://example.com/favicon.ico'])
      expect(getFavicon(db, 'https://example.com/x', { fetch: recorder.fetch }).state).toBe('ready')
    })
  })
})

describe('offline: links still render, nothing throws', () => {
  it('answers `none` for every link with the network unavailable, and never rejects', async () => {
    await withDatabase(async (db) => {
      const offline = (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch

      for (const url of ['https://a.example.com/1', 'https://b.example.com/2', 'https://c.example.com/3']) {
        const result = getFavicon(db, url, { fetch: offline })
        expect(result.state).toBe('none')
      }

      // The unawaited background work must settle without an unhandled
      // rejection — the process would otherwise take the main-process crash
      // path for a missing favicon.
      await expect(awaitPendingFavicons()).resolves.toBeUndefined()

      for (const url of ['https://a.example.com/1', 'https://b.example.com/2', 'https://c.example.com/3']) {
        const result = getFavicon(db, url, { fetch: offline })
        expect(result).toMatchObject({ state: 'none', reason: 'unavailable' })
      }
    })
  })
})

describe('a URL this app will never fetch is terminal, not deferred', () => {
  it('answers `unsupported-url` for file:, javascript:, loopback and IP-literal links, and issues no request', async () => {
    await withDatabase(async (db) => {
      const recorder = recordingFetch({})
      for (const url of [
        'file:///C:/Users/robby/secret.txt',
        'javascript:fetch("https://evil.test")',
        'http://localhost:3000/admin',
        'http://127.0.0.1/admin',
        'http://169.254.169.254/latest/meta-data/'
      ]) {
        expect(getFavicon(db, url, { fetch: recorder.fetch })).toEqual({
          state: 'none',
          reason: 'unsupported-url',
          retryAfter: null
        })
      }
      await awaitPendingFavicons()
      expect(recorder.calls).toEqual([])
    })
  })
})
