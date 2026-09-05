import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { CHANNEL_NAMES } from '../../shared/ipc-types'
import type { ChannelName, ChannelRequest, ChannelResponse } from '../../shared/ipc-types'
import type { ChannelDefinition } from './registry'
import { MIGRATIONS } from '../db/migrations'
import { pathLikeStrings } from '../branding/test-support/path-leak'

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
//
// T-260829-05 adds `dialog` and `BrowserWindow` to the mock, because
// `branding:choose` is the one handler that reaches a native dialog and its
// definition takes no injection point — the picker's dependencies are
// injectable (`branding/picker.test.ts` drives every branch that way), but a
// registry entry is a fixed `(payload) => …`, so driving the *channel* end to
// end means steering the module boundary instead. `hoisted` state is what lets
// the factory below, which vitest hoists above every import, be controlled per
// test.
const electronFake = vi.hoisted(() => ({
  /** What `BrowserWindow.getFocusedWindow()` answers. `null` is the refusal case. */
  focusedWindow: {} as object | null,
  /** What `dialog.showOpenDialog` resolves to. */
  openDialogResult: { canceled: true, filePaths: [] as string[] },
  /** Every options object the dialog was opened with. */
  openDialogCalls: [] as Array<Record<string, unknown>>,
  /** What `dialog.showSaveDialog` resolves to — `backup:run`'s destination. */
  saveDialogResult: { canceled: true } as { canceled: boolean; filePath?: string },
  saveDialogCalls: [] as Array<Record<string, unknown>>
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here overrides userDataDir')
    }
  },
  BrowserWindow: {
    getFocusedWindow: () => electronFake.focusedWindow
  },
  dialog: {
    showOpenDialog: async (_window: unknown, options: Record<string, unknown>) => {
      electronFake.openDialogCalls.push(options)
      return electronFake.openDialogResult
    },
    showSaveDialog: async (_window: unknown, options: Record<string, unknown>) => {
      electronFake.saveDialogCalls.push(options)
      return electronFake.saveDialogResult
    }
  },
  // T-260901-12: `companyImages:choose` stores a derivative beside the
  // original, and `writeCompanyImage`'s default deriver decodes through
  // `nativeImage` — a registry entry, again, takes no injection point. This
  // fake decodes nothing: it answers a fixed 1 × 1 source and encodes each
  // slot's thumbnail as a recognisable byte string, so the channel tests can
  // assert the *shape* the wire carries (a `data:` URL of the derivative, the
  // slot's content type, the decoded size) without a real decoder, which
  // `images/derive.electron.test.ts` proves separately.
  nativeImage: {
    createFromBuffer: () => {
      const image = {
        isEmpty: () => false,
        getSize: () => ({ width: 1, height: 1 }),
        resize: () => image,
        toPNG: () => Buffer.from('fake-png-thumbnail', 'utf-8'),
        toJPEG: () => Buffer.from('fake-jpeg-thumbnail', 'utf-8')
      }
      return image
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

describe("'db:stats'", () => {
  it('handler answers with the live file facts, through the request and response schemas', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-stats-'))
    try {
      openDatabase({ userDataDir: tmpDir })
      const result = await callChannel('db:stats')

      // The response schema is `.strict()`, so `callChannel`'s own
      // `response.parse` has already refused anything extra or missing; what
      // is asserted here is that the values describe the file this test just
      // opened, not a plausible-looking constant.
      expect(result.path.endsWith('solocrm.db')).toBe(true)
      expect(result.journalMode).toBe('wal')
      expect(result.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
      expect(result.fileBytes).toBeGreaterThan(0)
      expect(result.tables.map((table) => table.name)).toContain('companies')
      // X-04/X-05 own these; nothing writes them yet and this channel does
      // not invent them.
      expect(result.lastBackupAt).toBeNull()
      expect(result.lastIntegrityCheckOk).toBeNull()
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

    const milestones = await callChannel('milestones:list', { engagementId: created.id })
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

// ---------------------------------------------------------------------------
// T-260901-07: the offerings catalogue's ten channels.
//
// The repository's own behaviour — the version window, the overlap check, the
// duplicate's copied rate, the archive's idempotence — belongs to T-260901-05
// and is covered by `db/repositories/offerings.test.ts`. What is covered here
// is the wire: that each channel exists, that a request carrying a field the
// contract does not declare is refused rather than quietly dropped, that a
// refusal's own sentence survives the envelope, and that no response names a
// location on disk.
// ---------------------------------------------------------------------------

describe('offerings channels — end to end against a real database', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-offerings-'))
    openDatabase({ userDataDir: tmpDir })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('categories: create -> listCategories -> update round-trips through each channel’s own request and response schema', async () => {
    const created = expectOk(await callChannel('offerings:createCategory', { name: 'Consulting', color: '#C9A84C', sort: 1 }))
    expect(created.name).toBe('Consulting')

    const listed = await callChannel('offerings:listCategories')
    expect(listed.map((category) => category.id)).toEqual([created.id])

    const renamed = expectOk(await callChannel('offerings:updateCategory', { id: created.id, patch: { name: 'Advisory' } }))
    expect(renamed).toEqual({ ...created, name: 'Advisory', updatedAt: expect.any(String) })

    const deleted = expectOk(await callChannel('offerings:deleteCategory', { id: created.id }))
    expect(deleted).toEqual({ id: created.id })
    expect(await callChannel('offerings:listCategories')).toEqual([])
  })

  it('offerings: create -> list (with its current rate joined on) -> get (with the history) -> update -> archive -> duplicate', async () => {
    const category = expectOk(await callChannel('offerings:createCategory', { name: 'Retainers' }))

    const created = expectOk(
      await callChannel('offerings:create', {
        name: 'Fractional CTO',
        type: 'service',
        categoryId: category.id,
        billingModel: 'retainer',
        unit: 'mo',
        rateCents: 800_000
      })
    )
    // `offerings:create`'s response is the offering WITH its history, and the
    // repository writes the first version in the same transaction — so a
    // freshly created offering already has exactly one.
    expect(created.versions).toHaveLength(1)
    expect(created.versions[0]?.rateCents).toBe(800_000)

    const listed = await callChannel('offerings:list')
    expect(listed.map((offering) => offering.id)).toEqual([created.id])
    // The list carries the current rate so a row can show a price without a
    // second call — the whole reason `offerings:list` answers with
    // `OfferingListItem` rather than a bare `Offering`.
    expect(listed[0]?.currentVersion?.rateCents).toBe(800_000)

    expect((await callChannel('offerings:list', { type: 'service' })).map((o) => o.id)).toEqual([created.id])
    expect(await callChannel('offerings:list', { type: 'product' })).toEqual([])
    expect((await callChannel('offerings:list', { categoryId: category.id })).map((o) => o.id)).toEqual([created.id])

    const fetched = await callChannel('offerings:get', { id: created.id })
    expect(fetched?.name).toBe('Fractional CTO')
    expect(fetched?.versions).toHaveLength(1)

    const updated = expectOk(await callChannel('offerings:update', { id: created.id, patch: { blurb: 'Two days a month' } }))
    expect(updated.blurb).toBe('Two days a month')

    const archived = expectOk(await callChannel('offerings:archive', { id: created.id }))
    expect(archived.active).toBe(false)
    // Archiving hides nothing from a read by id, and an unfiltered list still
    // shows it — there is no implicit `active = true`.
    expect((await callChannel('offerings:list', { active: false })).map((o) => o.id)).toEqual([created.id])
    expect(await callChannel('offerings:list', { active: true })).toEqual([])

    const copy = expectOk(await callChannel('offerings:duplicate', { id: created.id, overrides: { name: 'Fractional CTO (lite)' } }))
    expect(copy.name).toBe('Fractional CTO (lite)')
    expect(copy.id).not.toBe(created.id)
    // The copy starts its own history at the original's current rate — it does
    // not inherit the original's versions.
    expect(copy.versions).toHaveLength(1)
    expect(copy.versions[0]?.rateCents).toBe(800_000)

    // Omitting `overrides` entirely is legal and is the repository's
    // " (copy)" default, not a name this channel invents.
    const defaultCopy = expectOk(await callChannel('offerings:duplicate', { id: created.id }))
    expect(defaultCopy.name).toBe('Fractional CTO (copy)')
  })

  it('offerings:deleteCategory on a category holding an offering refuses as data — the repository’s sentence reaches the caller verbatim and the category still exists', async () => {
    const category = expectOk(await callChannel('offerings:createCategory', { name: 'Consulting' }))
    expectOk(await callChannel('offerings:create', { name: 'Discovery Sprint', categoryId: category.id, rateCents: 250_000 }))

    const result = await callChannel('offerings:deleteCategory', { id: category.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('refused')
    // Verbatim, not a substring: this is the exact sentence
    // `deleteOfferingCategory` composes, so anything that re-words or
    // truncates it on the way through the envelope fails here.
    expect(result.error.message).toBe(
      'Cannot delete "Consulting": 1 offering is in it (e.g. "Discovery Sprint"). Move them to another category before deleting this one.'
    )
    expect(result.error.blocker).toEqual({ reason: 'offerings', count: 1 })

    // Refused, not partially applied.
    expect((await callChannel('offerings:listCategories')).map((c) => c.id)).toEqual([category.id])
  })

  it('offerings:create with no rate is refused and writes no row — at the wire, and again in the repository', async () => {
    // At the wire: `createOfferingInputSchema` makes `rateCents` required, so
    // a real IPC call never reaches the handler at all — index.ts answers
    // `{ ok: false, error: { code: 'invalid-request' } }`.
    const rejected = registry['offerings:create'].request.safeParse({ name: 'Rateless' })
    expect(rejected.success).toBe(false)
    if (!rejected.success) {
      expect(rejected.error.issues.some((issue) => issue.path.includes('rateCents'))).toBe(true)
    }

    // And again one layer in, independently of the request schema — the same
    // second-line-of-defence the `settings:set` test above proves. Not routed
    // through `callChannel`, whose `request.parse` would refuse this payload
    // before the handler ran.
    // @ts-expect-error - deliberately missing the required rateCents, to prove the repository's own validation refuses it too rather than writing a version-less offering.
    const result = await registry['offerings:create'].handler({ name: 'Rateless' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')

    // Nothing was written — not the `offerings` row, not a version.
    expect(await callChannel('offerings:list')).toEqual([])
  })

  it('every mutating offerings channel refuses a request body carrying a field its contract does not declare', () => {
    // Categories.
    expect(registry['offerings:createCategory'].request.safeParse({ name: 'Consulting' }).success).toBe(true)
    expect(registry['offerings:createCategory'].request.safeParse({ name: 'Consulting', archived: true }).success).toBe(false)
    expect(registry['offerings:updateCategory'].request.safeParse({ id: 'c1', patch: { name: 'x' } }).success).toBe(true)
    expect(registry['offerings:updateCategory'].request.safeParse({ id: 'c1', patch: { archived: true } }).success).toBe(false)
    expect(registry['offerings:updateCategory'].request.safeParse({ id: 'c1', patch: {}, force: true }).success).toBe(false)
    expect(registry['offerings:deleteCategory'].request.safeParse({ id: 'c1' }).success).toBe(true)
    expect(registry['offerings:deleteCategory'].request.safeParse({ id: 'c1', cascade: true }).success).toBe(false)

    // Offerings. `active` is not a create field — archiving is a named action,
    // not a flag a generic form can set on the way in.
    expect(registry['offerings:create'].request.safeParse({ name: 'x', rateCents: 1 }).success).toBe(true)
    expect(registry['offerings:create'].request.safeParse({ name: 'x', rateCents: 1, active: false }).success).toBe(false)
    expect(registry['offerings:create'].request.safeParse({ name: 'x', rateCents: 1, version: 3 }).success).toBe(false)
    expect(registry['offerings:create'].request.safeParse({ name: 'x', rateCents: 1, type: 'widget' }).success).toBe(false)

    // The one that matters most: §6.5 makes changing a price a distinct
    // action (P3-02), so a rate in an update patch is refused rather than
    // ignored — an ignored one would look like a saved price change.
    expect(registry['offerings:update'].request.safeParse({ id: 'o1', patch: { name: 'x' } }).success).toBe(true)
    expect(registry['offerings:update'].request.safeParse({ id: 'o1', patch: { rateCents: 999 } }).success).toBe(false)
    expect(registry['offerings:update'].request.safeParse({ id: 'o1', patch: { active: true } }).success).toBe(false)
    // The wrapper is strict too, not only the patch inside it (merge review:
    // dropping the outer `.strict()` survived every line above).
    expect(registry['offerings:update'].request.safeParse({ id: 'o1', patch: { name: 'x' }, rateCents: 999 }).success).toBe(false)

    expect(registry['offerings:archive'].request.safeParse({ id: 'o1' }).success).toBe(true)
    expect(registry['offerings:archive'].request.safeParse({ id: 'o1', hard: true }).success).toBe(false)

    expect(registry['offerings:duplicate'].request.safeParse({ id: 'o1' }).success).toBe(true)
    expect(registry['offerings:duplicate'].request.safeParse({ id: 'o1', overrides: { name: 'x' } }).success).toBe(true)
    expect(registry['offerings:duplicate'].request.safeParse({ id: 'o1', overrides: { rateCents: 1 } }).success).toBe(false)
    expect(registry['offerings:duplicate'].request.safeParse({ id: 'o1', name: 'x' }).success).toBe(false)

    // And the reads: the list filter is `.strict()`, so a typo'd key is a
    // validation failure rather than a silently unfiltered list.
    expect(registry['offerings:list'].request.safeParse(undefined).success).toBe(true)
    expect(registry['offerings:list'].request.safeParse({ active: true }).success).toBe(true)
    expect(registry['offerings:list'].request.safeParse({ archived: true }).success).toBe(false)
    expect(registry['offerings:list'].request.safeParse({ limit: 10 }).success).toBe(false)
    expect(registry['offerings:listCategories'].request.safeParse(undefined).success).toBe(true)
    expect(registry['offerings:listCategories'].request.safeParse({}).success).toBe(false)
    expect(registry['offerings:get'].request.safeParse({ id: 'o1' }).success).toBe(true)
    expect(registry['offerings:get'].request.safeParse({ id: 'o1', withVersions: true }).success).toBe(false)
  })

  it('no offerings response names a location on disk, and no channel accepts one — every branch, walked', async () => {
    const category = expectOk(await callChannel('offerings:createCategory', { name: 'Consulting' }))
    const offering = expectOk(
      await callChannel('offerings:create', { name: 'Discovery Sprint', categoryId: category.id, rateCents: 250_000 })
    )

    const responses: unknown[] = [
      await callChannel('offerings:listCategories'),
      await callChannel('offerings:list'),
      await callChannel('offerings:get', { id: offering.id }),
      await callChannel('offerings:update', { id: offering.id, patch: { blurb: 'Two weeks' } }),
      await callChannel('offerings:archive', { id: offering.id }),
      await callChannel('offerings:duplicate', { id: offering.id }),
      // The refusal branches — their messages cross verbatim, so they are part
      // of the same property rather than a separate concern.
      await callChannel('offerings:deleteCategory', { id: category.id }),
      await callChannel('offerings:updateCategory', { id: 'does-not-exist', patch: { name: 'x' } }),
      await callChannel('offerings:archive', { id: 'does-not-exist' })
    ]

    const refusals = responses.filter((response) => (response as { ok?: boolean }).ok === false)
    expect(refusals).toHaveLength(3)

    expect(pathLikeStrings(responses)).toEqual([])

    // And nothing on the way in accepts one either: no request schema in this
    // group has a path-shaped field to put one in, so a caller naming one is
    // refused by `.strict()` rather than handed to the filesystem.
    expect(registry['offerings:create'].request.safeParse({ name: 'x', rateCents: 1, path: 'C:\\catalogue.csv' }).success).toBe(
      false
    )
    expect(registry['offerings:list'].request.safeParse({ file: '/tmp/offerings.json' }).success).toBe(false)
  })
})

/**
 * The three branding channels (T-260829-05), driven end to end through
 * `callChannel` — so every assertion below is about what a *renderer* would
 * actually receive, after both the request and the response schema have run.
 *
 * The branch coverage of the picker itself (single-flight, the bounded read,
 * the SVG refusal) lives in `electron/main/branding/picker.test.ts`, which
 * injects the dialog directly. What is here is the wire: that the channels
 * exist, that a cancelled pick is a success, that a refusal is an envelope,
 * and — the criterion this task turns on — that nothing any of the three
 * answers with names a location on disk.
 */
describe('branding channels — end to end against a real database', () => {
  let tmpDir: string
  let fileDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-branding-'))
    fileDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-images-'))
    openDatabase({ userDataDir: tmpDir })
    electronFake.focusedWindow = {}
    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    electronFake.openDialogCalls.length = 0
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(fileDir, { recursive: true, force: true })
  })

  /** A genuine 1x1 PNG, written where the picker's fake says it was chosen. */
  function writePng(name: string): string {
    const path = join(fileDir, name)
    writeFileSync(
      path,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    return path
  }

  it('branding:get answers both slots as absent on a fresh database, and opens no dialog', async () => {
    expect(await callChannel('branding:get')).toEqual({
      icon: { state: 'absent', slot: 'icon' },
      logo: { state: 'absent', slot: 'logo' }
    })
    expect(electronFake.openDialogCalls).toEqual([])
  })

  it('branding:choose stores the picked file and answers with a data: URL', async () => {
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('logo.png')] }

    const choice = expectOk(await callChannel('branding:choose', { slot: 'logo' }))
    expect(choice.outcome).toBe('chosen')
    if (choice.outcome !== 'chosen') return
    expect(choice.state.state).toBe('present')
    if (choice.state.state !== 'present') return
    expect(choice.state.dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    // And it is readable back through the read channel, which never opens a
    // dialog of its own.
    const snapshot = await callChannel('branding:get')
    expect(snapshot.logo).toEqual(choice.state)
    expect(snapshot.icon).toEqual({ state: 'absent', slot: 'icon' })
    expect(electronFake.openDialogCalls).toHaveLength(1)
  })

  it('a cancelled picker is ok: true with outcome cancelled, and the slot is identical before and after', async () => {
    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    const before = await callChannel('branding:get')

    const result = await callChannel('branding:choose', { slot: 'icon' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ outcome: 'cancelled' })

    expect(await callChannel('branding:get')).toEqual(before)
  })

  it('branding:choose with no focused window is refused as a mutation error, and no dialog is opened', async () => {
    electronFake.focusedWindow = null
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('logo.png')] }

    const result = await callChannel('branding:choose', { slot: 'logo' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')
    expect(electronFake.openDialogCalls).toEqual([])
  })

  it('branding:clear on a default slot succeeds with { state: absent } rather than erroring', async () => {
    const result = expectOk(await callChannel('branding:clear', { slot: 'icon' }))
    expect(result).toEqual({ state: 'absent', slot: 'icon' })
  })

  it('branding:clear removes a stored image and branding:get agrees', async () => {
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('icon.png')] }
    expectOk(await callChannel('branding:choose', { slot: 'icon' }))

    expect(expectOk(await callChannel('branding:clear', { slot: 'icon' }))).toEqual({ state: 'absent', slot: 'icon' })
    expect(await callChannel('branding:get')).toEqual({
      icon: { state: 'absent', slot: 'icon' },
      logo: { state: 'absent', slot: 'logo' }
    })
  })

  it('the request schemas take a slot and nothing else — no path, no filename, no declared content type', () => {
    expect(registry['branding:choose'].request.safeParse({ slot: 'icon' }).success).toBe(true)
    expect(registry['branding:choose'].request.safeParse({ slot: 'sidebar' }).success).toBe(false)
    expect(registry['branding:choose'].request.safeParse({ slot: 'icon', path: 'C:\\logo.png' }).success).toBe(false)
    expect(registry['branding:choose'].request.safeParse({ slot: 'icon', contentType: 'image/png' }).success).toBe(false)
    expect(registry['branding:clear'].request.safeParse({ slot: 'logo' }).success).toBe(true)
    expect(registry['branding:clear'].request.safeParse({}).success).toBe(false)
    expect(registry['branding:get'].request.safeParse(undefined).success).toBe(true)
    expect(registry['branding:get'].request.safeParse({ slot: 'icon' }).success).toBe(false)
  })

  it('no response from any of the three channels contains a filesystem path — every branch, walked', async () => {
    const chosenPath = writePng('logo.png')
    // The premise: the path handed to the dialog really does look like one,
    // so finding none in the responses means something.
    expect(chosenPath).toContain(sep)

    const responses: unknown[] = []

    electronFake.openDialogResult = { canceled: false, filePaths: [chosenPath] }
    responses.push(await callChannel('branding:choose', { slot: 'logo' }))
    responses.push(await callChannel('branding:get'))

    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    responses.push(await callChannel('branding:choose', { slot: 'icon' }))

    // The refusal branches — their messages cross the boundary verbatim, so
    // they are part of the same property, not a separate concern.
    electronFake.openDialogResult = { canceled: false, filePaths: [join(fileDir, 'not-here.png')] }
    responses.push(await callChannel('branding:choose', { slot: 'icon' }))

    electronFake.focusedWindow = null
    responses.push(await callChannel('branding:choose', { slot: 'icon' }))
    electronFake.focusedWindow = {}

    responses.push(await callChannel('branding:clear', { slot: 'logo' }))
    responses.push(await callChannel('branding:get'))

    // Every refusal above really was one, so the sweep is not walking a list
    // of successes that never had a chance to leak anything.
    const refusals = responses.filter((response) => (response as { ok?: boolean }).ok === false)
    expect(refusals).toHaveLength(2)

    expect(pathLikeStrings(responses)).toEqual([])
  })
})

/**
 * The four company image channels (T-260901-12), driven end to end through
 * `callChannel` the way the branding block above is — so every assertion is
 * about what a *renderer* receives after both schemas have run. The picker's
 * branch coverage (per-slot cap before the read, single flight, the unknown
 * company, the SVG refusal) lives in `electron/main/images/company-images.test.ts`;
 * what is here is the wire: that the channels exist, that the two reads have
 * ADR-015's shapes and never open a dialog, that a cancelled pick is a
 * success, that a refusal is an envelope, and that nothing any of the four
 * answers with names a location on disk.
 */
describe('companyImages channels — end to end against a real database', () => {
  let tmpDir: string
  let fileDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-company-images-'))
    fileDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-company-files-'))
    openDatabase({ userDataDir: tmpDir })
    electronFake.focusedWindow = {}
    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    electronFake.openDialogCalls.length = 0
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(fileDir, { recursive: true, force: true })
  })

  const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  /** A genuine 1x1 PNG, written where the picker's fake says it was chosen. */
  function writePng(name: string): string {
    const path = join(fileDir, name)
    writeFileSync(path, Buffer.from(PNG_BASE64, 'base64'))
    return path
  }

  async function createCompany(name: string): Promise<string> {
    return expectOk(await callChannel('companies:create', { name })).id
  }

  it('companyImages:get answers both slots as absent for a company with no images, and opens no dialog', async () => {
    const id = await createCompany('Rinvii')
    expect(await callChannel('companyImages:get', { companyId: id })).toEqual({
      logo: { state: 'absent', slot: 'logo' },
      banner: { state: 'absent', slot: 'banner' }
    })
    expect(electronFake.openDialogCalls).toEqual([])
  })

  it('companyImages:thumbnails is an empty map on a database with companies but no images, and opens no dialog', async () => {
    await createCompany('Rinvii')
    expect(await callChannel('companyImages:thumbnails')).toEqual({})
    expect(electronFake.openDialogCalls).toEqual([])
  })

  it('companyImages:choose stores the picked file for that company and answers with a data: URL of the original plus its size', async () => {
    const id = await createCompany('Rinvii')
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('logo.png')] }

    const choice = expectOk(await callChannel('companyImages:choose', { companyId: id, slot: 'logo' }))
    expect(choice.outcome).toBe('chosen')
    if (choice.outcome !== 'chosen') return
    expect(choice.state).toEqual({
      state: 'present',
      slot: 'logo',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_BASE64}`,
      byteLength: Buffer.from(PNG_BASE64, 'base64').length,
      width: 1,
      height: 1,
      updatedAt: expect.any(String)
    })

    // Readable back through the per-company read, which never opens a
    // dialog of its own; the other slot is untouched.
    const snapshot = await callChannel('companyImages:get', { companyId: id })
    expect(snapshot.logo).toEqual(choice.state)
    expect(snapshot.banner).toEqual({ state: 'absent', slot: 'banner' })
    expect(electronFake.openDialogCalls).toHaveLength(1)
  })

  it('companyImages:thumbnails is keyed by company id, present slots only, and carries the derivative rather than the original', async () => {
    const withLogo = await createCompany('Logo only')
    const withBoth = await createCompany('Both')
    await createCompany('Nothing')

    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('a.png')] }
    expectOk(await callChannel('companyImages:choose', { companyId: withLogo, slot: 'logo' }))
    expectOk(await callChannel('companyImages:choose', { companyId: withBoth, slot: 'logo' }))
    expectOk(await callChannel('companyImages:choose', { companyId: withBoth, slot: 'banner' }))

    const thumbnails = await callChannel('companyImages:thumbnails')

    expect(Object.keys(thumbnails).sort()).toEqual([withLogo, withBoth].sort())
    expect(Object.keys(thumbnails[withLogo] ?? {})).toEqual(['logo'])
    expect(Object.keys(thumbnails[withBoth] ?? {}).sort()).toEqual(['banner', 'logo'])

    // The derivative is what the fake decoder encoded — per slot, PNG for the
    // logo and JPEG for the banner — never the picked file's own bytes.
    expect(thumbnails[withBoth]?.logo).toEqual({
      slot: 'logo',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from('fake-png-thumbnail', 'utf-8').toString('base64')}`,
      width: 1,
      height: 1,
      updatedAt: expect.any(String)
    })
    expect(thumbnails[withBoth]?.banner?.contentType).toBe('image/jpeg')
    expect(thumbnails[withBoth]?.banner?.dataUrl).toBe(
      `data:image/jpeg;base64,${Buffer.from('fake-jpeg-thumbnail', 'utf-8').toString('base64')}`
    )
    expect(JSON.stringify(thumbnails)).not.toContain(PNG_BASE64)
  })

  it('a cancelled picker is ok: true with outcome cancelled, and the company’s images are identical before and after', async () => {
    const id = await createCompany('Rinvii')
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('banner.png')] }
    expectOk(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))
    const before = await callChannel('companyImages:get', { companyId: id })
    const thumbnailsBefore = await callChannel('companyImages:thumbnails')

    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    const result = await callChannel('companyImages:choose', { companyId: id, slot: 'banner' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({ outcome: 'cancelled' })

    expect(await callChannel('companyImages:get', { companyId: id })).toEqual(before)
    expect(await callChannel('companyImages:thumbnails')).toEqual(thumbnailsBefore)
  })

  it('companyImages:choose with no focused window is refused as a mutation error, path-free, and no dialog is opened', async () => {
    const id = await createCompany('Rinvii')
    electronFake.focusedWindow = null
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('logo.png')] }

    const result = await callChannel('companyImages:choose', { companyId: id, slot: 'logo' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')
    expect(pathLikeStrings(result)).toEqual([])
    expect(electronFake.openDialogCalls).toEqual([])
  })

  it('companyImages:choose for a company that does not exist is refused as not-found, echoes only the id, and writes nothing', async () => {
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('logo.png')] }

    const result = await callChannel('companyImages:choose', { companyId: 'no-such-company', slot: 'logo' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-found')
    expect(result.error.message).toBe('Company "no-such-company" was not found')
    expect(pathLikeStrings(result)).toEqual([])

    expect(await callChannel('companyImages:thumbnails')).toEqual({})
  })

  it('companyImages:clear on an absent slot succeeds with { state: absent } rather than erroring', async () => {
    const id = await createCompany('Rinvii')
    expect(expectOk(await callChannel('companyImages:clear', { companyId: id, slot: 'banner' }))).toEqual({
      state: 'absent',
      slot: 'banner'
    })
  })

  it('companyImages:clear removes one slot only, and both reads agree', async () => {
    const id = await createCompany('Rinvii')
    electronFake.openDialogResult = { canceled: false, filePaths: [writePng('a.png')] }
    expectOk(await callChannel('companyImages:choose', { companyId: id, slot: 'logo' }))
    expectOk(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))

    expect(expectOk(await callChannel('companyImages:clear', { companyId: id, slot: 'logo' }))).toEqual({
      state: 'absent',
      slot: 'logo'
    })

    const snapshot = await callChannel('companyImages:get', { companyId: id })
    expect(snapshot.logo).toEqual({ state: 'absent', slot: 'logo' })
    expect(snapshot.banner.state).toBe('present')
    expect(Object.keys((await callChannel('companyImages:thumbnails'))[id] ?? {})).toEqual(['banner'])
  })

  it('the request schemas take a company id and a slot and nothing else — no path, no filename, no declared content type', () => {
    for (const name of ['companyImages:choose', 'companyImages:clear'] as const) {
      const request = registry[name].request
      expect(request.safeParse({ companyId: 'c1', slot: 'logo' }).success).toBe(true)
      expect(request.safeParse({ companyId: 'c1', slot: 'banner' }).success).toBe(true)
      expect(request.safeParse({ companyId: 'c1', slot: 'icon' }).success).toBe(false)
      expect(request.safeParse({ slot: 'logo' }).success).toBe(false)
      expect(request.safeParse({ companyId: '', slot: 'logo' }).success).toBe(false)
      expect(request.safeParse({ companyId: 'c1', slot: 'logo', path: 'C:\\logo.png' }).success).toBe(false)
      expect(request.safeParse({ companyId: 'c1', slot: 'logo', contentType: 'image/png' }).success).toBe(false)
      expect(request.safeParse({ companyId: 'c1', slot: 'logo', byteLength: 12 }).success).toBe(false)
    }
    expect(registry['companyImages:get'].request.safeParse({ companyId: 'c1' }).success).toBe(true)
    expect(registry['companyImages:get'].request.safeParse({}).success).toBe(false)
    expect(registry['companyImages:get'].request.safeParse({ companyId: 'c1', slot: 'logo' }).success).toBe(false)
    expect(registry['companyImages:thumbnails'].request.safeParse(undefined).success).toBe(true)
    expect(registry['companyImages:thumbnails'].request.safeParse({ companyId: 'c1' }).success).toBe(false)
    expect(registry['companyImages:thumbnails'].request.safeParse({ ids: ['c1'] }).success).toBe(false)
  })

  it('no response from any of the four channels contains a filesystem path — every branch, walked', async () => {
    const id = await createCompany('Rinvii')
    const chosenPath = writePng('logo.png')
    expect(chosenPath).toContain(sep)

    const responses: unknown[] = []

    electronFake.openDialogResult = { canceled: false, filePaths: [chosenPath] }
    responses.push(await callChannel('companyImages:choose', { companyId: id, slot: 'logo' }))
    responses.push(await callChannel('companyImages:get', { companyId: id }))
    responses.push(await callChannel('companyImages:thumbnails'))

    electronFake.openDialogResult = { canceled: true, filePaths: [] }
    responses.push(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))

    // The refusal branches — their messages cross the boundary verbatim, so
    // they are part of the same property, not a separate concern: a file
    // that is not there, no focused window, no such company, and a file
    // the store refuses (an SVG named as a PNG).
    electronFake.openDialogResult = { canceled: false, filePaths: [join(fileDir, 'not-here.png')] }
    responses.push(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))

    electronFake.focusedWindow = null
    responses.push(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))
    electronFake.focusedWindow = {}

    electronFake.openDialogResult = { canceled: false, filePaths: [chosenPath] }
    responses.push(await callChannel('companyImages:choose', { companyId: 'no-such-company', slot: 'logo' }))

    const svgPath = join(fileDir, 'brand.png')
    writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    electronFake.openDialogResult = { canceled: false, filePaths: [svgPath] }
    responses.push(await callChannel('companyImages:choose', { companyId: id, slot: 'banner' }))

    responses.push(await callChannel('companyImages:clear', { companyId: id, slot: 'logo' }))
    responses.push(await callChannel('companyImages:get', { companyId: id }))
    responses.push(await callChannel('companyImages:thumbnails'))

    const refusals = responses.filter((response) => (response as { ok?: boolean }).ok === false)
    expect(refusals).toHaveLength(4)

    expect(pathLikeStrings(responses)).toEqual([])
  })
})

describe("'backup:run' — a manual copy of the live database", () => {
  let tmpDir: string
  let backupDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-backup-'))
    backupDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-backup-dest-'))
    openDatabase({ userDataDir: tmpDir })
    electronFake.focusedWindow = {}
    electronFake.saveDialogCalls = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
    rmSync(backupDir, { recursive: true, force: true })
  })

  it('writes a self-contained copy where the dialog says, records when, and db:stats reports it', async () => {
    // `backup.folder` set, so the handler never reaches `app.getPath`, which
    // this file's electron fake refuses on purpose.
    expectOk(await callChannel('settings:set', { key: 'backup.folder', value: backupDir }))
    expectOk(await callChannel('companies:create', { name: 'In The Backup' }))
    const destination = join(backupDir, 'copy.db')
    electronFake.saveDialogResult = { canceled: false, filePath: destination }

    const result = expectOk(await callChannel('backup:run'))
    expect(result.outcome).toBe('written')
    if (result.outcome !== 'written') return
    expect(result.path).toBe(destination)
    expect(existsSync(destination)).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    // A real SQLite file, not a copy of the WAL sidecar or an empty touch.
    expect(readFileSync(destination).subarray(0, 15).toString('utf-8')).toBe('SQLite format 3')

    // The dialog opened over the focused window, in the configured folder.
    expect(electronFake.saveDialogCalls).toHaveLength(1)
    expect(String(electronFake.saveDialogCalls[0].defaultPath)).toContain(backupDir)

    const stats = await callChannel('db:stats')
    expect(stats.lastBackupAt).toBe(result.completedAt)
    const entry = await callChannel('settings:get', { key: 'backup.lastRunAt' })
    expect(entry.value).toBe(result.completedAt)
  })

  it('a cancelled dialog is ok: true with outcome cancelled, and records nothing', async () => {
    expectOk(await callChannel('settings:set', { key: 'backup.folder', value: backupDir }))
    electronFake.saveDialogResult = { canceled: true }

    const result = expectOk(await callChannel('backup:run'))
    expect(result).toEqual({ outcome: 'cancelled' })
    expect((await callChannel('db:stats')).lastBackupAt).toBeNull()
  })

  it('refuses the live database as its own destination, inside the envelope, with a path-free message', async () => {
    expectOk(await callChannel('settings:set', { key: 'backup.folder', value: backupDir }))
    electronFake.saveDialogResult = { canceled: false, filePath: join(tmpDir, 'solocrm.db') }

    const result = await callChannel('backup:run')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')
    expect(result.error.message).toContain('live database itself')
    expect(result.error.message).not.toContain(tmpDir)
  })

  it('refuses with no focused window rather than opening a parentless dialog', async () => {
    expectOk(await callChannel('settings:set', { key: 'backup.folder', value: backupDir }))
    electronFake.focusedWindow = null

    const result = await callChannel('backup:run')
    expect(result.ok).toBe(false)
    expect(electronFake.saveDialogCalls).toEqual([])
  })
})
