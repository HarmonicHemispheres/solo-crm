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
import { SETTINGS_KEYS, type SettingsSnapshot } from '../../shared/settings'
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
  'view.data.snippets': []
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
      <WorkspaceSettings />
    </QueryClientProvider>
  )
}

describe('WorkspaceSettings', () => {
  it('every §6.11 key has a visible control', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByLabelText('Workspace')).toBeTruthy())

    expect(screen.getByLabelText('Workspace')).toHaveProperty('value', 'MagicPill Labs')
    expect(screen.getByLabelText('Operator')).toHaveProperty('value', 'Robby Boney')
    expect(screen.getByLabelText('Currency')).toHaveProperty('value', 'USD')
    expect(screen.getByLabelText('Fiscal year start month')).toHaveProperty('value', '1')

    for (const label of ['Client', 'End client', 'Prospect', 'Advisory', 'Channel']) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    expect(screen.getByRole('switch', { name: 'Stripe' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Google Calendar' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Gmail' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Nightly JSON export' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Interface motion' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Compact density' })).toBeTruthy()
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
      'view.data.snippets'
    ])
    expect([...SETTINGS_KEYS].sort()).toEqual([...covered].sort())
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
    // this task's acceptance: "a setting changed, the app restarted, and the
    // change still in effect."
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceSettings />
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

  it('the cadence panel states plainly that a change moves no company yet (P2-02 is not built)', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Default cadence')).toBeTruthy())
    expect(screen.getByText(/has no effect on any company until then/)).toBeTruthy()

    const clientRow = screen.getByText('Client').closest('.setrow') as HTMLElement
    const step14 = within(clientRow).getByRole('button', { name: '14' })
    step14.click()
    await waitFor(() =>
      expect(window.crm['settings:set']).toHaveBeenCalledWith({ key: 'cadence.defaultDays.client', value: 14 })
    )
  })

  it('each integration switch reflects its own stored value, not just its presence', async () => {
    // DEFAULT_SNAPSHOT stores Stripe/Calendar on and Gmail off — a real,
    // mixed snapshot. `checked={snapshot[key]}` replaced with `checked={true}`
    // (the reviewer's mutant) renders every switch on regardless of what is
    // stored; the presence-only assertions elsewhere in this file don't
    // notice, because they only check the switch exists. This does.
    renderSettings()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Stripe' })).toBeTruthy())

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
    await waitFor(() => expect(screen.getByText('Client')).toBeTruthy())

    const clientRow = screen.getByText('Client').closest('.setrow') as HTMLElement
    expect(within(clientRow).getByRole('button', { name: '7' }).getAttribute('aria-pressed')).toBe('true')
    for (const other of ['14', '30', '90']) {
      expect(within(clientRow).getByRole('button', { name: other }).getAttribute('aria-pressed')).toBe('false')
    }

    const channelRow = screen.getByText('Channel').closest('.setrow') as HTMLElement
    expect(within(channelRow).getByRole('button', { name: '30' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(channelRow).getByRole('button', { name: '7' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('states pull-only in the rendered output, not only in source', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Integrations')).toBeTruthy())
    expect(screen.getByText('pull-only')).toBeTruthy()
    expect(screen.getByText(/never writes back/)).toBeTruthy()
  })

  it('the backup folder picker states plainly that it is not wired, and issues no filesystem call of its own', async () => {
    renderSettings({ 'backup.folder': '~/Documents/SoloCRM/backups' })
    await waitFor(() => expect(screen.getByText('~/Documents/SoloCRM/backups')).toBeTruthy())
    const chooseButton = screen.getByRole('button', { name: 'Choose folder' })
    expect(chooseButton).toHaveProperty('disabled', true)
    expect(screen.getByText(/needs a main-process dialog channel that doesn't exist/)).toBeTruthy()
  })

  it('no credential field appears anywhere on the page (ADR-004)', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy())
    const bodyText = document.body.textContent ?? ''
    for (const word of ['api key', 'apikey', 'token', 'secret', 'password', 'credential']) {
      expect(bodyText.toLowerCase()).not.toContain(word)
    }
  })

  it('turning interface motion off sets data-motion="off" on the document root, and back on removes it', async () => {
    renderSettings()
    const motionSwitch = await screen.findByRole('switch', { name: 'Interface motion' })
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)

    motionSwitch.click()
    await waitFor(() => expect(document.documentElement.getAttribute('data-motion')).toBe('off'))

    motionSwitch.click()
    await waitFor(() => expect(document.documentElement.hasAttribute('data-motion')).toBe(false))
  })

  it('compact density says plainly that no view applies it yet', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Compact density')).toBeTruthy())
    expect(screen.getByText(/no view applies compact density yet/)).toBeTruthy()
  })

  it('the shortcut reference is generated from useGlobalShortcuts.ts — every bound combo appears, none invented', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Shortcuts')).toBeTruthy())
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

  it('every switch has role="switch" and an accessible name, and every stepper button is a real, keyboard-reachable button', async () => {
    renderSettings()
    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy())
    for (const el of screen.getAllByRole('switch')) {
      expect(el.getAttribute('aria-checked')).toMatch(/^(true|false)$/)
      expect(el.getAttribute('aria-label')).toBeTruthy()
    }
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
        <WorkspaceSettings />
      </QueryClientProvider>
    )
    expect(screen.getByText('Loading settings…')).toBeTruthy()
  })

  it('shows the error message when settings:getAll fails', async () => {
    window.crm = stubCrm({
      'settings:getAll': vi.fn(async () => ({ ok: false as const, error: { code: 'handler-error' as const, message: 'boom' } }))
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceSettings />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
  })

  // -------------------------------------------------------------------------
  // Branding (T-260829-07)
  // -------------------------------------------------------------------------

  describe('the Branding card', () => {
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
          <WorkspaceSettings />
        </QueryClientProvider>
      )
    }

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

    it('says what is accepted, the cap, and that SVG is not one of them', async () => {
      renderBranding()
      await waitFor(() => expect(screen.getByText('Branding')).toBeTruthy())
      const caption = screen.getByText(/SVG is not one of them/)
      expect(caption.textContent).toContain('512 KB')
      for (const format of ['PNG', 'JPEG', 'WebP', 'GIF', 'BMP', 'ICO']) {
        expect(caption.textContent).toContain(format)
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
            <Rail open={false} onNavigate={() => {}} />
            <WorkspaceSettings />
          </MemoryRouter>
        </QueryClientProvider>
      )

      await screen.findByRole('group', { name: 'Icon' })
      await waitFor(() => expect(get).toHaveBeenCalled())
      expect(get).toHaveBeenCalledTimes(1)
    })
  })
})
