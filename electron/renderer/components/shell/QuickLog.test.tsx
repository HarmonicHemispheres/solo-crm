import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts'
import { LayerManager } from './LayerManager'
import { QuickLog } from './QuickLog'
import { Companies } from '../../views/Companies'
import type { Company } from '../../../shared/companies'
import type { Engagement } from '../../../shared/engagements'
import type { Person } from '../../../shared/people'
import type { Activity, LogActivityInput } from '../../../shared/activity'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Relative to the real clock, not a pinned date: `Companies.tsx`'s own
 *  `daysSince` measures against `Date.now()`, so a fixture anchored to a
 *  literal would drift a day off its expected label as soon as the suite ran
 *  on any other date. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makePerson(overrides: Partial<Person> & { id: string; name: string }): Person {
  return {
    email: null,
    phone: null,
    notes: null,
    lastContactAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeEngagement(overrides: Partial<Engagement> & { id: string; name: string }): Engagement {
  return {
    billingCompanyId: null,
    clientCompanyId: null,
    serviceVersionId: null,
    agreedRateCents: null,
    billingModel: null,
    status: 'active',
    startedOn: '2026-01-01',
    endsOn: null,
    renewsOn: null,
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const SANDSAGE = makeCompany({ id: 'sandsage', name: 'Sand & Sage', cadenceDays: 14, lastTouchAt: isoDaysAgo(22) })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii', cadenceDays: 7, lastTouchAt: isoDaysAgo(1) })
const SANDRA = makePerson({ id: 'sandra', name: 'Sandra Ellis' })

const SAVED_ACTIVITY: Activity = {
  id: 'act-1',
  occurredAt: '2026-08-28T12:00:00.000Z',
  kind: 'call',
  title: 'saved',
  body: null,
  companyId: 'sandsage',
  personId: null,
  engagementId: null,
  source: 'manual',
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z'
}

// ---------------------------------------------------------------------------
// Keystroke instrumentation
//
// §2's fourth goal is a measurement, and this task's third Risk is that
// measuring it "by feel" makes it a wish (requirements §8). jsdom wall-clock
// time would measure the test runner rather than the app, so what is scripted
// and asserted here is the thing that actually costs the operator time: the
// number of keystrokes the interface demands, priced at one deliberately
// unhurried human interval. Every simulated key goes through `press`/`type`
// below, so the count can never drift from what the script really did.
// ---------------------------------------------------------------------------

/** ≈55 wpm — a fluent but unhurried typist, per-character. Slower than a
 *  practised operator logging their own shorthand, which is who this flow is
 *  actually for; deliberately not generous. */
const KEYSTROKE_MS = 220
const FIVE_SECONDS_MS = 5000

let keystrokes = 0

/** A chord (⌘L) or a single named key — one keystroke. */
function press(target: Document | Element, key: string, init: KeyboardEventInit = {}) {
  keystrokes += 1
  fireEvent.keyDown(target, { key, ...init })
}

/** Typed text — one keystroke per character, plus the value change it produces. */
function type(target: HTMLElement, text: string) {
  keystrokes += text.length
  fireEvent.change(target, { target: { value: text } })
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/** `activity:log`'s own method type, taken off `CrmApi` rather than restated — a stub that stops matching the channel is a typecheck failure here. */
type LogChannel = NonNullable<NonNullable<Parameters<typeof stubCrm>[0]>['activity:log']>

interface Fixtures {
  companies?: readonly Company[]
  people?: readonly Person[]
  engagements?: readonly Engagement[]
  log?: LogChannel
  crmOverrides?: Parameters<typeof stubCrm>[0]
}

function crmFor({ companies = [SANDSAGE, RINVII], people = [SANDRA], engagements = [], log, crmOverrides = {} }: Fixtures) {
  return stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'activity:log': log ?? vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } })),
    ...crmOverrides
  })
}

/** Stands in for the shell: ⌘L bound once (`useGlobalShortcuts`) plus a text
 *  input elsewhere on the page, so the shortcut is exercised the way it is in
 *  the app rather than against a bare document. */
function ShellHarness() {
  useGlobalShortcuts()
  return <input aria-label="somewhere else in the app" />
}

function renderShell(fixtures: Fixtures = {}) {
  const crm = crmFor(fixtures)
  window.crm = crm
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LayerManager>
        <ShellHarness />
      </LayerManager>
    </QueryClientProvider>
  )
  return { ...view, crm }
}

/** ⌘L, then wait for the who field's options to have arrived. */
async function openQuickLog() {
  press(document, 'l', { metaKey: true })
  const who = screen.getByLabelText('Who')
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy())
  return who as HTMLInputElement
}

/** Type into the who field and take the highlighted match with ↵. */
async function pickWho(who: HTMLElement, query: string) {
  type(who, query)
  await screen.findByRole('listbox')
  press(who, 'Enter')
}

// ---------------------------------------------------------------------------

describe('QuickLog', () => {
  it('logs a touch from open to saved in under five seconds, by keyboard alone', async () => {
    keystrokes = 0
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    // Any pointer input at all would break X-06's "no mouse is required at
    // any step" — counted rather than asserted by inspection.
    const pointerEvents = vi.fn()
    document.addEventListener('click', pointerEvents)
    document.addEventListener('mousedown', pointerEvents)

    try {
      renderShell({ log })

      const who = await openQuickLog()
      // Opens focused on the who field (scope) — nothing to Tab to first.
      expect(document.activeElement).toBe(who)
      const overheadBefore = keystrokes

      await pickWho(who, 'sand')
      const note = screen.getByLabelText('What happened') as HTMLTextAreaElement
      expect(document.activeElement).toBe(note)

      const noteLength = 'Kickoff call'.length
      type(note, 'Kickoff call')
      press(note, 'Enter')

      await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a touch' })).toBeNull())

      // What the interface itself costs, with the note's own characters taken
      // out: the ⌘L chord, the four characters that identify who, and the two
      // ↵s. Everything else in the budget is the operator writing their line.
      const interfaceKeystrokes = keystrokes - noteLength
      expect(interfaceKeystrokes).toBe(overheadBefore + 4 + 1 + 1)
      expect(interfaceKeystrokes * KEYSTROKE_MS).toBeLessThan(FIVE_SECONDS_MS / 2)

      // And the whole scripted flow, note included, still lands inside five
      // seconds at that same per-keystroke price.
      expect(keystrokes * KEYSTROKE_MS).toBeLessThan(FIVE_SECONDS_MS)

      expect(pointerEvents).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', pointerEvents)
      document.removeEventListener('mousedown', pointerEvents)
    }
  })

  it('writes one row naming the company, the kind and the line — and nothing else', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    const { crm } = renderShell({ log })

    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    const note = screen.getByLabelText('What happened')
    type(note, 'Talked through the setback engine')
    press(note, 'Enter')

    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    const input = log.mock.calls[0][0] as LogActivityInput
    expect(input).toMatchObject({
      kind: 'call',
      title: 'Talked through the setback engine',
      body: null,
      companyId: 'sandsage',
      personId: null,
      engagementId: null,
      source: 'manual'
    })
    expect(typeof input.occurredAt).toBe('string')

    // The cadence clock moves inside `activity:log`'s own transaction
    // (T-260828-24) — a second call to push `last_touch_at` is this task's
    // first Risk, not an implementation detail left open.
    expect(crm['companies:update']).not.toHaveBeenCalled()
    expect(crm['people:update']).not.toHaveBeenCalled()
  })

  it('matches people as well as companies, and says which is which', async () => {
    renderShell()

    const who = await openQuickLog()
    type(who, 'sand')
    const listbox = await screen.findByRole('listbox')
    const options = within(listbox).getAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual(['COMPANYSand & Sage', 'PERSONSandra Ellis'])
  })

  it('hangs the row on the person, not on a company it would have to guess', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    renderShell({ log })

    const who = await openQuickLog()
    type(who, 'sandra')
    await screen.findByRole('listbox')
    press(who, 'Enter')

    const note = screen.getByLabelText('What happened')
    type(note, 'Intro call')
    press(note, 'Enter')

    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0][0]).toMatchObject({ companyId: null, personId: 'sandra' })
  })

  it('moves the highlight with the arrow keys rather than needing an exact match', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    renderShell({ log })

    const who = await openQuickLog()
    type(who, 'sand')
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')

    press(who, 'ArrowDown')
    await waitFor(() => expect(within(listbox).getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true'))
    press(who, 'Enter')

    const note = screen.getByLabelText('What happened')
    type(note, 'Intro call')
    press(note, 'Enter')
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0][0]).toMatchObject({ personId: 'sandra' })
  })

  it('refuses an empty note with a stated reason, keeps the overlay open and keeps what was typed', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    renderShell({ log })

    const who = await openQuickLog()
    await pickWho(who, 'sand')
    const note = screen.getByLabelText('What happened') as HTMLTextAreaElement
    // Whitespace alone is still empty.
    type(note, '   ')
    press(note, 'Enter')

    expect(log).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('write one line first')
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
    expect((screen.getByLabelText('Who') as HTMLInputElement).value).toBe('Sand & Sage')
    expect(note.value).toBe('   ')
  })

  it('says plainly that the company has to exist rather than saving against nothing', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    renderShell({ log })

    const who = await openQuickLog()
    type(who, 'Nobody In Particular')
    await waitFor(() => expect(screen.getByText(/create it from New first/)).toBeTruthy())

    // ↵ on a name that matched nothing is answered, not swallowed.
    press(who, 'Enter')
    expect(screen.getByRole('alert').textContent).toContain('create it from New')

    const note = screen.getByLabelText('What happened')
    type(note, 'Left a voicemail')
    press(note, 'Enter')

    expect(log).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('create it from New')
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('pre-fills the one active engagement a company has, and offers to none of them when it has two', async () => {
    const oneEngagement = makeEngagement({ id: 'eng-1', name: 'SiteFacts', billingCompanyId: 'sandsage', clientCompanyId: 'sandsage' })
    const second = makeEngagement({ id: 'eng-2', name: 'Parcel engine', billingCompanyId: 'sandsage', clientCompanyId: 'sandsage' })
    const ended = makeEngagement({
      id: 'eng-3',
      name: 'Old retainer',
      billingCompanyId: 'sandsage',
      clientCompanyId: 'sandsage',
      status: 'delivered'
    })

    // Exactly one active — the only answer there is, so it is not a guess.
    const logOne = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    const single = renderShell({ engagements: [oneEngagement, ended], log: logOne })
    let who = await openQuickLog()
    await pickWho(who, 'sand &')
    await waitFor(() => expect((screen.getByLabelText('Engagement') as HTMLSelectElement).value).toBe('eng-1'))
    type(screen.getByLabelText('What happened'), 'Kickoff')
    press(screen.getByLabelText('What happened'), 'Enter')
    await waitFor(() => expect(logOne).toHaveBeenCalledTimes(1))
    expect(logOne.mock.calls[0][0]).toMatchObject({ engagementId: 'eng-1' })
    single.unmount()

    // Two active — it does not pick one.
    const logTwo = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })
    renderShell({ engagements: [oneEngagement, second], log: logTwo })
    who = await openQuickLog()
    await pickWho(who, 'sand &')
    await waitFor(() => expect((screen.getByLabelText('Engagement') as HTMLSelectElement).value).toBe(''))
    type(screen.getByLabelText('What happened'), 'Kickoff')
    press(screen.getByLabelText('What happened'), 'Enter')
    await waitFor(() => expect(logTwo).toHaveBeenCalledTimes(1))
    expect(logTwo.mock.calls[0][0]).toMatchObject({ engagementId: null })
  })

  it('offers no engagement field at all for a company with none active', async () => {
    renderShell({ engagements: [] })
    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    expect(screen.queryByLabelText('Engagement')).toBeNull()
  })

  it('surfaces a repository refusal as its own reason and keeps the overlay open', async () => {
    const log = vi.fn(async (input: unknown) => {
      void input
      return {
        ok: true as const,
        data: { ok: false as const, error: { code: 'validation' as const, message: 'title: title is required' } }
      }
    })
    renderShell({ log })

    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    type(screen.getByLabelText('What happened'), 'Kickoff')
    press(screen.getByLabelText('What happened'), 'Enter')

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('title: title is required'))
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('confirms with the toast after the overlay is gone', async () => {
    renderShell()
    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    type(screen.getByLabelText('What happened'), 'Kickoff')
    press(screen.getByLabelText('What happened'), 'Enter')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a touch' })).toBeNull())
    const status = screen.getByRole('status')
    expect(status.className).toContain('show')
    expect(status.textContent).toBe('Logged. Sand & Sage is current.')
  })

  it('takes no Escape handler of its own — dismissal belongs to LayerManager', () => {
    // Mounted without a LayerManager: if this component had its own listener
    // (or left `Sheet`'s standalone one on), Escape would close it here, and
    // one press would take two layers with it inside the real shell —
    // T-260828-12's review settled that the manager owns Escape outright.
    const onClose = vi.fn()
    window.crm = crmFor({})
    render(
      <QueryClientProvider client={createQueryClient()}>
        <QuickLog open onClose={onClose} />
      </QueryClientProvider>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('is dismissed by Escape through the manager, and comes back blank', async () => {
    renderShell()
    let who = await openQuickLog()
    type(who, 'sand &')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Log a touch' })).toBeNull()

    who = await openQuickLog()
    expect((who as HTMLInputElement).value).toBe('')
  })
})

// ---------------------------------------------------------------------------
// The point of the whole feature: the write has to move the company out of
// "going quiet" on screen, with nothing manually refreshed.
// ---------------------------------------------------------------------------

describe('QuickLog against a live view', () => {
  it('moves the company out of going quiet — last_touch_at and the rendered cadence state both, with no manual refresh', async () => {
    // A stateful `companies:list`, the way the real repository behaves: the
    // row `activity:log` touched comes back with a moved `last_touch_at`, and
    // only an invalidation makes the view ask for it again.
    let companies: readonly Company[] = [SANDSAGE, RINVII]
    const log = vi.fn(async (input: unknown) => {
      const payload = input as LogActivityInput
      companies = companies.map((company) =>
        company.id === payload.companyId ? { ...company, lastTouchAt: payload.occurredAt } : company
      )
      return { ok: true as const, data: { ok: true as const, data: SAVED_ACTIVITY } }
    })

    window.crm = stubCrm({
      'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
      'people:list': vi.fn(async () => ({ ok: true as const, data: [SANDRA] })),
      'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
      'activity:log': log
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/companies']}>
          <LayerManager>
            <ShellHarness />
            <Companies />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )

    const card = await screen.findByRole('button', { name: /^Sand & Sage/ })
    // 22 days against a 14-day cadence: late, which is what "going quiet"
    // means on this view.
    expect(card.textContent).toContain('22d')
    expect(card.querySelector('.decay')?.className).toContain('late')

    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    type(screen.getByLabelText('What happened'), 'Caught up on the parcel engine')
    press(screen.getByLabelText('What happened'), 'Enter')

    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    // The repository moved the column inside the same transaction...
    expect(companies.find((company) => company.id === 'sandsage')?.lastTouchAt).toBe(
      (log.mock.calls[0][0] as LogActivityInput).occurredAt
    )
    // ...and the card behind the overlay re-reads it without anything being
    // clicked, reloaded or navigated.
    await waitFor(() => {
      const refreshed = screen.getByRole('button', { name: /^Sand & Sage/ })
      expect(refreshed.textContent).toContain('today')
      expect(refreshed.querySelector('.decay')?.className).toContain('ok')
    })
  })
})
