---
id: T-260828-20
title: Build the companies repository — CRUD, billing links, referential refusals
status: done
category: data
plan_ref: P1-01
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`electron/main/db/` holds a connection, a migration runner, a schema and a seed
fixture — and nothing that reads or writes a row. Migration 0001 created
`companies` in T-260828-07 and the seed fixture writes to it directly with raw
Drizzle inserts, so the table is real but no code outside `seed/fixture.ts`
knows how to touch it. Every task downstream of this one — the IPC channels, the
companies view, company detail, the create sheets, the palette — needs a
companies repository to exist before it can be built, which is why the plan
names P1-01 first in the P1-CUT subset. This is the first task in the project
that makes the database do work.

## Scope

**In:** A new `electron/main/db/repositories/companies.ts` exporting typed
functions over the `companies` table as `schema.ts` declares it:

- `listCompanies`, `getCompany(id)`, `createCompany(input)`,
  `updateCompany(id, patch)`, `deleteCompany(id)`.
- Every column round-trips: `kind`, `website`, `bills_directly`,
  `billed_via_company_id`, `introduced_by_company_id`, `cadence_days`,
  `budget_note`, `notes`, `since`.
- UUID `id` and `created_at` / `updated_at` are set by the repository, never by
  a caller — the convention AGENTS.md makes universal and ADR-002 exempts only
  `settings` and `favicons` from. `updated_at` moves on every update.
- Zod input schemas for create and update, built from `electron/shared/types.ts`
  primitives (`dateOnlySchema` for `since`, not a bare string) per CONVENTIONS.md.
- Referential refusals that return a **reason**, not a raw SQLite error: deleting
  a company that is another company's `billed_via_company_id` or
  `introduced_by_company_id`, or that has `activity` rows, is refused with a
  message naming what blocks it and how many rows. Migration 0001 gave
  `activity`'s back-links RESTRICT foreign keys deliberately (G8, ADR-001) —
  this repository turns that constraint into a sentence.
- A repository-level error type the IPC layer can map to its envelope, so
  T-260828-26 does not have to string-match.

**Out:** IPC channels (T-260828-26 owns the whole registry, one task by design).
Any renderer code. The people, engagements, tasks and activity repositories —
each is its own task. Decay/cadence computation (P2-03). Links (P1-18).

## Touches

- `electron/main/db/repositories/companies.ts` — new
- `electron/main/db/repositories/companies.test.ts` — new
- `electron/main/db/repositories/errors.ts` — new, the shared refusal type
- Possibly `electron/main/db/schema.ts` — read only; no DDL change is expected

## Acceptance

- [ ] A company created with all fourteen writable columns set, then read back
      by `getCompany`, is equal field-for-field to what went in
- [ ] `createCompany` assigns a UUID `id` and equal `created_at`/`updated_at`;
      a subsequent `updateCompany` moves `updated_at` and leaves `created_at`
- [ ] Setting `billed_via_company_id` to the row's own `id` is rejected by the
      database `CHECK` (`companies_billed_via_company_not_self`), and the
      repository surfaces it as a refusal, not an unhandled throw
- [ ] `deleteCompany` on a company that is another's billing party returns a
      refusal naming the blocking company, and the row is still present
      afterwards
- [ ] `deleteCompany` on a company with activity rows is refused with a reason
      that names the activity count; no activity row is deleted or orphaned
- [ ] `since` rejects `'2026-8-1'` and accepts `'2026-08-01'` — the
      `dateOnlySchema` boundary, not a hand-rolled check
- [ ] Tests run against a real migrated in-memory/temp database, not a mock

## Risks

- **Deleting through the FK instead of refusing before it.** The tempting
  implementation catches `SQLITE_CONSTRAINT` and rephrases it. That produces a
  correct-looking message for the case that fires and a raw error string for the
  case that does not. Check first, in the same transaction as the delete.
- **Reintroducing a parent/child company link.** `billed_via_company_id` is a
  billing pointer, not a hierarchy — §5's modelling note. A convenience helper
  like `getSubsidiaries()` would quietly make it one.
- **`bills_directly` defaults to `true` in the schema.** An update patch that
  omits the field must not reset it; distinguish "absent" from "explicitly false".

---

## Outcome

Merged as `45e738c` (branch `T-260828-20`, commits `212ebe0` + `c113048`).
Verify on the merged tree: typecheck clean both projects, `eslint .` clean,
380/380 tests across 47 files.

**Changed:**

- `electron/shared/companies.ts` — new. `Company`, `COMPANY_KINDS` and both
  input schemas as pure zod, composing `dateOnlySchema` from `shared/types.ts`.
- `electron/main/db/repositories/companies.ts` — new. CRUD, row mapping,
  constraint translation. Imports its domain types from shared.
- `electron/main/db/repositories/errors.ts` — new. `RefusalError` /
  `ValidationError` with a `blocker` discriminator so callers never string-match.
- `electron/main/db/repositories/referential-guard.ts` — new.
  `refuseIfReferenced(db, id, blockers)`, declarative.
- `electron/main/db/repositories/companies.test.ts` — new, 29 tests.
- `.dev/decisions/ADR-007-entity-schemas-in-shared.md` — new.

**Review:** two lenses, because this task sets the pattern five repositories
copy. `code-review` returned **blocking**; `architecture-review` non-blocking
but with the finding that mattered most.

Fixed before merge:

1. *(blocking)* `deleteCompany` checked 3 of the 8 foreign keys pointing at
   `companies`. Deleting a company with an engagement — the most likely real
   delete — threw a raw `FOREIGN KEY constraint failed`. Now all 8, via the new
   declarative guard.
2. *(blocking)* `spec.key in parsed` did not distinguish an absent key from one
   explicitly `undefined`, so a renderer patch of the natural shape
   `{ field: dirty ? value : undefined }` wiped the column to NULL. Electron's
   structured clone preserves undefined-valued keys, so this was reachable over
   IPC. Fixed once, in `parseInput`, which also fixed `createCompany` bypassing
   its documented defaults.
3. *(pattern)* Wire schemas lived in main-only code that `shared/ipc-types.ts`
   cannot import (TS6307). T-260828-26 would have had to redefine all 14 fields,
   giving every payload two schemas free to drift. Moved to
   `electron/shared/companies.ts`; recorded as **ADR-007** because it binds the
   next five repositories and the IPC task.
4. *(pattern)* Readable refusal was a convention repeated three times, obliging
   nothing. Now `refuseIfReferenced`. Note migration 0001 uses `ON DELETE no
   action`, **not** `RESTRICT` as this task's own scope text assumed — so a
   repository that skips the pre-check gets a bare FK error with no net.
5. *(pattern)* `translateWriteError` forwarded raw better-sqlite3 messages into
   user-facing text. Now dispatches on the `SQLITE_CONSTRAINT_*` subcode and the
   constraint name. `blocker` is set on write-path refusals too, not just deletes.
6. *(pattern)* Schemas were non-strict, so `{ nmae: 'typo' }` parsed to `{}`,
   bumped `updated_at` and returned a `Company` that looked saved. Now `.strict()`.
7. *(scope)* `lastTouchAt` had been added as a 14th writable field. ADR-001
   assigns it to the activity repository and says it never retreats; a caller
   could render a client touched yesterday as six years stale. Removed from the
   writable set, kept on the read type.

Review also caught that the test for risk #3 **could not have failed** — it
passed a literally-absent key, the one case the broken code handled. Tests
rewritten to exercise the integration: 15 → 29.

**Deferred:**

- FK columns are unindexed; `links` / `taggings` / `external_refs` orphan
  silently on delete → **T-260828-41**
- A billed-via cycle `A → B → A` is accepted, though `seed/index.ts` already
  refuses it → **T-260828-42**
- Nowhere, deliberately: whitespace-only names are not trimmed; `mapRow` reads
  `bills_directly` as `=== 1` rather than `!== 0`; an empty patch still bumps
  `updated_at`. Each is a one-line change with no current caller that can
  trigger it, and folding them in would have widened a diff already carrying
  seven fixes.
- `schema.test.ts`'s drift check spawns `drizzle-kit` against a fixed 5s vitest
  timeout and flakes on a cold run. Not touched — weakening a check to make it
  pass is forbidden. It is a real hazard for parallel waves and needs its own
  task if it recurs.
