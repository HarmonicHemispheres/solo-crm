---
id: ADR-003
title: Revenue is materialised in revenue_lines; every revenue question is one SUM … GROUP BY
status: accepted
date: 2026-08-28
---

## Context

Requirements §5 already says `revenue_lines` is materialised rather than
computed. This ADR exists anyway, because the mockup does the opposite and the
mockup is the authoritative *visual* spec — the document everyone opens. Reading
it as a data spec is the single most likely way this decision gets undone.

What the mockup actually does (`planning/solo-crm-mockup.html:946-948`):

```js
const mrr     = e => e.model==='retainer' && e.status==='Active' ? e.rate : 0;
const runRate = e => e.model==='tm'       && e.status==='Active' ? e.hourly*e.hoursUsed : 0;
const backlog = e => e.model==='fixed'    && e.status==='Active' ? e.value*(1-e.done/e.total) : 0;
```

Three live computations, each branching on billing model, each reading a
different set of engagement columns, each in its own place. The revenue chart
next to them (`:833`) is a hardcoded fifteen-element array — the shape of the
real thing was never worked out at all.

Two requirements make that shape expensive rather than merely untidy. §2 goal 2
and §6.7 want the same totals attributed three ways — by billing party, by end
client, by model — so live computation means writing the per-model branching once
per attribution. And §7 has Stripe writing `status`, `paid_at` and
`stripe_invoice_id` onto revenue rows, which requires rows to exist.

The pressure point is Phase 3, where the live version is genuinely faster to
write for the first metric and the cost only shows up at the fourth.

## Decision

**`revenue_lines` is the only source of any revenue figure or rollup.** A
revenue figure that does not come from a `SUM(amount_cents)` over
`revenue_lines` is a defect, not an optimisation.

"Revenue figure or rollup" means a total, an aggregate, a chart series or a
metric that answers *how much money*. It does not mean every number with a
currency symbol. Two things stay legal reads of engagement and offerings
columns, and neither is a finding:

- **A single engagement's own headline price** — §6.4's card rendering
  "$6,500 / mo", "$18,000" or "$175 / hr" from `agreed_rate_cents`,
  `contract_value_cents` or `hourly_rate_cents` (P1-15, mirroring the mockup's
  `headline()`). It states the engagement's terms; it does not aggregate.
- **The §6.5 offerings price list**, which reads `service_versions.rate_cents`
  and has no `revenue_lines` row by construction — nothing has been sold.

The line is aggregation and attribution. The moment a number sums across
engagements, or attributes to a month, a payer or a model, it comes from
`revenue_lines`.

The canonical shape, which every revenue question reduces to:

```sql
SELECT period_month, status, SUM(amount_cents)
FROM   revenue_lines
JOIN   engagements ON engagements.id = revenue_lines.engagement_id
WHERE  ...
GROUP BY period_month, status
```

Attribution changes the join and the `GROUP BY` key. It never changes the
arithmetic. Recurring monthly revenue, fixed backlog, T&M run rate,
concentration, and the stacked projected-versus-actual chart are all this query
with a different filter.

**Branching on `billing_model` is legal in exactly one place: the generator that
writes `revenue_lines` from an engagement (P3-05).** The enumeration is
exhaustive over §5's `billing_model` enum, because an unlisted model does not
fail loudly — it gets improvised at the call site:

- **`retainer`** — one row per month of its term, `kind = 'retainer'`. Where
  `ends_on` is NULL the engagement is rolling (§5's modelling note), so there is
  no term: it generates to a **stated rolling horizon** — twelve months from the
  current month, regenerated as months pass — and no further. A horizon is a
  parameter of the generator, not a judgement made per engagement.
- **`fixed`** — one row per milestone at that milestone's `expected_month`,
  `kind = 'milestone'`.
- **`tm`** — `tm_estimate` rows, replaced by `tm_actual` rows as described
  below.
- **`equity`** — **no rows at all.**
- **`none`** — **no rows at all**, for the same reason as equity: an engagement
  with no billing model produces no money, and it is excluded by having nothing
  in the table rather than by a filter someone has to remember. §5 declares
  `none`; the generator must have the branch, even though the branch does
  nothing.

Everywhere else — a query, a repository, a hook, a component — an
`if (billing_model === …)` reached for while producing a revenue figure or
rollup is the defect this ADR names.

**`kind = 'expense'` rows are operator-entered, and that is the one other legal
writer of `revenue_lines`.** The generator does not produce them; no adapter
does. They carry a **negative `amount_cents`**, so the canonical `SUM` returns
net and needs no special case. A rollup that deliberately wants gross revenue
filters `kind <> 'expense'` — a filter on the line's own kind, not a branch on
the engagement's billing model, which is the thing this ADR forbids. The
generator never deletes or rewrites an expense row while regenerating an
engagement.

Three further rules the generator owes:

- **Actuals replace estimates; they do not sit beside them.** When `tm_actual`
  rows are written for a month, the generator **deletes that month's
  `tm_estimate` rows for that engagement in the same transaction**. A month
  therefore holds estimates or actuals, never both, and a consumer stays one
  `SUM` needing no `kind` filter to avoid counting a $7,000 estimate and the
  $8,050 actual that replaced it as $15,050. Superseding is the generator's job
  precisely so that
  it is not every consumer's job. This is what §5's original "actuals overwrite"
  meant, stated as a mechanism.
- **Regeneration is idempotent and non-destructive.** Regenerating an
  engagement's lines must not disturb rows already `invoiced` or `paid`, or the
  `stripe_invoice_id` on them. Rows still `projected` are rewritten, including
  those of an in-progress month — the estimate replacement above is exactly that
  case, and it is not restricted to future months.
- **Equity and `none` are excluded by having no rows**, not by a
  `WHERE billing_model NOT IN ('equity','none')` repeated across every
  aggregate. This is what makes §11's "yes, model equity positions here" a
  one-line answer instead of a clause that will eventually be forgotten in one
  of the three rollups.

### Until P3-05 lands

P3-05 is the only writer of `revenue_lines` and it is a Phase 3 task, while
P2-04 ships the Today hero metrics and the twelve-month chart in Phase 2. Built
in plan order there is a stretch where the table is empty and the rule above
cannot be satisfied. Stating it as an absolute anyway is how the rule gets
quietly discarded rather than followed.

So, as a **provisional allowance**, mirroring the pattern P1-15 already uses for
hours: until P3-05 lands, a Phase 2 surface may compute a revenue figure off
engagement columns **only if the figure is visibly marked provisional in the
UI** — the same marking, in the same style, as an hours figure before P4-05.
Provisional means the operator can see the number is not yet real; it is not a
comment in the source.

Two conditions bound it. Provisional computation lives in **one module**, not
scattered per component, so removing it is a deletion rather than a hunt. And
**P3-05 does not land until every provisional revenue computation is gone** —
that is a criterion on P3-05, not a follow-up task. After P3-05, the permanent
rule stands exactly as written above, with no provisional carve-out remaining.

## Consequences

**Easier.** The three §6.7 rollups are one query with a different join. The
chart, the concentration metric and the Today hero numbers read the same table,
so they cannot disagree with each other — which the mockup's three independent
functions can, and eventually would.

**Easier.** Stripe (§7) writes onto rows that already exist. Actuals land with no
recomputation anywhere, and projected-versus-actual is `GROUP BY status` rather
than a second code path.

**Easier.** Performance is one indexed table and no per-engagement work at read
time, comfortably inside §8's 100ms at ten times volume.

**Harder — the lines must be kept current.** Editing an engagement's rate, term
or milestones has to regenerate its future lines. A forgotten regeneration is a
wrong number with no error attached to it. This is the genuine cost of
materialising, and it belongs to the generator, which is why the generator is the
one place allowed to branch.

**Harder — a row exists before the money does.** Projections are rows, so
"revenue" always means "rows with some set of statuses". A query without a status
filter is asking a question nobody meant to ask.

**Cost — the first metric ships slower** than the mockup's one-liner. That is the
whole of the trade: one afternoon at the start against per-model branching in
every consumer for the life of the project.

**Forecloses** computing a revenue figure ad hoc in a component. Deliberately.

## Alternatives

**Compute live from engagement columns, as the mockup does.** Lost because the
branching does not stay in three functions. Each of the three §6.7 attributions
has to re-derive the same money from the same columns, and each billing model
added multiplies through all of them. The first time two of those derivations
disagree, there is no single place the number comes from, so there is nothing to
debug — which is the state the current Notion setup is in and the reason for §1.

**A hybrid: materialise projections, compute actuals live from Stripe data.**
Lost because it splits one question across two mechanisms. "What did October
bring in" becomes a union of a table and a computation, and the chart's projected
and actual bars would come from different code paths — guaranteeing they
eventually round, filter or date-bucket differently.

**A SQL view over `engagements` that produces the `revenue_lines` shape.** Lost
because the per-model branching still exists, now in SQL where it is harder to
test, and because Stripe would have nothing to write to: `invoiced_at`, `paid_at`
and `stripe_invoice_id` are per-line facts that no view can hold. It looks like
materialising and delivers none of the reason for it.

**Recompute on read and cache in memory.** Lost because it keeps every cost of
computing live and adds cache invalidation, and because the two machines in §3
would show different numbers depending on which one had been open longer.
