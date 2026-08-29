---
id: T-260828-39
title: Open a genuinely read-only query channel — second connection plus statement refusal
status: done
category: ipc
plan_ref: X-02
created: 2026-08-28
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

§6.12's rationale is that the schema encodes decisions the UI deliberately does
not expose — version history, snapshot rates, affiliation ranges — and a query
console is what keeps pressure off the UI to grow an analytics surface for every
one-off question. The console (T-260828-40) cannot exist until there is a channel
that runs a statement, and this is the single most dangerous channel in the app:
it takes SQL from the renderer.

X-02 specifies belt and braces for a reason. A `^SELECT` regex is not a
safeguard — `PRAGMA writable_schema = 1` and `ATTACH DATABASE` both slip past it
and both can destroy the file.

## Scope

**In:**

- A **second `better-sqlite3` connection, opened readonly** against the same
  database file, held separately from the write connection and never handed out.
- **And** a rejection of any statement where `stmt.readonly` is false, checked on
  the prepared statement rather than on the source text.
- A `db:query` channel taking a statement and optional bound parameters,
  returning rows, a row count and an execution time.
- Refusals are **explicit and name why** — nothing is silently ignored (§6.12).
  A rejected `DELETE`, a rejected `PRAGMA writable_schema`, and a rejected
  `ATTACH` each say what was refused and on what grounds.
- A statement timeout and a row cap, so a cartesian join freezes nothing.
- The write connection is unreachable from this channel by construction, not by
  discipline — asserted in a test.

**Out:** The console UI (T-260828-40). Saved snippets, which live with the UI.
Maintenance actions — `VACUUM`, `ANALYZE`, `integrity_check` are writes and
belong to X-05, not here. Any write path whatsoever.

## Touches

- `electron/main/db/readonly-connection.ts` — new
- `electron/shared/ipc-types.ts`, `electron/main/ipc/registry.ts` — the channel
- `electron/main/db/connection.ts` — read only; the write connection is untouched
- Tests alongside each

## Acceptance

- [ ] `DELETE FROM companies`, `PRAGMA writable_schema = 1`, `ATTACH DATABASE
      ':memory:' AS x` and `UPDATE settings SET value = …` are **each** refused
      with a message naming why — one assertion per statement
- [ ] A legitimate four-table join returns rows
- [ ] Every refusal is explicit; no statement is accepted and silently
      no-opped (§6.12)
- [ ] The write connection is not reachable from the channel's module graph —
      asserted, not argued
- [ ] A statement exceeding the timeout is cancelled with a stated reason rather
      than hanging the main process
- [ ] A result set larger than the row cap is truncated with that fact stated in
      the response, not silently
- [ ] The error envelope carries no filesystem path and no stack trace
      (T-260828-09's boundary)
- [ ] `security-review` runs on this diff — it is the category default for `ipc`
      and this is the channel that most needs it

## Risks

- **The regex temptation.** `^\s*SELECT` looks like a check and is not one; X-02
  names the two statements that defeat it. Both mechanisms, or neither is worth
  having.
- **A readonly connection opened against a WAL database still writing `-shm`.**
  Verify the connection genuinely refuses writes rather than assuming the flag
  did it.
- **AGENTS.md: the renderer never touches SQLite.** This channel is the closest
  the app comes to breaking that rule, and it holds only because the statement
  is executed in main against a connection that cannot write. That is the whole
  argument, and it should be written into the file's header comment.
- **Timeouts on the main process.** `better-sqlite3` is synchronous; a long
  query blocks everything. The cap and timeout are not optional polish.


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed by the
orchestrator at merge, with one security gap found and closed on top.

**Changed:** `electron/main/db/readonly-connection.ts` (new),
`readonly-connection.test.ts` (new), `connection.test.ts`,
`electron/main/ipc/registry.{ts,test.ts}`, `electron/main/index.ts`,
`electron/shared/ipc-types.ts`,
`electron/renderer/lib/test-support/stub-crm.ts`.

### Three independent mechanisms, none of them textual

X-02 asks for belt and braces because `^\s*SELECT` is not a safeguard —
`PRAGMA writable_schema = 1` and `ATTACH DATABASE` both slip past a text check
and both can destroy the file. **Nothing here is decided by looking at the
statement text:**

1. **The connection is opened `readonly: true`, plus `query_only = ON`,** so
   SQLite itself refuses a write at step time. Asserted, not assumed:
   the test runs a `DELETE` straight at the connection, bypassing every check
   below, and expects `SQLITE_READONLY`.
2. **`stmt.readonly` must be true** — read off the compiled statement
   (`sqlite3_stmt_readonly`), never off the source string. Catches `DELETE`,
   `UPDATE`, `INSERT`, `VACUUM`, `ANALYZE`.
3. **`stmt.reader` must be true** — the statement must return a result set.

### The finding that made mechanism 3 necessary

The builder measured, rather than assumed, what `stmt.readonly` covers:
**against better-sqlite3 13.0.3, both `ATTACH DATABASE` and
`PRAGMA writable_schema = 1` report `readonly === true`.** SQLite deliberately
classifies statements that change connection *configuration* as read-only. So
the second mechanism the scope names **cannot by itself satisfy its own
acceptance criteria** — the two attacks X-02 was written to stop are exactly the
two it lets through.

Mechanism 3 is the answer, and it is still non-textual: those statements return
no columns, and column count is read off the compiled statement. `PRAGMA
table_info(...)` and `EXPLAIN` still work, because they do return rows.

### Security gap found at review and closed on top of the merge

**The read-only connection opened without the sync-folder guard.**
`openReadOnlyDatabase` resolved its path with `resolveDatabasePath()`, which only
joins a filename onto the resolved data root — **the guard lives inside
`openDatabase()`, not inside the path helper.** So this was a second, unchecked
way to open the database, which is the precise shape AGENTS.md warns about.

In practice the write connection opens at boot and would already have refused a
sync-folder path, so nothing was exploitable today. But that protection rested on
an **ordering invariant nothing enforced**: anything that opened this connection
earlier — a first-run diagnostic, a future repair path — would have bypassed the
guard silently, and file-sync daemons corrupt SQLite whether one connection is
attached or two.

The guard now runs here too, imported from `./sync-folder-guard` **directly,
never through `./connection`**, so the write handle stays unreachable from this
module by construction and the structural test asserting that still holds. A new
test opens a read-only connection under a `Dropbox/` path and requires
`SyncFolderGuardError` specifically — not merely "it threw", since
`fileMustExist: true` would also throw there for a much weaker reason.
**Verified by mutation:** with `findSyncFolderMatch` neutered the new test fails
and the other 23 pass; restored, 24/24.

### The timeout's honest limit, named rather than papered over

better-sqlite3 exposes neither `sqlite3_interrupt` nor
`sqlite3_progress_handler`, so the only point this code regains control is
*between rows*. `runReadOnlyQuery` steps the statement one row at a time and
abandons it once the deadline passes, which covers the case that actually
happens — a join streaming far more rows than anyone meant — and the row cap
covers it from the other side.

**What it cannot interrupt is a single long `sqlite3_step` before the first
row**, e.g. `SELECT count(*)` over a cartesian product. That gap is stated in the
file header rather than hidden. Closing it needs an interrupt binding this
dependency does not have.

### Two files outside the scope's Touches, both for correctness

`electron/main/index.ts` — `before-quit` now calls `closeReadOnlyDatabase()`
**before** `closeDatabase()`. Without that ordering, `closeDatabase`'s
`wal_checkpoint(TRUNCATE)` fails quietly while a second connection is attached,
leaving committed data in the `-wal` sidecar — the exact outcome that checkpoint
exists to prevent. `stub-crm.ts` — `CrmApi` is not partial, so a new channel
needs a default there or every renderer lib test stops compiling.

## For T-260828-40, which builds the console on this

Rows come back as **positional arrays keyed by a `columns` array, not objects.**
A four-table join names `id` four times and an object row would silently keep one
of them — losing data in exactly the kind of query this channel exists to make
possible.

The timeout and row limit are main-side constants, deliberately absent from the
request schema and kept out by `.strict()`: **the console must not be able to
raise its own ceiling.** `truncated` is reported explicitly, never silently.

## Still owed: a standalone security review

This task is category `ipc`, and it is the most dangerous channel in the
application — it takes SQL from the renderer. Under the current process
`security-review` runs in its own session rather than inside a build wave, and it
has **not** been run. The orchestrator's review at merge found and fixed the
sync-folder gap above, but that is a code review, not the security gate. Recorded
in the run summary as outstanding.

## What went wrong, in the review fix itself

The first version of the new guard test **broke the guard test next to it**.
`connection.test.ts`'s *single owner of the SQLite connection* walk scans every
module under `electron/` for the better-sqlite3 constructor as a source string,
and my explanatory comment quoted that constructor literally — so
`readonly-connection.test.ts` was reported as an unauthorised opener on the
strength of a comment.

Two things worth keeping from it. The walk was **right**, and it was found by
running the whole suite on the merged tree rather than the files I had touched —
neither the branch nor a targeted run would have shown it, since the walk lives
in a file in the serial pool that my change did not touch. And the test it
collided with had already anticipated the problem for itself: it assembles its
own matching regex from fragments specifically "so this check does not match
itself". The lesson generalises to prose — a source-scanning guard makes comments
part of the program.

## Gate

Whole suite on the merged tree, after the review fix: **73 files / 939 tests**
in the fast pools and **7 files / 64 tests** in the serial runtime-boot pools —
**1003 green, nothing skipped.** Typecheck clean across all three passes, lint
clean.
