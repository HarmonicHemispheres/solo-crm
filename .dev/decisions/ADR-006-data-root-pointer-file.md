---
id: ADR-006
title: The data root is named by a pointer file outside the database, not a settings row or an env var
status: accepted
date: 2026-08-28
---

## Context

`resolveDatabasePath()` has always hardcoded `app.getPath('userData')` as the
folder holding `solocrm.db` and its `-wal`/`-shm` sidecars
([connection.ts](../../electron/main/db/connection.ts)). That is right for
most users and wrong for anyone who keeps their data on a second drive — there
has been no path forward for them at all.

The obvious place to record "where is my data" is the `settings` table
(ADR-002). It is wrong here, and for a structural reason rather than a
style preference: `settings` lives *inside* `solocrm.db`, and the data root
is the answer to "where is `solocrm.db`". A row cannot tell the app where to
find the database that row lives in — the value would have to be read before
the database holding it is open. This is a chicken-and-egg constraint, not a
detail, and it is why the choice belongs in an ADR rather than in T-260828-17's
task file alone.

The second obvious place is an environment variable, on the model of
`SOLOCRM_ALLOW_SYNC_FOLDER_DB` (T-260828-06). That guard's env var is a
narrow, documented escape hatch for a yes/no decision an expert user makes
once, accepting a stated risk. A data *location* is a different shape of
value: it is meant to persist across every future launch, wants to survive
being set through a UI (T-260828-18), and — unlike the guard override — has
no safe default to fall back to if it goes missing. `SOLOCRM_ALLOW_SYNC_FOLDER_DB`
existing is not precedent for a second env var; it is precedent for how narrow
that mechanism is meant to stay. Widening it into a location override would
reopen exactly the unchecked-default risk T-260828-05's Risks section refused
during the original database-boot task.

This also sits directly on the AGENTS.md gotcha that predates it: **the
database must never live in a Drive, Dropbox or iCloud folder**, enforced by
T-260828-06's sync-folder guard inside `openDatabase()`. Making the data root
user-suppliable is precisely the input that guard was built to check —
whatever mechanism carries the location has to keep resolving through
`resolveDatabasePath()` so the guard still runs against it, not introduce a
second path into `new Database(...)` that bypasses the check.

## Decision

The data root is named by a pointer file, `data-location.json`, that itself
always lives at the fixed location `app.getPath('userData')/data-location.json`
— never anywhere the pointer's own contents move. Its shape:

```json
{ "dataRoot": "<absolute path>" }
```

`electron/main/db/data-root.ts` owns it:

1. **No pointer file present is the default, and is byte-for-byte today's
   behaviour.** `resolveDataRoot()` returns `app.getPath('userData')`
   unchanged. T-260828-17 builds no UI and writes no pointer file on its own
   — every existing install stays on exactly the path it already used.
2. **The pointer only ever names the folder holding `solocrm.db` and its
   sidecars.** Nothing broader. X-04's backup-folder setting is a different
   value, stored differently (as a `settings` row, once P2-01 exists, per
   ADR-002) and is deliberately allowed to be a sync folder — a backup is a
   point-in-time export, not a live file two processes write to at once, so
   the sync-corruption risk this ADR exists to avoid does not apply to it.
   Conflating the two would either forbid a legitimate backup destination or
   quietly exempt the live database from the guard; ADR-006 keeps them apart
   by keeping the value apart.
3. **A pointer is read, validated and composed with the database filename
   before `openDatabase()`'s sync-folder guard runs — never after.**
   `resolveDatabasePath()` stays the single seam the guard depends on
   (T-260828-06's Risks note); it composes with `resolveDataRoot()` rather
   than reading the pointer inline, so the read lives in one file
   (`data-root.ts`) and the composition is visible in `connection.ts` rather
   than hidden inside either. The guard itself needed no change: it already
   checks whatever path `resolveDatabasePath()` returns, so routing the
   pointer's contents through that same function is what keeps a
   pointer-supplied Dropbox path just as refused as a hardcoded one would
   have been.
4. **A pointer that cannot be trusted fails startup loudly. It never falls
   back to the default.** A missing `dataRoot` key, a non-absolute path, an
   empty string, malformed JSON, or a named directory whose parent does not
   exist each throw into the existing `dialog.showErrorBox` + `app.exit(1)`
   path ([index.ts](../../electron/main/index.ts)), naming the pointer file,
   the problem, and that deleting the file restores the default. See
   Consequences for why silent fallback is the one behaviour worse than
   refusing to start.
5. **Writing the pointer is a separate, explicit function
   (`writeDataRootPointer`), exported for T-260828-18 to call and not called
   from anywhere in this task.** It writes through a temp file and renames
   into place, so a crash mid-write leaves either the previous pointer or a
   complete new one — never a truncated file that then refuses every future
   launch.
6. **No environment-variable override.** Unlike the sync-folder guard, the
   data root does not get a documented escape hatch — see Alternatives.

`settings` (ADR-002) is amended by one boundary rule this ADR states rather
than restates: **the database's own location may never be a value read from
inside the database.** Nothing else about ADR-002's exemption class changes.

## Consequences

**Easier.** T-260828-18's first-run chooser and T-260828-19's relocation both
have one function to call (`writeDataRootPointer`) and one function to trust
for reading it back (`resolveDataRoot`), rather than each needing to know the
file's shape or validation rules directly.

**Easier.** The sync-folder guard required no changes at all — it was already
written to check whatever `resolveDatabasePath()` returns, so a
pointer-supplied path inherits the same protection a hardcoded one had, for
free, as long as the composition rule in Decision item 3 holds.

**Harder — a second file to keep consistent.** `data-location.json` and
`solocrm.db` can now disagree (a pointer edited by hand while the app is
closed, a pointer copied from another machine, a stale pointer left after the
folder it names is deleted). Decision item 4 is the mitigation: every
disagreement fails loudly at the next launch rather than silently reopening
whichever root happens to resolve.

**Forecloses relying on the database to know where it lives.** Nothing in
`solocrm.db` — no table, no pragma — may ever be asked "where is your own
file." Any future feature wanting that answer reads `data-location.json`
through `data-root.ts`, not the database.

**Cost — one more thing a user's backup or dotfile sync can silently move.**
`data-location.json` sits in `userData` precisely because `userData` is not
supposed to be synced or backed up as a folder (safeStorage credentials,
ADR-004, already live there on the same assumption). A user who syncs their
entire `userData` folder against this app's own advice can end up with two
machines' pointers pointing at each other's local drives — noted, not solved;
X-04's eventual backup does not cover this file, and nothing about this task
claims to close that gap.

## Alternatives

**Store `dataRoot` as a `settings` row once P2-01 exists.** Lost on the
chicken-and-egg fact in Context: the value has to be known before
`solocrm.db` opens, and a `settings` row cannot be read before the database
holding it is open. No amount of caching or lazy-loading changes that a
*first* read still has nothing to read from.

**An environment variable, `SOLOCRM_DATA_ROOT`, mirroring
`SOLOCRM_ALLOW_SYNC_FOLDER_DB`.** Lost because the two values are different
shapes of decision. The guard's override is a one-time, session-scoped
"I accept this risk" that a user sets when they mean to, and losing it
between launches is harmless — the guard just asks again. A data root has to
persist silently across every future launch with no reminder that it is even
set, wants to be set through T-260828-18's UI rather than a shell variable,
and — critically — has no safe empty state: an unset guard override means
"guard on," the safe default; an unset data-root override would have to mean
"use the default," which is exactly what the no-pointer-file case already
provides without an env var. Adding one would only add a second, less
discoverable way to set the same value T-260828-18 will expose properly, and
T-260828-05's Risks section already refused widening `userDataDir` into a
production escape hatch on the same reasoning.

**A pointer file whose own path is configurable (e.g. found via a registry
key, or searched for across common drive letters).** Lost because it
reintroduces the chicken-and-egg problem one level up — the app would need to
know *where to look for the file that says where to look*. Fixing the
pointer's own location at `app.getPath('userData')/data-location.json` is
what makes it findable with no configuration at all.

**Let a missing or invalid pointer fall back to the default root rather than
refusing to start.** Lost on the Risks note this task was scoped against: a
silent fallback looks exactly like total data loss. The user sees an empty,
freshly-migrated CRM at the default location while their real data sits
untouched at the path the broken pointer named — a far worse outcome than a
startup dialog naming the exact file to fix or delete.
