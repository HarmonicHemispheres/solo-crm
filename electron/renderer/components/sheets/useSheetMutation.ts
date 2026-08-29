import { useState } from 'react'
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { invalidate, queryKeys } from '../../lib/query-keys'
import { toSheetError, type SheetError } from './field-errors'

type Entity = keyof typeof queryKeys

/**
 * The onSuccess/onError shape every create sheet in this directory shares
 * (code review, T-260828-27): invalidate the entity and close on success;
 * surface the thrown message — never a stringified `[object Object]`, per
 * `ipc.ts`'s `IpcCallError` — on failure. Each sheet still owns its own
 * `mutationFn` (`PersonSheet`'s create-then-affiliate retry logic,
 * `EngagementSheet`'s discriminated-union payload build) and its own
 * submit-time validation; only the two callbacks and the error string live
 * here, so a future change to either (the close timing, the fallback
 * wording) is made once instead of drifting across four files.
 *
 * `fieldLabels` maps this sheet's payload keys to the labels its own fields
 * carry, and is what turns a thrown message into a placed one: every failure
 * — a repository `ValidationError`, a client-side amount parse — goes
 * through `toSheetError` (field-errors.ts) before it reaches state, so the
 * sheet renders it against the field that caused it under the name the user
 * sees, and only a failure no field owns falls back to the banner.
 */
export function useSheetMutation<TVariables, TData>(
  entity: Entity,
  mutationFn: (variables: TVariables) => Promise<TData>,
  onClose: () => void,
  errorFallback: string,
  fieldLabels: Readonly<Record<string, string>>
): {
  mutation: UseMutationResult<TData, unknown, TVariables>
  error: SheetError | null
  setError: (error: SheetError | null) => void
  /** Places a raw `path: message` string — a thrown repository or parse failure — against its field. */
  setRawError: (raw: string) => void
  /** The message to render against `field`, or `undefined` when the current error belongs elsewhere. */
  errorFor: (field: string) => string | undefined
} {
  const queryClient = useQueryClient()
  const [error, setError] = useState<SheetError | null>(null)

  const setRawError = (raw: string) => setError(toSheetError(raw, fieldLabels))

  const mutation = useMutation({
    mutationFn,
    onSuccess: async () => {
      // Search alongside the entity (T-260828-37 review). The palette caches a
      // result set for SEARCH_STALE_MS, so without this, creating a company and
      // then re-running a search term typed moments earlier answers from a cache
      // that predates the row — a record the user just made, missing from the one
      // surface built to find anything. The index itself is already correct: it is
      // trigger-maintained, so nothing in the renderer can observe that it changed.
      // The palette stale time stays as the backstop for writes that do not pass
      // through here (an update, a delete, the seeder); this closes the create path,
      // which is the one a user watches happen and then immediately searches for.
      await Promise.all([invalidate[entity](queryClient), invalidate.search(queryClient)])
      onClose()
    },
    onError: (err: unknown) => setRawError(err instanceof Error ? err.message : errorFallback)
  })

  return {
    mutation,
    error,
    setError,
    setRawError,
    errorFor: (field: string) => (error?.field === field ? error.message : undefined)
  }
}
