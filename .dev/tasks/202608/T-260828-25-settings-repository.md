---
id: T-260828-25
title: Build the settings repository — typed accessors, declared defaults, no credentials
status: open
category: data
plan_ref: P2-01
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The Settings page is blank in the installed build because nothing can store a
setting. The `settings` table exists (ADR-002: keyed by natural identity, so
exempt from the UUID rule, with `updated_at` and no `created_at`) and has no
accessor. Everything §6.11 lists — identity, per-kind default cadence,
integration toggles, backup folder, appearance — is a row in this table, and so
is §6.13's per-view card/list mode. The plan files this as P2-01 in Phase 2, but
it is pulled forward here because the Settings view (T-260828-38) has nothing to
render without it, and because view-mode persistence is a Phase 1 promise.

ADR-004 also makes this a boundary task, not just a table wrapper: credentials
live in Electron `safeStorage`, never here, and nothing at the database level
enforces that. The type does.

## Scope

**In:** `electron/main/db/repositories/settings.ts`:

- A **declared key registry** — every settable key listed once with its zod
  value schema and its default. Reading an unset key returns its declared
  default, never `undefined`.
- `getSetting(key)`, `setSetting(key, value)`, `getAllSettings()`,
  `resetSetting(key)`. Typed by the registry, so `getSetting('appearance.density')`
  returns the density union and not `string`.
- Values are stored as JSON text in `value`, parsed and validated on read. A row
  whose stored JSON no longer matches its schema falls back to the declared
  default and logs — an app that will not boot because of one bad settings row
  is a worse failure than one that ignores it.
- `updated_at` stamped on every write. No `created_at` — ADR-002.
- The keys §6.11 and §6.13 need: workspace name, operator, currency, fiscal year
  start; default cadence per company kind; integration enable toggles;
  backup folder path and nightly-toggle; interface motion and compact density;
  per-view presentation mode.
- **A credential guard.** The registry's value type forbids anything named or
  shaped like a secret, and a test asserts that no declared key is a token, key
  or password field (ADR-004, G7).

**Out:** IPC channels (T-260828-26). The Settings view itself (T-260828-38).
The cadence-inheritance behaviour that consumes the per-kind defaults (P2-02) —
this task stores the values, it does not move companies when they change. The
nightly backup (X-04). `safeStorage` credential handling (P4-01).

## Touches

- `electron/main/db/repositories/settings.ts` — new
- `electron/main/db/repositories/settings.test.ts` — new

## Acceptance

- [ ] A key written, the database closed and reopened, and the key read back
      unchanged — against a real file database, not in-memory
- [ ] Reading a key that has never been written returns its declared default,
      and no row is created as a side effect of the read
- [ ] A key not in the registry is rejected at the type level and at runtime
- [ ] A row whose stored JSON fails its schema yields the default and logs once;
      the app still starts
- [ ] `updated_at` moves on every `setSetting` and the table has no
      `created_at` column
- [ ] No declared key stores a credential — asserted by a test over the registry,
      not by reading the diff (ADR-004)
- [ ] Every key §6.11 lists has an entry, checked against that section by name

## Risks

- **A generic `set(key: string, value: unknown)` escape hatch.** It makes the
  registry advisory, and the credential guard along with it.
- **Defaults living at the call site.** Two views defaulting density
  differently is invisible until someone notices the app disagrees with itself.
  The default belongs in the registry, once.
- **AGENTS.md's UUID rule.** `settings` is one of the two exemptions (ADR-002);
  adding an `id` column here to satisfy a reviewer's habit would be the
  regression.
