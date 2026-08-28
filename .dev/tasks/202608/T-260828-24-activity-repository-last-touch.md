---
id: T-260828-24
title: Build the append-only activity repository and maintain the last-touch timestamps
status: done
category: data
plan_ref: P1-05
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`companies.last_touch_at` and `people.last_contact_at` are denormalised columns
that exist because ADR-001 decided they must not be derived from
`MAX(activity.occurred_at)` — the Gmail adapter writes a contact timestamp with
no activity row to hang it on. Nothing writes them today, so every cadence
figure the app will show is currently null. This task is where the denormalised
pair gets its maintainer, and where G8's append-only rule stops being a comment
in `schema.ts` and becomes a boundary: the repository exposes no update and no
delete, because a SQLite trigger would also block the repository's own writes,
so the boundary is the only place the rule can live.

## Scope

**In:** `electron/main/db/repositories/activity.ts`:

- `listActivity` with filters by company, person, engagement and date range, and
  `getActivity(id)`.
- `logActivity(input)` — the **only** writer. Carries `occurred_at`, `kind`
  (`call | email | meeting | note`), `title`, `body`, optional `company_id`,
  `person_id`, `engagement_id`, and `source` (`manual | gcal`; `gmail` is
  reserved with no writer per ADR-001).
- The insert and the touch-timestamp updates are **one transaction**: an
  activity row with a company moves that company's `last_touch_at`; one with a
  person moves that person's `last_contact_at`; one with both moves both. The
  timestamps only ever move forward — a backdated activity row does not pull a
  company's `last_touch_at` backwards.
- A separate `recordContact(entity, at)` for the Gmail adapter's future use —
  moves the denormalised column with no activity row, which is the whole reason
  ADR-001 rejected deriving it. Exported and tested now, called by P4-xx later.
- Explicitly **no** `updateActivity` and no `deleteActivity`. A test asserts the
  module's export list, so adding one later fails the suite rather than passing
  review.

**Out:** IPC channels (T-260828-26) — and note that task must expose no update
or delete channel for activity either. The Activity view (T-260828-34). The
quick log UI (T-260828-35). Decay computation from `last_touch_at` (P2-03). The
Gmail adapter itself (P4-xx).

## Touches

- `electron/main/db/repositories/activity.ts` — new
- `electron/main/db/repositories/activity.test.ts` — new
- Reads `companies` and `people` to update their touch columns

## Acceptance

- [ ] The module exports no function whose name contains `update` or `delete`
      for activity rows — asserted against the module's own exports, not by
      reading the diff (G8)
- [ ] Inserting an activity row with a company moves that company's
      `last_touch_at` in the same transaction; forcing the update half to fail
      leaves **no** activity row written
- [ ] An activity row with a person and no company still moves the person's
      `last_contact_at`
- [ ] An activity row backdated behind the company's current `last_touch_at`
      leaves that column unchanged, and the row is still stored
- [ ] `recordContact` moves `last_touch_at` with no activity row created —
      verified by an activity count before and after
- [ ] A correction is a new row: two rows about the same call both persist, and
      neither is mutated
- [ ] `occurred_at` is a `timestampSchema` value; `source: 'gmail'` is rejected
      by the input schema, since it has no writer (ADR-001)

## Risks

- **Deriving `last_touch_at` from `MAX(occurred_at)` because it is tidier.**
  ADR-001 rejected exactly this: it would silently ignore email, the largest
  source of contact. Reviewers should treat any `MAX(occurred_at)` in this file
  as a finding.
- **Two statements, no transaction.** A crash between the insert and the touch
  update leaves history that the cadence meter cannot see — the failure mode is
  a company that looks quiet while its timeline says otherwise.
- **Forward-only clamping forgotten.** Importing historical activity later
  would then walk every company's `last_touch_at` backwards in one run.
- **An `upsert`-flavoured helper reintroducing mutation.** The append-only rule
  has no database enforcement behind it; this file is the enforcement.

---

## Outcome

Merged as `419f550`. Verify on the merged tree: typecheck clean both projects,
404/404 tests.

**Changed:**

- `electron/shared/activity.ts` — new. Write-input schemas as pure zod (ADR-007).
- `electron/main/db/repositories/activity.ts` — new. `logActivity` as the only
  writer; insert plus both touch-timestamp updates in one transaction, clamped
  forward-only. `recordContact` for the Gmail adapter's future no-activity-row path.
- `electron/main/db/repositories/activity.test.ts` — new.

**Review:** non-blocking. Confirmed the things that mattered: no
`MAX(occurred_at)` anywhere (ADR-001), the module exports nothing that updates or
deletes an activity row (G8), and the atomicity holds — the reviewer probed the
person path directly and a failing `UPDATE people` correctly rolls back both the
activity row and the already-applied company touch.

Deferred rather than fixed, none of which changes behaviour:

- `ActivityFilters` is a bare TypeScript interface in main with no zod schema,
  so the read filter did not follow the write inputs into shared. T-260828-26
  needs it there → folded into that task's scope.
- The person half of the atomicity test is unproven — the code is right (probed),
  but only the company path is exercised.
- `listActivity`'s `ORDER BY occurred_at DESC` has no tiebreaker, so rows sharing
  a timestamp — every backfilled import stamps a batch with one — can reorder
  between two identical queries → **T-260828-43**.
- ~55 lines copied verbatim from `companies.ts` → **T-260828-43**.
- No index on `activity(company_id)`, `(person_id)` or `(occurred_at)`, so every
  filtered read is a full scan of the fastest-growing table → **T-260828-41**.
- The module header's justification for the no-trigger decision is factually
  wrong: `logActivity` only INSERTs into `activity`, so a `BEFORE UPDATE`/
  `BEFORE DELETE` trigger would not fire against this repository's own writes.
  The decision stands on G8; the reasoning in the comment needs correcting.
