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
  /** Whole days since the last touch. `null` when never touched. */
  readonly days: number | null
  /** days ÷ effective cadence. 1 or more is late. `Infinity` when never touched. */
  readonly pct: number
  readonly band: DecayBand
  /** The cadence actually used — the company's own, or its kind's default. */
  readonly cadenceDays: number
  /** DecayMeter's `label` — "today", "9d", or "never" for an untouched company. */
  readonly label: string
}

/**
 * The company fields decay actually depends on. Deliberately a `Pick` and not
 * the whole `Company`: every caller has a full row to hand, and narrowing the
 * parameter is what lets a test state a three-field literal rather than a
 * fifteen-field one whose other twelve fields imply a relevance they do not
 * have.
 */
export type DecayInput = Pick<Company, 'kind' | 'cadenceDays' | 'lastTouchAt'>

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
 * own cadence nor a kind to inherit one from. `decayForCompany` maps a
 * non-positive cadence to `Infinity` rather than dividing by it, so "no
 * cadence known" reads late for the same reason "never touched" does,
 * instead of arriving at `DecayMeter` as a `NaN` for the component to
 * rescue.
 */
function effectiveCadenceDays(company: DecayInput, settings: SettingsSnapshot): number {
  if (company.cadenceDays != null) return company.cadenceDays
  if (company.kind == null) return 0
  return settings[CADENCE_SETTING_KEY[company.kind]]
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

export function decayForCompany(company: DecayInput, settings: SettingsSnapshot, now: Date): Decay {
  const cadenceDays = effectiveCadenceDays(company, settings)

  // ADR-001 rule 5: a company nobody has ever touched is maximally stale, not
  // excluded and not blank. P2-04 states the rendered consequence — "a
  // company never touched shows a determinate state, not NaN" — which is why
  // this returns `Infinity` (which `DecayMeter` clamps to a full late bar)
  // rather than a fraction over a cadence there is no touch to measure.
  if (company.lastTouchAt == null) {
    return { days: null, pct: Number.POSITIVE_INFINITY, band: 'late', cadenceDays, label: 'never' }
  }

  const days = wholeDaysSince(company.lastTouchAt, now)
  const pct = cadenceDays > 0 ? days / cadenceDays : Number.POSITIVE_INFINITY

  return {
    days,
    pct,
    band: bandFor(pct),
    cadenceDays,
    // A touch later today (or, from a clock skew, a moment in the future)
    // reads "today" rather than "0d" or a negative day count.
    label: days <= 0 ? 'today' : `${days}d`
  }
}
