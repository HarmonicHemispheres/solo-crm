import { centsToDecimalString } from '../../shared/format'
import type { Engagement, Milestone } from '../../shared/engagements'

// ---------------------------------------------------------------------------
// What an engagement is worth — one engagement's own headline price.
//
// ADR-003 names two things it does *not* forbid and this is the first: "a
// single engagement's own headline price ... states the engagement's terms;
// it does not aggregate." Every figure below is read from the engagement's
// own columns. There is deliberately no annualisation and no total across
// rows: `× 12` is an attribution to periods, which is the Revenue view's
// and the generator's job (P3-05).
// ---------------------------------------------------------------------------

/** `$3,500` — money as this app writes it everywhere else (`centsToDecimalString`, no locale grouping; that is P2-01's). */
function money(cents: number): string {
  return `$${centsToDecimalString(cents)}`
}

export interface Terms {
  /** The headline figure, or `null` when nobody has priced this engagement. */
  readonly value: string | null
  /** `/ mo` on a retainer; nothing elsewhere — a unit, not a sentence. */
  readonly unit: string | null
  /** How the figure was arrived at, and any cap on it. Metadata, drawn as metadata. */
  readonly basis: readonly string[]
  /** What to say instead of a figure. `null` for the models that have no price to state at all. */
  readonly note: string | null
}

const NO_TERMS: Terms = { value: null, unit: null, basis: [], note: null }

/** A retainer's monthly price, from whichever pair its basis names. `null` when the terms are not complete enough to state one — an unpriced retainer says so rather than showing `$0.00`. */
function retainerMonthly(engagement: Engagement): number | null {
  if (engagement.retainerBasis === 'amount') return engagement.monthlyAmountCents
  if (engagement.retainerBasis === 'hours') {
    if (engagement.hoursIncluded == null || engagement.hourlyRateCents == null) return null
    return Math.round(engagement.hoursIncluded * engagement.hourlyRateCents)
  }
  // No basis stated — every retainer written before migration 0008. There is
  // nothing true to put here.
  return null
}

export function termsFor(engagement: Engagement, milestones: readonly Milestone[]): Terms {
  switch (engagement.billingModel) {
    case 'retainer': {
      const monthly = retainerMonthly(engagement)
      if (monthly == null) return { ...NO_TERMS, note: 'No price set' }
      return {
        value: money(monthly),
        unit: '/ mo',
        basis:
          engagement.retainerBasis === 'hours'
            ? [`${engagement.hoursIncluded} hrs × ${money(engagement.hourlyRateCents ?? 0)}`]
            : [],
        note: null
      }
    }
    case 'fixed': {
      const done = milestones.filter((milestone) => milestone.completedAt != null).length
      const basis = milestones.length > 0 ? [`${done} of ${milestones.length} milestone${milestones.length === 1 ? '' : 's'}`] : []
      if (engagement.contractValueCents == null) return { ...NO_TERMS, basis, note: 'No contract value set' }
      return { value: money(engagement.contractValueCents), unit: null, basis, note: null }
    }
    case 'tm': {
      const { hourlyRateCents, estimatedHours, notToExceedCents } = engagement
      if (hourlyRateCents == null && estimatedHours == null && notToExceedCents == null) return { ...NO_TERMS, note: 'No rate set' }
      // The estimate at the agreed rate, capped by this engagement's own
      // not-to-exceed. Still one engagement's headline number.
      const estimate = hourlyRateCents != null && estimatedHours != null ? Math.round(estimatedHours * hourlyRateCents) : null
      const capped = estimate != null && notToExceedCents != null ? Math.min(estimate, notToExceedCents) : estimate
      const basis: string[] = []
      if (hourlyRateCents != null) basis.push(`${estimatedHours != null ? `~${estimatedHours} hrs × ` : ''}${money(hourlyRateCents)} / hr`)
      if (notToExceedCents != null) basis.push(`max ${money(notToExceedCents)}`)
      return { value: capped != null ? money(capped) : null, unit: null, basis, note: null }
    }
    default:
      // `equity`, `none` and a null model have no price to state, and
      // inventing a line saying so on every equity deal is text spent for
      // nothing.
      return NO_TERMS
  }
}

