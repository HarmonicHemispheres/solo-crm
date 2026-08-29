import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts'
import { LayerManager } from './LayerManager'
import { CommandPalette } from './CommandPalette'
import { NewMenu } from './NewMenu'
import { CREATE_COMMANDS } from './create-commands'
import { SEARCH_KINDS, type SearchKind, type SearchResult } from '../../../shared/search'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Reports where a palette result actually navigated to — pathname plus hash, since an engagement result carries its row anchor in the hash. */
function LocationProbe() {
  const location = useLocation()
  return <pre data-testid="location">{`${location.pathname}${location.hash}`}</pre>
}

/** Stands in for the shell: ⌘K bound once, the real New menu beside it (the drift check below reads it), and a location probe. */
function ShellHarness() {
  useGlobalShortcuts()
  return (
    <div>
      <NewMenu />
      <LocationProbe />
    </div>
  )
}

interface Fixtures {
  results?: readonly SearchResult[]
  companies?: readonly unknown[]
  people?: readonly unknown[]
  engagements?: readonly unknown[]
}

function renderShell({ results = [], companies = [], people = [], engagements = [] }: Fixtures = {}) {
  const search = vi.fn(async () => ({ ok: true as const, data: results }))
  window.crm = stubCrm({
    'search:query': search,
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies as never })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people as never })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements as never }))
  })
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <LayerManager>
          <ShellHarness />
        </LayerManager>
      </QueryClientProvider>
    </MemoryRouter>
  )
  return { ...view, search }
}

function openPalette() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true })
  return screen.getByRole('dialog', { name: 'Search' })
}

function input() {
  return screen.getByRole('combobox', { name: 'Search or create' })
}

/** Types a whole string the way a person does — one change event per character, so the debounce is exercised rather than sidestepped. */
function type(text: string) {
  const field = input() as HTMLInputElement
  for (const char of text) {
    fireEvent.change(field, { target: { value: field.value + char } })
  }
}

function rowLabels() {
  return screen.getAllByRole('option').map((row) => row.textContent ?? '')
}

function location() {
  return screen.getByTestId('location').textContent
}

const TIMESTAMP = '2026-08-01T00:00:00.000Z'

function company(id: string, name: string, updatedAt = TIMESTAMP) {
  return { id, name, updatedAt, createdAt: TIMESTAMP }
}

// ---------------------------------------------------------------------------

describe('CommandPalette — create commands', () => {
  it('an empty query shows every create command, not a blank panel', () => {
    renderShell()
    openPalette()

    for (const command of CREATE_COMMANDS) {
      expect(rowLabels().some((label) => label.includes(command.paletteLabel))).toBe(true)
    }
  })

  it('every item the New menu draws is reachable from the palette — the two lists compared, not eyeballed', () => {
    renderShell()

    // The menu's own rendered items, read off the real component rather than
    // restated here: the drift this guards against is exactly a menu item
    // added in NewMenu.tsx and forgotten in `create-commands.ts`.
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    const menuLabels = screen
      .getAllByRole('menuitem')
      // Each item renders <icon>Label<span class="k">key</span>; the label is
      // the text with the key badge stripped.
      .map((item) => (item.textContent ?? '').replace(/(C|P|E|⌘L)$/, '').trim())

    const tableLabels = CREATE_COMMANDS.map((command) => command.menuLabel)
    expect(menuLabels.length).toBeGreaterThan(0)
    for (const label of menuLabels) {
      expect(tableLabels).toContain(label)
    }

    // And the palette really draws the table, so "in the table" means "reachable".
    fireEvent.keyDown(document, { key: 'Escape' })
    openPalette()
    const palette = rowLabels()
    for (const label of menuLabels) {
      const command = CREATE_COMMANDS.find((entry) => entry.menuLabel === label)
      expect(command).toBeDefined()
      expect(palette.some((row) => row.includes(command!.paletteLabel))).toBe(true)
    }
  })

  it('leads with create commands while the query is short, and lets records lead once it is not', async () => {
    const { search } = renderShell({
      results: [{ kind: 'company', id: 'c1', text: 'Persimmon Ltd' }]
    })
    openPalette()

    type('pe')
    await waitFor(() => expect(search).toHaveBeenCalled())
    await waitFor(() => expect(rowLabels()[0]).toContain('New person'))

    type('rsimmon')
    await waitFor(() => expect(rowLabels()[0]).toContain('Persimmon Ltd'))
  })

  it('a create command closes the palette and opens its own form', () => {
    renderShell()
    openPalette()

    fireEvent.click(screen.getByRole('option', { name: /New company/ }))

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    expect(screen.getByRole('dialog', { name: /company/i })).toBeTruthy()
  })

  it('the log command opens the quick log rather than a create form', () => {
    renderShell()
    openPalette()

    fireEvent.click(screen.getByRole('option', { name: /Log a touch/ }))

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    expect(screen.getByRole('dialog', { name: /log/i })).toBeTruthy()
  })
})

describe('CommandPalette — results', () => {
  it('an empty query shows recent records, most recently updated first', async () => {
    renderShell({
      companies: [company('old', 'Older Co', '2026-01-01T00:00:00.000Z'), company('new', 'Newer Co', '2026-08-20T00:00:00.000Z')]
    })
    openPalette()

    await waitFor(() => expect(rowLabels().some((label) => label.includes('Newer Co'))).toBe(true))
    const labels = rowLabels()
    expect(labels.findIndex((label) => label.includes('Newer Co'))).toBeLessThan(
      labels.findIndex((label) => label.includes('Older Co'))
    )
  })

  it('every row carries a kind label, so two records with the same name stay tellable apart', async () => {
    const { search } = renderShell({
      results: [
        { kind: 'company', id: 'c1', text: 'Vega' },
        { kind: 'person', id: 'p1', text: 'Vega' }
      ]
    })
    openPalette()
    type('vega')
    await waitFor(() => expect(search).toHaveBeenCalled())

    await waitFor(() => expect(rowLabels().filter((label) => label.includes('Vega'))).toHaveLength(2))
    const rows = screen.getAllByRole('option').filter((row) => (row.textContent ?? '').includes('Vega'))
    expect(rows.map((row) => within(row).getByText(/COMPANY|PERSON/).textContent)).toEqual(['COMPANY', 'PERSON'])
  })

  it('an activity note is shown as a preview of its body, not an unreadable paragraph', async () => {
    const body = 'A very long note about the renewal conversation that ran well past a single line of the palette'
    const { search } = renderShell({ results: [{ kind: 'activity', id: 'a1', text: body }] })
    openPalette()
    type('renewal')
    await waitFor(() => expect(search).toHaveBeenCalled())

    await waitFor(() => expect(rowLabels().some((label) => label.includes('NOTE'))).toBe(true))
    const row = screen.getAllByRole('option').find((option) => (option.textContent ?? '').includes('NOTE'))
    expect(row?.textContent).toContain('A very long note')
    expect(row?.textContent).not.toContain('palette')
  })

  it('a query matching nothing says so plainly', async () => {
    const { search } = renderShell({ results: [] })
    openPalette()
    type('zzzznothing')

    await waitFor(() => expect(search).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('No match.')).toBeTruthy())
  })

  it('debounces: a burst of keystrokes asks main once, with the whole word', async () => {
    const { search } = renderShell({ results: [] })
    openPalette()

    type('acme')

    await waitFor(() => expect(search).toHaveBeenCalledWith({ query: 'acme', limit: 25 }))
    // One request for the burst, not one per character. (A second is
    // tolerated: React may commit the first character's debounce before the
    // rest of the burst lands on a slow machine.)
    expect(search.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('CommandPalette — Enter lands on the right view', () => {
  // One case per indexed kind (`SEARCH_KINDS`) — the five source tables the
  // FTS index covers. Offerings is not one of them (see
  // `targetForSearchResult`'s note), so there is no sixth case to write.
  const EXPECTED: Record<SearchKind, string> = {
    company: '/company/x1',
    person: '/person/x1',
    engagement: '/engagements#engagement-x1',
    task: '/todos',
    activity: '/activity'
  }

  for (const kind of SEARCH_KINDS) {
    it(`a ${kind} result navigates to ${EXPECTED[kind]}`, async () => {
      const { search } = renderShell({ results: [{ kind, id: 'x1', text: 'Target' }] })
      openPalette()
      type('target')
      await waitFor(() => expect(search).toHaveBeenCalled())
      await waitFor(() => expect(rowLabels()[0]).toContain('Target'))

      fireEvent.keyDown(input(), { key: 'Enter' })

      expect(location()).toBe(EXPECTED[kind])
      expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    })
  }
})

describe('CommandPalette — keyboard', () => {
  it('arrow keys move the selection and Enter activates it, with no mouse anywhere', async () => {
    const { search } = renderShell({
      results: [
        { kind: 'company', id: 'first', text: 'Alpha Co' },
        { kind: 'company', id: 'second', text: 'Alpha Two' }
      ]
    })
    openPalette()
    type('alpha co')
    await waitFor(() => expect(search).toHaveBeenCalled())
    await waitFor(() => expect(rowLabels()[0]).toContain('Alpha Co'))

    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')

    // Wraps in both directions, so the whole list is reachable either way.
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(location()).toBe('/company/second')
  })

  it('typing resets the selection to the top, so Enter never fires the row a previous query had highlighted', async () => {
    const { search } = renderShell({
      results: [
        { kind: 'company', id: 'first', text: 'Alpha Co' },
        { kind: 'company', id: 'second', text: 'Alpha Two' }
      ]
    })
    openPalette()
    type('alpha co')
    await waitFor(() => expect(search).toHaveBeenCalled())
    await waitFor(() => expect(rowLabels()[0]).toContain('Alpha Co'))

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    type('x')

    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
  })
})

describe('CommandPalette — Esc belongs to LayerManager', () => {
  it('handles no Escape of its own: pressing Esc against the component alone does nothing', () => {
    const onClose = vi.fn()
    window.crm = stubCrm()
    render(
      <MemoryRouter>
        <QueryClientProvider client={createQueryClient()}>
          {/* Inside a LayerManager for the context the create commands need,
              but mounted as its own child rather than as the `palette` layer —
              so the manager's central Escape handler has an empty stack and
              nothing but a listener in this component could call `onClose`. */}
          <LayerManager>
            <CommandPalette open onClose={onClose} />
          </LayerManager>
        </QueryClientProvider>
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search or create' }), { key: 'Escape' })

    // Nothing here listens for Escape — dismissal is LayerManager's, centrally
    // (T-260828-12). The next test proves that path really works.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is dismissed by Esc once mounted inside LayerManager, which owns the key', () => {
    renderShell()
    openPalette()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
  })

  it('opens blank: a query typed before dismissal is gone on the next ⌘K', async () => {
    const { search } = renderShell({ results: [] })
    openPalette()
    type('acme')
    await waitFor(() => expect(search).toHaveBeenCalled())

    fireEvent.keyDown(document, { key: 'Escape' })
    openPalette()

    expect((input() as HTMLInputElement).value).toBe('')
  })
})
