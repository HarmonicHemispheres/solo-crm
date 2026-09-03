import { centsToDecimalString } from '../../shared/format'
import type { OfferingBillingModel, OfferingType, OfferingUnit } from '../../shared/offerings'

/**
 * How an offering's three vocabularies and its rate are spelled on screen —
 * shared by `views/Offerings.tsx` and `components/sheets/OfferingSheet.tsx`
 * so the chip a form offers and the text a row shows cannot drift apart.
 *
 * Its own module rather than an export from either of those files:
 * `react-refresh/only-export-components` forbids a component file exporting
 * non-components, and `todo-urgency.ts` already sets the precedent for a
 * view's pure helpers living beside it.
 *
 * **No money arithmetic happens here and none may be added.** `formatMoney`
 * converts one stored `rateCents` into the string that renders it, which
 * ADR-003 permits explicitly ("displaying one offering's price is a legal
 * read of an offering column"); summing rates, projecting them, or branching
 * on `billingModel` to produce a figure is `revenue_lines`' job (P3-05) and
 * appears nowhere in this file or its callers. Note that `formatRate` below
 * dispatches on `unit` — how a rate is *quoted* — and never on
 * `billingModel`, which is the branch that rule is actually about.
 */

/** Thousands separators only. Grouping a whole-dollar string, never dividing a cent value by 100 — see `formatMoney`. */
const GROUP = new Intl.NumberFormat('en-US')

/**
 * Integer cents as the price list shows them: `450000` -> `"$4,500"`,
 * `17550` -> `"$175.50"`.
 *
 * Routed through `centsToDecimalString` and `BigInt` rather than
 * `Intl.NumberFormat('en-US', { style: 'currency' }).format(cents / 100)`,
 * which is the obvious version and is wrong twice: `cents / 100` is a binary
 * float, so a large rate can round on the way to its own display, and the
 * currency is a workspace setting (§6.11, P2-01) that no view may hardcode.
 * The `$` here is the same bare prefix `Engagements.tsx` already renders a
 * stored `notToExceedCents` with, and it moves when P2-01 gives the app a
 * single currency-aware formatter to move it to.
 *
 * A whole-dollar rate drops its `.00` — `ui-design.md`'s "numbers take a
 * unit, not a sentence" applies to noise inside the number too, and every
 * rate the seed carries is whole dollars.
 */
export function formatMoney(cents: number): string {
  const decimal = centsToDecimalString(cents)
  const negative = decimal.startsWith('-')
  const [whole, fraction] = (negative ? decimal.slice(1) : decimal).split('.')
  const grouped = GROUP.format(BigInt(whole))
  const tail = fraction === '00' ? '' : `.${fraction}`
  return `${negative ? '-' : ''}$${grouped}${tail}`
}

/** `2 retainers`, `1 unbilled milestone` — a count with its noun, for the Stat metas Today and Revenue both draw (T-260902-05). Regular plurals only; nothing here takes an irregular one. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The mockup's `fmtRate()` — a rate plus the unit it is quoted in. `fixed`
 * and a null unit both render the bare amount; there is no sentence
 * explaining what "fixed" means, because the absence of a suffix already
 * says it.
 */
export function formatRate(unit: OfferingUnit | null, cents: number): string {
  switch (unit) {
    case 'hr':
      return `${formatMoney(cents)} / hr`
    case 'mo':
      return `${formatMoney(cents)} / mo`
    case 'from':
      return `from ${formatMoney(cents)}`
    default:
      return formatMoney(cents)
  }
}

export const TYPE_LABEL: Record<OfferingType, string> = {
  service: 'Service',
  product: 'Product'
}

/** The three a catalogue entry can carry — not the five an engagement can (see `electron/shared/offerings.ts`'s note on why they are separate tuples). */
export const BILLING_MODEL_LABEL: Record<OfferingBillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed',
  tm: 'T&M'
}

/** How the rate is *quoted*. `fixed` here is a flat price and is unrelated to `BILLING_MODEL_LABEL`'s `fixed`, which is how the work bills. */
export const UNIT_LABEL: Record<OfferingUnit, string> = {
  fixed: 'Flat',
  from: 'From',
  mo: 'Per month',
  hr: 'Per hour'
}
