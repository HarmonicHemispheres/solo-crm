import { useState } from 'react'
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { invalidate, queryKeys } from '../../lib/query-keys'

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
 */
export function useSheetMutation<TVariables, TData>(
  entity: Entity,
  mutationFn: (variables: TVariables) => Promise<TData>,
  onClose: () => void,
  errorFallback: string
): {
  mutation: UseMutationResult<TData, unknown, TVariables>
  error: string | null
  setError: (error: string | null) => void
} {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn,
    onSuccess: async () => {
      await invalidate[entity](queryClient)
      onClose()
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : errorFallback)
  })

  return { mutation, error, setError }
}
