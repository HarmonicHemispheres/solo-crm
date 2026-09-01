import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { InfoPopover } from '../components/primitives/InfoPopover'
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
  CADENCE_SETTING_KEY,
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
 * `/workspace/settings` (T-260828-38, rebuilt by T-260901-09).
 *
 * **The layout is [ADR-014](.dev/decisions/ADR-014-settings-layout.md), not
 * the mockup's card grid.** The mockup draws five cards in a
 * `repeat(auto-fit, minmax(340px, 1fr))` grid; this page had grown to seven
 * with two more plan items (P4-08, X-04) aimed at the same page, and an
 * auto-fit grid puts a given control somewhere different at every window
 * width. So: a **section rail** on the left, and **one section's card at a
 * time** on the right — six sections, in the fixed order `SETTINGS_SECTIONS`
 * declares. The mockup is annotated in place at `views.settings` so a reader
 * finds the divergence where they would otherwise copy from; do not restore
 * the grid.
 *
 * The cards, rows, switches and steppers *inside* a section are still the
 * mockup's spec, unchanged — only the arrangement departs. Two of the seven
 * old cards were merged into a neighbouring section (Branding into Identity,
 * Guided tour into Help, each as a second `Card.Header` inside the one card)
 * and one was split (Backup & appearance), for the reasons ADR-014 §2 gives.
 *
 * Every value shown reads and writes through T-260828-25's settings
 * repository (`settings:getAll` / `settings:set`) — there is no second store,
 * and the rebuild added, removed and renamed no key. The selected section is
 * deliberately **not** one: it is component state defaulting to the first
 * section on every visit, not a `settings` row and not a route (ADR-014 §1 —
 * persisting it would put the operator on last time's section, which is the
 * "nothing is where it was" complaint in a new form).
 *
 * Two cards here read no setting at all and must not be folded into the
 * snapshot: Branding goes through `branding:get`/`choose`/`clear` (an image
 * is not a setting value — `electron/shared/branding.ts`), and Guided tour
 * reopens the first-run overlay through the layer manager, which owns its own
 * `onboarding.tourSeen` write.
 *
 * **Where prose lives** is ADR-014 §4, and it is a rule by kind rather than a
 * judgement per paragraph, because "put the descriptions in popovers" reads
 * naturally as "all of them" and doing that would silently reverse P2-09's
 * honest-caption criterion. A section's *explanation* goes behind an
 * `InfoPopover` in its `Card.Header` (Branding, Default cadence, Guided
 * tour); a section's *state* stays in the flow as a `.settings-foot`
 * caption — either behaviour a control implies that has not landed (the
 * three honest captions: cadence has no consumer until P2-02, the backup
 * folder has no dialog channel to open, `appearance.density` has no view
 * applying it), or a constraint §6.11 requires the UI itself to state (the
 * integrations pull-only line). The day P2-02, a folder-dialog channel or a
 * density consumer lands, the matching caption is deleted in that same
 * change — a stale limitation is as misleading as a hidden one.
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

type SetSetting = <K extends SettingKey>(key: K, value: SettingValue<K>) => void

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
// Identity — workspace name, operator, currency, fiscal year start, then the
// Branding group beneath its own header (ADR-014 §2: two image slots are the
// workspace's identity as much as its name is, and each half is short on its
// own).
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

function IdentitySection({ snapshot, setSetting }: { snapshot: SettingsSnapshot; setSetting: SetSetting }) {
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
      <BrandingGroup />
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

/** The accepted set as the popover says it, composed from the shared list so the sentence cannot drift from what main will take. */
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

/**
 * A header plus two rows rather than a `<Card>` of its own — ADR-014 §2 puts
 * Branding inside the Identity section as a second `Card.Header`, which is
 * the shape `Card.tsx`'s own header recommends over nested cards. The merge
 * is visual only: this still reads `branding:get` and writes
 * `branding:choose`/`branding:clear`, and is not folded into the settings
 * snapshot.
 *
 * The card's old four-line footer is now this header's `InfoPopover`
 * (ADR-014 §4): it explains a rule the control already enforces, since a
 * refused pick renders its own reason beside the row that failed
 * (`brandrow-error`, `role="alert"`), so the honest path survives without the
 * paragraph standing in the flow.
 */
function BrandingGroup() {
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
    <>
      <Card.Header
        title="Branding"
        actions={
          <InfoPopover aria-label="About Branding">
            {ACCEPTED_FORMAT_LIST}, up to {BRANDING_MAX_BYTES / 1024} KB per slot. SVG is not one of them: it is a
            document format that can carry script, and these two images render inside the app&rsquo;s own chrome on
            every view — so Solo CRM stores an image&rsquo;s pixels here, never a document. Choosing one says so
            rather than failing quietly. The format is decided by the file&rsquo;s own bytes, not its extension.
          </InfoPopover>
        }
      />
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
    </>
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

// `CADENCE_SETTING_KEY` — the one declared place these keys are composed —
// moved to `electron/shared/settings.ts` in T-260829-13, where ADR-002 rule
// 3's "keys are declared in one module" already points and where
// `renderer/lib/decay.ts` (which resolves a null `cadence_days` against these
// defaults) can import it without importing a view. It is imported above.

function CadenceSection({ snapshot, setSetting }: { snapshot: SettingsSnapshot; setSetting: SetSetting }) {
  return (
    <Card>
      <Card.Header
        title="Default cadence"
        actions={
          <>
            <span className="meta">days between touches</span>
            {/* The mockup's own closing line, which explains intended
                behaviour rather than stating a limitation — ADR-014 §4 sends
                it here and keeps the honest caption below in the flow. When
                P2-02 lands, the caption is deleted and this popover stays. */}
            <InfoPopover aria-label="About Default cadence">
              New companies inherit these. Any company can override its own.
            </InfoPopover>
          </>
        }
      />
      {COMPANY_KINDS.map((kind) => {
        const key = CADENCE_SETTING_KEY[kind]
        const value = snapshot[key]
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
      <p className="meta settings-foot">Stored only — no company moves until P2-02 applies these defaults.</p>
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

function IntegrationsSection({ snapshot, setSetting }: { snapshot: SettingsSnapshot; setSetting: SetSetting }) {
  return (
    <Card>
      {/* No `InfoPopover` here, deliberately (ADR-014 §4): the pull-only line
          is a constraint §6.11 requires the *UI* to state, so it stays in the
          flow, and there is nothing further to explain — a popover with
          nothing to say is an icon button that lies about having content. */}
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
// Backup — its own section now (ADR-014 §2). The mockup grouped it with
// Appearance because each was two rows and the grid wanted a card; they are
// different subjects with different futures (Backup grows with X-04,
// Appearance does not), and a rail entry named for two subjects is one an
// operator has to guess at.
// ---------------------------------------------------------------------------

function BackupSection({ snapshot, setSetting }: { snapshot: SettingsSnapshot; setSetting: SetSetting }) {
  return (
    <Card>
      <Card.Header title="Backup" />
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
          title="Not built yet — the folder picker needs a main-process dialog channel"
        >
          Choose folder
        </Button>
      </div>
      <p className="meta settings-foot">
        The picker needs a main-process dialog channel that doesn&rsquo;t exist yet; the export is X-04.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Appearance — interface motion and compact density.
// ---------------------------------------------------------------------------

function AppearanceSection({ snapshot, setSetting }: { snapshot: SettingsSnapshot; setSetting: SetSetting }) {
  const density = snapshot['appearance.density']
  return (
    <Card>
      <Card.Header title="Appearance" />
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
// Help — Shortcuts (read-only, generated from useGlobalShortcuts.ts's own
// `GLOBAL_SHORTCUTS` registry rather than hand-typed, so a combo added or
// removed there can never leave this list stale) and the Guided tour, as two
// groups under one section (ADR-014 §2).
//
// The tour is a second `Card.Header` beneath Shortcuts rather than a row
// inside it: this page has always refused to put a button that *does*
// something into a keyboard reference, and that reasoning still holds. The
// section is named Help, not Shortcuts, so the operator who would come here
// looking for the tour by name finds a rail entry that answers.
//
// "Take the tour" reopens the overlay without clearing `onboarding.tourSeen`
// — the flag stays `true` and closing the tour again writes `true` again.
// Dismissal is final on its own; this is the operator asking, which is the
// only way back this feature has.
// ---------------------------------------------------------------------------

function HelpSection() {
  const { openLayer } = useLayerManager()
  const triggerRef = useRef<HTMLButtonElement>(null)

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
      <Card.Header
        title="Guided tour"
        actions={
          <InfoPopover aria-label="About Guided tour">
            The walkthrough a new workspace opens with, and only ever opens with once. Taking it again changes
            nothing — it reads out what each section is for and writes no record but its own &ldquo;seen&rdquo; flag.
          </InfoPopover>
        }
      />
      <div className="field">
        <span className="k">Five screens</span>
        <span className="v">Today, Companies, People, Engagements, Workspace</span>
        <Button ref={triggerRef} variant="ghost" onClick={() => openLayer('tour', triggerRef.current)}>
          Take the tour
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The section rail — ADR-014 §1. A `<nav>` of real buttons in a fixed order,
// one selected at a time, `aria-current` on the selected one so the selection
// is exposed to assistive technology by something other than colour. No
// roving tabindex: Tab moves between the buttons in order, matching the app
// rail's own `Link`s. Activating one swaps the content column and leaves
// focus where it is, so the content region is the next Tab stop in DOM order.
//
// Below 900px — the app's own breakpoint, where the rail goes off-canvas
// (Rail.css, `--bp-tablet`) — this becomes a wrapping horizontal strip above
// the content, in CSS alone: same `<nav>`, same buttons, same `aria-current`,
// so keyboard operation is identical at every width.
// ---------------------------------------------------------------------------

const SETTINGS_SECTIONS = ['identity', 'cadence', 'integrations', 'backup', 'appearance', 'help'] as const

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The rail's label for each section, and the accessible name of the content
 * region while that section is selected. */
const SECTION_LABEL: Record<SettingsSection, string> = {
  identity: 'Identity',
  cadence: 'Default cadence',
  integrations: 'Integrations',
  backup: 'Backup',
  appearance: 'Appearance',
  help: 'Help'
}

function SectionRail({
  section,
  onSelect
}: {
  section: SettingsSection
  onSelect: (next: SettingsSection) => void
}) {
  return (
    <nav className="settings-rail" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map((candidate) => {
        const selected = candidate === section
        return (
          <button
            key={candidate}
            type="button"
            className={selected ? 'settings-railb on' : 'settings-railb'}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(candidate)}
          >
            {SECTION_LABEL[candidate]}
          </button>
        )
      })}
    </nav>
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
  // Component state, not a setting key and not a route (ADR-014 §1): every
  // visit opens on the first section.
  const [section, setSection] = useState<SettingsSection>(SETTINGS_SECTIONS[0])
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
      <div className="settings-layout">
        <SectionRail section={section} onSelect={setSection} />
        {/* One section's card, and nothing from the others mounted. The swap
            is immediate with no transition, so `prefers-reduced-motion` has
            nothing to remove and the section change survives it intact. */}
        <section className="settings-body" aria-label={SECTION_LABEL[section]}>
          {section === 'identity' && <IdentitySection snapshot={snapshot} setSetting={setSetting} />}
          {section === 'cadence' && <CadenceSection snapshot={snapshot} setSetting={setSetting} />}
          {section === 'integrations' && <IntegrationsSection snapshot={snapshot} setSetting={setSetting} />}
          {section === 'backup' && <BackupSection snapshot={snapshot} setSetting={setSetting} />}
          {section === 'appearance' && <AppearanceSection snapshot={snapshot} setSetting={setSetting} />}
          {section === 'help' && <HelpSection />}
        </section>
      </div>
    </div>
  )
}
