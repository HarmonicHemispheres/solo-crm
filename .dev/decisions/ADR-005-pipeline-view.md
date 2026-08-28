---
id: ADR-005
title: The Pipeline nav item is dropped; the Engagements cards view is the only view of the book
status: accepted
date: 2026-08-28
---

## Context

The mockup ships a **Pipeline** nav item (`planning/solo-crm-mockup.html:492`):
a five-column board — Lead → Qualified → Scoped → Proposed → Committed — with a
per-item probability bar, backed by its own seed array
(`planning/solo-crm-mockup.html:664-673`). Requirements §5 has no `stage`,
`probability` or pipeline table to render it from, and requirements §1 opens by
naming the reason: *"Existing CRMs are built around a sales pipeline — a funnel
of deals that close. That is the wrong center of gravity for a solo services
business"* (`planning/solo-crm-requirements.md:32`). The taskplan's §A.2 flags
this as a genuine conflict between the mockup (authoritative per AGENTS.md) and
the requirements, and recommends dropping the view because "Engagements grouped
by status (§6.4 cards view) already show the whole book" — `status` already
spans `proposed | pending | active | held | delivered | lost`
(`planning/solo-crm-requirements.md:161`, `planning/solo-crm-taskplan.md:90-92`).

That claim has to be checked, not assumed, against the one pipeline column that
does not read as pure sales prospecting: **Committed**. The mockup's own help
text describes its purpose — *"Committed holds signed recurring work so the
board shows the whole book, not only what is unsold"*
(`planning/solo-crm-mockup.html:1030`). If Committed carries state that
`engagements.status` cannot express, dropping the board would lose real
information and the taskplan's premise would be wrong.

It does not. The three Committed items and the engagement rows they reference,
by mockup line number:

| Committed item | Engagement(s) | `status` |
|---|---|---|
| Rinvii retainer (`:670`) | `e1` Advisory + development retainer (`:629`) | `Active` |
| SiteFacts retainer (`:671`) | `e2` SiteFacts — parcel & setback engine (`:631`) | `Active` |
| Samay + platform (`:672`) | `e4` Samay — AI timesheet agent (`:635`), `e6` Platform advisory (`:639`) | `Active`, `Active` |

Every Committed item is exactly the set of engagements with `status = 'Active'`
for that billing company — the axis matters: EZDeploy's card covers `e4`, which
is delivered to W+K (`client:'wk'`) and only billed via EZDeploy (`:635`). "Signed recurring work" is not a state the board invents —
it is the mockup's own name for what `status = 'active'` already means. The
Engagements cards view, grouped by status (§6.4), reproduces Committed exactly
by rendering its Active group; nothing about signed, underway work needs a
second column to exist in.

The other four columns strengthen the case rather than complicate it. Only
Lead holds a pure prospect with no engagement row — Northbank referrals
(`:665`). Qualified's sole item is `e11` (`status = 'Proposed'`, `:649`) and
Scoped's Post-grant build (`:667`) is `e10` (`status = 'Pending'`), so both
already surface in the cards view without a board. The pure-prospect case is
consistent with §1: this business does not track probability-weighted deals, it tracks
companies that stay warm or go cold, which is what the Today view's cadence
and decay ring already do. Proposed is where the mapping gets inconsistent
rather than clean: `e11` (Discovery Audit, `status = 'Proposed'`, `:649`) sits
in the pipeline's **Qualified** column at 40%, while `e9` (Naslund fixed-scope
SOW, also `status = 'Proposed'`, `:645`) sits in the pipeline's **Proposed**
column at 55%. Two engagements sharing one `status` value sit in two different
pipeline stages in the mockup's own hand-authored data. There is no fixed
status→column map that reproduces the board as drawn — which matters for the
option this ADR rejects below. The one board item outside every bucket above,
radial's VedX phase two (`:668`, $15,000 at 25%), has no engagement row and is
already in the record as activity `a7` ("Phase two mentioned, no timeline",
`:659`) — exactly the prospect case the Consequences paragraph declines to
track as a stage.

## Decision

**The Pipeline nav item is not built.** No `stage`, `probability` or pipeline
table is added anywhere in the schema. The Engagements cards view (§6.4,
P1-15), grouped by `status`, is the sole view of engagement state — proposed,
pending, active, held, delivered or lost — and covers everything about signed
or in-flight work that the Pipeline board showed under Committed and Proposed.

Pre-engagement prospecting — board items with no engagement row, like Lead's
Northbank referrals and radial's VedX phase two — is not ported in any form. A company that is
being courted but has not signed anything is tracked the way §1 already argues
it should be: by activity logged against the company and by its cadence/decay
state on the Today view, not by a probability-weighted deal stage. If a
prospect becomes real, it becomes an engagement with `status = 'proposed'`
(or `'pending'`) and appears in the cards view like everything else. Nothing
new is built to hold the in-between state.

## Consequences

**Easier.** One fewer nav item, one fewer view to build, test and keep in
sync with engagement data. Every place "how much signed work is there" gets
asked, it is asked of `engagements.status`, which is also what revenue
attribution and hours reporting already read — one status field, one set of
consumers.

**Easier.** No second status vocabulary to keep aligned with
`engagements.status`. The taskplan's own risk about Option 2 — "two mappings
that drift apart is a bug that looks like a design inconsistency" — cannot
happen because there is only one mapping, and the Proposed-column
inconsistency shown above is evidence it would have happened: the mockup's
own data already disagrees with itself about which stage a `Proposed`-status
engagement belongs in.

**Forecloses tracking probability-weighted pre-engagement deals** —
deliberately. This is the cost §1 explicitly accepts: a solo consultancy's
revenue is "a small number of relationships that either stay warm or quietly
go cold," not a funnel with a close probability. A future decision to track
early-stage prospects belongs to a `companies`/`activity`-based warmth signal
(already in scope), not a revived pipeline board.

**Cost — a standing contradiction with AGENTS.md's "authoritative visual
spec" line**, since the mockup draws a view the product will not have.
Resolved by amending AGENTS.md itself (below) rather than leaving an agent
reading the mockup to treat the board's absence as an oversight.

## Alternatives

**Derive it from `engagements.status` with a fixed status→column map (taskplan
option 2).** Rejected. It looked like it would cost a day and add no schema;
the mapping check above shows it is not free even before build time. The
mockup's own seed data puts two `status = 'Proposed'` engagements in two
different pipeline columns (Qualified and Proposed), and Lead/Qualified/Scoped
hold prospects with no engagement row for a derived map to key off at all. A
"fixed status→column map" cannot reproduce the board as drawn — it can only
draw a different, invented one — which means Option 2 is not really "derive
the mockup's board," it is "design a new, smaller board and justify it," at
which point it is competing with Option 1 on the merits §1 already settled
against a sales funnel. Two status vocabularies (engagement status and pipeline
stage) that both claim to describe the same thing was always the shape of the
risk the taskplan named; the mockup's own inconsistency shows it is not
hypothetical.

**Build it as drawn, with `stage` and `probability` columns (taskplan option
3).** Rejected on the same grounds requirements §1 and §2 already reject a
sales-funnel center of gravity, and because it adds a second source of truth
for "how likely is this" with no consumer elsewhere in the requirements that
needs a probability figure. §12's scope-creep risk is exactly this: a view the
mockup happened to include outliving the reason the requirements gave for not
wanting it.
