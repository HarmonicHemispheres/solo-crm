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
// The visual spec as text, through Vite's `?raw` (the same mechanism
// `electron/main/db/migrations/index.ts` uses) rather than `node:fs`, which a
// renderer file may not import (`local/no-renderer-node-access`). It is what
// lets the highlight's contrast be checked against the token values instead of
// by eye — see the block above `QuickLog’s selected row` for why the token
// values are read from here and not from QuickLog.css itself.
import mockupHtml from '../../../../planning/solo-crm-mockup.html?raw'
import type { Company } from '../../../shared/companies'
import type { EngagementWithOffering } from '../../../shared/engagements'
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
    introducedByPersonId: null,
    cadenceDays: 14,
    lastTouchAt: null,
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

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string; name: string }): EngagementWithOffering {
  return {
    billingCompanyId: null,
    clientCompanyId: null,
    offeringVersionId: null,
    agreedRateCents: null,
    offeringId: null,
    offeringName: null,
    billingModel: null,
    status: 'active',
    startedOn: '2026-01-01',
    endsOn: null,
    renewsOn: null,
    retainerBasis: null,
    monthlyAmountCents: null,
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
  dueOn: null,
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

/**
 * Typed text, one character at a time. Every counted keystroke is a key event
 * this function actually dispatched — the count used to be `text.length` added
 * beside a single whole-string `change`, which is a number the test asserted
 * about itself rather than about the interface (T-260828-35 review).
 */
function type(target: HTMLElement, text: string) {
  const field = target as HTMLInputElement | HTMLTextAreaElement
  for (const char of text) {
    keystrokes += 1
    fireEvent.keyDown(field, { key: char })
    fireEvent.change(field, { target: { value: field.value + char } })
    fireEvent.keyUp(field, { key: char })
  }
}

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

/** `activity:log`'s own method type, taken off `CrmApi` rather than restated — a stub that stops matching the channel is a typecheck failure here. */
type LogChannel = NonNullable<NonNullable<Parameters<typeof stubCrm>[0]>['activity:log']>

interface Fixtures {
  companies?: readonly Company[]
  people?: readonly Person[]
  engagements?: readonly EngagementWithOffering[]
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
      //
      // The chord is the literal 1 it is, not a counter read after opening:
      // baselining on `keystrokes` as it stood after the open made the
      // assertion agree with whatever opening had just cost, so an overlay
      // that took two presses to open would still have passed
      // (T-260828-35 review).
      const interfaceKeystrokes = keystrokes - noteLength
      expect(interfaceKeystrokes).toBe(1 + 4 + 1 + 1)
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

// ---------------------------------------------------------------------------
// The highlight (T-260828-58). The quick log is keyboard-only by design, so
// the row ↵ would take is the one state that has to read, and it has to stay
// on screen. Both are asserted against something mechanical — the token
// values and the dispatched scroll call — rather than by eye, which is how a
// highlight *darker* than its own list survived a review in the first place.
//
// Why the token values come from the mockup rather than from QuickLog.css:
// Vitest replaces every `.css` import with an empty string (`css: false`, its
// default — its css-disable plugin matches on the extension, so `?raw` is
// blanked too), and a renderer test may not reach for `node:fs`
// (`local/no-renderer-node-access`, AGENTS.md). The mockup is `.html`, so it
// arrives intact, and tokens.css is lifted from its `:root` verbatim —
// styles/tokens.test.ts is the standing diff that keeps that true. What is
// pinned here is therefore the pair of tokens QuickLog.css names:
// `.qlog-list { background: var(--surface-2) }` and
// `.qlog-opt.sel { background: var(--surface-3) }`.
// ---------------------------------------------------------------------------

const LIST_BACKGROUND_TOKEN = '--surface-2'
const SELECTED_ROW_TOKEN = '--surface-3'

/** The hex the mockup's own `:root` — and so tokens.css — gives a token. */
function tokenValue(name: string): string {
  const rootStart = mockupHtml.indexOf(':root')
  if (rootStart === -1) throw new Error('the mockup has no :root block')
  const root = mockupHtml.slice(rootStart, mockupHtml.indexOf('}', rootStart))
  // Anchored on a preceding delimiter so `--surface` cannot match inside
  // `--surface-2`, which is exactly the family this compares.
  const declared = new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+)`).exec(root)
  if (!declared) throw new Error(`the mockup declares no ${name}`)
  return declared[1].trim()
}

/** WCAG relative luminance — "one step lighter" as a number, not an opinion. */
function luminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const [r, g, b] = [0, 2, 4]
    .map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('QuickLog’s selected row', () => {
  it('is painted a step lighter than the list it sits in, by the token values themselves', () => {
    // It was `--surface` on a `--surface-2` list: the one row a keyboard-only
    // flow has to see was the darkest in the list, and the same colour as the
    // sheet behind it. The mockup's `.pal-i.sel` steps the other way.
    expect(luminance(tokenValue(SELECTED_ROW_TOKEN))).toBeGreaterThan(luminance(tokenValue(LIST_BACKGROUND_TOKEN)))
  })

  it('is the row the keyboard would take, and it alone carries the class the highlight is drawn with', async () => {
    renderShell()
    const who = await openQuickLog()
    type(who, 'sand')
    const listbox = await screen.findByRole('listbox')

    press(who, 'ArrowDown')
    await waitFor(() => {
      const options = within(listbox).getAllByRole('option')
      expect(options.map((option) => option.className)).toEqual(['qlog-opt', 'qlog-opt sel'])
      expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    })
  })
})

describe('QuickLog keeps the highlight in view', () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    makeCompany({ id: `acme-${index}`, name: `Acme ${String(index).padStart(2, '0')}` })
  )

  it('scrolls the row the arrow keys moved to into the list’s viewport', async () => {
    // jsdom has no layout, so the geometry cannot be measured here — what is
    // asserted instead is that the app asked for the *right element* to be
    // brought into view, with `block: 'nearest'` so a row already on screen
    // does not make the list jump. The browser does the geometry.
    const original = Element.prototype.scrollIntoView as ((arg?: boolean | ScrollIntoViewOptions) => void) | undefined
    const scrolled: Array<{ element: Element; options?: boolean | ScrollIntoViewOptions }> = []
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(
      this: Element,
      options?: boolean | ScrollIntoViewOptions
    ) {
      scrolled.push({ element: this, options })
    }

    try {
      renderShell({ companies: many, people: [] })
      const who = await openQuickLog()
      type(who, 'acme')
      const listbox = await screen.findByRole('listbox')
      expect(within(listbox).getAllByRole('option')).toHaveLength(12)

      // Down to the last match — past what 168px of list can show.
      for (let step = 0; step < 11; step++) press(who, 'ArrowDown')

      const options = within(listbox).getAllByRole('option')
      const last = options[options.length - 1]
      await waitFor(() => expect(last.getAttribute('aria-selected')).toBe('true'))
      await waitFor(() => expect(scrolled[scrolled.length - 1].element).toBe(last))
      expect(scrolled[scrolled.length - 1].options).toEqual({ block: 'nearest' })
    } finally {
      if (original) Element.prototype.scrollIntoView = original
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})

describe('QuickLog’s combobox wiring', () => {
  it('points aria-controls at the list only while the list is rendered', async () => {
    renderShell()
    const who = await openQuickLog()

    // Closed: a dangling IDREF resolves to nothing, so there must be none.
    expect(who.hasAttribute('aria-controls')).toBe(false)

    type(who, 'sand')
    const listbox = await screen.findByRole('listbox')
    const controls = who.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls as string)).toBe(listbox)
  })

  it('reopens a closed list where it was left rather than one row further down', async () => {
    // Two matches that both survive the pick, so the difference is visible:
    // picking "Sand" leaves the query matching "Sand" and "Sand & Sage" both.
    const sand = makeCompany({ id: 'sand', name: 'Sand' })
    renderShell({ companies: [sand, SANDSAGE], people: [] })

    const who = await openQuickLog()
    type(who, 'sand')
    await screen.findByRole('listbox')
    press(who, 'Enter')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(who.value).toBe('Sand')

    press(who, 'ArrowDown')
    const listbox = await screen.findByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  })
})

describe('QuickLog confirms before the refetches settle', () => {
  it('closes the overlay and raises the toast without waiting on the invalidated queries', async () => {
    let calls = 0
    let settled = 0
    let release: () => void = () => {}
    // Every refetch after the first load hangs here until this test lets it
    // go — a deliberately slow query standing in for three real round trips.
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const companiesList = vi.fn(async () => {
      calls += 1
      if (calls > 1) await held
      settled += 1
      return { ok: true as const, data: [SANDSAGE, RINVII] }
    })

    renderShell({ crmOverrides: { 'companies:list': companiesList } })

    const who = await openQuickLog()
    await pickWho(who, 'sand &')
    type(screen.getByLabelText('What happened'), 'Kickoff')
    press(screen.getByLabelText('What happened'), 'Enter')

    // Gone and confirmed...
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a touch' })).toBeNull())
    expect(screen.getByRole('status').textContent).toBe('Logged. Sand & Sage is current.')

    // ...while the refetch it triggered is still in flight.
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    expect(settled).toBe(1)

    release()
    await waitFor(() => expect(settled).toBe(calls))
  })
})
