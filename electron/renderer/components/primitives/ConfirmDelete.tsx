import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { Button } from './Button'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { invalidate, queryKeys } from '../../lib/query-keys'
import type { DeletableEntity, DeletionImpact } from '../../../shared/deletion'
import './ConfirmDelete.css'

/**
 * The confirmation in front of every delete (T-260902-09).
 *
 * Companies, people, engagements and offerings all had a working
 * `<entity>:delete` in main and no way to reach it from the app — "we can't
 * delete engagements, companies, people or offerings, we need a way to do
 * this". This is that way, and the reason it is one component rather than
 * four: the dialog is the same question every time, and four copies of a
 * destructive confirmation is four chances for one of them to under-state
 * what it is about to do.
 *
 * It works in two beats, which is the decision this implements rather than a
 * UI flourish:
 *
 * 1. **Ask what would go.** `<entity>:deleteImpact` returns the counts,
 *    derived from the same declarations the delete runs
 *    (`electron/main/db/repositories/cascade.ts`), so the list here cannot
 *    promise less than the delete takes.
 * 2. **Then delete, with `cascade` set.** Only after the operator has read
 *    that list and pressed the red button. `cascade` defaults to false
 *    everywhere else, so nothing can reach the cascading path without
 *    passing through this dialog.
 *
 * A record nothing points at skips the list entirely — it gets a plain "this
 * cannot be undone", because a dialog that enumerates zero consequences is
 * noise standing between the operator and an obvious action.
 *
 * **Two kinds of line, kept visually apart.** Rows that are *deleted* and
 * rows that are only *unlinked* — another company that billed through this
 * one, an engagement sold from a deleted offering — are different
 * consequences and are not merged into one count. Calling an unlink a
 * deletion would overstate the damage; calling a deletion a change would
 * understate it.
 */
export interface ConfirmDeleteProps {
  entity: DeletableEntity
  id: string
  /** Shown while the impact loads, so the dialog names its subject from the first frame rather than after a round trip. */
  name: string
  onClose: () => void
  /** Ran after the delete succeeds — where the caller navigates away from a page whose record no longer exists. */
  onDeleted?: () => void
}

/** The impact channel for each entity. A record rather than a template string so a typo is a compile error and `ChannelName` stays exhaustive. */
const IMPACT_CHANNEL = {
  company: 'companies:deleteImpact',
  person: 'people:deleteImpact',
  engagement: 'engagements:deleteImpact',
  offering: 'offerings:deleteImpact'
} as const

const DELETE_CHANNEL = {
  company: 'companies:delete',
  person: 'people:delete',
  engagement: 'engagements:delete',
  offering: 'offerings:delete'
} as const

/** Which entity caches a delete can invalidate. Broad on purpose: deleting a company removes engagements, todos and activity too, and a narrower list would leave one of those lists showing a row that is gone. */
const AFFECTED: Record<DeletableEntity, readonly (keyof typeof invalidate)[]> = {
  company: ['companies', 'engagements', 'tasks', 'activity', 'people', 'companyImages'],
  person: ['people', 'tasks', 'activity', 'companies'],
  engagement: ['engagements', 'milestones', 'tasks', 'activity', 'companies'],
  offering: ['offerings', 'engagements']
}

const NOUN: Record<DeletableEntity, string> = {
  company: 'company',
  person: 'person',
  engagement: 'engagement',
  offering: 'offering'
}

export function ConfirmDelete({ entity, id, name, onClose, onDeleted }: ConfirmDeleteProps) {
  const queryClient = useQueryClient()

  const impactQuery = useQuery({
    queryKey: queryKeys.deletion.impact(entity, id),
    queryFn: ipcQueryFn(IMPACT_CHANNEL[entity], { id })
  })

  const deleteMutation = useMutation({
    mutationFn: () => callCrm(DELETE_CHANNEL[entity], { id, cascade: true }).then(unwrapMutationResult),
    onSuccess: async () => {
      await Promise.all(AFFECTED[entity].map((key) => invalidate[key](queryClient)))
      onDeleted?.()
      onClose()
    }
  })

  const impact: DeletionImpact | undefined = impactQuery.data
  const deleted = impact?.entries.filter((entry) => entry.action === 'delete') ?? []
  const unlinked = impact?.entries.filter((entry) => entry.action === 'clear') ?? []
  // Rows, not kinds. The first version of this counted `deleted.length` —
  // the number of *lines* in the dialog — so a company losing 3 todos, 1
  // activity record and 3 engagements offered "Delete all 4" over a list
  // adding up to seven. Understating the count on the button that does the
  // deleting is the exact failure this dialog exists to prevent.
  const deletedRows = deleted.reduce((total, entry) => total + entry.count, 0)
  const subject = impact?.name ?? name

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Delete this ${NOUN[entity]}?`}
      titleMeta={`DELETE ${entity}`}
      aria-label={`Delete ${subject}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            // Disabled until the impact has actually arrived: the whole point
            // is that nobody agrees to a list they have not been shown.
            disabled={impactQuery.isPending || deleteMutation.isPending || impactQuery.isError}
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? 'Deleting…' : deleteLabel(deletedRows)}
          </Button>
        </>
      }
    >
      <div className="confirm-del">
        <p className="confirm-del-subject">{subject}</p>

        {impactQuery.isPending && <p className="meta">Checking what else this would affect…</p>}
        {impactQuery.isError && (
          <div className="field-error" role="alert">
            {impactQuery.error.message}
          </div>
        )}

        {impact && deleted.length === 0 && unlinked.length === 0 && (
          <p className="meta">Nothing else references it. This cannot be undone.</p>
        )}

        {deleted.length > 0 && (
          <>
            <p className="confirm-del-lead">This would also delete:</p>
            <ul className="confirm-del-list">
              {deleted.map((entry) => (
                <li key={entry.label}>
                  <span className="confirm-del-count">{entry.count}</span> {entry.label}
                </li>
              ))}
            </ul>
          </>
        )}

        {unlinked.length > 0 && (
          <>
            {/* Deliberately a separate list with its own verb: these records
                survive. Folding them into the list above would tell the
                operator they are losing things they are not. */}
            <p className="confirm-del-lead">These would be kept, and unlinked:</p>
            <ul className="confirm-del-list confirm-del-kept">
              {unlinked.map((entry) => (
                <li key={entry.label}>
                  <span className="confirm-del-count">{entry.count}</span> {entry.label}
                </li>
              ))}
            </ul>
          </>
        )}

        {impact && (deleted.length > 0 || unlinked.length > 0) && <p className="meta">This cannot be undone.</p>}

        {deleteMutation.error && (
          <div className="field-error" role="alert">
            {deleteMutation.error.message}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/**
 * The button says how many records it is about to remove, so the count is on
 * the control being pressed and not only in a list above it — the operator
 * who skims the dialog still reads the number on the thing they click.
 *
 * `attachedRows` is the total number of *rows* the listed entries cover, and
 * the `+ 1` is the record itself. Rows that are only unlinked are excluded:
 * they are not being deleted, and folding them in would make the button
 * claim more damage than the dialog above it does.
 */
function deleteLabel(attachedRows: number): string {
  if (attachedRows === 0) return 'Delete'
  return `Delete all ${attachedRows + 1}`
}
