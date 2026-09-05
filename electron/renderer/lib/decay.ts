import type { Company } from '../../shared/companies'
import { CADENCE_SETTING_KEY, type SettingsSnapshot } from '../../shared/settings'

/**
 * P2-03 / T-260829-13 — the one function that turns a company's
 * `last_touch_at` and `cadence_days` into the `pct` `DecayMeter` and `Ring`
 * take, plus the band and label every "going quiet" surface reads off it.
 *
 * There is one of these because there would otherwise be three, each
 * slightly different: the Today view's Going quiet list, the Companies
 * grid's cadence ring and company detail all ask the same question and the
 * requirements answer it *per relationship*, not against a global threshold
 * (§6.1: "companies past their own cadence, sorted by how far past";
 * P2-03: "a retainer client at eight days reads late and a channel at eight
 * days reads fine, from the same function").
 *
 * A pure module: no IPC, no Node access, no React. `now` is a required
 * parameter and `Date.now()` is never read inside, so a test can state a
 * fixed clock instead of building fixtures relative to whenever it runs.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type DecayBand = 'ok' | 'warn' | 'late'

export interface Decay {
  /**
   * Whole days of the current wait — since the last touch, or, when nothing
   * has ever been logged, since the company was added to the workspace.
   */
  readonly days: number
  /** days ÷ effective cadence. 1 or more is late. */
  readonly pct: number
  readonly band: DecayBand
  /** The cadence actually used — the company's own, or its kind's default. */
  readonly cadenceDays: number
  /** DecayMeter's `label` — "today", "9d", or "new" for a company added today with nothing logged. */
  readonly label: string
  /** False when no activity has ever been logged against this company — the wait is measured from `created_at` instead. */
  readonly touched: boolean
  /** The sentence a meter's tooltip states, so the bar's colour is never the only account of itself. */
  readonly description: string
}

/**
 * The company fields decay actually depends on. Deliberately a `Pick` and not
 * the whole `Company`: every caller has a full row to hand, and narrowing the
 * parameter is what lets a test state a three-field literal rather than a
 * fifteen-field one whose other twelve fields imply a relevance they do not
 * have.
 */
export type DecayInput = Pick<Company, 'kind' | 'cadenceDays' | 'lastTouchAt' | 'createdAt'>

/**
 * The mockup's own `decay()` thresholds — `>= 1` late, `>= .7` warn, else ok.
 *
 * `DecayMeter.tsx` keeps its own copy of these numbers as its drawing rule
 * and this module deliberately imports nothing from it (a pure computation
 * that pulls in a React component to learn what "late" means is worse than
 * the duplication). `decay.test.ts` asserts the two agree at 0.69/0.7/0.99/1
 * by rendering the component against this module's band, so the copies
 * cannot drift apart silently.
 *
 * A non-finite `pct` is late, never ok: ADR-001 rule 5 makes missing touch
 * data maximally stale ("the most overdue thing in the book, not an absence
 * of data"), and `DecayMeter` maps a non-finite pct the same way. That guard
 * is also what keeps `NaN` — an unparseable timestamp — out of the `ok` band
 * rather than silently green.
 */
function bandFor(pct: number): DecayBand {
  if (!Number.isFinite(pct) || pct >= 1) return 'late'
  if (pct >= 0.7) return 'warn'
  return 'ok'
}

/**
 * The company's own cadence when it has one, otherwise its kind's
 * `cadence.defaultDays.<kind>` default from the settings snapshot.
 *
 * `cadenceDays` is nullable on the row (`electron/shared/companies.ts`) even
 * though `CompanySheet` always writes an explicit value today, so this
 * fallback is reachable from the seed, from a hand-edited database and from
 * any future create path that lets the field go unset (P2-02's "new
 * companies inherit" — the *reading* half of which is this line).
 *
 * `0` is returned when nothing can be resolved — a company with neither its
 * own cadence nor a kind to inherit one from, or a kind whose default is
 * "N/A" (`null` in the settings registry, which is every kind's default
 * since the operator asked for that). `decayForCompany` reads a
 * non-positive cadence as **not tracked**: the `ok` band at `pct` 0, never
 * a division by it and never `Infinity`.
 *
 * That is a change from how this used to read. A missing cadence was
 * mapped to `Infinity` — overdue — on the reasoning that "no cadence known"
 * should read like "never touched". With N/A a first-class choice in
 * settings, that reasoning inverts: an operator who set a kind to N/A said
 * "do not chase these", and a page that then paints every one of them red
 * is ignoring the setting. A company with no cadence is not on the Going
 * quiet list, its ring is empty, and its tooltip says so in words.
 */
function effectiveCadenceDays(company: DecayInput, settings: SettingsSnapshot): number {
  if (company.cadenceDays != null) return company.cadenceDays
  if (company.kind == null) return 0
  return settings[CADENCE_SETTING_KEY[company.kind]] ?? 0
}

/**
 * `last_touch_at` is a full UTC instant (`timestampSchema`, CONVENTIONS.md),
 * not a date-only value, so this is instant arithmetic: elapsed milliseconds
 * floored to whole days. It is emphatically *not* the local-calendar-day
 * arithmetic `Todos.tsx`'s `localToday()` does — that is correct there
 * because `due_on` is a date-only value whose meaning is the user's wall
 * clock day, and it would be wrong here, where an hour spanning local
 * midnight would count as a day and a touch logged at 23:30 would read as
 * yesterday's the moment the calendar flipped.
 *
 * Floor, not round: 23 hours is zero whole days elapsed, not one.
 */
function wholeDaysSince(lastTouchAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(lastTouchAt).getTime()) / DAY_MS)
}

/**
 * **A company with no logged touch is not automatically overdue.**
 *
 * It used to be: `last_touch_at IS NULL` returned `Infinity`, which
 * `DecayMeter` clamps to a full red bar labelled "never" and `Today`'s Going
 * quiet list treats as late. That is right for a client added a year ago and
 * forgotten, and plainly wrong for one added five minutes ago — and the
 * second is what an operator sees, because every company starts there. A
 * brand-new record greeting them in red said the software could not tell the
 * difference between neglect and newness.
 *
 * So an untouched company's wait is measured from `created_at` — the point
 * the workspace first knew about it, and the only honest floor there is for
 * "how long have you gone without contact". A company added today is `ok`; an
 * untouched one added two hundred days ago against a ninety-day cadence is
 * still `late`, which is the case the old behaviour actually existed to
 * catch. `since` is deliberately *not* used: it is a backdated fact about the
 * relationship, often years old, and reading it here would put every
 * carefully-recorded history straight back into the red.
 *
 * `touched` carries the distinction the label no longer does, so a surface
 * that wants to say "nothing logged yet" still can — `description` is that
 * sentence, and every meter renders it as a tooltip.
 */
export function decayForCompany(company: DecayInput, settings: SettingsSnapshot, now: Date): Decay {
  const cadenceDays = effectiveCadenceDays(company, settings)
  const touched = company.lastTouchAt != null
  const days = wholeDaysSince(company.lastTouchAt ?? company.createdAt, now)
  // No cadence: not tracked, so nothing to be late against — see
  // `effectiveCadenceDays`. `bandFor` still maps an unparseable timestamp
  // (`NaN` days) to `late`, which is the one non-finite case that remains.
  const pct = cadenceDays > 0 ? days / cadenceDays : 0
  const band = cadenceDays > 0 ? bandFor(pct) : Number.isNaN(days) ? 'late' : 'ok'

  return {
    days,
    pct,
    band,
    cadenceDays,
    // A touch later today (or, from a clock skew, a moment in the future)
    // reads "today" rather than "0d" or a negative day count. An untouched
    // company added today reads "new": there is no touch for "today" to
    // refer to.
    label: days <= 0 ? (touched ? 'today' : 'new') : `${days}d`,
    touched,
    description: describe(days, cadenceDays, touched, band)
  }
}

function describe(days: number, cadenceDays: number, touched: boolean, band: DecayBand): string {
  const elapsed = days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`
  const opening = touched ? `Last touch ${elapsed}` : days <= 0 ? 'Added today, nothing logged yet' : `Added ${elapsed}, nothing logged yet`
  if (cadenceDays <= 0) return `${opening}. No cadence set — not tracked.`
  return `${opening}. Cadence every ${cadenceDays} days — ${band === 'late' ? 'overdue' : band === 'warn' ? 'due soon' : 'on track'}.`
}
