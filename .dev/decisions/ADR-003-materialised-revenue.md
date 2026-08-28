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

**`revenue_lines` is the only source of any revenue figure.** A number that does
not come from a `SUM(amount_cents)` over `revenue_lines` is a defect, not an
optimisation.

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
writes `revenue_lines` from an engagement (P3-05).** There:

- a retainer generates one row per month of its term, `kind = 'retainer'`;
- a fixed scope generates one row per milestone at that milestone's
  `expected_month`, `kind = 'milestone'`;
- T&M generates `tm_estimate` rows that `tm_actual` rows supersede;
- equity generates **no rows at all**.

Everywhere else — a query, a repository, a hook, a component — an
`if (billing_model === …)` reached for while producing a money figure is the
defect this ADR names.

Two further rules the generator owes:

- **Regeneration is idempotent and non-destructive.** Regenerating an
  engagement's lines must not disturb rows already `invoiced` or `paid`, or the
  `stripe_invoice_id` on them. Only future projected rows are rewritten.
- **Equity is excluded by having no rows**, not by a `WHERE billing_model <>
  'equity'` repeated across every aggregate. This is what makes §11's "yes,
  model equity positions here" a one-line answer instead of a clause that will
  eventually be forgotten in one of the three rollups.

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
