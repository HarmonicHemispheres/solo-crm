/**
 * Where a validation failure is shown, and what it is called there.
 *
 * T-260828-27's scope said errors "render against the field that caused
 * them"; what shipped was one banner at the top of the sheet naming the
 * *database column* — a caller typing `$28,500` into Contract value read
 * `contractValueCents: "$28,500" is not a valid amount`. Both halves of that
 * are wrong: the message is nowhere near the field it is about, and it names
 * a column the user has never seen.
 *
 * Every error a sheet can receive already carries the offending path as its
 * first token, and by one shared convention:
 * `formatIssues` (electron/main/db/repositories/input.ts) renders a
 * `ValidationError` as `path.join('.'): message`, and the sheets' own
 * client-side parsers (`EngagementSheet`'s `parseCents`/`parseHours`) throw
 * in that same shape. So the mapping needed here is exactly: split off that
 * path, look it up in the sheet's own payload-key -> visible-label table, and
 * hand the sheet back which field to render against.
 *
 * A path the sheet has no field for — a root-level `(root)` issue, a column
 * this form does not offer, a refusal that is not about a field at all —
 * stays a banner, verbatim. Nothing is dropped because it could not be
 * placed.
 */

/** A validation failure, already resolved to where it belongs. `field: null` means "no field owns this" — render it as the sheet-level banner. */
export interface SheetError {
  readonly field: string | null
  readonly message: string
}

/** `name: name is required` -> path `name`, detail `name is required`. Anchored, and deliberately narrow: a payload key, never arbitrary prose before the colon. */
const PATH_PREFIX = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*): ([\s\S]+)$/

/**
 * Resolves a raw error message against a sheet's `payload key -> field label`
 * table. `formatIssues` joins multiple issues with `'; '`; a message carrying
 * more than one of them belongs to more than one field, so it stays a banner
 * rather than being attributed to whichever field happened to be listed
 * first.
 */
export function toSheetError(raw: string, labels: Readonly<Record<string, string>>): SheetError {
  if (raw.split('; ').length > 1) return { field: null, message: raw }
  const match = PATH_PREFIX.exec(raw)
  if (!match) return { field: null, message: raw }
  const [, path, detail] = match
  const label = labels[path]
  if (label === undefined) return { field: null, message: raw }
  return { field: path, message: `${label}: ${detail}` }
}
