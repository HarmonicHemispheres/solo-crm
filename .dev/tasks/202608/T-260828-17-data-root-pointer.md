---
id: T-260828-17
title: Resolve the data root from a pointer file so its location can be a choice
status: open
category: data
plan_ref: P0-03
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`resolveDatabasePath()` hardcodes `app.getPath('userData')` and exposes exactly
one override — `userDataDir`, documented "tests only, no environment-variable
fallback" ([connection.ts:34-67](../../../electron/main/db/connection.ts#L34-L67)).
That discipline is right and should survive. But it means the database location
is not a choice anyone can make, and a user with their data on a different drive
has no path forward.

The location cannot live in the `settings` table: it has to be known *before* the
database opens, so a row inside that database can never carry it. That
chicken-and-egg is the whole design constraint, and it is why this is a durable
decision (ADR) rather than an implementation detail.

This task builds the mechanism only. With no pointer file present, behaviour is
byte-for-byte what it is today.

## Scope

**In:**

- `electron/main/db/data-root.ts` — new. Reads
  `app.getPath('userData')/data-location.json`, shape
  `{ "dataRoot": "<absolute path>" }`, validated with `zod` (already a
  dependency). Exports the resolved root and a writer for T-260828-18 to call.
- The **default** when no pointer file exists is `app.getPath('userData')` —
  identical to today.
- `resolveDatabasePath()` resolves under the data root instead of `userData`
  directly. The `userDataDir` test override keeps its exact current semantics and
  its comment; do not widen it into a production escape hatch.
- The data root is defined as **the folder holding `solocrm.db` and its `-wal` /
  `-shm` sidecars**. Nothing broader is invented here — X-04's backup folder is a
  separate setting per §6.11 and is deliberately allowed to be a sync folder.
- A pointer naming a directory that does not exist is **created**, if its parent
  exists. If the parent does not exist, that is an error, not a `mkdir -p`.
- A pointer that is missing, malformed, has a non-absolute path, or fails
  validation **throws** into the existing startup error path
  (`dialog.showErrorBox` + `app.exit(1)`, [index.ts:88-99](../../../electron/main/index.ts#L88-L99)),
  with a message naming the pointer file, the problem, and that deleting the file
  restores the default. It must **not** silently fall back — see Risks.
- Atomic write (temp file + rename), so a crash mid-write cannot leave a
  truncated pointer that then refuses to start.
- **ADR-006** recording the pointer-file decision: why not `settings`, why not an
  env var, what it means for X-04 and P2-01. Linked from the AGENTS.md gotcha list
  alongside the sync-folder warning.

**Out:**

- Any UI or prompt for choosing the folder — T-260828-18.
- Moving an existing database to a new root — T-260828-19.
- Changing the root from Workspace settings — belongs with P2-01/P2-03.
- An env-var override. `SOLOCRM_ALLOW_SYNC_FOLDER_DB` exists because a guard needs
  a documented escape hatch; a *location* does not, and adding one reintroduces
  exactly the unchecked-default risk T-260828-05 refused.
- Relocating `safeStorage` credentials (ADR-004) — they stay in `userData`.

## Touches

- `electron/main/db/data-root.ts` — new
- `electron/main/db/connection.ts` — `resolveDatabasePath` reads the root
- `.dev/decisions/ADR-006-data-root-pointer-file.md` — new
- `AGENTS.md` — gotcha entry, beside the sync-folder one
- `electron/main/db/data-root.test.ts` — new; `connection.test.ts` — extended

## Acceptance

- [ ] With no `data-location.json`, the database resolves to
      `app.getPath('userData')/solocrm.db` and every existing test in
      `connection.test.ts` passes unchanged
- [ ] A pointer at a temp directory creates `solocrm.db` there, and **no**
      `solocrm.db`, `-wal` or `-shm` appears under `userData`
- [ ] Malformed JSON, a missing `dataRoot` key, an empty string, and a relative
      path each fail startup with a message naming `data-location.json` — and no
      database file is created anywhere
- [ ] A pointer into a path with a `Dropbox` / `Google Drive` / `OneDrive` /
      `Mobile Documents` segment is refused by the **existing** sync-folder guard,
      and the refusal names the pointed-at path, not the `userData` one
- [ ] A pointer at `<existing parent>/newfolder` creates `newfolder`; a pointer at
      `<missing parent>/newfolder` fails with a message distinguishing the two
- [ ] Interrupting the atomic write leaves either no pointer file or a complete
      one — never a partial one
- [ ] `ADR-006` exists, is referenced from AGENTS.md, and states the `settings`
      exclusion in the form of a rule about what may hold the path
- [ ] `npm run lint`, `npm run typecheck` and `npm test` green

## Risks

- **A silent fallback would look exactly like total data loss.** If a pointer
  becomes unreadable and the app quietly reopens the default root, the user sees
  an empty CRM and a database that "reset itself" — while their real data sits
  untouched on another drive. Failing loudly is the only safe behaviour, and it is
  why the malformed-pointer case is an acceptance criterion rather than a detail.
- Directly adjacent to the AGENTS.md gotcha: **the database must never live in a
  Drive, Dropbox or iCloud folder.** This task makes the location user-supplied,
  which is precisely the input the guard was written for. The guard already runs
  inside `openDatabase()` between path resolution and `new Database()` — verify it
  still sits on the *new* resolved path, and prove it with a test rather than
  assuming the ordering survived.
- `resolveDatabasePath()` is exported and side-effect-free by design
  (T-260828-05's outcome calls that out as the seam T-260828-06 depends on).
  Reading a file inside it would break that property. Keep the read in
  `data-root.ts` and keep the composition explicit.
- Two pointer files on two machines pointing at one synced folder is the
  corruption scenario dressed differently. The guard catches the named services;
  it cannot catch a network share. Note the limit rather than pretending to solve it.
- ADR-002 exempts `settings` from the UUID rule but says nothing about what may
  live outside the database. ADR-006 should state that boundary, not restate
  ADR-002.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
