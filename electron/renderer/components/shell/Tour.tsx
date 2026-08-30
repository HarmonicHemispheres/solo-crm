import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../primitives/Button'
import { useLayerManager } from './layer-manager-context'
import { TOUR_STEPS } from './tour-steps'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { invalidate, queryKeys } from '../../lib/query-keys'
import type { SettingsSnapshot } from '../../../shared/settings'
import './Tour.css'

/**
 * The first-run walkthrough (T-260829-15). Nothing in this app explains
 * itself on first open: ten nav items across three groups, and several ideas
 * that are not guessable from a label — contacts stored apart from companies
 * so history follows a person, an engagement splitting "billed to" from
 * "work is for", cadence being per relationship. Each of those is already
 * written down in the `ViewHeader` info popover of the view that needs it,
 * which is the wrong place to learn the view exists.
 *
 * It is one centred card over a scrim and it does NOT anchor to, spotlight
 * or point at anything in the rail. That is a deliberate constraint, not a
 * missing feature: the rail goes off-canvas at 900px and its focus/`inert`
 * behaviour is still open work (T-260828-15), so an arrow positioned against
 * a rail button is wrong at some window width and the failure is purely
 * visual — no test catches it. Navigation is a button in the card instead.
 *
 * The five steps themselves live in `tour-steps.ts` — see that file's header
 * for why they are not in here.
 */

/**
 * The controller half: it owns when the overlay opens, and the one settings
 * write that closing it produces. The card itself is a separate component
 * mounted only while the layer is open, so every open starts on step 1 from
 * a fresh mount rather than from an effect that resets state (the same
 * reasoning `LayerManager` gives for mounting the four create sheets only
 * while `sheet` is open).
 *
 * Rendered from `Shell.tsx` rather than from `LayerManager`'s overlay list,
 * because it needs the routed shell's `useNavigate` — see LayerManager's own
 * header for why that placement is also the right paint order.
 */
export function Tour() {
  const { isOpen, openLayer, closeLayer } = useLayerManager()
  const open = isOpen('tour')
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
  const tourSeen: boolean | undefined = settingsQuery.data?.['onboarding.tourSeen']

  // The second of the two conditions, and the one that keeps this a
  // first-run tour rather than a popup: a workspace updating into this
  // version with forty companies in it has never had the flag set, and must
  // still never see the overlay.
  //
  // `enabled` is what stops that workspace paying for the list at all — the
  // flag reads `true` there after the first close, so the shell asks for
  // companies on exactly the boots where the answer could matter. The query
  // key is `Companies.tsx`'s own, so on `/companies` this is the same cache
  // entry rather than a second request.
  const companiesQuery = useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: ipcQueryFn('companies:list'),
    enabled: tourSeen === false
  })

  // `?.length === 0` is false while the query is still pending, which is the
  // point: this task's Risks name "rendering the overlay while companies:list
  // is still loading and then hiding it" as a flash on every restart for
  // every existing user. Undefined waits.
  const workspaceIsEmpty = companiesQuery.data?.length === 0

  // Auto-open fires at most once per mount. Without this, closing the tour
  // would race its own settings write: the snapshot still reads `false`
  // until the invalidation round-trips, and the effect below would reopen
  // what the operator just skipped — the nag this feature exists to avoid.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (tourSeen !== false || !workspaceIsEmpty) return
    autoOpenedRef.current = true
    openLayer('tour')
  }, [tourSeen, workspaceIsEmpty, openLayer])

  const markSeen = useMutation({
    mutationFn: () =>
      callCrm('settings:set', { key: 'onboarding.tourSeen', value: true }).then(unwrapMutationResult),
    onSuccess: () => invalidate.settings(queryClient)
  })

  // Held in a ref so the close effect below depends on `open` alone — the
  // mutation object is a new identity every render (Sheet.tsx's own reason
  // for the same pattern with `onClose`).
  const markSeenRef = useRef(markSeen)
  useEffect(() => {
    markSeenRef.current = markSeen
  })

  /**
   * Every way out writes the flag, and they all arrive here: *Skip tour*,
   * *Finish*, the two navigating actions, and Escape — which this component
   * never listens for, because `LayerManager` owns the one document-level
   * Escape handler and closing the layer from there lands on exactly this
   * transition. Watching the layer close, rather than writing the flag in
   * each button's handler, is what makes "skip is as final as finish" true
   * by construction instead of by four handlers remembering.
   *
   * The write is unconditional, including on the reopened-from-Settings
   * path where the flag is already `true`. Setting a boolean to the value it
   * already holds is the cheaper thing to reason about than a guard that has
   * to read a snapshot which may be mid-refetch.
   */
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    markSeenRef.current.mutate()

    // Written straight into the cache as well, the same way
    // WorkspaceSettings' own `setSetting` does: the mutation's invalidation
    // is a round-trip, and until it lands the snapshot still says the tour
    // is unseen.
    queryClient.setQueryData(queryKeys.settings.list(), (current: SettingsSnapshot | undefined) =>
      current ? { ...current, 'onboarding.tourSeen': true } : current
    )
  }, [open, queryClient])

  if (!open) return null
  return <TourCard onClose={() => closeLayer('tour')} />
}

/**
 * The card. Mounted only while the layer is open, so `step` needs no reset.
 */
function TourCard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const navigate = useNavigate()
  const cardRef = useRef<HTMLDivElement>(null)

  const current = TOUR_STEPS[step]
  const isLast = step === TOUR_STEPS.length - 1
  const action = current.action

  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  function leaveFor(path: string) {
    navigate(path)
    onClose()
  }

  /**
   * Keeps Tab inside the card. The scrim is paint, not a barrier — without
   * this, Tab from the last button lands on the rail behind it, and a
   * keyboard user is driving a page they cannot see.
   *
   * `button` is the whole selector because buttons are the only focusable
   * thing this card contains; a link or an input added here would need it
   * widened. `:not([disabled])` matters on step 1, where *Back* is disabled.
   * Handled on the container (keydown bubbles from the buttons) rather than
   * per-button, and `document.activeElement === card` is the just-opened
   * case, where focus is on the container itself and the browser's own next
   * stop is already the first button — done explicitly so it is the same in
   * jsdom, which does not implement sequential focus navigation at all.
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const card = cardRef.current
    if (!card) return
    const focusable = [...card.querySelectorAll<HTMLElement>('button:not([disabled])')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || active === card) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last || active === card) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="tour-scrim">
      <div
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
        tabIndex={-1}
        ref={cardRef}
        onKeyDown={handleKeyDown}
      >
        <div className="tour-h">
          <h2>{current.title}</h2>
          <span className="tour-count">
            {step + 1} of {TOUR_STEPS.length}
          </span>
        </div>
        <p className="tour-body">{current.body}</p>
        <div className="tour-f">
          {/* Sits at the far edge of `.tour-f`'s space-between row, apart
              from the three navigation buttons: it is the way out, not one
              more step in the sequence. */}
          <Button variant="ghost" onClick={onClose}>
            Skip tour
          </Button>
          <div className="tour-nav">
            {/* Disabled rather than absent on step 1: the row keeps its
                shape across all five steps instead of the primary button
                jumping sideways under the pointer between step 1 and 2. */}
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
            {action && (
              <Button variant="ghost" onClick={() => leaveFor(action.path)}>
                {action.label}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => {
                if (!isLast) {
                  setStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))
                  return
                }
                // The last step's primary action is *Finish* and it is also
                // the step's own "go there" action (this task's Scope names
                // both for step 5), so finishing lands on the page it just
                // described rather than on whatever route the tour opened
                // over.
                if (current.finishPath) leaveFor(current.finishPath)
                else onClose()
              }}
            >
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
