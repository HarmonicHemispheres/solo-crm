import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceSettings } from './WorkspaceSettings'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import { GLOBAL_SHORTCUTS } from '../hooks/useGlobalShortcuts'
import { formatShortcut } from '../lib/platform'
import { MemoryRouter } from 'react-router'
import { Rail } from '../components/shell/Rail'
import { LayerManager } from '../components/shell/LayerManager'
import { Tour } from '../components/shell/Tour'
import { SETTINGS_KEYS, type SettingKey, type SettingsSnapshot } from '../../shared/settings'
import type { CrmApi, SettingEntry } from '../../shared/ipc-types'
import type { BrandingSlot, BrandingSlotState } from '../../shared/branding'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
  document.documentElement.removeAttribute('data-motion')
})

const DEFAULT_SNAPSHOT: SettingsSnapshot = {
  'workspace.name': 'MagicPill Labs',
  'workspace.operator': 'Robby Boney',
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
  // `true` — this harness is an established workspace, not a first run. The
  // flag's three states are Tour.test.tsx's subject; here it only has to
  // stay out of the way of the cards this file is about.
  'onboarding.tourSeen': true
}

/**
 * The view plus the two providers it stopped being free-standing without in
 * T-260829-15: the Guided tour group calls `useLayerManager`, and the tour it
 * opens navigates. Spelled once here rather than at each of the render sites
 * below, which are otherwise about entirely different things.
 */
function SettingsHost() {
  return (
    <MemoryRouter initialEntries={['/workspace/settings']}>
      <LayerManager>
        <WorkspaceSettings />
        {/* The same sibling relationship the real tree has: `ShellLayout`
            renders the routed view and `<Tour />` next to each other under
            one `LayerManager`. Without it the Guided tour button would open
            a layer with nothing mounted to render it — a green test for a
            button that does nothing visible. */}
        <Tour />
      </LayerManager>
    </MemoryRouter>
  )
}

/** Renders with a stateful `settings:getAll`/`settings:set` pair — a `set`
 * mutates the same snapshot object `getAll` answers with next, matching the
 * real repository's read-your-writes behaviour, the same reasoning
 * Companies.test.tsx's `renderCompanies` gives for its own stateful
 * `settings:get`/`settings:set` stub. */
function renderSettings(overrides: Partial<SettingsSnapshot> = {}) {
  const snapshot: SettingsSnapshot = { ...DEFAULT_SNAPSHOT, ...overrides }
  window.crm = stubCrm({
    'settings:getAll': vi.fn(async () => ({ ok: true as const, data: { ...snapshot } })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      // @ts-expect-error - writing a dynamically-keyed value back onto the typed snapshot.
      snapshot[entry.key] = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    })
  })
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsHost />
    </QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// The section rail (ADR-014). Only one section's card is mounted at a time, so
// almost every assertion below has to say which section it is about first.
// ---------------------------------------------------------------------------

/** ADR-014 §2's six sections, in the order the decision fixes them in. Hand-typed
 * rather than imported from the view: the order *is* the decision, and a list
 * imported from the thing under test would agree with it however it changed. */
const SECTION_ORDER = ['Identity', 'Default cadence', 'Integrations', 'Backup', 'Appearance', 'Help'] as const

function sectionRail(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Settings sections' })
}

/** Clicks a rail entry and waits for its content region to be the one mounted. */
async function openSection(label: string): Promise<HTMLElement> {
  const rail = await screen.findByRole('navigation', { name: 'Settings sections' })
  fireEvent.click(within(rail).getByRole('button', { name: label }))
  return await screen.findByRole('region', { name: label })
}

describe('WorkspaceSettings', () => {
  // -------------------------------------------------------------------------
  // The rail itself — ADR-014 §1 and §2.
  // -------------------------------------------------------------------------

  it('lists ADR-014’s six sections in the decided order, and nothing else', async () => {
    renderSettings()
    const rail = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect(within(rail).getAllByRole('button').map((el) => el.textContent)).toEqual([...SECTION_ORDER])
  })

  it('opens on the first section every visit, and mounts nothing from the other five', async () => {
    renderSettings()
    // Identity's own fields are present…
    await waitFor(() => expect(screen.getByLabelText('Workspace')).toBeTruthy())
    expect(screen.getByRole('region', { name: 'Identity' })).toBeTruthy()
    // …and no other section's controls are anywhere in the document.
    expect(screen.queryByRole('switch', { name: 'Stripe' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Interface motion' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Default cadence' })).toBeNull()

    // A remount is a fresh visit: it opens on Identity again rather than on
    // wherever the operator was last (ADR-014 §1 — the section is component
    // state, deliberately not a `settings` key).
    const rail = sectionRail()
    fireEvent.click(within(rail).getByRole('button', { name: 'Appearance' }))
    await screen.findByRole('region', { name: 'Appearance' })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsHost />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Identity' })).toHaveLength(1))
  })

  it('marks the current section with aria-current, not colour alone, and only ever one at a time', async () => {
    renderSettings()
    const rail = await screen.findByRole('navigation', { name: 'Settings sections' })

    for (const label of SECTION_ORDER) {
      fireEvent.click(within(rail).getByRole('button', { name: label }))
      await screen.findByRole('region', { name: label })
      const current = within(rail)
        .getAllByRole('button')
        .filter((el) => el.getAttribute('aria-current') === 'true')
      expect(current.map((el) => el.textContent)).toEqual([label])
    }
  })

  it('the rail is real buttons, keyboard-reachable, and activating one leaves focus where it was', async () => {
    renderSettings()
    const rail = await screen.findByRole('navigation', { name: 'Settings sections' })

    for (const el of within(rail).getAllByRole('button')) {
      // No roving tabindex (ADR-014 §1): Tab walks all six in order, the same
      // way the app rail's own links do.
      expect(el.tagName).toBe('BUTTON')
      expect(el.getAttribute('tabindex')).toBeNull()
      expect(el).toHaveProperty('disabled', false)
    }

    const backup = within(rail).getByRole('button', { name: 'Backup' })
    backup.focus()
    fireEvent.click(backup)
    await screen.findByRole('region', { name: 'Backup' })
    // Focus stays on the trigger, so the content region is the next Tab stop
    // in DOM order rather than the rail restarting from the top.
    expect(document.activeElement).toBe(backup)
  })

  it('names the content region for the section it is showing', async () => {
    renderSettings()
    for (const label of SECTION_ORDER) {
      const region = await openSection(label)
      expect(region.tagName).toBe('SECTION')
      expect(region.querySelector('.card')).toBeTruthy()
    }
  })

  // -------------------------------------------------------------------------
  // Every key still has its control, and still writes through settings:set.
  // -------------------------------------------------------------------------

  it('every §6.11 key has a visible control, in the section ADR-014 puts it in', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByLabelText('Workspace')).toBeTruthy())

    expect(screen.getByLabelText('Workspace')).toHaveProperty('value', 'MagicPill Labs')
    expect(screen.getByLabelText('Operator')).toHaveProperty('value', 'Robby Boney')
    expect(screen.getByLabelText('Currency')).toHaveProperty('value', 'USD')
    expect(screen.getByLabelText('Fiscal year start month')).toHaveProperty('value', '1')

    await openSection('Default cadence')
    for (const label of ['Client', 'End client', 'Prospect', 'Advisory', 'Channel']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    await openSection('Integrations')
    expect(screen.getByRole('switch', { name: 'Stripe' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Google Calendar' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Gmail' })).toBeTruthy()

    await openSection('Backup')
    expect(screen.getByRole('switch', { name: 'Nightly JSON export' })).toBeTruthy()

    await openSection('Appearance')
    expect(screen.getByRole('switch', { name: 'Interface motion' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Compact density' })).toBeTruthy()
  })

  /**
   * The per-key round trip T-260901-09's acceptance asks for by name. Seven
   * cards were rearranged into six sections holding roughly fifteen controls,
   * and "it looks like everything is there" is exactly how one goes missing —
   * a control dropped in the move fails *its own* case here rather than
   * disappearing behind an assertion that only counts what is present.
   *
   * `backup.folder` is the one page-owned key with no writing control: its
   * picker is deliberately disabled until a main-process dialog channel
   * exists, so it is covered by the read assertion in the test below instead.
   */
  const ROUND_TRIPS: ReadonlyArray<{
    key: SettingKey
    section: string
    value: unknown
    act: () => void
  }> = [
    {
      key: 'workspace.name',
      section: 'Identity',
      value: 'Renamed Labs',
      act: () => {
        const input = screen.getByLabelText('Workspace')
        fireEvent.change(input, { target: { value: 'Renamed Labs' } })
        fireEvent.blur(input)
      }
    },
    {
      key: 'workspace.operator',
      section: 'Identity',
      value: 'Someone Else',
      act: () => {
        const input = screen.getByLabelText('Operator')
        fireEvent.change(input, { target: { value: 'Someone Else' } })
        fireEvent.blur(input)
      }
    },
    {
      key: 'workspace.currency',
      section: 'Identity',
      value: 'EUR',
      act: () => fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } })
    },
    {
      key: 'workspace.fiscalYearStartMonth',
      section: 'Identity',
      value: 4,
      act: () => fireEvent.change(screen.getByLabelText('Fiscal year start month'), { target: { value: '4' } })
    },
    // 90 differs from every kind's default in DEFAULT_SNAPSHOT, so each of
    // these is a real change rather than a click on the already-pressed step.
    ...(
      [
        ['cadence.defaultDays.client', 'Client'],
        ['cadence.defaultDays.end_client', 'End client'],
        ['cadence.defaultDays.prospect', 'Prospect'],
        ['cadence.defaultDays.advisory', 'Advisory'],
        ['cadence.defaultDays.channel', 'Channel']
      ] as ReadonlyArray<[SettingKey, string]>
    ).map(([key, label]) => ({
      key,
      section: 'Default cadence',
      value: 90,
      act: () => {
        const row = screen.getByText(label).closest('.setrow') as HTMLElement
        fireEvent.click(within(row).getByRole('button', { name: '90' }))
      }
    })),
    ...(
      [
        ['integrations.stripe.enabled', 'Stripe', false],
        ['integrations.googleCalendar.enabled', 'Google Calendar', false],
        ['integrations.gmail.enabled', 'Gmail', true]
      ] as ReadonlyArray<[SettingKey, string, boolean]>
    ).map(([key, label, value]) => ({
      key,
      section: 'Integrations',
      value,
      act: () => fireEvent.click(screen.getByRole('switch', { name: label }))
    })),
    {
      key: 'backup.enabled',
      section: 'Backup',
      value: false,
      act: () => fireEvent.click(screen.getByRole('switch', { name: 'Nightly JSON export' }))
    },
    {
      key: 'appearance.motion',
      section: 'Appearance',
      value: false,
      act: () => fireEvent.click(screen.getByRole('switch', { name: 'Interface motion' }))
    },
    {
      key: 'appearance.density',
      section: 'Appearance',
      value: 'compact',
      act: () => fireEvent.click(screen.getByRole('switch', { name: 'Compact density' }))
    }
  ]

  it.each(ROUND_TRIPS)('$key still round-trips through settings:set from $section', async ({ key, section, value, act }) => {
    renderSettings()
    await openSection(section)
    act()
    await waitFor(() => expect(window.crm['settings:set']).toHaveBeenCalledWith({ key, value }))
  })

  it('shows the stored backup folder, whose picker is the one control deliberately not wired', async () => {
    renderSettings({ 'backup.folder': '~/Documents/SoloCRM/backups' })
    await openSection('Backup')
    expect(screen.getByText('~/Documents/SoloCRM/backups')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose folder' })).toHaveProperty('disabled', true)
  })

  it('no key in the settings registry is missing a control — SETTINGS_KEYS stays exhaustive against this list', () => {
    // Pins the coverage claim above to the registry itself rather than a
    // hand-typed count: a key added to SETTINGS_REGISTRY with nothing
    // rendering it fails this the moment SETTINGS_KEYS grows past what the
    // two tests above actually exercise.
    const covered = new Set([
      'workspace.name',
      'workspace.operator',
      'workspace.currency',
      'workspace.fiscalYearStartMonth',
      'cadence.defaultDays.client',
      'cadence.defaultDays.end_client',
      'cadence.defaultDays.prospect',
      'cadence.defaultDays.advisory',
      'cadence.defaultDays.channel',
      'integrations.stripe.enabled',
      'integrations.googleCalendar.enabled',
      'integrations.gmail.enabled',
      'backup.enabled',
      'backup.folder',
      'appearance.motion',
      'appearance.density',
      // The `view.*` keys are per-view presentation state (§6.13), set from
      // each view's own header rather than from this page. They are listed
      // here because this assertion's job is that no registry key is
      // *unaccounted for* — a new key must be either given a control here or
      // deliberately named as belonging to a view.
      'view.companies.mode',
      'view.people.mode',
      'view.todos.groupBy',
      // T-260828-40's saved query snippets, written from the Data view's own
      // console — per-view state like the three above, and named here for the
      // reason this list's comment already gives: the assertion's job is that
      // no registry key is unaccounted for, not that every key is controlled
      // from this page.
      'view.data.snippets',
      // T-260829-15's first-run flag. Accounted for here rather than given a
      // control: the Guided tour group below *reopens* the overlay, and the
      // overlay owns the write — there is no switch on this page that reads
      // or sets the flag, and a "mark the tour unseen" toggle would be a way
      // to make the app nag on the next restart.
      'onboarding.tourSeen'
    ])
    expect([...SETTINGS_KEYS].sort()).toEqual([...covered].sort())
    // The section the rebuild put each key in is asserted above; this stays a
    // pure registry check. Note it names no section key: ADR-014 §1 keeps the
    // selected section out of `settings` on purpose, so a `view.settings.*`
    // key appearing here is a decision being reversed, not a test to update.
    expect([...SETTINGS_KEYS].some((key) => key.startsWith('view.settings'))).toBe(false)
  })

  it('changing the currency persists through settings:set and the new value survives a refetch', async () => {
    const { rerender } = renderSettings()
    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeTruthy())

    const select = screen.getByLabelText('Currency') as HTMLSelectElement
    select.value = 'EUR'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => expect(select.value).toBe('EUR'))
    expect(window.crm['settings:set']).toHaveBeenCalledWith({ key: 'workspace.currency', value: 'EUR' })

    // A remount reads through the same stateful stub as a fresh boot would —
    // T-260828-38's acceptance: "a setting changed, the app restarted, and the
    // change still in effect."
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsHost />
      </QueryClientProvider>
    )
    await waitFor(() => expect((screen.getByLabelText('Currency') as HTMLSelectElement).value).toBe('EUR'))
  })

  it('a text field commits on blur, not on every keystroke', async () => {
    renderSettings()
    const input = await screen.findByLabelText('Workspace')

    fireEvent.change(input, { target: { value: 'Renamed Labs' } })
    expect(window.crm['settings:set']).not.toHaveBeenCalled()

    fireEvent.blur(input)
    await waitFor(() =>
      expect(window.crm['settings:set']).toHaveBeenCalledWith({ key: 'workspace.name', value: 'Renamed Labs' })
    )
  })

  // -------------------------------------------------------------------------
  // Where the prose lives — ADR-014 §4. Explanation behind an `InfoPopover`;
  // state (an honest caption, or a constraint §6.11 makes the UI state) in
  // the flow. The single most likely way to get this rebuild wrong is to move
  // all six of the old footers behind popovers, which silently reverses
  // P2-09's criterion, so both halves are asserted.
  // -------------------------------------------------------------------------

  /**
   * A `.settings-foot` caption is one line wide at most. Measured rather than
   * guessed: `.settings-body` caps at 720px, `.settings-foot` pads 15px each
   * side, and `.meta` is 11px mono (~6.6px advance) with .4px tracking — about
   * 98 characters across the 690px that leaves. jsdom computes no layout, so
   * the character count is the only form this can take here.
   */
  const ONE_LINE = 98

  /** Every `.settings-foot` in the whole page, section by section. */
  async function everyVisibleCaption(): Promise<string[]> {
    const captions: string[] = []
    for (const label of SECTION_ORDER) {
      const region = await openSection(label)
      for (const el of Array.from(region.querySelectorAll('p.settings-foot'))) {
        captions.push((el.textContent ?? '').replace(/\s+/g, ' ').trim())
      }
    }
    return captions
  }

  it('keeps exactly the four captions ADR-014 §4 leaves in the flow, each inside one line', async () => {
    renderSettings()
    const captions = await everyVisibleCaption()

    expect(captions).toEqual([
      // Honest caption: the steppers store a number no company reads yet.
      'Stored only — no company moves until P2-02 applies these defaults.',
      // §6.11: "All pull-only; the UI must state this." Behind a click is not
      // the UI stating it.
      'Every source above is pull-only. Solo CRM never writes back to Stripe, Google Calendar or Gmail.',
      // Honest caption: the picker is disabled and the export is unbuilt.
      'The picker needs a main-process dialog channel that doesn’t exist yet; the export is X-04.',
      // Honest caption: `appearance.density` has no consumer in the renderer.
      'Stored for later use — no view applies compact density yet.'
    ])

    for (const caption of captions) expect(caption.length).toBeLessThanOrEqual(ONE_LINE)
  })

  it('the cadence section states plainly that a change moves no company yet (P2-02 is not built)', async () => {
    renderSettings()
    await openSection('Default cadence')
    // Visible, in the flow, with no click — the whole point of the criterion.
    expect(screen.getByText(/no company moves until P2-02/)).toBeTruthy()
  })

  it('states pull-only in the rendered output, not only in source', async () => {
    renderSettings()
    await openSection('Integrations')
    expect(screen.getByText('pull-only')).toBeTruthy()
    expect(screen.getByText(/never writes back/)).toBeTruthy()
  })

  it('the backup folder picker states plainly that it is not wired, and issues no filesystem call of its own', async () => {
    renderSettings({ 'backup.folder': '~/Documents/SoloCRM/backups' })
    await openSection('Backup')
    const chooseButton = screen.getByRole('button', { name: 'Choose folder' })
    expect(chooseButton).toHaveProperty('disabled', true)
    expect(screen.getByText(/needs a main-process dialog channel that doesn’t exist/)).toBeTruthy()
  })

  it('compact density says plainly that no view applies it yet', async () => {
    renderSettings()
    await openSection('Appearance')
    expect(screen.getByText('Compact density')).toBeTruthy()
    expect(screen.getByText(/no view applies compact density yet/)).toBeTruthy()
  })

  it('every info popover names its own section, sits in a card header, and none says “About this view”', async () => {
    renderSettings()
    const found: Record<string, string[]> = {}
    for (const label of SECTION_ORDER) {
      const region = await openSection(label)
      found[label] = Array.from(region.querySelectorAll('button.info')).map((el) => {
        // In the header's trailing slot, never loose in the body — ADR-014 §4
        // puts a section's explanation on the header it belongs to.
        expect(el.closest('.card-h'), `${label}: an info trigger outside a card header`).toBeTruthy()
        return el.getAttribute('aria-label') ?? ''
      })
    }

    // Three popovers, on the three groups ADR-014 §4 assigns prose to — and
    // none on Integrations, Backup or Appearance, whose prose stays visible.
    // A popover with nothing to say is an icon button that lies about having
    // content.
    expect(found).toEqual({
      Identity: ['About Branding'],
      'Default cadence': ['About Default cadence'],
      Integrations: [],
      Backup: [],
      Appearance: [],
      Help: ['About Guided tour']
    })

    for (const labels of Object.values(found)) {
      for (const label of labels) expect(label).not.toBe('About this view')
    }
  })

  it('the cadence popover holds the explanation, and the caption below it holds the limitation', async () => {
    renderSettings()
    const region = await openSection('Default cadence')
    // The mockup's own line is behind the affordance…
    expect(screen.queryByText(/New companies inherit these/)).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: 'About Default cadence' }))
    expect(await screen.findByText(/New companies inherit these/)).toBeTruthy()
    // …and the honest caption is not: it was visible before the click and
    // still is.
    expect(screen.getByText(/no company moves until P2-02/)).toBeTruthy()
  })

  it('no credential field appears anywhere on the page, popovers opened (ADR-004)', async () => {
    renderSettings()
    let text = ''
    for (const label of SECTION_ORDER) {
      const region = await openSection(label)
      for (const trigger of Array.from(region.querySelectorAll('button.info'))) {
        fireEvent.click(trigger)
      }
      text += ` ${document.body.textContent ?? ''}`
    }
    for (const word of ['api key', 'apikey', 'token', 'secret', 'password', 'credential']) {
      expect(text.toLowerCase()).not.toContain(word)
    }
  })

  // -------------------------------------------------------------------------
  // The controls themselves — unchanged by the rebuild, and asserted so a
  // rearrangement cannot quietly stop one reading its own stored value.
  // -------------------------------------------------------------------------

  it('each integration switch reflects its own stored value, not just its presence', async () => {
    // DEFAULT_SNAPSHOT stores Stripe/Calendar on and Gmail off — a real,
    // mixed snapshot. `checked={snapshot[key]}` replaced with `checked={true}`
    // (the reviewer's mutant) renders every switch on regardless of what is
    // stored; the presence-only assertions elsewhere in this file don't
    // notice, because they only check the switch exists. This does.
    renderSettings()
    await openSection('Integrations')

    expect(screen.getByRole('switch', { name: 'Stripe' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Google Calendar' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Gmail' }).getAttribute('aria-checked')).toBe('false')
  })

  it('the cadence stepper marks only the stored default as pressed, not every step or none', async () => {
    // DEFAULT_SNAPSHOT: client -> 7, channel -> 30. `aria-pressed={step ===
    // value}` replaced with `false` (the reviewer's mutant) leaves every
    // stepper button unpressed; nothing before this asserted the pressed
    // button matched what is actually stored, only that clicking one issues
    // the right settings:set call.
    renderSettings()
    await openSection('Default cadence')

    const clientRow = screen.getByText('Client').closest('.setrow') as HTMLElement
    expect(within(clientRow).getByRole('button', { name: '7' }).getAttribute('aria-pressed')).toBe('true')
    for (const other of ['14', '30', '90']) {
      expect(within(clientRow).getByRole('button', { name: other }).getAttribute('aria-pressed')).toBe('false')
    }

    const channelRow = screen.getByText('Channel').closest('.setrow') as HTMLElement
    expect(within(channelRow).getByRole('button', { name: '30' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(channelRow).getByRole('button', { name: '7' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('turning interface motion off sets data-motion="off" on the document root, and back on removes it', async () => {
    renderSettings()
    await openSection('Appearance')
    const motionSwitch = screen.getByRole('switch', { name: 'Interface motion' })
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)

    motionSwitch.click()
    await waitFor(() => expect(document.documentElement.getAttribute('data-motion')).toBe('off'))

    motionSwitch.click()
    await waitFor(() => expect(document.documentElement.hasAttribute('data-motion')).toBe(false))
  })

  it('a switch that could not be saved goes back to what it was (T-260901-28)', async () => {
    // `renderSettings` above stubs a *succeeding* `settings:set`, which is
    // what every other test here wants. This one fails the write and holds
    // it open until this test says so, and freezes `settings:getAll` after
    // its first answer so the reconciling refetch cannot supply the correct
    // value — the only thing that can put the switch back is
    // `optimisticUpdate`'s own `onError`.
    //
    // The held-open write is what makes the assertions deterministic rather
    // than a race. Asserting the final state alone passes against no fix at
    // all (LESSONS.md line 14's species): `waitFor`'s first poll runs before
    // React has re-rendered the optimistic value, so "still unchecked" is
    // true for a moment whether or not a rollback exists. Watching the
    // switch go *on* and then come back off is the assertion that cannot be
    // satisfied by nothing happening.
    //
    // Before T-260901-28 this page wrote the snapshot with a bare
    // `setQueryData` and had no `onError`: the switch stayed on, claiming a
    // preference main had refused, until the next relaunch. On the settings
    // page of all places.
    let failTheWrite!: () => void
    const writeFailed = new Promise<void>((resolve) => {
      failTheWrite = resolve
    })
    let getCalls = 0
    window.crm = stubCrm({
      'settings:getAll': vi.fn(async () => {
        getCalls += 1
        if (getCalls === 1) return { ok: true as const, data: { ...DEFAULT_SNAPSHOT } }
        return new Promise<never>(() => {})
      }),
      'settings:set': vi.fn(async () => {
        await writeFailed
        return { ok: false as const, error: { code: 'handler-error' as const, message: 'disk is read-only' } }
      })
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsHost />
      </QueryClientProvider>
    )

    await openSection('Integrations')
    // DEFAULT_SNAPSHOT has Gmail off.
    expect(screen.getByRole('switch', { name: 'Gmail' }).getAttribute('aria-checked')).toBe('false')

    fireEvent.click(screen.getByRole('switch', { name: 'Gmail' }))

    // On, optimistically, while the write is still in flight — the half that
    // makes the toggle feel instant, and that must survive this change.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gmail' }).getAttribute('aria-checked')).toBe('true'))

    failTheWrite()

    // And back off, because it could not be stored.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Gmail' }).getAttribute('aria-checked')).toBe('false'))
    // The neighbouring switch is untouched — the rollback restored the
    // snapshot, it did not clear the page's settings out from under it.
    expect(screen.getByRole('switch', { name: 'Stripe' }).getAttribute('aria-checked')).toBe(
      String(DEFAULT_SNAPSHOT['integrations.stripe.enabled'])
    )
  })

  it('the shortcut reference is generated from useGlobalShortcuts.ts — every bound combo appears, none invented', async () => {
    renderSettings()
    await openSection('Help')
    expect(screen.getByRole('heading', { name: 'Shortcuts' })).toBeTruthy()
    for (const shortcut of GLOBAL_SHORTCUTS) {
      // Rendered via the same platform-derived glyph the component uses
      // (lib/platform.ts) rather than a hardcoded ⌘ — jsdom's navigator
      // reads as non-Mac, matching the one platform this app ships on
      // (package.json builds only a Windows NSIS target), so this is
      // 'Ctrl+K'/'Ctrl+L', not the Mac-only glyph a hardcoded assertion
      // would have hidden the same bug behind (T-260828-38 review).
      expect(screen.getByText(formatShortcut(shortcut.key))).toBeTruthy()
      expect(screen.getByText(shortcut.label)).toBeTruthy()
    }
    // Pinned count, not just presence: a shortcut removed from the hook
    // without a matching removal here would otherwise still pass every
    // assertion above.
    expect(screen.getAllByText(/^(⌘|Ctrl\+)[A-Z]$/)).toHaveLength(GLOBAL_SHORTCUTS.length)
  })

  it('keeps the shortcut reference and the tour as two groups in one Help section, in that order', async () => {
    // ADR-014 §2: the tour is not a row inside Shortcuts — "a button that does
    // something is not a keyboard reference" — but it is not a section of its
    // own either. Two `Card.Header`s, one card.
    renderSettings()
    const region = await openSection('Help')
    expect(region.querySelectorAll('.card')).toHaveLength(1)
    expect(Array.from(region.querySelectorAll('.card-h h2')).map((el) => el.textContent)).toEqual([
      'Shortcuts',
      'Guided tour'
    ])
  })

  it('every switch has role="switch" and an accessible name, and every stepper button is a real, keyboard-reachable button', async () => {
    renderSettings()
    for (const label of ['Integrations', 'Backup', 'Appearance']) {
      await openSection(label)
      for (const el of screen.getAllByRole('switch')) {
        expect(el.getAttribute('aria-checked')).toMatch(/^(true|false)$/)
        expect(el.getAttribute('aria-label')).toBeTruthy()
      }
    }
    await openSection('Default cadence')
    for (const el of screen.getAllByRole('button', { name: /^(7|14|30|90)$/ })) {
      expect(el.tagName).toBe('BUTTON')
    }
  })

  it('shows a loading state before the snapshot resolves', () => {
    window.crm = stubCrm({
      'settings:getAll': vi.fn(() => new Promise<never>(() => {}))
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsHost />
      </QueryClientProvider>
    )
    expect(screen.getByText('Loading settings…')).toBeTruthy()
    // No rail either: there is no section to be on until there is a snapshot
    // to show in one.
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
  })

  it('shows the error message when settings:getAll fails', async () => {
    window.crm = stubCrm({
      'settings:getAll': vi.fn(async () => ({ ok: false as const, error: { code: 'handler-error' as const, message: 'boom' } }))
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsHost />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
  })

  // -------------------------------------------------------------------------
  // Guided tour (T-260829-15) — the way back in after a skip. The tour's own
  // behaviour is Tour.test.tsx's subject; what this page owes is that the
  // button opens it, at step 1, on a workspace whose flag is already set.
  // -------------------------------------------------------------------------

  it('“Take the tour” reopens the overlay at step 1 even though onboarding.tourSeen is already true', async () => {
    renderSettings({ 'onboarding.tourSeen': true })
    const region = await openSection('Help')
    const button = within(region).getByRole('button', { name: 'Take the tour' })
    expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull()

    fireEvent.click(button)

    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })
    expect(within(dialog).getByText('1 of 5')).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('closing the reopened tour leaves the flag true — the button is not a way to make the app nag again', async () => {
    renderSettings({ 'onboarding.tourSeen': true })
    const region = await openSection('Help')
    fireEvent.click(within(region).getByRole('button', { name: 'Take the tour' }))
    const dialog = await screen.findByRole('dialog', { name: 'Guided tour' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip tour' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guided tour' })).toBeNull())
    // Every `onboarding.tourSeen` write this page can produce writes `true`.
    // There is no path here that sets it back to `false`.
    for (const call of vi.mocked(window.crm['settings:set']).mock.calls) {
      if (call[0].key === 'onboarding.tourSeen') expect(call[0].value).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // Branding (T-260829-07) — now the Identity section's second group rather
  // than a card of its own (ADR-014 §2), and reached with no rail click since
  // Identity is where the page opens.
  // -------------------------------------------------------------------------

  describe('the Branding group', () => {
    function presentSlot(slot: BrandingSlot): BrandingSlotState {
      return {
        state: 'present',
        slot,
        contentType: 'image/png',
        dataUrl: `data:image/png;base64,${slot === 'icon' ? 'aWNvbg==' : 'bG9nbw=='}`,
        // Exactly 34 KB, so the state line's own rounding is asserted rather
        // than whatever the formatter happens to do to an awkward number.
        byteLength: 34 * 1024,
        updatedAt: '2026-08-29T00:00:00.000Z'
      }
    }

    function absentSlot(slot: BrandingSlot): BrandingSlotState {
      return { state: 'absent', slot }
    }

    function brandingGet(icon: BrandingSlotState, logo: BrandingSlotState): Partial<CrmApi> {
      return { 'branding:get': vi.fn(async () => ({ ok: true as const, data: { icon, logo } })) }
    }

    /** `branding:get` reading back what `branding:clear` wrote, so a Remove can be asserted through the invalidation rather than only at the channel. */
    function statefulBranding(initial: { icon: BrandingSlotState; logo: BrandingSlotState }) {
      const slots = { ...initial }
      const clear = vi.fn(async ({ slot }: { slot: BrandingSlot }) => {
        slots[slot] = absentSlot(slot)
        return { ok: true as const, data: { ok: true as const, data: slots[slot] } }
      })
      return {
        clear,
        overrides: {
          'branding:get': vi.fn(async () => ({ ok: true as const, data: { ...slots } })),
          'branding:clear': clear
        } satisfies Partial<CrmApi>
      }
    }

    function renderBranding(overrides: Partial<CrmApi> = {}) {
      window.crm = stubCrm({
        'settings:getAll': vi.fn(async () => ({ ok: true as const, data: { ...DEFAULT_SNAPSHOT } })),
        ...overrides
      })
      return render(
        <QueryClientProvider client={createQueryClient()}>
          <SettingsHost />
        </QueryClientProvider>
      )
    }

    it('sits inside the Identity section as a second header, not a card of its own', async () => {
      renderBranding()
      const region = await screen.findByRole('region', { name: 'Identity' })
      expect(region.querySelectorAll('.card')).toHaveLength(1)
      expect(Array.from(region.querySelectorAll('.card-h h2')).map((el) => el.textContent)).toEqual([
        'Identity',
        'Branding'
      ])
    })

    it('shows the built-in default in both rows when nothing is set, and offers no Remove', async () => {
      renderBranding()
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      const logoRow = screen.getByRole('group', { name: 'Logo' })

      for (const row of [iconRow, logoRow]) {
        expect(within(row).getByText('Solo CRM default')).toBeTruthy()
        // The built-in mark and wordmark are inline SVG, drawn from the same
        // components the rail draws — not an <img>, which is what a custom
        // slot renders and what these tests tell the two states apart by.
        expect(row.querySelector('svg')).toBeTruthy()
        expect(row.querySelector('img')).toBeNull()
        expect(within(row).getByRole('button', { name: 'Upload…' })).toBeTruthy()
        expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull()
      }
    })

    it('shows a custom slot as its own image, with format and size, and offers Replace and Remove', async () => {
      renderBranding(brandingGet(presentSlot('icon'), presentSlot('logo')))
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(iconRow.querySelector('img')).toBeTruthy())

      // `data:` is the only image transport the renderer's CSP admits.
      expect(iconRow.querySelector('img')?.getAttribute('src')?.startsWith('data:image/')).toBe(true)
      expect(iconRow.querySelector('img')?.getAttribute('alt')).toBe('')
      expect(within(iconRow).getByText('Custom · PNG · 34 KB')).toBeTruthy()
      expect(within(iconRow).getByRole('button', { name: 'Replace…' })).toBeTruthy()
      expect(within(iconRow).getByRole('button', { name: 'Remove' })).toBeTruthy()
      expect(within(iconRow).queryByRole('button', { name: 'Upload…' })).toBeNull()
    })

    it('never names a file — the channel returns no path and the card must not invent one', async () => {
      renderBranding(brandingGet(presentSlot('icon'), presentSlot('logo')))
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(iconRow.querySelector('img')).toBeTruthy())
      expect(iconRow.textContent).not.toMatch(/[\\/]|\.png/i)
    })

    it('keeps the two slots independent — a custom icon renders one image and one built-in SVG', async () => {
      renderBranding(brandingGet(presentSlot('icon'), absentSlot('logo')))
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(iconRow.querySelector('img')).toBeTruthy())

      const logoRow = screen.getByRole('group', { name: 'Logo' })
      expect(logoRow.querySelector('img')).toBeNull()
      expect(logoRow.querySelector('svg.wordmark')).toBeTruthy()
      expect(within(logoRow).getByText('Solo CRM default')).toBeTruthy()
      expect(within(logoRow).queryByRole('button', { name: 'Remove' })).toBeNull()
    })

    it('Remove clears that slot alone, and the row returns to the built-in default', async () => {
      const branding = statefulBranding({ icon: presentSlot('icon'), logo: presentSlot('logo') })
      renderBranding(branding.overrides)
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(iconRow.querySelector('img')).toBeTruthy())

      fireEvent.click(within(iconRow).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(within(iconRow).getByText('Solo CRM default')).toBeTruthy())

      expect(branding.clear).toHaveBeenCalledWith({ slot: 'icon' })
      expect(iconRow.querySelector('img')).toBeNull()
      expect(screen.getByRole('group', { name: 'Logo' }).querySelector('img')).toBeTruthy()
    })

    it('shows a refusal beside the row that failed, and nowhere else', async () => {
      const message = 'That image is not a format Solo CRM can store. SVG is not accepted.'
      renderBranding({
        'branding:choose': vi.fn(async () => ({
          ok: true as const,
          data: { ok: false as const, error: { code: 'validation' as const, message } }
        }))
      })
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      fireEvent.click(within(iconRow).getByRole('button', { name: 'Upload…' }))

      await waitFor(() => expect(within(iconRow).getByRole('alert').textContent).toBe(message))
      expect(within(screen.getByRole('group', { name: 'Logo' })).queryByRole('alert')).toBeNull()
    })

    it('a cancelled picker produces no error state anywhere in the card', async () => {
      // Cancellation arrives as `{ ok: true, data: { outcome: 'cancelled' } }`
      // — a success branch, not an error — so nothing must appear.
      const choose = vi.fn(async () => ({
        ok: true as const,
        data: { ok: true as const, data: { outcome: 'cancelled' as const } }
      }))
      renderBranding({ 'branding:choose': choose })
      const iconRow = await screen.findByRole('group', { name: 'Icon' })
      fireEvent.click(within(iconRow).getByRole('button', { name: 'Upload…' }))

      await waitFor(() => expect(choose).toHaveBeenCalledWith({ slot: 'icon' }))
      expect(screen.queryByRole('alert')).toBeNull()
      expect(within(iconRow).getByText('Solo CRM default')).toBeTruthy()
    })

    it('says what is accepted, the cap, and that SVG is not one of them — behind the info popover, since the control enforces it anyway', async () => {
      renderBranding()
      await screen.findByRole('group', { name: 'Icon' })
      // Not in the flow: ADR-014 §4 classes this as explanation, not state,
      // because a refused pick already renders its own reason beside the row.
      expect(screen.queryByText(/SVG is not one of them/)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'About Branding' }))
      const panel = await screen.findByText(/SVG is not one of them/)
      expect(panel.textContent).toContain('512 KB')
      for (const format of ['PNG', 'JPEG', 'WebP', 'GIF', 'BMP', 'ICO']) {
        expect(panel.textContent).toContain(format)
      }
    })

    it('shares one branding:get with the rail — opening settings issues no second fetch', async () => {
      // The acceptance criterion, pinned behaviourally rather than by grepping
      // for the key: `staleTime` is Infinity, so two *different* keys would
      // each fetch exactly once and this count would be 2. It is 1 only while
      // Rail.tsx and WorkspaceSettings.tsx name the same
      // `queryKeys.branding.current()`, which is precisely what a later
      // refactor can separate without anything else failing.
      const get = vi.fn(async () => ({
        ok: true as const,
        data: { icon: absentSlot('icon'), logo: absentSlot('logo') }
      }))
      window.crm = stubCrm({
        'branding:get': get,
        'settings:getAll': vi.fn(async () => ({ ok: true as const, data: { ...DEFAULT_SNAPSHOT } }))
      })
      render(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter initialEntries={['/workspace/settings']}>
            <LayerManager>
              <Rail open={false} onNavigate={() => {}} />
              <WorkspaceSettings />
            </LayerManager>
          </MemoryRouter>
        </QueryClientProvider>
      )

      await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(get).toHaveBeenCalled())
      expect(get).toHaveBeenCalledTimes(1)
    })
  })
})
