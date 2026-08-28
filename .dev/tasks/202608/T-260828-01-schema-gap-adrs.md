---
id: T-260828-01
title: Settle the schema gaps G1–G8 and record the binding ones as ADRs
status: done
category: docs
plan_ref: D-01
created: 2026-08-28
closed: 2026-08-28
---

## Why

T-260828-07 writes the first migration. G1–G8 in the task plan are gaps between
the requirements §5 schema and what the mockup and the integrations actually
need — two of them add columns, one adds a table, one decides where credentials
live. A DDL written before they are settled encodes guesses into migration 0001,
and a migration is the most expensive thing in this project to change later.

Four of the eight bind code nobody has written yet, which is exactly what an ADR
is for.

## Scope

**In:** Work through G1–G8 in [the task plan §A.1](../../../planning/solo-crm-taskplan.md),
recording accepted / amended / rejected against each with a reason. Create
`.dev/decisions/` and write ADRs from
[the template](../../templates/adr.md) for the four that constrain future code:

- **G1** — denormalised `companies.last_touch_at` / `people.last_contact_at`
  rather than deriving from `MAX(activity.occurred_at)`
- **G2** — a `settings` key/value table
- **G5** — revenue is materialised in `revenue_lines`; every revenue question is
  one `SUM … GROUP BY`
- **G7** — credentials live in Electron `safeStorage`, never in the database

Then amend `planning/solo-crm-requirements.md` §5 so the DDL in the requirements
and the DDL in the migration cannot disagree.

**Out:** Writing the migration (T-260828-07). The Pipeline view decision
(T-260828-02). The §11 open questions in §A.3 — those are data-entry choices
about real companies and need no code and no ADR.

## Touches

- `.dev/decisions/` — new directory, four ADR files
- `planning/solo-crm-requirements.md` — §5 DDL block
- `planning/solo-crm-taskplan.md` — §A.1 table, resolution recorded per gap

## Acceptance

- [ ] Each of G1–G8 in §A.1 carries `accepted`, `amended` or `rejected` and a
      one-line reason
- [ ] `.dev/decisions/` holds ADRs for G1, G2, G5 and G7, each with
      `status: accepted` in frontmatter
- [ ] Every ADR's `Alternatives` section names what lost and the specific reason
      — the template's point is that this is what stops the option being
      re-proposed
- [ ] Requirements §5 DDL contains `companies.last_touch_at`,
      `people.last_contact_at` and a `settings` table
- [ ] `grep -c "last_touch" planning/solo-crm-requirements.md` returns non-zero,
      confirming the amendment landed rather than being described in prose

## Risks

- **Amending §5 makes the requirements a living document.** The header still
  says "Draft v1". Either bump it or state in the ADRs that §5 is amended as of
  this date — otherwise the two files drift and the next reader trusts the wrong
  one.
- **G5 is the gap that gets re-litigated under Phase 3 time pressure**, because
  computing revenue live off engagement columns is faster to write. "Revenue is
  materialised" is too vague to lose an argument with; the ADR needs to name the
  `SUM … GROUP BY period_month, status` shape and say that per-model branching
  outside the generator is the defect. `architecture-review` already cites this
  as a standing flag and will point at the ADR.
- **G7 fails silently rather than loudly.** It holds right up until someone adds
  a settings row for an API key, which will look reasonable. State it as a rule
  about what the `settings` table may hold, not as a rule about Stripe.
- Near the AGENTS.md gotcha that every table gets a UUID primary key and
  `created_at` / `updated_at` — the new `settings` table is keyed by name, so say
  explicitly whether it is exempt.

---

## Outcome

Merged to main in `7f005d3` (run R-260828-01). All eight gaps resolved — 7
accepted, 1 amended (G2). ADR-001..004 written; §5, §4 and §7 of the
requirements amended; AGENTS.md and the architecture-review skill's UUID rule
qualified to match ADR-002.

Decisions taken during the task, beyond the literal scope:

- **UUID exemption is a class, not a singleton**: tables keyed by natural
  identity (`settings` by key, `favicons` by host). Join tables get UUID PKs +
  timestamps; `affiliations` deliberately has no unique pair constraint
  (re-employment history). `activity` keeps `created_at`/`updated_at` despite
  being append-only — uniform rule over a third exemption.
- **Estimate/actual supersession is the generator's job** (ADR-003): writing
  `tm_actual` deletes that month's `tm_estimate` in the same transaction, so
  consumers stay one `SUM` with no per-kind filter.
- **Phase 2 provisional allowance** (ADR-003): revenue figures may be computed
  off engagement columns until P3-05 lands, only if visibly marked provisional;
  P3-05's landing criteria include removing them.
- **FTS5 ownership**: migration 0001 creates neither `search_fts` nor its
  triggers — P1-06 owns both together.
- **'gmail' activity source is reserved with no writer** (ADR-001); the Gmail
  adapter writes touch columns only. NULL `last_touch_at` counts as maximally
  stale so never-touched prospects surface in "going quiet".
- **safeStorage guard** (ADR-004) requires backend ≠ `basic_text`, not just
  `isEncryptionAvailable()` — Linux `basic_text` silently encrypts with a
  hardcoded key.

Review: code-review + architecture-review found 5 blocking / 10 should-fix / 5
nit findings, all fixed before merge across commits `3e51ece`, `1770e0e`,
`53413a9`. Verify: docs-only branch on a pre-toolchain tree — nothing to run,
reported honestly; structural checks (table parse, link resolution, acceptance
greps) all passed.

Follow-up: none open. The requirements' §12 risk-table cell "UUID keys,
`updated_at` everywhere" (line ~426) was left unqualified as non-normative.
