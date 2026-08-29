import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { CHANNEL_NAMES } from '../../shared/ipc-types'
import type { ChannelName, ChannelRequest, ChannelResponse } from '../../shared/ipc-types'
import type { ChannelDefinition } from './registry'
import { MIGRATIONS } from '../db/migrations'

// Derived, not hardcoded: a fresh database's schema version is whatever the
// latest registered migration leaves it at. T-260828-36 added migration 0002,
// bumping a freshly migrated database from 1 to 2 — hardcoding either number
// here would silently re-break the moment another migration lands.
const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

// electron/main/db/connection.ts imports `app` from 'electron' at its own
// top level (for the no-override resolveDatabasePath path, unused below
// since every test here passes an explicit userDataDir). This module also
// calls app.getVersion() inside the 'app:version' handler. Mocking the
// whole 'electron' module keeps this file running as an ordinary
// vitest/Node test — the real Electron boot proof lives in bridge.test.ts.
// vi.mock is hoisted above every import in this file (vitest's static
// analysis, not execution order), so the imports below already see the
// mocked module.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here overrides userDataDir')
    }
  }
}))

const { closeDatabase, openDatabase } = await import('../db/connection')
const { closeReadOnlyDatabase, openReadOnlyDatabase } = await import('../db/readonly-connection')
const { registry } = await import('./registry')

/**
 * Routes a test call through the same two validation steps
 * `electron/main/ipc/index.ts` performs on a real IPC call — review fix,
 * item 4. Calling `registry[name].handler(...)` directly (what every entity
 * test below used to do) exercises neither: the request schema never parses
 * `payload` and the response schema never parses the return value, so a
 * schema/handler mismatch anywhere in `CHANNEL_CONTRACTS` — the exact shape
 * of item 1's drift, and the reason it survived — is invisible to the whole
 * suite. `callChannel` parses `payload` through `registry[name].request`
 * first, runs the handler on the parsed result (exactly what `index.ts`
 * does), then parses the handler's return value through
 * `registry[name].response` before handing it back — every call below goes
 * through both halves, for every channel, not a sample.
 */
async function callChannel<K extends ChannelName>(name: K, payload?: ChannelRequest<K>): Promise<ChannelResponse<K>> {
  // Widened to a concrete (non-`K`-dependent) definition shape rather than
  // `registry[name]` directly: indexing a mapped object type on a still-generic
  // key distributes over every entry's own Req/Res, which makes `tsc` compute
  // the handler's parameter as the intersection of 40 unrelated payload types
  // (effectively `never`) instead of the one entry `name` actually names. The
  // real per-channel precision is still enforced — by `registry.ts`'s own
  // `satisfies` at the definition site, and by the two explicit `.parse()`
  // calls below, which throw at runtime on exactly the mismatch this cast
  // waives compile-time checking of.
  const channel = registry[name] as unknown as ChannelDefinition<z.ZodTypeAny, z.ZodTypeAny>
  const parsedRequest = channel.request.parse(payload)
  const result = await channel.handler(parsedRequest)
  return channel.response.parse(result) as ChannelResponse<K>
}

afterEach(() => {
  closeDatabase()
})

describe('registry keys match electron/shared/ipc-types.ts CHANNEL_NAMES', () => {
  it('has exactly the same channel names as the shared, preload-safe mirror', () => {
    // The runtime half of the drift guard (the compile-time half is the
    // mapped-type `satisfies` in registry.ts, which couples the channel set
    // AND each entry's schemas to CHANNEL_CONTRACTS). registry.ts is the
    // single source for what a channel validates and does; CHANNEL_NAMES is
    // the one thing named a second time, for preload — this proves the two
    // never diverge.
    expect(Object.keys(registry).sort()).toEqual([...CHANNEL_NAMES].sort())
  })
})

describe("'app:version'", () => {
  it('request schema accepts no payload and rejects a real value', () => {
    expect(registry['app:version'].request.safeParse(undefined).success).toBe(true)
    expect(registry['app:version'].request.safeParse({ extra: true }).success).toBe(false)
  })

  it('handler returns the app version, through the request and response schemas', async () => {
    const result = await callChannel('app:version')
    expect(result).toEqual({ version: '0.1.0-test' })
  })
})

describe("'db:schemaVersion'", () => {
  it('handler reads through getDatabase()/getSchemaVersion(), through the request and response schemas', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-'))
    try {
      openDatabase({ userDataDir: tmpDir })
      // callChannel (not a bare handler call) parses BOTH the request and the
      // response against the channel's contract and throws on a mismatch —
      // T-260828-26's blocking review finding — so it subsumes the explicit
      // response safeParse this test carried on the T-260828-36 side.
      const result = await callChannel('db:schemaVersion')
      expect(result).toEqual({ version: LATEST_SCHEMA_VERSION, lastMigrationAt: expect.any(String) })
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// -----------------------------------------------------------------------
// T-260828-26: the entity surface — companies, people, engagements, tasks,
// activity, settings.
// -----------------------------------------------------------------------

describe('G8: activity has no update or delete channel', () => {
  it('CHANNEL_NAMES names exactly list/get/log for activity — nothing else', () => {
    expect(CHANNEL_NAMES.filter((name) => name.startsWith('activity:')).sort()).toEqual([
      'activity:get',
      'activity:list',
      'activity:log'
    ])
  })
})

/** Unwraps a mutation channel's `{ ok: true, data }` | `{ ok: false, error }` result, failing the test with the refusal's own message if it refused — every entity round-trip below expects success unless it is explicitly testing a refusal. */
function expectOk<Data>(result: {
  readonly ok: boolean
  readonly data?: Data
  readonly error?: { readonly message: string }
}): Data {
  if (!result.ok) throw new Error(`expected a successful mutation, got a refusal: ${result.error?.message}`)
  return result.data as Data
}

describe('entity channels — end to end against a real database', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-entities-'))
    openDatabase({ userDataDir: tmpDir })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('companies: create -> list -> get -> update -> delete round-trips, and every call passes through its own request and response schema', async () => {
    const created = expectOk(await callChannel('companies:create', { name: 'Acme' }))

    const listed = await callChannel('companies:list')
    expect(listed.map((company) => company.id)).toContain(created.id)

    const fetched = await callChannel('companies:get', { id: created.id })
    expect(fetched?.name).toBe('Acme')

    const updated = expectOk(await callChannel('companies:update', { id: created.id, patch: { name: 'Acme Inc' } }))
    expect(updated.name).toBe('Acme Inc')

    const deleted = expectOk(await callChannel('companies:delete', { id: created.id }))
    expect(deleted).toEqual({ id: created.id })

    expect(await callChannel('companies:get', { id: created.id })).toBeNull()
  })

  it('companies:update on a missing id surfaces as a mutation-result refusal, not a thrown exception', async () => {
    const result = await callChannel('companies:update', { id: 'does-not-exist', patch: { name: 'x' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-found')
    // NotFoundError never sets a blocker — only RefusalError does (item 3).
    expect(result.error.blocker).toBeUndefined()
  })

  it('companies:delete blocked by activity history: the refusal reaches the caller as data, carrying the reason and the blocking count structurally, with no filesystem path or stack frame', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Acme' }))
    expectOk(
      await callChannel('activity:log', {
        occurredAt: '2026-08-28T00:00:00.000Z',
        kind: 'note',
        title: 'Kickoff call',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
    )

    const result = await callChannel('companies:delete', { id: company.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('refused')
    expect(result.error.message).toContain('activity record')
    expect(result.error.message).toContain('Acme')
    // Item 3: the refusal's blocker survives the envelope as data, not just
    // as a sentence a caller would have to parse.
    expect(result.error.blocker).toEqual({ reason: 'activity', count: 1 })
    // No path, no stack frame — the message is what a person reads, never an
    // implementation detail (this task's Risks: "map, do not forward").
    expect(result.error.message).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(result.error.message).not.toContain('AppData')
    expect(result.error.message).not.toContain('.db')
    expect(result.error.message).not.toMatch(/\bat .*:\d+:\d+/)
    // The company itself is untouched — refused, not partially deleted.
    expect(await callChannel('companies:get', { id: company.id })).not.toBeNull()
  })

  it('people: create, addAffiliation, get returns the affiliation nested with current: true, move opens a new stint and closes the old one', async () => {
    const companyA = expectOk(await callChannel('companies:create', { name: 'Company A' }))
    const companyB = expectOk(await callChannel('companies:create', { name: 'Company B' }))
    const person = expectOk(await callChannel('people:create', { name: 'Robby' }))

    const affiliation = expectOk(
      await callChannel('people:addAffiliation', { personId: person.id, companyId: companyA.id, started: '2026-01-01' })
    )
    expect(affiliation.companyId).toBe(companyA.id)

    const fetched = await callChannel('people:get', { id: person.id })
    expect(fetched?.affiliations).toEqual([expect.objectContaining({ id: affiliation.id, companyId: companyA.id, current: true })])

    const moved = expectOk(
      await callChannel('people:move', { personId: person.id, toCompanyId: companyB.id, options: { on: '2026-06-01' } })
    )
    expect(moved.companyId).toBe(companyB.id)

    const afterMove = await callChannel('people:get', { id: person.id })
    expect(afterMove?.affiliations.find((a) => a.id === affiliation.id)?.current).toBe(false)
    expect(afterMove?.affiliations.find((a) => a.companyId === companyB.id)?.current).toBe(true)
  })

  it('people:delete round-trips for a person with no affiliations', async () => {
    const person = expectOk(await callChannel('people:create', { name: 'No Affiliations' }))

    const deleted = expectOk(await callChannel('people:delete', { id: person.id }))

    expect(deleted).toEqual({ id: person.id })
    expect(await callChannel('people:get', { id: person.id })).toBeNull()
  })

  it('engagements: create -> list -> get -> milestones (empty) -> update -> delete', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Client Co' }))
    const created = expectOk(
      await callChannel('engagements:create', {
        name: 'Retainer',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        clientCompanyId: company.id
      })
    )

    const listed = await callChannel('engagements:list')
    expect(listed.map((e) => e.id)).toContain(created.id)

    const filtered = await callChannel('engagements:list', { clientCompanyId: company.id })
    expect(filtered.map((e) => e.id)).toEqual([created.id])

    const milestones = await callChannel('engagements:milestones', { engagementId: created.id })
    expect(milestones).toEqual([])

    const updated = expectOk(await callChannel('engagements:update', { id: created.id, patch: { status: 'active' } }))
    expect(updated.status).toBe('active')

    const deleted = expectOk(await callChannel('engagements:delete', { id: created.id }))
    expect(deleted).toEqual({ id: created.id })
  })

  it('tasks: create -> setNextStep -> countOpen reflects it -> update reopening clears a stale flag -> delete', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Task Co' }))
    const task = expectOk(await callChannel('tasks:create', { title: 'Follow up', companyId: company.id }))

    const flagged = expectOk(await callChannel('tasks:setNextStep', { id: task.id }))
    expect(flagged.isNextStep).toBe(true)

    const openCount = await callChannel('tasks:countOpen', { companyId: company.id })
    expect(openCount).toEqual({ count: 1 })

    const deleted = expectOk(await callChannel('tasks:delete', { id: task.id }))
    expect(deleted).toEqual({ id: task.id })

    expect(await callChannel('tasks:get', { id: task.id })).toBeNull()
  })

  it('tasks:setNextStep on a task with no company is refused, as data, not thrown', async () => {
    const task = expectOk(await callChannel('tasks:create', { title: 'Orphan task' }))

    const result = await callChannel('tasks:setNextStep', { id: task.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('refused')
    expect(result.error.message).toContain('no company')
    // Item 3: a blocker with no natural row count (a write-path refusal, not
    // a delete-path referential one) still carries its reason structurally.
    expect(result.error.blocker).toEqual({ reason: 'no-company' })
  })

  it('activity: log -> list -> get; logging with a companyId advances that company’s last_touch_at (ADR-001), visible on the next companies:get', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Touched Co' }))
    expect((await callChannel('companies:get', { id: company.id }))?.lastTouchAt).toBeNull()

    const logged = expectOk(
      await callChannel('activity:log', {
        occurredAt: '2026-08-28T12:00:00.000Z',
        kind: 'call',
        title: 'Check-in',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
    )

    const listed = await callChannel('activity:list', { companyId: company.id })
    expect(listed.map((a) => a.id)).toEqual([logged.id])

    const fetched = await callChannel('activity:get', { id: logged.id })
    expect(fetched?.title).toBe('Check-in')

    expect((await callChannel('companies:get', { id: company.id }))?.lastTouchAt).toBe('2026-08-28T12:00:00.000Z')
  })

  it('settings: get returns the declared default, set validates and persists, getAll includes it, reset restores the default', async () => {
    const initial = await callChannel('settings:get', { key: 'workspace.name' })
    expect(initial).toEqual({ key: 'workspace.name', value: '' })

    const set = expectOk(await callChannel('settings:set', { key: 'workspace.name', value: 'Solo CRM' }))
    expect(set).toEqual({ key: 'workspace.name', value: 'Solo CRM' })

    const snapshot = await callChannel('settings:getAll')
    expect(snapshot['workspace.name']).toBe('Solo CRM')

    const reset = expectOk(await callChannel('settings:reset', { key: 'workspace.name' }))
    expect(reset).toEqual({ key: 'workspace.name', value: '' })
  })

  it('settings:set rejects a value that fails its key’s own schema, as a mutation-result refusal', async () => {
    // Deliberately NOT routed through callChannel: this test exists to prove
    // the repository's own validation (setSetting -> SETTINGS_REGISTRY) is a
    // second, independent line of defence, not routed through the request
    // schema a real IPC call already validates against — callChannel's
    // request.parse would reject this payload itself (settingEntrySchema's
    // superRefine checks the same registry) and never reach the handler,
    // which would test index.ts's job, not the repository's.
    // @ts-expect-error - deliberately the wrong shape (a bogus currency) to prove the repository's own validation still runs, independent of the request schema a real IPC call would already have failed at.
    const result = await registry['settings:set'].handler({ key: 'workspace.currency', value: 'not-a-real-currency' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')
  })
})

// ---------------------------------------------------------------------------
// T-260828-39: 'db:query' — the read-only query channel.
//
// The mechanisms themselves (the second connection, the two statement-level
// checks, the cap and the timeout) are proven in
// `electron/main/db/readonly-connection.test.ts`. What this covers is the
// wire: that a refusal AND a result both survive the channel's own
// request/response schemas, which is what `callChannel` parses through.
// ---------------------------------------------------------------------------

describe("'db:query'", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-query-'))
    openDatabase({ userDataDir: tmpDir })
    // The handler passes no options — production resolves through
    // `app.getPath('userData')`, which this file's mock deliberately throws
    // on. Opening the read-only connection here is what points it at
    // tmpDir; `getReadOnlyDatabase()` inside the handler then returns this
    // handle rather than resolving a path of its own.
    openReadOnlyDatabase({ userDataDir: tmpDir })
  })

  afterEach(() => {
    closeReadOnlyDatabase()
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns rows and columns for a legitimate read, through the request and response schemas', async () => {
    const created = expectOk(await callChannel('companies:create', { name: 'Acme' }))
    const result = await callChannel('db:query', {
      statement: 'SELECT id, name FROM companies WHERE id = ?',
      params: [created.id]
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.columns).toEqual(['id', 'name'])
    expect(result.data.rows).toEqual([[created.id, 'Acme']])
    expect(result.data.truncated).toBe(false)
  })

  it('carries a refusal as data, so its reason survives the response schema rather than being flattened to a generic sentence', async () => {
    const result = await callChannel('db:query', { statement: 'DELETE FROM companies' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('writes-data')
    expect(result.error.message).toMatch(/modifies the database/)
  })

  it('rejects a malformed request at the schema, and gives the renderer no way to raise the cap or the timeout', () => {
    expect(registry['db:query'].request.safeParse({ statement: 'SELECT 1' }).success).toBe(true)
    expect(registry['db:query'].request.safeParse({ statement: '' }).success).toBe(false)
    expect(registry['db:query'].request.safeParse({ statement: 42 }).success).toBe(false)
    // Both are main-side constants; `.strict()` is what keeps them there.
    expect(registry['db:query'].request.safeParse({ statement: 'SELECT 1', rowLimit: 1_000_000 }).success).toBe(false)
    expect(registry['db:query'].request.safeParse({ statement: 'SELECT 1', timeoutMs: 600_000 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T-260828-37: the command palette's read.
//
// The FTS index itself, its query plan and its latency budget belong to
// T-260828-36/51 (`db/repositories/search.test.ts` and
// `search.latency.test.ts`). What is covered here is the wire: that a real
// match, an empty result and a refused payload each behave correctly through
// this channel's own request and response schemas, which `callChannel` parses
// both halves of.
// ---------------------------------------------------------------------------

describe("'search:query'", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-search-'))
    openDatabase({ userDataDir: tmpDir })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds a record written through another channel, and reports which table it came from', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Sand Sage' }))

    const results = await callChannel('search:query', { query: 'sand' })

    expect(results).toContainEqual({ kind: 'company', id: company.id, text: 'Sand Sage' })
  })

  it('answers across kinds in one call — a company, a person and a todo all naming the same thing', async () => {
    const company = expectOk(await callChannel('companies:create', { name: 'Nimbus' }))
    const person = expectOk(await callChannel('people:create', { name: 'Nimbus Vega' }))
    const task = expectOk(await callChannel('tasks:create', { title: 'Call Nimbus back' }))

    const results = await callChannel('search:query', { query: 'nimbus' })

    expect(results.map((row) => `${row.kind}:${row.id}`).sort()).toEqual(
      [`company:${company.id}`, `person:${person.id}`, `task:${task.id}`].sort()
    )
  })

  it('a query matching nothing is an empty list, not an error — and neither is one with nothing searchable in it', async () => {
    expectOk(await callChannel('companies:create', { name: 'Acme' }))

    expect(await callChannel('search:query', { query: 'zzzznothing' })).toEqual([])
    // Punctuation and whitespace carry no FTS5 token; `searchAll`
    // short-circuits rather than issuing a MATCH that would itself be a
    // syntax error.
    expect(await callChannel('search:query', { query: '   ' })).toEqual([])
    expect(await callChannel('search:query', { query: '"*(' })).toEqual([])
  })

  it('honours the caller-supplied cap, and refuses a payload the shared schema does not describe', async () => {
    for (const name of ['Acme One', 'Acme Two', 'Acme Three']) {
      expectOk(await callChannel('companies:create', { name }))
    }

    expect(await callChannel('search:query', { query: 'acme', limit: 2 })).toHaveLength(2)

    // The request schema *is* `searchQueryInputSchema`
    // (electron/shared/search.ts) — strict, and shared with the repository —
    // so an unknown key, a non-positive limit or one past its ceiling is
    // refused at the wire rather than reaching SQLite.
    expect(registry['search:query'].request.safeParse({ query: 'acme' }).success).toBe(true)
    expect(registry['search:query'].request.safeParse({ query: 'acme', kind: 'company' }).success).toBe(false)
    expect(registry['search:query'].request.safeParse({ query: 'acme', limit: 0 }).success).toBe(false)
    expect(registry['search:query'].request.safeParse({ query: 'acme', limit: 10_000 }).success).toBe(false)
    expect(registry['search:query'].request.safeParse({ limit: 5 }).success).toBe(false)
  })
})
