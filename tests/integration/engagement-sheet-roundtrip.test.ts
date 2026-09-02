// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { closeDatabase, getDatabase, openDatabase } from '../../electron/main/db/connection'
import { createCompany, listCompanies } from '../../electron/main/db/repositories/companies'
import { createEngagement, getEngagementWithOffering } from '../../electron/main/db/repositories/engagements'
import { createOffering, listOfferings } from '../../electron/main/db/repositories/offerings'
import { RepositoryError } from '../../electron/main/db/repositories/errors'
import { callCrm } from '../../electron/renderer/lib/ipc'
import { createQueryClient } from '../../electron/renderer/lib/query-client'
import { stubCrm } from '../../electron/renderer/lib/test-support/stub-crm'
import { EngagementSheet } from '../../electron/renderer/components/sheets/EngagementSheet'

/**
 * `EngagementSheet` against a real, migrated database — the one test in the
 * project where "what the form sent" is not the assertion.
 *
 * T-260828-27's criteria 1 and 6 asked for the row to be read back over IPC
 * after a save, field for field, and for `ends_on` to be verified *on the raw
 * column*. What shipped instead asserted an outbound payload against a
 * `vi.fn()` that accepts anything — a stub cannot reject a payload the
 * repository would reject, cannot tell `null` from an absent key, and cannot
 * show what SQLite actually stored. So this file wires `window.crm`'s
 * `engagements:*` channels to the real repository over a real migrated
 * database (the same `openDatabase({ userDataDir })` discipline
 * `engagements.test.ts` uses), fills the form, and then looks at the columns.
 *
 * The engagement sheet is the one that earns this: it is the form whose
 * payload is a discriminated union, and the only one where a NULL means
 * something specific — `ends_on: null` is *rolling*, not "not yet decided"
 * (electron/shared/engagements.ts).
 *
 * **Why it lives in `tests/` rather than beside the sheet.** It is the one
 * test that is renderer code *and* main-process code at once, and every
 * boundary in this project is set up to forbid exactly that inside
 * `electron/renderer/**`: `local/no-renderer-node-access` rejects a renderer
 * file that imports `node:fs` or reaches into `electron/main`,
 * tsconfig.web.json ships no Node types, and tsconfig.node.json has neither
 * DOM nor JSX. Those rules are about the renderer *bundle*, and they are
 * right — this file would be a defect if it sat in that tree, and adding it
 * to an ignore list would blunt the rule for everything around it. So it sits
 * outside both trees instead: no lint carve-out, nothing relaxed. It is
 * collected by vitest's `catch-all` project (vitest.config.ts, which exists
 * for exactly this — a test file outside the three named trees), runs under
 * jsdom via the docblock above, and typechecks under tsconfig.integration.json
 * (the web options plus Node types) as `npm run typecheck`'s third pass.
 *
 * `createElement` rather than JSX, hence `.test.ts`: Vite picks a file's JSX
 * transform from the tsconfig that includes it, and no tsconfig.json above
 * this directory sets one, so esbuild falls back to the classic transform and
 * a JSX render dies on `React is not defined`. Two elements deep is a small
 * price.
 *
 * `@testing-library/react`'s cleanup is wired by hand here for the same
 * reason `electron/renderer/test-setup.ts` does it: this project has no
 * `globals: true`, and the catch-all project loads no setup file.
 */

let tempDataRoot: string | null = null

function openTemporaryDatabase() {
  tempDataRoot = mkdtempSync(join(tmpdir(), 'solo-crm-engagement-sheet-'))
  openDatabase({ userDataDir: tempDataRoot })
  return getDatabase()
}

afterEach(() => {
  cleanup()
  closeDatabase()
  if (tempDataRoot) rmSync(tempDataRoot, { recursive: true, force: true })
  tempDataRoot = null
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** The `{ ok: false }` half of `MutationResult` — how a repository refusal reaches a renderer (electron/shared/ipc-types.ts). */
function asMutationResult<T>(run: () => T) {
  try {
    return { ok: true as const, data: { ok: true as const, data: run() } }
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { ok: true as const, data: { ok: false as const, error: { code: error.code, message: error.message } } }
    }
    throw error
  }
}

/** `window.crm`, backed by the real repositories against `db` rather than by a stub that accepts anything. */
function bridgeToDatabase() {
  const db = getDatabase()
  window.crm = stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: listCompanies(db) })),
    'offerings:list': vi.fn(async (filter?: Parameters<typeof listOfferings>[1]) => ({ ok: true as const, data: listOfferings(db, filter) })),
    'engagements:create': vi.fn(async (input: unknown) => asMutationResult(() => createEngagement(db, input))),
    'engagements:get': vi.fn(async ({ id }: { id: string }) => ({ ok: true as const, data: getEngagementWithOffering(db, id) }))
  })
}

function renderSheet(onClose = vi.fn()) {
  render(
    createElement(QueryClientProvider, { client: createQueryClient() }, createElement(EngagementSheet, { onClose, target: { mode: 'create' } }))
  )
  return { onClose }
}

describe('EngagementSheet against a real migrated database', () => {
  it('stores every column the form filled in, and leaves ends_on NULL when "Ends" was never touched', async () => {
    const db = openTemporaryDatabase()
    const client = createCompany(db, { name: 'Rinvii' })
    bridgeToDatabase()
    const { onClose } = renderSheet()

    const billedTo = await screen.findByLabelText('Billed to')
    await waitFor(() => expect(billedTo.textContent).toContain('Rinvii'))
    fireEvent.change(billedTo, { target: { value: client.id } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rinvii retainer' } })
    // A retainer defaults to a flat monthly amount (migration 0008); this one
    // is priced the other way, so the basis is chosen before the pair it
    // reveals can be filled in.
    fireEvent.click(screen.getByRole('button', { name: 'Hourly' }))
    fireEvent.change(screen.getByLabelText('Hours per month'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Hourly rate'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-03-01' } })
    // "Ends" is deliberately left empty — rolling work.
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    // The raw columns, straight out of SQLite — not the repository's mapping
    // of them, and not the payload the form sent.
    const row = db
      .prepare(
        `SELECT name, billing_company_id, client_company_id, billing_model, status,
                started_on, ends_on, retainer_basis, monthly_amount_cents, hours_included,
                contract_value_cents, hourly_rate_cents
         FROM engagements`
      )
      .get() as Record<string, unknown>
    expect(row.name).toBe('Rinvii retainer')
    expect(row.billing_company_id).toBe(client.id)
    // "Work is for" mirrored "Billed to" and was never edited away from it.
    expect(row.client_company_id).toBe(client.id)
    expect(row.billing_model).toBe('retainer')
    expect(row.status).toBe('active')
    expect(row.started_on).toBe('2026-03-01')
    // The point of the whole file: a real NULL, not '' and not a sentinel.
    expect(row.ends_on).toBeNull()
    // The hours basis, and both of the columns that price it.
    expect(row.retainer_basis).toBe('hours')
    expect(row.hours_included).toBe(12)
    expect(row.hourly_rate_cents).toBe(15_000)
    // The other basis's column stays NULL — the basis says which pair is
    // live, and a row carrying both would forecast twice.
    expect(row.monthly_amount_cents).toBeNull()
    // Columns belonging to the models this one is not.
    expect(row.contract_value_cents).toBeNull()

    // And field for field as a caller reads it back over IPC.
    const id = (db.prepare('SELECT id FROM engagements').get() as { id: string }).id
    const readBack = await callCrm('engagements:get', { id })
    expect(readBack).toMatchObject({
      id,
      name: 'Rinvii retainer',
      billingCompanyId: client.id,
      clientCompanyId: client.id,
      billingModel: 'retainer',
      status: 'active',
      startedOn: '2026-03-01',
      endsOn: null,
      retainerBasis: 'hours',
      monthlyAmountCents: null,
      hoursIncluded: 12,
      hourlyRateCents: 15_000,
      contractValueCents: null,
      estimatedHours: null,
      notToExceedCents: null
    })
  })

  it('stores a fixed-scope contract value as integer cents, and only that model’s columns', async () => {
    const db = openTemporaryDatabase()
    bridgeToDatabase()
    const { onClose } = renderSheet()

    await screen.findByLabelText('Billed to')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fixed scope SOW' } })
    // Typed under the retainer model first: switching models must not carry
    // the previous model's column into the row.
    fireEvent.change(screen.getByLabelText('Amount per month'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '28500.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const row = db
      .prepare(
        'SELECT billing_model, contract_value_cents, retainer_basis, monthly_amount_cents, hours_included, ends_on FROM engagements'
      )
      .get() as Record<string, unknown>
    expect(row.billing_model).toBe('fixed')
    // CONVENTIONS.md: money is integer cents in the column, never a float.
    expect(row.contract_value_cents).toBe(2_850_050)
    expect(row.hours_included).toBeNull()
    // The retainer's own two columns go the same way as its hours — a fixed
    // scope that remembered a monthly fee would forecast as both.
    expect(row.retainer_basis).toBeNull()
    expect(row.monthly_amount_cents).toBeNull()
    expect(row.ends_on).toBeNull()
  })

  it('copies the chosen offering’s rate into agreed_rate_cents and stores its current version id', async () => {
    const db = openTemporaryDatabase()
    // The acceptance list's figure: an offering priced at $3,500. `versions`
    // is written in the same transaction as the offering, so this is the
    // version the picker will resolve to.
    const offering = createOffering(db, { name: 'Advisory retainer', rateCents: 350_000, billingModel: 'retainer', unit: 'mo' })
    bridgeToDatabase()
    const { onClose } = renderSheet()

    const soldAs = await screen.findByLabelText('Sold as')
    await waitFor(() => expect(soldAs.textContent).toContain('Advisory retainer'))
    // The price is on the option, because picking it is what copies the price.
    expect(soldAs.textContent).toContain('$3500.00/mo')
    fireEvent.change(soldAs, { target: { value: offering.id } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 advisory' } })
    // Left on the default flat-amount basis: this test is about
    // `agreed_rate_cents` being copied from the offering, and the retainer's
    // own price is beside the point. They are different columns for a reason
    // — see electron/shared/engagements.ts on the snapshot.
    fireEvent.change(screen.getByLabelText('Amount per month'), { target: { value: '3500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const row = db.prepare('SELECT id, offering_version_id, agreed_rate_cents FROM engagements').get() as Record<string, unknown>
    expect(row.agreed_rate_cents).toBe(350_000)
    expect(row.offering_version_id).toBe(offering.versions[0].id)

    // The catalogue moves; the signed engagement does not. This is the whole
    // of P3-03 — a copy, not a link — checked on the raw column after the
    // price it was copied from has changed.
    db.prepare('UPDATE offering_versions SET rate_cents = ? WHERE id = ?').run(500_000, offering.versions[0].id)
    const after = db.prepare('SELECT agreed_rate_cents FROM engagements').get() as { agreed_rate_cents: number | null }
    expect(after.agreed_rate_cents).toBe(350_000)

    // And the read a card labels itself from names the offering, not a price.
    const readBack = await callCrm('engagements:get', { id: row.id as string })
    expect(readBack).toMatchObject({ offeringId: offering.id, offeringName: 'Advisory retainer' })
  })

  it('stores NULL for both the offering and the rate when nothing was sold from', async () => {
    const db = openTemporaryDatabase()
    createOffering(db, { name: 'Advisory retainer', rateCents: 350_000 })
    bridgeToDatabase()
    const { onClose } = renderSheet()

    // The picker is available and deliberately left at "— none —".
    const soldAs = await screen.findByLabelText('Sold as')
    await waitFor(() => expect(soldAs.textContent).toContain('Advisory retainer'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsold work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const row = db.prepare('SELECT offering_version_id, agreed_rate_cents FROM engagements').get() as Record<string, unknown>
    expect(row.offering_version_id).toBeNull()
    expect(row.agreed_rate_cents).toBeNull()
  })

  it('writes no row at all when the repository refuses the insert, and keeps the sheet open saying so', async () => {
    const db = openTemporaryDatabase()
    const client = createCompany(db, { name: 'Rinvii' })
    bridgeToDatabase()
    const { onClose } = renderSheet()

    const billedTo = await screen.findByLabelText('Billed to')
    await waitFor(() => expect(billedTo.textContent).toContain('Rinvii'))
    fireEvent.change(billedTo, { target: { value: client.id } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Doomed' } })

    // The company goes away between picking it and submitting — the shape of
    // every stale-reference failure. A `vi.fn()` stub cannot produce this at
    // all: only the real database has the foreign key.
    db.prepare('DELETE FROM companies WHERE id = ?').run(client.id)
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toBe('')
    expect(onClose).not.toHaveBeenCalled()
    expect((db.prepare('SELECT COUNT(*) AS n FROM engagements').get() as { n: number }).n).toBe(0)
    // Nothing typed was lost.
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Doomed')
  })
})
