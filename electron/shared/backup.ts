import { z } from 'zod'
import { timestampSchema } from './types'

/**
 * `backup:run`'s wire contract — a manual backup of the live database to a
 * file the operator chooses. PURE zod with no Node imports, like every
 * `electron/shared/**` module (see `companies.ts`'s header for why).
 *
 * A cancelled save dialog is `{ outcome: 'cancelled' }` inside a
 * *successful* envelope, not a failed mutation — the same shape
 * `branding:choose` answers, for the same reason: the operator changing
 * their mind is not an error.
 *
 * `path` crosses the boundary deliberately, as `db:stats.path` does
 * (`ipc-types.ts`'s section on it): the whole subject of this channel is
 * which file on this machine now holds a copy of the data, and a backup
 * nobody can find is not a backup. It is the path the operator just chose
 * in a native dialog, so it tells them nothing they did not already know.
 * Refusal messages carry no path — `electron/main/backup/manual.ts` writes
 * every one of them by hand.
 */
export const manualBackupResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('cancelled') }).strict(),
  z
    .object({
      outcome: z.literal('written'),
      /** Where the copy landed — the file the operator chose. */
      path: z.string().min(1),
      /** The copy's size on disk once written. */
      bytes: z.number().int().nonnegative(),
      completedAt: timestampSchema
    })
    .strict()
])
export type ManualBackupResult = z.infer<typeof manualBackupResultSchema>
