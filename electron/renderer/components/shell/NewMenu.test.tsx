import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { Company } from '../../../shared/companies'
import { LayerManager } from './LayerManager'
import { NewMenu } from './NewMenu'

// T-260828-27 gives Company/Person/Engagement real content — each a query
// hook (companies:list, at least) plus a mutation — so this suite's harness
// needs the same QueryClientProvider + window.crm stub as any other test
// that mounts a data-fetching component (see lib/query-integration.test.tsx).
afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function renderNewMenu() {
  window.crm = stubCrm()
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LayerManager>
        <NewMenu />
      </LayerManager>
    </QueryClientProvider>
  )
}

describe('NewMenu', () => {
  it('is closed by default', () => {
    renderNewMenu()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on click and does not immediately re-close itself (stopPropagation on the toggle click)', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('toggles closed on a second click of the same button', () => {
    renderNewMenu()
    const toggle = screen.getByRole('button', { name: /New/ })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on an outside click', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the generic sheet layer titled for the item clicked, and closes the menu', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))

    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a differently-titled sheet for Person and Engagement', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Person/ }))
    expect(screen.getByRole('dialog', { name: 'New person' })).toBeTruthy()
  })

  it('opens the log layer for Touch, not the generic sheet', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Touch/ }))
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('returns focus to the New button when the opened sheet closes', () => {
    renderNewMenu()
    const toggle = screen.getByRole('button', { name: /New/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(toggle)
  })

  it('reopening the New menu over an already-open sheet and picking a different item does not swap out or discard the open form (code review)', () => {
    // Sheet has no focus trap (Sheet.tsx's own header), so the New button
    // stays clickable while a sheet is open — clicking it again reopens the
    // menu (the earlier auto-close on the sheet's own open only fires once).
    renderNewMenu()
    const toggle = screen.getByRole('button', { name: /New/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half-typed Co' } })

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: /Person/ }))

    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'New person' })).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Half-typed Co')
  })
})

/** Reads `companies:list` the same way a real Companies view would — used below to prove a save is visible with no manual reload. */
function CompaniesListReader() {
  const { data } = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  return <ul aria-label="companies">{(data ?? []).map((company) => <li key={company.id}>{company.name}</li>)}</ul>
}

describe('saving a company from the New menu', () => {
  it('appears in a live companies list with no manual reload', async () => {
    let companies: readonly Company[] = []
    window.crm = stubCrm({
      'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
      'companies:create': vi.fn(async (input) => {
        const created: Company = {
          id: 'new-co',
          name: input.name,
          kind: null,
          website: null,
          billsDirectly: null,
          billedViaCompanyId: null,
          introducedByCompanyId: null,
          cadenceDays: null,
          lastTouchAt: null,
          budgetNote: null,
          notes: null,
          since: null,
          createdAt: '2026-08-28T00:00:00.000Z',
          updatedAt: '2026-08-28T00:00:00.000Z'
        }
        companies = [...companies, created]
        return { ok: true as const, data: { ok: true as const, data: created } }
      })
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <LayerManager>
          <NewMenu />
          <CompaniesListReader />
        </LayerManager>
      </QueryClientProvider>
    )

    expect(screen.queryByText('Acme Co')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // No refetch call from this test — invalidate.companies() is the only
    // thing that could make the reader's list change.
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeTruthy())
    expect(screen.queryByRole('dialog', { name: 'New company' })).toBeNull()
  })
})
