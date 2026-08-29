import type { z } from 'zod'
import { ValidationError } from './errors'

/**
 * The input-parsing machinery every repository in this directory shares
 * (T-260828-43). Until this module existed, `parseInput`,
 * `stripUndefinedValues` and the zod-issue formatting were copied
 * byte-for-byte into six repositories, each carrying its own restatement of
 * the absent-vs-explicitly-undefined rule below. That rule was a blocking
 * defect on T-260828-20 precisely because getting it wrong silently NULLs a
 * column, and five hand-synced copies of it is five chances for one to drift
 * in one entity only — the hardest version of the bug to notice.
 *
 * This is machinery, not policy: nothing here knows a table name, a column
 * or a schema. What legitimately differs per repository — the schemas
 * themselves, the `FIELD_SPECS`/`CREATE_DEFAULTS` tables, the table-specific
 * constraint messages — stays in the repository that owns it.
 *
 * `machinery.test.ts` asserts by scanning the tree that each of these names
 * is declared exactly once, so a seventh copy fails the suite rather than
 * waiting for a reviewer to spot it.
 */

/** The structural shape `ValidationError` needs from a zod issue — a path and a message. */
export interface IssueLike {
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

/**
 * The one rendering of a zod issue list into a single human-readable line.
 * A root-level issue has an empty `path`, which would otherwise render as an
 * empty field name; `(root)` names it instead.
 */
export function formatIssues(issues: ReadonlyArray<IssueLike>): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}

/**
 * Removes keys whose value is the literal `undefined`, shallowly. Returns
 * non-objects (and `null`) unchanged, so it is safe to apply to any parse
 * result. Never mutates its argument.
 *
 * This is the absent-vs-explicitly-undefined rule, in one place:
 *
 * zod's `.partial()`/`.optional()` marks a field optional, not absent — a
 * patch that sets a key to the literal value `undefined` (the shape a
 * renderer's `{ field: dirty ? value : undefined }` naturally produces, and
 * the shape Electron's structured clone preserves across the IPC boundary)
 * still parses with that key present, holding `undefined`. Every repository
 * write path distinguishes "key absent" from "key present" via `in`, so an
 * undefined-valued key left in the parse result would read as "the caller
 * explicitly set this" and either wipe a column to NULL on update or skip a
 * documented create default. Stripping undefined-valued keys makes "absent"
 * and "explicitly undefined" the same thing for every caller, which is what
 * a JS object literal actually means.
 */
export function stripUndefinedValues<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  const cleaned = { ...(value as Record<string, unknown>) }
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined) delete cleaned[key]
  }
  return cleaned as T
}

export interface ParseInputOptions {
  /**
   * Strip undefined-valued keys from the *input* before `safeParse` rather
   * than from the parse result after it. Needed only by a schema whose shape
   * depends on which keys are present — `engagements.ts`'s
   * `z.union([...])` / `z.discriminatedUnion(...)`, where stripping after the
   * parse cannot influence which branch was chosen and
   * `{ billingModel: undefined, notes: 'x' }` therefore defeats both branches
   * even though the caller's intent ("leave billingModel alone") is exactly
   * what an absent key means. Harmless but pointless for a plain
   * `z.object()`, so it is opt-in rather than the default.
   */
  readonly stripBeforeParse?: boolean
  /**
   * Rewrites the issue list before it is formatted and attached to the
   * thrown `ValidationError` — `engagements.ts` uses it to recurse into a
   * union branch's nested `issue.errors`, which zod v4 does not flatten onto
   * the top-level issues array.
   */
  readonly transformIssues?: (issues: readonly z.core.$ZodIssue[]) => readonly z.core.$ZodIssue[]
}

/**
 * Parses `input` against `schema`, throwing `ValidationError` (never a raw
 * `ZodError`) on failure and returning data with explicitly-`undefined` keys
 * stripped — see `stripUndefinedValues` for why that matters.
 */
export function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown, options: ParseInputOptions = {}): z.infer<Schema> {
  const candidate = options.stripBeforeParse ? stripUndefinedValues(input) : input
  const result = schema.safeParse(candidate)
  if (!result.success) {
    const issues = options.transformIssues ? options.transformIssues(result.error.issues) : result.error.issues
    throw new ValidationError(formatIssues(issues), issues)
  }
  return stripUndefinedValues(result.data)
}

/**
 * SQLite has no boolean type: a domain `true`/`false` is stored as `1`/`0`,
 * and `null`/absent stays `NULL` rather than collapsing to `0`. Used from a
 * `FIELD_SPEC`'s `toSql` in the repositories that have a boolean column.
 */
export const boolToSql = (value: unknown): unknown => (value === null || value === undefined ? null : value ? 1 : 0)
