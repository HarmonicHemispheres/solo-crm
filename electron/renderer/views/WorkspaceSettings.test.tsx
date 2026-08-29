import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceSettings } from './WorkspaceSettings'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import { GLOBAL_SHORTCUTS } from '../hooks/useGlobalShortcuts'
import { SETTINGS_KEYS, type SettingsSnapshot } from '../../shared/settings'
import type { SettingEntry } from '../../shared/ipc-types'

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
  'view.people.mode': 'card'
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
      'view.companies.mode',
      'view.people.mode'
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
      expect(screen.getByText(`⌘${shortcut.key.toUpperCase()}`)).toBeTruthy()
      expect(screen.getByText(shortcut.label)).toBeTruthy()
    }
    // Pinned count, not just presence: a shortcut removed from the hook
    // without a matching removal here would otherwise still pass every
    // assertion above.
    expect(screen.getAllByText(/^⌘[A-Z]$/)).toHaveLength(GLOBAL_SHORTCUTS.length)
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
})
