import { decimalStringToCents } from '../../shared/format'
import type { OfferingBillingModel, OfferingUnit } from '../../shared/offerings'

/**
 * §6.5's quick-add grammar — `Name, 4500` / `Name, 4500/mo` / `Name, 175/hr`
 * — as a pure function, in its own module for the same reason
 * `todo-urgency.ts` is one: `react-refresh/only-export-components` forbids a
 * component file from exporting anything but components, and this needs to be
 * testable on its own rather than only through a rendered view.
 *
 * The grammar is the mockup's `quickService()` regex, widened in exactly two
 * ways and no more:
 *
 * - **Cents are allowed.** The mockup matched `[\d,]+` and multiplied by 100.
 *   `175.50/hr` is an ordinary rate and CONVENTIONS.md's money representation
 *   is integer cents, so the fractional part goes through
 *   `decimalStringToCents` — the same parser `EngagementSheet` uses — rather
 *   than through a float multiply that would put `17549` in the database for
 *   a rate someone typed as `175.50`.
 * - **A failure is a value, not a zero.** The mockup fell back to
 *   `rate = 0` for anything its regex missed, silently creating a free
 *   offering. `createOfferingInputSchema` makes `rateCents` required
 *   precisely so a rateless offering is unrepresentable, and this returns a
 *   refusal the caller shows instead of inventing a price nobody typed.
 *
 * What it deliberately does **not** decide is `type` (service vs. product)
 * or `categoryId`: both are the caller's context — which category's row the
 * text was typed into, and which type filter is showing — not something to
 * infer from the words. The mockup guessed `product` when the category name
 * contained "product"; that guess is not ported.
 */

export interface QuickAddOffering {
  readonly name: string
  readonly rateCents: number
  readonly unit: OfferingUnit
  readonly billingModel: OfferingBillingModel
}

export type QuickAddResult =
  | { readonly ok: true; readonly value: QuickAddOffering }
  | { readonly ok: false; readonly message: string }

/**
 * `<name><separator><amount>[/mo|/hr]`. The name group is lazy so the
 * separator binds as late as possible — "Systems / Agent Audit, 4200" keeps
 * the slash inside the name rather than splitting on it.
 */
const QUICK_ADD = /^(.*?)[\s,]+\$?([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(mo|hr))?$/i

/**
 * The unit/model pairing §6.5 names, and the only place in this view the two
 * vocabularies are related to each other. Keyed by unit, so the table cannot
 * grow a fourth pairing without `OFFERING_UNITS` growing a fourth member.
 */
const MODEL_FOR_UNIT: Record<'fixed' | 'mo' | 'hr', OfferingBillingModel> = {
  fixed: 'fixed',
  mo: 'retainer',
  hr: 'tm'
}

const SYNTAX = 'Write it as "Name, 4500", "Name, 4500/mo" or "Name, 175/hr".'

export function parseQuickAddOffering(raw: string): QuickAddResult {
  const trimmed = raw.trim()
  const match = QUICK_ADD.exec(trimmed)
  if (!match) {
    return { ok: false, message: `"${trimmed}" has no price. ${SYNTAX}` }
  }

  const name = match[1].trim()
  if (!name) {
    return { ok: false, message: `"${trimmed}" has no name. ${SYNTAX}` }
  }

  const suffix = match[3]?.toLowerCase()
  const unit: OfferingUnit = suffix === 'mo' ? 'mo' : suffix === 'hr' ? 'hr' : 'fixed'

  let rateCents: number
  try {
    // The typed number is dollars — `decimalStringToCents` is what turns it
    // into the integer cents the wire schema takes, and it throws rather than
    // rounding a third decimal place away.
    rateCents = decimalStringToCents(match[2].replace(/,/g, ''))
  } catch {
    return { ok: false, message: `"${match[2]}" is not an amount with at most two decimal places.` }
  }

  return { ok: true, value: { name, rateCents, unit, billingModel: MODEL_FOR_UNIT[unit] } }
}
