---
id: T-260828-39
title: Open a genuinely read-only query channel — second connection plus statement refusal
status: in-progress
category: ipc
plan_ref: X-02
created: 2026-08-28
closed:
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
