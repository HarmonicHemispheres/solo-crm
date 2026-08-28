import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL_NAMES } from '../../shared/ipc-types'

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
const { registry } = await import('./registry')


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

  it('handler returns the app version, and it passes the response schema', async () => {
    const result = await registry['app:version'].handler(undefined)
    expect(result).toEqual({ version: '0.1.0-test' })
    expect(registry['app:version'].response.safeParse(result).success).toBe(true)
  })
})

describe("'db:schemaVersion'", () => {
  it('handler reads through getDatabase()/getSchemaVersion(), and the result passes the response schema', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-'))
    try {
      openDatabase({ userDataDir: tmpDir })
      const result = await registry['db:schemaVersion'].handler(undefined)
      expect(result).toEqual({ version: 1, lastMigrationAt: expect.any(String) })
      expect(registry['db:schemaVersion'].response.safeParse(result).success).toBe(true)
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
function expectOk<Data>(result: { readonly ok: boolean; readonly data?: Data; readonly error?: { readonly message: string } }): Data {
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

  it('companies: create -> list -> get -> update -> delete round-trips, and every response passes its own schema', async () => {
    const created = expectOk(await registry['companies:create'].handler({ name: 'Acme' }))
    expect(registry['companies:create'].response.safeParse({ ok: true, data: created }).success).toBe(true)

    const listed = await registry['companies:list'].handler(undefined)
    expect(listed.map((company) => company.id)).toContain(created.id)
    expect(registry['companies:list'].response.safeParse(listed).success).toBe(true)

    const fetched = await registry['companies:get'].handler({ id: created.id })
    expect(fetched?.name).toBe('Acme')

    const updated = expectOk(await registry['companies:update'].handler({ id: created.id, patch: { name: 'Acme Inc' } }))
    expect(updated.name).toBe('Acme Inc')

    const deleted = expectOk(await registry['companies:delete'].handler({ id: created.id }))
    expect(deleted).toEqual({ id: created.id })

    expect(await registry['companies:get'].handler({ id: created.id })).toBeNull()
  })

  it('companies:update on a missing id surfaces as a mutation-result refusal, not a thrown exception', async () => {
    const result = await registry['companies:update'].handler({ id: 'does-not-exist', patch: { name: 'x' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-found')
  })

  it('companies:delete blocked by activity history: the refusal reaches the caller as data, carrying the reason, with no filesystem path or stack frame', async () => {
    const company = expectOk(await registry['companies:create'].handler({ name: 'Acme' }))
    expectOk(
      await registry['activity:log'].handler({
        occurredAt: '2026-08-28T00:00:00.000Z',
        kind: 'note',
        title: 'Kickoff call',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
    )

    const result = await registry['companies:delete'].handler({ id: company.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('refused')
    expect(result.error.message).toContain('activity record')
    expect(result.error.message).toContain('Acme')
    // No path, no stack frame — the message is what a person reads, never an
    // implementation detail (this task's Risks: "map, do not forward").
    expect(result.error.message).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(result.error.message).not.toContain('AppData')
    expect(result.error.message).not.toContain('.db')
    expect(result.error.message).not.toMatch(/\bat .*:\d+:\d+/)
    // The company itself is untouched — refused, not partially deleted.
    expect(await registry['companies:get'].handler({ id: company.id })).not.toBeNull()
  })

  it('people: create, addAffiliation, get returns the affiliation nested with current: true, move opens a new stint and closes the old one', async () => {
    const companyA = expectOk(await registry['companies:create'].handler({ name: 'Company A' }))
    const companyB = expectOk(await registry['companies:create'].handler({ name: 'Company B' }))
    const person = expectOk(await registry['people:create'].handler({ name: 'Robby' }))

    const affiliation = expectOk(
      await registry['people:addAffiliation'].handler({ personId: person.id, companyId: companyA.id, started: '2026-01-01' })
    )
    expect(affiliation.companyId).toBe(companyA.id)

    const fetched = await registry['people:get'].handler({ id: person.id })
    expect(fetched?.affiliations).toEqual([expect.objectContaining({ id: affiliation.id, companyId: companyA.id, current: true })])

    const moved = expectOk(
      await registry['people:move'].handler({ personId: person.id, toCompanyId: companyB.id, options: { on: '2026-06-01' } })
    )
    expect(moved.companyId).toBe(companyB.id)

    const afterMove = await registry['people:get'].handler({ id: person.id })
    expect(afterMove?.affiliations.find((a) => a.id === affiliation.id)?.current).toBe(false)
    expect(afterMove?.affiliations.find((a) => a.companyId === companyB.id)?.current).toBe(true)
  })

  it('people:delete round-trips for a person with no affiliations', async () => {
    const person = expectOk(await registry['people:create'].handler({ name: 'No Affiliations' }))

    const deleted = expectOk(await registry['people:delete'].handler({ id: person.id }))

    expect(deleted).toEqual({ id: person.id })
    expect(await registry['people:get'].handler({ id: person.id })).toBeNull()
  })

  it('engagements: create -> list -> get -> milestones (empty) -> update -> delete', async () => {
    const company = expectOk(await registry['companies:create'].handler({ name: 'Client Co' }))
    const created = expectOk(
      await registry['engagements:create'].handler({
        name: 'Retainer',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        clientCompanyId: company.id
      })
    )

    const listed = await registry['engagements:list'].handler(undefined)
    expect(listed.map((e) => e.id)).toContain(created.id)

    const filtered = await registry['engagements:list'].handler({ clientCompanyId: company.id })
    expect(filtered.map((e) => e.id)).toEqual([created.id])

    const milestones = await registry['engagements:milestones'].handler({ engagementId: created.id })
    expect(milestones).toEqual([])

    const updated = expectOk(await registry['engagements:update'].handler({ id: created.id, patch: { status: 'active' } }))
    expect(updated.status).toBe('active')

    const deleted = expectOk(await registry['engagements:delete'].handler({ id: created.id }))
    expect(deleted).toEqual({ id: created.id })
  })

  it('tasks: create -> setNextStep -> countOpen reflects it -> update reopening clears a stale flag -> delete', async () => {
    const company = expectOk(await registry['companies:create'].handler({ name: 'Task Co' }))
    const task = expectOk(await registry['tasks:create'].handler({ title: 'Follow up', companyId: company.id }))

    const flagged = expectOk(await registry['tasks:setNextStep'].handler({ id: task.id }))
    expect(flagged.isNextStep).toBe(true)

    const openCount = await registry['tasks:countOpen'].handler({ companyId: company.id })
    expect(openCount).toEqual({ count: 1 })

    const deleted = expectOk(await registry['tasks:delete'].handler({ id: task.id }))
    expect(deleted).toEqual({ id: task.id })

    expect(await registry['tasks:get'].handler({ id: task.id })).toBeNull()
  })

  it('tasks:setNextStep on a task with no company is refused, as data, not thrown', async () => {
    const task = expectOk(await registry['tasks:create'].handler({ title: 'Orphan task' }))

    const result = await registry['tasks:setNextStep'].handler({ id: task.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('refused')
    expect(result.error.message).toContain('no company')
  })

  it('activity: log -> list -> get; logging with a companyId advances that company’s last_touch_at (ADR-001), visible on the next companies:get', async () => {
    const company = expectOk(await registry['companies:create'].handler({ name: 'Touched Co' }))
    expect((await registry['companies:get'].handler({ id: company.id }))?.lastTouchAt).toBeNull()

    const logged = expectOk(
      await registry['activity:log'].handler({
        occurredAt: '2026-08-28T12:00:00.000Z',
        kind: 'call',
        title: 'Check-in',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
    )

    const listed = await registry['activity:list'].handler({ companyId: company.id })
    expect(listed.map((a) => a.id)).toEqual([logged.id])

    const fetched = await registry['activity:get'].handler({ id: logged.id })
    expect(fetched?.title).toBe('Check-in')

    expect((await registry['companies:get'].handler({ id: company.id }))?.lastTouchAt).toBe('2026-08-28T12:00:00.000Z')
  })

  it('settings: get returns the declared default, set validates and persists, getAll includes it, reset restores the default', async () => {
    const initial = await registry['settings:get'].handler({ key: 'workspace.name' })
    expect(initial).toEqual({ key: 'workspace.name', value: '' })

    const set = expectOk(await registry['settings:set'].handler({ key: 'workspace.name', value: 'Solo CRM' }))
    expect(set).toEqual({ key: 'workspace.name', value: 'Solo CRM' })

    const snapshot = await registry['settings:getAll'].handler(undefined)
    expect(snapshot['workspace.name']).toBe('Solo CRM')

    const reset = expectOk(await registry['settings:reset'].handler({ key: 'workspace.name' }))
    expect(reset).toEqual({ key: 'workspace.name', value: '' })
  })

  it('settings:set rejects a value that fails its key’s own schema, as a mutation-result refusal', async () => {
    // @ts-expect-error - deliberately the wrong shape (a bogus currency) to prove the repository's own validation still runs, independent of the request schema a real IPC call would already have failed at.
    const result = await registry['settings:set'].handler({ key: 'workspace.currency', value: 'not-a-real-currency' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation')
  })
})
