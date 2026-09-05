import type { RevenueLineStatus } from '../../../shared/revenue'

/**
 * How a `revenue_lines` row is named in the UI, in the one place both
 * surfaces that draw lines can read it.
 *
 * Two of them now: the Revenue report's Lines card, which lists every line in
 * the reporting window, and the engagement form, which lists one engagement's
 * own schedule so the operator can mark a month invoiced from the record it
 * belongs to instead of hunting for it in a report. Two copies of these
 * strings would drift the moment a kind is added, and a status wearing two
 * different words in two places is the kind of thing that reads as two
 * different states.
 *
 * Presentation only. The values are the stored ones and live in
 * `shared/revenue.ts`; nothing here decides what a line *is*.
 */
export const LINE_KIND_LABEL: Record<string, string> = {
  retainer: 'Retainer',
  milestone: 'Milestone',
  tm_estimate: 'T&M estimate',
  tm_actual: 'T&M actual',
  expense: 'Expense'
}

/**
 * The three states of a line, in the order money moves through them. The
 * control is a Toggle rather than a single cycling button: three states is
 * one too many to cycle through blind, and a segmented control shows where
 * the row is as well as where it can go.
 */
export const LINE_STATUS_OPTIONS = [
  { value: 'projected', label: 'Projected' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' }
] as const satisfies ReadonlyArray<{ value: RevenueLineStatus; label: string }>
