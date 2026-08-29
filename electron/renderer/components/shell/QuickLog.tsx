import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Toast } from '../primitives/Toast'
import { ChipField } from '../sheets/Field'
import { useCompaniesList, useEngagementsList, usePeopleList } from '../sheets/queries'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { invalidate } from '../../lib/query-keys'
import { ACTIVITY_KINDS, type ActivityKind, type LogActivityInput } from '../../../shared/activity'
import { formatDateOnly, nowTimestamp } from '../../../shared/format'
import '../sheets/fields.css'
import './QuickLog.css'

const KIND_LABELS: Record<ActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note'
}
const KIND_OPTIONS = ACTIVITY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

/** The mockup's own `let logKind='Call'` — a logged touch is a call until said otherwise, so the five-second path never has to visit this field. */
const DEFAULT_KIND: ActivityKind = 'call'

/** One row of the "who" result list. `kind` is what makes a company and a person tellable apart in it (acceptance), and what decides which of the two id columns the write fills. */
interface WhoOption {
  readonly kind: 'company' | 'person'
  readonly id: string
  readonly name: string
}

const whoOptionKey = (option: WhoOption) => `${option.kind}:${option.id}`

interface SaveVariables {
  readonly input: LogActivityInput
  /** The chosen company's or person's name, carried alongside the payload so the confirmation reads the name that was actually saved rather than whatever the field holds by the time the write resolves. */
  readonly subject: string
}

/**
 * §2's fourth goal — a touch logged in under five seconds, from any view,
 * by keyboard alone (P1-09). Mounted by `LayerManager` as the `log` layer's
 * content, opened by ⌘L/Ctrl+L (`hooks/useGlobalShortcuts.ts`, which already
 * binds it; this task adds no shortcut of its own).
 *
 * **Esc is not handled here.** `LayerManager` owns dismissal outright for
 * every layer (T-260828-12's review settled it) — hence `closeOnEscape={false}`
 * on the `Sheet` below, the same way every sheet in `components/sheets/`
 * passes it. A local Escape listener would close this overlay *and* whatever
 * it was stacked over, on one press.
 *
 * **One write, not two.** `activity:log` moves `companies.last_touch_at` /
 * `people.last_contact_at` in the same transaction as the row insert
 * (T-260828-24, ADR-001), so saving resets the cadence clock as a consequence
 * of this one call. There is deliberately no follow-up `companies:update`
 * here: a failure between two calls would leave activity history the cadence
 * meter cannot see, this task's first Risk.
 *
 * The outer component stays mounted for the life of the shell and holds only
 * the confirmation toast; the form itself mounts fresh on every open (see
 * `QuickLogForm`). The split is what lets the overlay close *and* still
 * confirm — a toast owned by the form would unmount with it, mid-message.
 */
export function QuickLog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState<ReactNode | null>(null)

  return (
    <>
      {open && <QuickLogForm onClose={onClose} onSaved={setConfirmation} />}
      <Toast message={confirmation} onDismiss={() => setConfirmation(null)} />
    </>
  )
}

/**
 * Mounted only while the `log` layer is open, so every open starts blank
 * without an effect resetting state on open — the same reasoning
 * `LayerManager` documents for the four create sheets, and this codebase's
 * `react-hooks/set-state-in-effect` rule.
 */
function QuickLogForm({ onClose, onSaved }: { onClose: () => void; onSaved: (message: ReactNode) => void }) {
  const formId = useId()
  const whoInputId = useId()
  const whoListId = useId()

  const companies = useCompaniesList()
  const people = usePeopleList()
  const engagements = useEngagementsList()

  const [whoQuery, setWhoQuery] = useState('')
  const [selected, setSelected] = useState<WhoOption | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [kind, setKind] = useState<ActivityKind>(DEFAULT_KIND)
  const [note, setNote] = useState('')
  /** `null` means "follow whatever the chosen company defaults to" — see `engagementId` below. */
  const [engagementChoice, setEngagementChoice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const whoRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Opens focused on the who field (scope). `Sheet` focuses its own panel on
  // open; a child's effect runs before its parent's, so this one lands last
  // and wins — no timeout, unlike the mockup's `setTimeout(...,50)`.
  useEffect(() => {
    whoRef.current?.focus()
  }, [])

  // Companies first, then people — the mockup's own palette ordering. Both
  // in one list because the field matches both (acceptance); `kind` keeps
  // them tellable apart in the rendered result.
  const whoOptions = useMemo<readonly WhoOption[]>(
    () => [
      ...companies.map((company) => ({ kind: 'company' as const, id: company.id, name: company.name })),
      ...people.map((person) => ({ kind: 'person' as const, id: person.id, name: person.name }))
    ],
    [companies, people]
  )

  const matches = useMemo(() => {
    const query = whoQuery.trim().toLowerCase()
    if (!query) return whoOptions
    return whoOptions.filter((option) => option.name.toLowerCase().includes(query))
  }, [whoOptions, whoQuery])

  // Clamped rather than reset from an effect: the list shrinks as the query
  // narrows, and a stale index past its end would leave Enter selecting
  // nothing at all.
  const activeIndex = Math.min(highlight, Math.max(matches.length - 1, 0))
  const showList = listOpen && matches.length > 0
  const optionDomId = (index: number) => `${whoListId}-${index}`

  // `.qlog-list` is `max-height: 168px; overflow: auto` (QuickLog.css), so
  // past roughly five matches the arrow keys were moving a highlight that had
  // left the viewport — in a flow with no mouse, driving a selection you
  // cannot see. `block: 'nearest'` scrolls only when the row is actually out
  // of view, so the list does not jump under a highlight that was already
  // visible. Guarded because jsdom implements no layout and no
  // `scrollIntoView` at all; a missing method must not break the keyboard
  // path it exists to serve.
  useEffect(() => {
    if (!showList) return
    const option = listRef.current?.children.item(activeIndex)
    if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' })
  }, [showList, activeIndex])

  // Active engagements on whichever side of the split-billing relationship
  // this company sits (`billingCompanyId` and `clientCompanyId` are
  // independent — electron/shared/engagements.ts §5 — and a touch is worth
  // hanging on either).
  const companyEngagements = useMemo(() => {
    if (selected?.kind !== 'company') return []
    return engagements.filter(
      (engagement) =>
        engagement.status === 'active' &&
        (engagement.billingCompanyId === selected.id || engagement.clientCompanyId === selected.id)
    )
  }, [engagements, selected])

  /** Exactly one active engagement is not a guess, it's the only answer; two or none and the field stays empty (acceptance). */
  const defaultEngagementId = companyEngagements.length === 1 ? companyEngagements[0].id : ''
  const engagementId = engagementChoice ?? defaultEngagementId

  // Adjusted during render, not in an effect (react.dev's "Adjusting state
  // when a prop changes", the pattern Shell.tsx already uses here): picking a
  // different company must drop an engagement chosen for the previous one,
  // and an effect would commit a render carrying the wrong pairing first.
  const selectedKey = selected ? whoOptionKey(selected) : ''
  const [lastSelectedKey, setLastSelectedKey] = useState(selectedKey)
  if (selectedKey !== lastSelectedKey) {
    setLastSelectedKey(selectedKey)
    setEngagementChoice(null)
  }

  const queryClient = useQueryClient()

  const logTouch = useMutation({
    mutationFn: ({ input }: SaveVariables) => callCrm('activity:log', input).then(unwrapMutationResult),
    onSuccess: (_activity, { subject }) => {
      // Confirmed and closed first, refetches behind it. `activity:log` has
      // already succeeded by the time this runs — the write is settled, so
      // this is not an optimistic close (this task's first Risk); what is no
      // longer waited on is only the *reading* back of three lists.
      onSaved(
        <>
          Logged. <b>{subject}</b> is current.
        </>
      )
      onClose()
      // Three entities, not one — which is why this doesn't go through
      // `components/sheets/useSheetMutation.ts` (single-entity, and it has no
      // confirmation to raise). The insert moved `companies.last_touch_at`
      // and `people.last_contact_at` in its own transaction, so every cached
      // company and person row is stale alongside the activity lists: without
      // all three, the company this touch was logged against keeps rendering
      // its old "going quiet" cadence state until something else refetches.
      // Deliberately not awaited: awaiting resolves only once the active
      // queries have refetched, which held the overlay up and withheld the
      // confirmation for a companies + people + activity round trip, against
      // a goal measured in felt seconds. The views still update themselves
      // when those land, exactly as before.
      void Promise.all([invalidate.activity(queryClient), invalidate.companies(queryClient), invalidate.people(queryClient), invalidate.search(queryClient)])
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Could not log this touch.')
  })

  const chooseWho = (option: WhoOption) => {
    setSelected(option)
    setWhoQuery(option.name)
    setListOpen(false)
    setError(null)
    noteRef.current?.focus()
  }

  const handleWhoKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape is deliberately absent — LayerManager owns it (this file's header).
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // A closed list reopens where it was left. Opening *and* stepping in one
      // press moved the highlight a row past what the user last saw, into a
      // list that was not on screen when they pressed.
      if (!showList) {
        setListOpen(true)
        return
      }
      setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key !== 'Enter') return
    // Never lets Enter reach the form from this field: the first Enter picks
    // the match and moves to the note, so the whole keyboard path is
    // ⌘L · type · ↵ · type · ↵.
    event.preventDefault()
    if (showList) {
      chooseWho(matches[activeIndex])
      return
    }
    if (selected) {
      noteRef.current?.focus()
      return
    }
    // Nothing matched what was typed. Submitting rather than swallowing the
    // press is what turns a dead Enter into the stated reason (this task's
    // last Risk) — `submit` refuses and says the name has to exist first.
    submit()
  }

  const submit = () => {
    // Matches the create sheets' identical guard — a second Enter while the
    // first write is still in flight must not log the touch twice.
    if (logTouch.isPending) return
    if (!selected) {
      setError('who: pick the company or person this was with — create it from New if it is not in the list yet')
      whoRef.current?.focus()
      return
    }
    const line = note.trim()
    if (!line) {
      // Refused with a stated reason; nothing is closed and nothing typed is
      // discarded (acceptance).
      setError('what happened: write one line first')
      noteRef.current?.focus()
      return
    }
    setError(null)
    logTouch.mutate({
      subject: selected.name,
      input: {
        occurredAt: nowTimestamp(),
        kind,
        title: line,
        body: null,
        companyId: selected.kind === 'company' ? selected.id : null,
        personId: selected.kind === 'person' ? selected.id : null,
        engagementId: engagementId || null,
        source: 'manual'
      }
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="Log a touch"
      titleMeta={formatDateOnly(new Date())}
      aria-label="Log a touch"
      footerNote="resets the cadence clock"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={logTouch.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} className="sheet-form" onSubmit={handleSubmit}>
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}

        <div>
          <label className="f-lab" htmlFor={whoInputId}>
            Who
          </label>
          <input
            id={whoInputId}
            ref={whoRef}
            className="inp"
            role="combobox"
            aria-expanded={showList}
            // Only while the list is rendered: `aria-controls` pointing at an
            // id that is not in the document is a dangling IDREF, which a
            // screen reader resolves to nothing.
            aria-controls={showList ? whoListId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={showList ? optionDomId(activeIndex) : undefined}
            autoComplete="off"
            placeholder="Company or person"
            value={whoQuery}
            onChange={(event) => {
              setWhoQuery(event.target.value)
              setSelected(null)
              setListOpen(true)
              setHighlight(0)
            }}
            onKeyDown={handleWhoKeyDown}
          />
          {showList && (
            <ul className="qlog-list" id={whoListId} ref={listRef} role="listbox" aria-label="Companies and people">
              {matches.map((option, index) => (
                <li
                  key={whoOptionKey(option)}
                  id={optionDomId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? 'qlog-opt sel' : 'qlog-opt'}
                  // Ahead of the input's blur, so a pointer user lands on the
                  // row they pressed rather than on a list that just closed.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    chooseWho(option)
                  }}
                >
                  <span className="ki">{option.kind === 'company' ? 'COMPANY' : 'PERSON'}</span>
                  <span className="tx">{option.name}</span>
                </li>
              ))}
            </ul>
          )}
          {listOpen && matches.length === 0 && (
            // This task's last Risk: say plainly that it has to exist, rather
            // than letting an unmatched name look like it saved against
            // something. Creating it inline is the palette's job (P1-10).
            <p className="qlog-none">No company or person matches — create it from New first.</p>
          )}
        </div>

        <ChipField label="Kind" value={kind} onChange={setKind} options={KIND_OPTIONS} />

        <div>
          <label className="f-lab" htmlFor={`${formId}-note`}>
            What happened
          </label>
          <textarea
            id={`${formId}-note`}
            ref={noteRef}
            className="inp qlog-note"
            placeholder="One line."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // The mockup's field is a textarea and stays one; Enter has to
              // save for the five-second path to exist, so a deliberate
              // newline is Shift+Enter.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </div>

        {companyEngagements.length > 0 && (
          <div>
            <label className="f-lab" htmlFor={`${formId}-engagement`}>
              Engagement
            </label>
            <select
              id={`${formId}-engagement`}
              className="inp"
              value={engagementId}
              onChange={(event) => setEngagementChoice(event.target.value)}
            >
              <option value="">— none —</option>
              {companyEngagements.map((engagement) => (
                <option key={engagement.id} value={engagement.id}>
                  {engagement.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </Sheet>
  )
}
