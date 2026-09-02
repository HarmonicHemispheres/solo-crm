import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { EmptyState } from '../components/primitives/EmptyState'

/**
 * `/revenue` (T-260902-01) — the view's header and an honest empty body,
 * in place of the bare `<h1>` the route rendered since T-260828-12.
 *
 * This is deliberately not the §6.7 view. Every revenue figure comes from
 * `revenue_lines` (ADR-003), and nothing writes that table until the
 * generator lands (P3-05, scoped as T-260902-03) — so the four metrics, the
 * rollup toggle and the stacked chart would all read zero on every database
 * there is. A page of zeros is a lie about the workspace; a page that says
 * what it is waiting on is not. There is no computation over `engagements`
 * here and there must not be one: AGENTS.md names porting the mockup's
 * `mrr()`/`backlog()` as the highest-risk carry-over in the project.
 *
 * What replaces this body is T-260902-05 (the view) and -06 (the chart),
 * after -02 to -04 give them a table to read.
 */
export function Revenue() {
  return (
    <>
      <ViewHeader
        icon={<RevenueGlyph />}
        accent="var(--gold)"
        title="Revenue"
        description="Revenue rolls up by whoever is on the invoice. Switch to end client to see who the work is actually for — the totals are the same, the attribution is not."
      />
      <Card>
        <Card.Header title="Recognised by month" />
        <EmptyState>
          Nothing to show yet. Revenue is recognised from each engagement's terms — retainers by the month, fixed scopes
          by milestone, T&amp;M by hours — and that recognition step has not been built. Engagements and their rates are
          already recorded; the numbers arrive here once it lands.
        </EmptyState>
      </Card>
    </>
  )
}

/** The rail's revenue glyph (components/shell/icons.tsx), per-view as every ViewHeader icon is. */
function RevenueGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4" />
    </svg>
  )
}
