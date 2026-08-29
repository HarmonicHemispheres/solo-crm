import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { EmptyState } from '../components/primitives/EmptyState'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { GLOBAL_SHORTCUTS } from '../hooks/useGlobalShortcuts'
import { COMPANY_KINDS, type CompanyKind } from '../../shared/companies'
import {
  CURRENCY_CODES,
  INTEGRATION_SOURCES,
  type CurrencyCode,
  type DensityMode,
  type IntegrationSource,
  type SettingKey,
  type SettingValue,
  type SettingsSnapshot
} from '../../shared/settings'
import type { SettingEntry } from '../../shared/ipc-types'
import './WorkspaceSettings.css'

/**
 * `/workspace/settings` (T-260828-38) — the first of the two blank pages the
 * user hit in the installed build. Five cards, one per §6.11 bullet:
 * Identity, Default cadence, Integrations, Backup & appearance, Shortcuts.
 *
 * Every value shown reads and writes through T-260828-25's settings
 * repository (`settings:getAll` / `settings:set`) — there is no second
 * store. Two panels describe behaviour that has not landed anywhere in the
 * app yet, and say so in the interface rather than storing a value and
 * implying an effect (this task's Risks, and the run instructions this task
 * was built under): the cadence card's defaults do not move any company
 * until P2-02 exists, and the backup folder has no picker to open until a
 * main-process dialog channel exists — see the note beside each. Neither is
 * hidden; both are visible, working controls with an honest caption.
 */

// ---------------------------------------------------------------------------
// Reading/writing one declared key — `settings:set`'s request shape pairs a
// literal key with that key's own value type (`SettingEntry`,
// electron/shared/ipc-types.ts); a value built from a still-generic `K`
// cannot be proven to match that pairing at the type level (the same
// widening `registry.ts`'s own `readSettingEntry` documents), so this is the
// one cast, in the one place, `registry.ts` already established the pattern
// for.
// ---------------------------------------------------------------------------

function settingEntry<K extends SettingKey>(key: K, value: SettingValue<K>): SettingEntry {
  return { key, value } as SettingEntry
}

function useSettingsSnapshot() {
  return useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
}

function useSetSetting() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (entry: SettingEntry) => callCrm('settings:set', entry).then(unwrapMutationResult),
    onSuccess: () => invalidate.settings(queryClient)
  })

  return function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>) {
    // Written to the cache immediately (Companies.tsx's own
    // `handleModeChange` pattern) so every switch/select/stepper here feels
    // instant; the mutation's `onSuccess` invalidation reconciles this key
    // with whatever main actually stored.
    queryClient.setQueryData(queryKeys.settings.list(), (current: SettingsSnapshot | undefined) =>
      current ? { ...current, [key]: value } : current
    )
    mutation.mutate(settingEntry(key, value))
  }
}

// ---------------------------------------------------------------------------
// The boolean on/off row — the mockup's `.switch` (Toggle.tsx's own header:
// not that component, "used in exactly one view and stays there").
// ---------------------------------------------------------------------------

function SettingSwitch({
  label,
  note,
  checked,
  onChange
}: {
  label: string
  note?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="setrow">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="setrow-label">{label}</div>
        {note != null && <div className="meta" style={{ marginTop: 2 }}>{note}</div>}
      </div>
      <button
        type="button"
        className={checked ? 'switch on' : 'switch'}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Identity — workspace name, operator, currency, fiscal year start.
// ---------------------------------------------------------------------------

/**
 * Local draft state, committed on blur — the same "don't write on every
 * keystroke" shape CompanyDetail.tsx's inline edit uses, simplified since
 * this field has no separate view/edit mode (it's always an input, matching
 * the mockup). Re-syncing `draft` when `value` changes from outside (this
 * same commit's own reconciling invalidation, a future second writer) is
 * "adjusting state when a prop changes" — React's own guidance for that is
 * a `key`, not a `useEffect` that calls `setState` (the lint rule this
 * avoids: cascading a second render off the first). The caller passes
 * `key={value}`, so a value that actually changed underneath this field
 * remounts it with a fresh initial draft instead.
 */
function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value)

  return (
    <div className="field">
      <span className="k">{label}</span>
      <span className="v">
        <input
          className="inp"
          value={draft}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== value) onCommit(draft)
          }}
        />
      </span>
    </div>
  )
}

const MONTH_LABEL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

function IdentityCard({
  snapshot,
  setSetting
}: {
  snapshot: SettingsSnapshot
  setSetting: <K extends SettingKey>(key: K, value: SettingValue<K>) => void
}) {
  return (
    <Card>
      <Card.Header title="Identity" />
      <TextField
        key={snapshot['workspace.name']}
        label="Workspace"
        value={snapshot['workspace.name']}
        onCommit={(v) => setSetting('workspace.name', v)}
      />
      <TextField
        key={snapshot['workspace.operator']}
        label="Operator"
        value={snapshot['workspace.operator']}
        onCommit={(v) => setSetting('workspace.operator', v)}
      />
      <div className="field">
        <span className="k">Currency</span>
        <span className="v">
          <select
            className="inp"
            aria-label="Currency"
            value={snapshot['workspace.currency']}
            onChange={(event) => setSetting('workspace.currency', event.target.value as CurrencyCode)}
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="field">
        <span className="k">Fiscal year</span>
        <span className="v">
          <select
            className="inp"
            aria-label="Fiscal year start month"
            value={snapshot['workspace.fiscalYearStartMonth']}
            onChange={(event) => setSetting('workspace.fiscalYearStartMonth', Number(event.target.value))}
          >
            {MONTH_LABEL.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </span>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Default cadence — one row per COMPANY_KINDS member, matching the pinned
// 1:1 relationship electron/shared/settings.ts's own header describes
// between that array and the `cadence.defaultDays.*` keys.
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis',
  prospect: 'gold'
}

const CADENCE_STEPS = [7, 14, 30, 90] as const

function cadenceKey(kind: CompanyKind): SettingKey {
  return `cadence.defaultDays.${kind}` as SettingKey
}

function CadenceCard({
  snapshot,
  setSetting
}: {
  snapshot: SettingsSnapshot
  setSetting: <K extends SettingKey>(key: K, value: SettingValue<K>) => void
}) {
  return (
    <Card>
      <Card.Header title="Default cadence" actions={<span className="meta">days between touches</span>} />
      {COMPANY_KINDS.map((kind) => {
        const key = cadenceKey(kind)
        const value = snapshot[key] as number
        return (
          <div className="setrow" key={kind}>
            <div style={{ flex: 1 }}>
              <Tag variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
            </div>
            <div className="steps" role="group" aria-label={`${KIND_LABEL[kind]} default cadence, days`}>
              {CADENCE_STEPS.map((step) => (
                <button
                  key={step}
                  type="button"
                  className={step === value ? 'stepb on' : 'stepb'}
                  aria-pressed={step === value}
                  onClick={() => setSetting(key, step)}
                >
                  {step}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <p className="meta settings-foot">
        Sets the stored default for new companies of this kind. Applying it — inheriting into new companies,
        moving existing ones off their old default — is not built yet (P2-02); changing a value here has no effect
        on any company until then.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Integrations — pull-only, stated in the interface, not only in a comment.
// ---------------------------------------------------------------------------

const INTEGRATION_LABEL: Record<IntegrationSource, string> = {
  stripe: 'Stripe',
  googleCalendar: 'Google Calendar',
  gmail: 'Gmail'
}

const INTEGRATION_NOTE: Record<IntegrationSource, string> = {
  stripe: 'Invoice status → revenue lines',
  googleCalendar: 'Meetings → activity log',
  gmail: 'Last-contacted timestamp only, no message bodies'
}

function integrationKey(source: IntegrationSource): SettingKey {
  return `integrations.${source}.enabled` as SettingKey
}

function IntegrationsCard({
  snapshot,
  setSetting
}: {
  snapshot: SettingsSnapshot
  setSetting: <K extends SettingKey>(key: K, value: SettingValue<K>) => void
}) {
  return (
    <Card>
      <Card.Header title="Integrations" count="pull-only" />
      {INTEGRATION_SOURCES.map((source) => {
        const key = integrationKey(source)
        return (
          <SettingSwitch
            key={source}
            label={INTEGRATION_LABEL[source]}
            note={INTEGRATION_NOTE[source]}
            checked={snapshot[key] as boolean}
            onChange={(next) => setSetting(key, next)}
          />
        )
      })}
      <p className="meta settings-foot">
        Every source above is pull-only. Solo CRM never writes back to Stripe, Google Calendar or Gmail.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Backup & appearance — one card, matching the mockup's own grouping.
// ---------------------------------------------------------------------------

function BackupAppearanceCard({
  snapshot,
  setSetting
}: {
  snapshot: SettingsSnapshot
  setSetting: <K extends SettingKey>(key: K, value: SettingValue<K>) => void
}) {
  const density = snapshot['appearance.density']
  return (
    <Card>
      <Card.Header title="Backup & appearance" />
      <SettingSwitch
        label="Nightly JSON export"
        note="Keeps the last 30 snapshots"
        checked={snapshot['backup.enabled']}
        onChange={(next) => setSetting('backup.enabled', next)}
      />
      <div className="field">
        <span className="k">Folder</span>
        <span className="v mono trunc">{snapshot['backup.folder'] || '—'}</span>
        <Button
          variant="ghost"
          disabled
          aria-disabled="true"
          title="Not built yet — the folder picker needs a main-process dialog channel (see this run's report)"
        >
          Choose folder
        </Button>
      </div>
      <p className="meta settings-foot">
        Choosing a folder here isn't wired yet — it needs a main-process dialog channel that doesn't exist in this
        build. The nightly export itself is a separate, later task (X-04).
      </p>
      <SettingSwitch
        label="Interface motion"
        note="Off also honours the system reduced-motion setting"
        checked={snapshot['appearance.motion']}
        onChange={(next) => setSetting('appearance.motion', next)}
      />
      <SettingSwitch
        label="Compact density"
        note="Tighter rows and smaller type"
        checked={density === 'compact'}
        onChange={(next) => setSetting('appearance.density', (next ? 'compact' : 'comfortable') as DensityMode)}
      />
      <p className="meta settings-foot">Stored for later use — no view applies compact density yet.</p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Shortcuts — read-only, generated from useGlobalShortcuts.ts's own
// `GLOBAL_SHORTCUTS` registry rather than hand-typed (this task's Scope), so
// a combo added or removed there can never leave this list stale.
// ---------------------------------------------------------------------------

function ShortcutsCard() {
  return (
    <Card>
      <Card.Header title="Shortcuts" />
      {GLOBAL_SHORTCUTS.map((shortcut) => (
        <div className="field" key={shortcut.key}>
          <span className="k">
            <span className="kbdx">⌘{shortcut.key.toUpperCase()}</span>
          </span>
          <span className="v">{shortcut.label}</span>
        </div>
      ))}
      <div className="field">
        <span className="k">
          <span className="kbdx">Esc</span>
        </span>
        <span className="v">Close whatever panel is open</span>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Motion — the in-app override for `appearance.motion`, mirroring the OS
// `prefers-reduced-motion` effect base.css already handles centrally. Writes
// a `data-motion` attribute to the document root rather than a component
// style: base.css's rule targets that attribute globally (every view, not
// just this one), and no cleanup runs on unmount — the setting is a
// workspace-wide preference, not something scoped to this page being open.
// Known gap: a session that never visits this view before another one
// renders sees the OS default rather than a previously-saved "off" until
// this effect has run once — closing that needs the same read to happen at
// the app shell (App.tsx/Shell.tsx), which this task's Touches does not
// include; noted in the run's report as a fast-follow rather than expanded
// into here.
// ---------------------------------------------------------------------------

function useMotionAttribute(motionOn: boolean | undefined) {
  useEffect(() => {
    if (motionOn == null) return
    if (motionOn) {
      document.documentElement.removeAttribute('data-motion')
    } else {
      document.documentElement.setAttribute('data-motion', 'off')
    }
  }, [motionOn])
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.5a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-3-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-3l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.1a1.7 1.7 0 003 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}

export function WorkspaceSettings() {
  const settingsQuery = useSettingsSnapshot()
  const setSetting = useSetSetting()
  useMotionAttribute(settingsQuery.data?.['appearance.motion'])

  const header = <ViewHeader icon={<SettingsGlyph />} accent="var(--verdigris)" title="Workspace" />

  if (settingsQuery.isPending) {
    return (
      <div>
        {header}
        <p className="meta">Loading settings…</p>
      </div>
    )
  }

  if (settingsQuery.error) {
    return (
      <div>
        {header}
        <EmptyState>{settingsQuery.error.message}</EmptyState>
      </div>
    )
  }

  const snapshot = settingsQuery.data

  return (
    <div>
      {header}
      <div className="settings-grid">
        <IdentityCard snapshot={snapshot} setSetting={setSetting} />
        <CadenceCard snapshot={snapshot} setSetting={setSetting} />
        <IntegrationsCard snapshot={snapshot} setSetting={setSetting} />
        <BackupAppearanceCard snapshot={snapshot} setSetting={setSetting} />
        <ShortcutsCard />
      </div>
    </div>
  )
}
