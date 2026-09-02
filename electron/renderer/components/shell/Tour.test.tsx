import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { LayerManager } from './LayerManager'
import { TOUR_STEPS } from './tour-steps'
import { AppRoutes } from '../../routes'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { Company } from '../../../shared/companies'
import type { SettingEntry } from '../../../shared/ipc-types'
import type { SettingsSnapshot } from '../../../shared/settings'

/**
 * The first-run tour (T-260829-15). Everything here renders the real shell
 * through `AppRoutes` rather than the `Tour` component alone: the two things
 * most worth pinning are *when* the overlay appears at boot and *which*
 * layer Escape closes, and neither is observable from a component mounted by
 * hand with its conditions already decided.
 */

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function makeCompany(id: string, name: string): Company {
  return {
    id,
    name,
    kind: 'client',
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: 14,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="pathname">{location.pathname}</span>
}

interface Harness {
  /** Every `settings:set` the run recorded, in order. */
  readonly sets: SettingEntry[]
  pathname(): string
}

/**
 * Boots the app at `/` with a workspace described by the two conditions the
 * overlay reads. `settings:set` is stateful, the way the real repository is:
 * a write lands in the same snapshot the next `getAll` answers with, so a
 * test can assert what a restart would see and not only what was called.
 */
function boot({ tourSeen = false, companies = [] as Company[], path = '/' } = {}): Harness {
  const snapshot = { ...BASE_SNAPSHOT, 'onboarding.tourSeen': tourSeen }
  const sets: SettingEntry[] = []

  window.crm = stubCrm({
    'settings:getAll': vi.fn(async () => ({ ok: true as const, data: { ...snapshot } })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      sets.push(entry)
      // @ts-expect-error - writing a dynamically-keyed value back onto the typed snapshot.
      snapshot[entry.key] = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    }),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies }))
  })

  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LayerManager>
          <AppRoutes />
          <LocationProbe />
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )

  return { sets, pathname: () => screen.getByTestId('pathname').textContent ?? '' }
}

const BASE_SNAPSHOT: SettingsSnapshot = {
  // Named, not blank, so `settledSettings()` below has something in the DOM
  // to wait on: the rail's brand block reads this key, and it says "Solo CRM"
  // until the snapshot arrives.
  'workspace.name': 'Settled Labs',
  'workspace.operator': '',
  'workspace.currency': 'USD',
  'workspace.fiscalYearStartMonth': 1,
  'cadence.defaultDays.client': 7,
  'cadence.defaultDays.end_client': 14,
  'cadence.defaultDays.prospect': 14,
  'cadence.defaultDays.advisory': 21,
  'cadence.defaultDays.channel': 30,
  'integrations.stripe.enabled': true,
  'integrations.googleCalendar.enabled': true,
  'integrations.gmail.enabled': false,
  'backup.enabled': true,
  'backup.folder': '',
  'appearance.motion': true,
  'appearance.density': 'comfortable',
  'view.companies.mode': 'card',
  'view.people.mode': 'card',
  'view.todos.groupBy': 'date',
  'view.data.snippets': [],
  'onboarding.tourSeen': false
}

function tour(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Guided tour' })
}

/**
 * Waits until the settings snapshot has actually rendered, so that a "no
 * dialog" assertion after it is a decision the overlay made and not a render
 * that had not happened yet. The rail's brand block is the signal: it is
 * named from `workspace.name`, so the moment it reads "Settled Labs" the
 * snapshot is in the tree and the auto-open effect has had its answer.
 */
async function settledSettings(): Promise<void> {
  await screen.findByRole('img', { name: 'Settled Labs' })
}

async function walkToLastStep(): Promise<HTMLElement> {
  for (let step = 1; step < TOUR_STEPS.length; step += 1) {
    fireEvent.click(within(tour()).getByRole('button', { name: 'Next' }))
  }
  return tour()
}

describe('the first-run tour', () => {
  // ---------------------------------------------------------------------
  // When it appears at all — the three conditions, one test each.
  // ---------------------------------------------------------------------

  it('opens on first paint when the flag is unset and the workspace holds no companies', async () => {
    boot({ tourSeen: false, companies: [] })
    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })
    expect(within(dialog).getByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('does not open when the flag is already true', async () => {
    boot({ tourSeen: true, companies: [] })
    await settledSettings()
    expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull()
  })

  it('does not open on a populated workspace, even with the flag unset — an update from 0.3.1 gets no overlay', async () => {
    // Booted on `/companies` so the three rows rendering is proof that
    // `companies:list` resolved: "no overlay" then means the condition was
    // evaluated and said no, not that the answer had not arrived.
    boot({
      tourSeen: false,
      companies: [makeCompany('a', 'EZDeploy'), makeCompany('b', 'Rinvii'), makeCompany('c', 'Sudo Systems')],
      path: '/companies'
    })
    await settledSettings()
    await screen.findByText('EZDeploy')
    await screen.findByText('Sudo Systems')
    expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull()
  })

  // ---------------------------------------------------------------------
  // The sequence.
  // ---------------------------------------------------------------------

  it('counts 1 of 5 through 5 of 5, disables Back on the first step and turns Next into Finish on the last', async () => {
    boot()
    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })

    expect(within(dialog).getByText('1 of 5')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true)
    expect(within(dialog).queryByRole('button', { name: 'Finish' })).toBeNull()

    for (let step = 2; step <= TOUR_STEPS.length; step += 1) {
      fireEvent.click(within(tour()).getByRole('button', { name: 'Next' }))
      expect(within(tour()).getByText(`${step} of ${TOUR_STEPS.length}`)).toBeTruthy()
      expect(within(tour()).getByRole('heading', { name: TOUR_STEPS[step - 1].title })).toBeTruthy()
      expect(within(tour()).getByRole('button', { name: 'Back' })).toHaveProperty('disabled', false)
    }

    expect(within(tour()).getByRole('button', { name: 'Finish' })).toBeTruthy()
    expect(within(tour()).queryByRole('button', { name: 'Next' })).toBeNull()

    // And Back walks it home again.
    fireEvent.click(within(tour()).getByRole('button', { name: 'Back' }))
    expect(within(tour()).getByText('4 of 5')).toBeTruthy()
  })

  it('offers Skip tour on every step', async () => {
    boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })
    for (let step = 1; step <= TOUR_STEPS.length; step += 1) {
      expect(within(tour()).getByRole('button', { name: 'Skip tour' })).toBeTruthy()
      if (step < TOUR_STEPS.length) fireEvent.click(within(tour()).getByRole('button', { name: 'Next' }))
    }
  })

  // ---------------------------------------------------------------------
  // The flag. Asserted on the recorded IPC call, not on the overlay merely
  // unmounting — a tour that closes without writing looks identical until
  // the next restart, which is when it would nag.
  // ---------------------------------------------------------------------

  it('Skip tour on step 1 closes the overlay and writes onboarding.tourSeen through settings:set', async () => {
    const harness = boot()
    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip tour' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    await waitFor(() =>
      expect(harness.sets).toContainEqual({ key: 'onboarding.tourSeen', value: true })
    )
  })

  it('Finish on step 5 writes the same flag — a skip and a finish are indistinguishable afterwards', async () => {
    const harness = boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })
    const dialog = await walkToLastStep()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    await waitFor(() =>
      expect(harness.sets).toContainEqual({ key: 'onboarding.tourSeen', value: true })
    )
  })

  it('Escape closes it and writes the flag', async () => {
    const harness = boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    await waitFor(() =>
      expect(harness.sets).toContainEqual({ key: 'onboarding.tourSeen', value: true })
    )
  })

  it('having been skipped once, it does not come back — the write is what a fresh boot reads', async () => {
    const harness = boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })
    fireEvent.click(within(tour()).getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(harness.sets.length).toBeGreaterThan(0))

    // The same stateful stub, read again the way a restart would read it.
    const reread = await window.crm['settings:getAll']()
    expect(reread.ok).toBe(true)
    if (!reread.ok) return
    expect(reread.data['onboarding.tourSeen']).toBe(true)
  })

  /**
   * Added by the orchestrator at merge (R-260829-03), not by the builder: a
   * mutant that replaced `autoOpenedRef`'s guard with a no-op left all 14
   * tests green, which made the one line standing between a dismissal and a
   * nag unpinned.
   *
   * The state it defends is reachable without anything failing loudly. The
   * close path writes `true` into the cache immediately, so a refetch is the
   * only thing that can put `false` back — and `settings:set`'s own success
   * invalidates the snapshot, so a write that reports success without
   * persisting (a refused row, a value that fails its schema on the way in)
   * refetches `false` within the same session. With the guard gone, the
   * effect's condition is satisfied a second time and the overlay reopens on
   * top of the operator who just skipped it. That is the single failure mode
   * this whole feature is written to avoid, so it gets a test rather than a
   * comment.
   */
  it('does not reopen when the flag does not stick — a dismissal is final for the session either way', async () => {
    const sets: SettingEntry[] = []
    window.crm = stubCrm({
      // Deliberately stateless: every read says the tour is unseen, however
      // many times it is written. `boot()`'s stub mutates its snapshot on
      // set, which is the honest happy path and is what the test above
      // covers; this one is the same code with the write not landing.
      'settings:getAll': vi.fn(async () => ({
        ok: true as const,
        data: { ...BASE_SNAPSHOT, 'onboarding.tourSeen': false }
      })),
      'settings:set': vi.fn(async (entry: SettingEntry) => {
        sets.push(entry)
        return { ok: true as const, data: { ok: true as const, data: entry } }
      }),
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [] }))
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <LayerManager>
            <AppRoutes />
            <LocationProbe />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )

    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip tour' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    // The write went out and its success invalidated the snapshot, so the
    // refetch below is the app's own doing, not the test's.
    await waitFor(() => expect(sets).toContainEqual({ key: 'onboarding.tourSeen', value: true }))
    await waitFor(() => expect(window.crm['settings:getAll']).toHaveBeenCalledTimes(2))

    // The refetch has landed and said `false`. Nothing may bring it back.
    expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull()
  })

  // ---------------------------------------------------------------------
  // The two navigating actions.
  // ---------------------------------------------------------------------

  it('the step-2 action opens Companies and closes the overlay', async () => {
    const harness = boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })
    fireEvent.click(within(tour()).getByRole('button', { name: 'Next' }))

    fireEvent.click(within(tour()).getByRole('button', { name: 'Open Companies' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    expect(harness.pathname()).toBe('/companies')
  })

  it('Finish on step 5 lands on Workspace settings', async () => {
    const harness = boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })
    const dialog = await walkToLastStep()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    expect(harness.pathname()).toBe('/workspace/settings')
  })

  // ---------------------------------------------------------------------
  // Keyboard.
  // ---------------------------------------------------------------------

  it('moves focus into the card on open, and Tab from the last control returns to the first instead of reaching the rail', async () => {
    boot()
    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })
    expect(dialog.contains(document.activeElement)).toBe(true)

    const buttons = within(dialog).getAllByRole('button').filter((button) => !(button as HTMLButtonElement).disabled)
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    expect(last).not.toBe(first)

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  /**
   * The reason the tour joins `LayerManager`'s stack as a `'tour'` kind
   * instead of listening for Escape itself (this task's Risks; the same bug
   * `Sheet`'s `closeOnEscape={false}` exists to avoid). With its own
   * listener, this single keypress would close both.
   */
  it('Escape with the palette open over the tour closes only the palette', async () => {
    boot()
    await screen.findByRole('dialog', { name: 'Guided tour' })

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Guided tour' })).toBeTruthy()
  })

  // ---------------------------------------------------------------------
  // Content.
  // ---------------------------------------------------------------------

  it('describes five built views and none of the placeholders', () => {
    expect(TOUR_STEPS.map((step) => step.title)).toEqual([
      'Today',
      'Companies',
      'People',
      'Engagements',
      'Workspace'
    ])
    // Offerings is a management surface the tour's five stops do not need
    // (T-260901-11), and Revenue (T-260902-01) is a header over an empty
    // body until the revenue generator lands; a tour step for it would be
    // describing a page that does not exist yet.
    expect(TOUR_STEPS.some((step) => step.title === 'Revenue' || step.title === 'Offerings')).toBe(false)
    // "two or three sentences" (this task's Scope) — a card that grows into a
    // paragraph is a card nobody reads.
    for (const step of TOUR_STEPS) {
      const sentences = step.body.split(/(?<=[.?!])\s+/).filter((part) => part.trim().length > 0)
      expect(sentences.length).toBeGreaterThanOrEqual(2)
      expect(sentences.length).toBeLessThanOrEqual(3)
    }
  })
})
