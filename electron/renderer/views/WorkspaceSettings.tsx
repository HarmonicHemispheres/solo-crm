import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { EmptyState } from '../components/primitives/EmptyState'
import { SoloCrmMark, SoloCrmWordmark } from '../components/shell/BrandMarks'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { GLOBAL_SHORTCUTS } from '../hooks/useGlobalShortcuts'
import { useMotionAttribute } from '../hooks/useMotionAttribute'
import { formatShortcut } from '../lib/platform'
import {
  BRANDING_CONTENT_TYPES,
  BRANDING_MAX_BYTES,
  BRANDING_SLOTS,
  type BrandingContentType,
  type BrandingSlot,
  type BrandingSlotState
} from '../../shared/branding'
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
 * Identity, Default cadence, Integrations, Backup & appearance, Shortcuts —
 * plus Branding (T-260829-07), the one card here that does not read or write
 * `settings` at all: an image is not a setting value, it lives in its own
 * table behind its own channels (`electron/shared/branding.ts`) — and Guided
 * tour (T-260829-15), which writes no setting from this page either: it
 * reopens the first-run overlay through the layer manager and the overlay
 * owns its own `onboarding.tourSeen` write.
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
// Branding — the operator's own icon and wordmark (T-260829-07). The two slots
// are independent: replacing the icon leaves the logo alone, and either can go
// back to the built-in default on its own.
//
// Nothing here is optimistic. What a pick produces depends on a native dialog
// the renderer cannot predict — the operator may cancel — and on a refusal it
// cannot anticipate, since the format is decided in main by the bytes' own
// magic number rather than by anything this side says the file is. So the only
// image shown is the one a channel actually came back with.
// ---------------------------------------------------------------------------

const SLOT_LABEL: Record<BrandingSlot, string> = { icon: 'Icon', logo: 'Logo' }

/**
 * `image/png` → `PNG`. A declared map over the shared list rather than
 * `contentType.split('/')[1].toUpperCase()`, for the same reason
 * `CADENCE_SETTING_KEY` below is a literal: a format added to
 * `BRANDING_CONTENT_TYPES` fails `tsc` here instead of quietly rendering
 * `X-ICON` in a state line.
 */
const CONTENT_TYPE_LABEL: Record<BrandingContentType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
  'image/x-icon': 'ICO'
}

/** The accepted set as the caption says it, composed from the shared list so the sentence cannot drift from what main will take. */
const ACCEPTED_FORMATS = BRANDING_CONTENT_TYPES.map((type) => CONTENT_TYPE_LABEL[type])
const ACCEPTED_FORMAT_LIST = `${ACCEPTED_FORMATS.slice(0, -1).join(', ')} or ${ACCEPTED_FORMATS[ACCEPTED_FORMATS.length - 1]}`

/** Bytes as the operator reads them. The cap is 512 KB, so there is no megabyte branch to get wrong. */
function formatByteLength(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}

/**
 * The state line under each preview. "Custom" and "Solo CRM default" are the
 * operator's words for the two branches — the discriminant itself is
 * `present`/`absent`, and no filename appears in either: the channel does not
 * return one and must not start (`electron/main/branding/picker.ts`).
 */
function slotStateLine(state: BrandingSlotState): string {
  return state.state === 'present'
    ? `Custom · ${CONTENT_TYPE_LABEL[state.contentType]} · ${formatByteLength(state.byteLength)}`
    : 'Solo CRM default'
}

/**
 * One slot's row. The preview is drawn from the *same* two components the rail
 * draws (`components/shell/BrandMarks.tsx`) into the *same* two boxes
 * (`.mark`, `.wordmark`, declared once in Rail.css), so what the operator sees
 * here is what the rail will do — including a near-square image rendering
 * small inside the 104px wordmark slot, which is correct behaviour and better
 * learned in the card than afterwards.
 *
 * `role="group"` with the slot's own label is what gives the two buttons their
 * context: two rows both offering "Upload…" are ambiguous read out on their
 * own, and an `aria-label` on the button would have replaced its visible text
 * rather than qualified it.
 */
function BrandingRow({
  state,
  message,
  onChoose,
  onClear
}: {
  state: BrandingSlotState
  message?: string
  onChoose: () => void
  onClear: () => void
}) {
  const label = SLOT_LABEL[state.slot]
  return (
    <div className="field brandrow" role="group" aria-label={label}>
      <span className="k">{label}</span>
      <span className="v brandrow-v">
        <span className="brandrow-prev">
          {state.slot === 'icon' ? (
            <span className="mark">
              {state.state === 'present' ? (
                <img src={state.dataUrl} alt="" />
              ) : (
                <SoloCrmMark gradientId="branding-preview-mark" />
              )}
            </span>
          ) : state.state === 'present' ? (
            <img className="wordmark" src={state.dataUrl} alt="" />
          ) : (
            <SoloCrmWordmark className="wordmark" />
          )}
        </span>
        <span className="brandrow-text">
          <span className="meta">{slotStateLine(state)}</span>
          {message != null && (
            <span className="meta brandrow-error" role="alert">
              {message}
            </span>
          )}
        </span>
      </span>
      <Button variant="ghost" onClick={onChoose}>
        {state.state === 'present' ? 'Replace…' : 'Upload…'}
      </Button>
      {state.state === 'present' && (
        <Button variant="ghost" onClick={onClear}>
          Remove
        </Button>
      )}
    </div>
  )
}

function BrandingCard() {
  const queryClient = useQueryClient()
  // The key `Rail.tsx` reads on too — that sharing is why opening this page
  // issues no second `branding:get`.
  const brandingQuery = useQuery({ queryKey: queryKeys.branding.current(), queryFn: ipcQueryFn('branding:get') })

  // One refusal at a time, remembered with the slot it belongs to so the
  // message lands beside the row that failed rather than under the card.
  const [failure, setFailure] = useState<{ slot: BrandingSlot; message: string } | null>(null)

  const chooseImage = useMutation({
    mutationFn: (slot: BrandingSlot) => callCrm('branding:choose', { slot }).then(unwrapMutationResult),
    onSuccess: async (choice) => {
      // Cancelling is a success that changed nothing (`brandingChoiceSchema`),
      // so it shows nothing: no error raised, and no standing message cleared
      // either — the operator changed their mind, they did not fix anything.
      if (choice.outcome === 'cancelled') return
      setFailure(null)
      await invalidate.branding(queryClient)
    },
    onError: (error, slot) => setFailure({ slot, message: error.message })
  })

  const clearImage = useMutation({
    mutationFn: (slot: BrandingSlot) => callCrm('branding:clear', { slot }).then(unwrapMutationResult),
    onSuccess: async () => {
      setFailure(null)
      await invalidate.branding(queryClient)
    },
    onError: (error, slot) => setFailure({ slot, message: error.message })
  })

  const snapshot = brandingQuery.data

  return (
    <Card>
      <Card.Header title="Branding" />
      {BRANDING_SLOTS.map((slot) => (
        <BrandingRow
          key={slot}
          // `absent` is an answer, not a pending read — and so is the
          // `undefined` here while the query is in flight. Both render the
          // built-in default, which is what the rail is showing meanwhile.
          state={snapshot?.[slot] ?? { state: 'absent', slot }}
          message={failure?.slot === slot ? failure.message : undefined}
          onChoose={() => chooseImage.mutate(slot)}
          onClear={() => clearImage.mutate(slot)}
        />
      ))}
      <p className="meta settings-foot">
        {ACCEPTED_FORMAT_LIST}, up to {BRANDING_MAX_BYTES / 1024} KB per slot. SVG is not one of them: it is a
        document format that can carry script, and these two images render inside the app&rsquo;s own chrome on
        every view — so Solo CRM stores an image&rsquo;s pixels here, never a document. Choosing one says so
        rather than failing quietly. The format is decided by the file&rsquo;s own bytes, not its extension.
      </p>
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

/**
 * The one place `cadence.defaultDays.<kind>` keys are composed, as a literal
 * map rather than a template-literal function — ADR-002 rule 3 names a key
 * built at a call site a defect outright ("it makes what settings exist
 * unanswerable by grep"), and Companies.tsx's `MODE_SETTING_KEY` const is
 * the merged precedent for declaring one instead. A literal here also drops
 * the `as SettingKey` cast the function version needed: `tsc` proves each
 * value against the `SettingKey` union on its own, and — the direction that
 * actually matters — a `cadence.defaultDays.*` key renamed or dropped from
 * `SETTINGS_REGISTRY` now fails this file to compile instead of silently
 * reading `undefined` from `snapshot` and writing a key the repository
 * rejects.
 */
const CADENCE_SETTING_KEY: Record<CompanyKind, SettingKey> = {
  client: 'cadence.defaultDays.client',
  end_client: 'cadence.defaultDays.end_client',
  prospect: 'cadence.defaultDays.prospect',
  advisory: 'cadence.defaultDays.advisory',
  channel: 'cadence.defaultDays.channel'
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
        const key = CADENCE_SETTING_KEY[kind]
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

/** Same reasoning as `CADENCE_SETTING_KEY` above — a declared literal map, no call-site key composition, no cast. */
const INTEGRATION_SETTING_KEY: Record<IntegrationSource, SettingKey> = {
  stripe: 'integrations.stripe.enabled',
  googleCalendar: 'integrations.googleCalendar.enabled',
  gmail: 'integrations.gmail.enabled'
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
        const key = INTEGRATION_SETTING_KEY[source]
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
            <span className="kbdx">{formatShortcut(shortcut.key)}</span>
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
// Guided tour — the way back into T-260829-15's first-run walkthrough after
// it has been skipped or finished. A card of its own rather than a row in
// Shortcuts: that card's own header says it is generated from
// `GLOBAL_SHORTCUTS` and is read-only, and a button that *does* something is
// not a keyboard reference. It is also the thing an operator would come here
// looking for by name, which a list of key combinations does not answer.
//
// It reopens the overlay without clearing `onboarding.tourSeen` — the flag
// stays `true` and closing the tour again writes `true` again. Dismissal is
// final on its own; this is the operator asking, which is the only way back
// this feature has.
// ---------------------------------------------------------------------------

function GuidedTourCard() {
  const { openLayer } = useLayerManager()
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <Card>
      <Card.Header title="Guided tour" />
      <div className="field">
        <span className="k">Five screens</span>
        <span className="v">Today, Companies, People, Engagements, Workspace</span>
        <Button ref={triggerRef} variant="ghost" onClick={() => openLayer('tour', triggerRef.current)}>
          Take the tour
        </Button>
      </div>
      <p className="meta settings-foot">
        The walkthrough a new workspace opens with, and only ever opens with once. Taking it again changes nothing — it
        reads out what each section is for and writes no record but its own &ldquo;seen&rdquo; flag.
      </p>
    </Card>
  )
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
        <BrandingCard />
        <CadenceCard snapshot={snapshot} setSetting={setSetting} />
        <IntegrationsCard snapshot={snapshot} setSetting={setSetting} />
        <BackupAppearanceCard snapshot={snapshot} setSetting={setSetting} />
        <ShortcutsCard />
        <GuidedTourCard />
      </div>
    </div>
  )
}
