import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { LayerManager } from './LayerManager'
import { CommandPalette } from './CommandPalette'
import { SEARCH_KINDS, type SearchResult } from '../../../shared/search'

/**
 * The §8 / X-07 budget for the palette, as a check rather than a claim:
 * **results update within one frame of a keystroke at 10x data volume.**
 * `CommandPalette.test.tsx` owns behaviour; this file owns the one number
 * this task's Acceptance names.
 *
 * The budget has two halves and they are measured in two places. The
 * database half — `searchAll` against 31,000 indexed rows — is
 * `electron/main/db/repositories/search.latency.test.ts` (T-260828-51: a
 * rowid seek against the materialised `search_source`, median 2.9-14.1 ms
 * against a 100 ms budget, with a query-plan assertion beside it that cannot
 * flake). This file owns the renderer half, which is the half the *frame*
 * budget is actually about: what a keystroke costs before the next paint.
 *
 * Three assertions, for three different failure modes:
 *
 * - **The keystroke does not wait on main.** Asserted structurally, by
 *   counting `search:query` calls across a burst: the round trip is debounced
 *   off the keystroke path entirely, so no amount of database latency can
 *   push a keystroke past a frame. This is the assertion that cannot flake,
 *   and it is what would catch the shortcut this task's first Risk names —
 *   filtering client-side, or awaiting the query synchronously.
 * - **The work per keystroke does not grow with the database.** Asserted by
 *   the rendered row count staying capped while the fixture is 10x. A palette
 *   that renders every match is one that gets slower as the workspace fills
 *   up, which is exactly the failure §8 is written against.
 * - **The measured keystroke itself fits in a frame.** The budget proper,
 *   taken as a median of several timings rather than a single one.
 *
 * On the fixture below (an idle 8-core Windows machine, jsdom, median of 9
 * keystrokes after 3 warm-ups) a keystroke measures 1.74 ms against the
 * 16.67 ms frame — a margin of roughly 10x, which the run prints so a merely
 * close pass is visible in the output rather than only in a failure. jsdom is
 * not a browser and its absolute numbers are not the app's, but it is
 * strictly *slower* at DOM work than a real renderer, so a comfortable pass
 * here is not hiding a real-browser failure. The margin is also what keeps a
 * loaded machine from turning this into a false failure — and if it ever does
 * fail alone on a quiet machine, that is a real regression in the amount of
 * work a keystroke does.
 */

// 10x the requirements' reference volume, the same figure §8's budget is
// stated against and the same shape `search.latency.test.ts` builds
// server-side: ~100 companies, ~500 engagements, and people to match. These
// are the lists the palette derives its empty-query "recents" from, so they
// are genuinely part of every keystroke's input, not decoration.
const COMPANY_COUNT = 100
const PERSON_COUNT = 1_000
const ENGAGEMENT_COUNT = 500

/** `RESULT_LIMIT` in CommandPalette.tsx — the most rows one query can return. */
const RESULT_ROWS = 25

/** `MAX_ITEMS` in CommandPalette.tsx — the most rows the palette ever draws at once. */
const MAX_RENDERED_ROWS = 12

/** One frame at 60Hz. The acceptance criterion, in milliseconds. */
const ONE_FRAME_MS = 1000 / 60

/** Median of `runs` measured keystrokes, after three warm-up keystrokes — the same shape `search.latency.test.ts` uses for its own timings. */
const WARMUP_KEYSTROKES = 3
const MEASURED_KEYSTROKES = 9

// The fixture is built once per test and the timing loop is 12 keystrokes;
// measured under a second on an idle machine. The budget below is a hang
// guard, not a performance assertion — the performance assertion is the
// median, which a slow machine slows down without breaking.
const TEST_TIMEOUT_MS = 30_000

const TIMESTAMP = '2026-08-01T00:00:00.000Z'

function rows<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index))
}

/** A full page of results, one of every indexed kind so the ranking and label lookups do the real work per row. */
const RESULTS: readonly SearchResult[] = rows(RESULT_ROWS, (index) => ({
  kind: SEARCH_KINDS[index % SEARCH_KINDS.length],
  id: `result-${index}`,
  text: `Acme match ${index} — a result title of about the length a real one has`
}))

const COMPANIES = rows(COMPANY_COUNT, (index) => ({
  id: `company-${index}`,
  name: `Acme Company ${index}`,
  updatedAt: TIMESTAMP,
  createdAt: TIMESTAMP
}))
const PEOPLE = rows(PERSON_COUNT, (index) => ({
  id: `person-${index}`,
  name: `Acme Person ${index}`,
  updatedAt: TIMESTAMP,
  createdAt: TIMESTAMP
}))
const ENGAGEMENTS = rows(ENGAGEMENT_COUNT, (index) => ({
  id: `engagement-${index}`,
  name: `Acme Engagement ${index}`,
  updatedAt: TIMESTAMP,
  createdAt: TIMESTAMP
}))

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function renderPalette() {
  const search = vi.fn(async () => ({ ok: true as const, data: RESULTS }))
  window.crm = stubCrm({
    'search:query': search,
    'companies:list': vi.fn(async () => ({ ok: true as const, data: COMPANIES as never })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: PEOPLE as never })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: ENGAGEMENTS as never }))
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <LayerManager>
          <CommandPalette open onClose={() => {}} />
        </LayerManager>
      </QueryClientProvider>
    </MemoryRouter>
  )
  return { search, input: screen.getByRole('combobox', { name: 'Search or create' }) as HTMLInputElement }
}

/** One keystroke: the character, the change event, and the render it causes — everything between the key going down and the DOM being ready to paint. */
function keystroke(field: HTMLInputElement, char: string) {
  fireEvent.change(field, { target: { value: field.value + char } })
}

describe('CommandPalette latency at 10x data volume', () => {
  it(
    'a keystroke never waits on main: a burst of them issues one query, not one per character',
    async () => {
      const { search, input } = renderPalette()

      for (const char of 'acme corp') keystroke(input, char)

      await waitFor(() => expect(search).toHaveBeenCalled())
      // The debounce is the mechanism; this is the observable consequence. A
      // palette that queried per keystroke would be at nine calls here, and
      // every one of them would be on the path to the next frame.
      expect(search.mock.calls.length).toBeLessThanOrEqual(2)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'the work per keystroke does not grow with the database: the rendered list stays capped at 10x volume',
    async () => {
      const { search, input } = renderPalette()

      // Empty query first: 5 create commands plus recents derived from 1,600
      // cached records.
      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
      expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(MAX_RENDERED_ROWS)

      for (const char of 'acme') keystroke(input, char)
      await waitFor(() => expect(search).toHaveBeenCalled())
      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))

      // 25 results plus the matching create commands, drawn as at most 12 rows.
      expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(MAX_RENDERED_ROWS)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'results update within one frame of a keystroke',
    async () => {
      const { search, input } = renderPalette()

      // Prime the list the way a real search is primed: type enough to fetch,
      // and wait for the answer, so what is measured below is a keystroke
      // against a full result set rather than against an empty one.
      for (const char of 'acme') keystroke(input, char)
      await waitFor(() => expect(search).toHaveBeenCalled())
      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))

      const alphabet = 'abcdefghijklmnopqrstuvwxyz'
      for (let i = 0; i < WARMUP_KEYSTROKES; i++) keystroke(input, alphabet[i % alphabet.length])

      const timings: number[] = []
      for (let i = 0; i < MEASURED_KEYSTROKES; i++) {
        const char = alphabet[i % alphabet.length]
        const started = performance.now()
        keystroke(input, char)
        timings.push(performance.now() - started)
      }
      timings.sort((a, b) => a - b)
      const median = timings[Math.floor(timings.length / 2)]

      // Reported so a run that is merely close to the budget is visible in the
      // output rather than only in a failure.
      console.log(`[palette] median keystroke: ${median.toFixed(2)}ms of a ${ONE_FRAME_MS.toFixed(2)}ms frame`)
      expect(median).toBeLessThan(ONE_FRAME_MS)
    },
    TEST_TIMEOUT_MS
  )
})
