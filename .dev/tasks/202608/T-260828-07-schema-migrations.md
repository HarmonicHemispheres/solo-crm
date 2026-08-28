---
id: T-260828-07
title: Write the Drizzle schema and the migration runner
status: open
category: data
plan_ref: P0-05
created: 2026-08-28
closed:
---

## Why

This is the task the rest of the project is shaped by. Requirements §5 is not
just a list of tables — it encodes decisions the UI deliberately does not expose:
billing party separate from delivery client, `agreed_rate_cents` as a snapshot,
`ends_on = NULL` meaning rolling, `affiliations` as its own table. A schema that
loses any of those loses the argument the requirements make, without failing a
test.

## Scope

**In:**

- The full §5 schema **as amended by T-260828-01** — including
  `companies.last_touch_at`, `people.last_contact_at` and the `settings` table.
  Do not re-derive the gaps here; read the ADRs.
- Every table: UUID primary key, `created_at`, `updated_at`. This is what keeps a
  later Turso / libSQL sync a drop-in rather than a rewrite (AGENTS.md), and it
  costs nothing now.
- Drizzle schema definitions plus generated SQL migration files, checked in. The
  migration runner executes pending migrations on boot inside a transaction and
  records the schema version.
- Constraints that carry the requirements' meaning rather than just its shape:
  `billed_via_company_id` cannot equal `id`; `engagements.status` includes `lost`;
  `ends_on` is nullable with no sentinel default.
- The schema version and last-migration date readable in main, for X-01 to
  display.

**Out:** Repositories and any query (P1-01 onward). The FTS5 virtual table and
its triggers — P1-06 owns that, because it needs the source tables to exist and
has its own architecture gate. Seed data (T-260828-13).

## Touches

- `electron/main/db/schema.ts`
- `electron/main/db/migrations/0001_*.sql` — generated, checked in
- `electron/main/db/migrate.ts` — runner
- `electron/main/db/connection.ts` — run migrations after open

## Acceptance

- [ ] A fresh database and one created by replaying every migration in order
      produce an identical schema — compared by dumping `sqlite_master`, not by
      inspection
- [ ] Every table has a UUID primary key, `created_at` and `updated_at`; a query
      over `pragma_table_info` asserts it rather than a reviewer checking by eye
- [ ] Migrations apply cleanly to a **populated** copy, not only to an empty file
- [ ] A migration that throws leaves the database at its previous version, with
      no partial application
- [ ] The schema version and last-migration date are readable from main
- [ ] `INSERT` of an engagement with `billed_via_company_id = id` is rejected by
      the database
- [ ] `ends_on` accepts `NULL` and no default substitutes a date

## Risks

- **This is the expensive thing to change later**, which is why T-260828-01 gates
  it. If that task's ADRs are not written, this one is blocked, not unblocked by
  guessing.
- **A migration that only works on an empty database is broken and does not look
  broken** — `verify` calls this out specifically. Test against a seeded copy.
- Drizzle's SQLite driver is friendlier to `text` primary keys than to a UUID
  type; whichever representation is chosen, it must be consistent across all
  tables or joins silently fail to match.
- `revenue_lines` and `time_entries` are the two tables that grow. Index
  `period_month` and `worked_on` now — retrofitting an index onto 20k rows is
  easy, noticing it is missing is not (§8 targets 20k time entries).
- Foreign keys enforce nothing unless T-260828-05's pragma is on. Confirm rather
  than assume; a schema full of unenforced references is the failure mode this
  pair of tasks exists to avoid.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
