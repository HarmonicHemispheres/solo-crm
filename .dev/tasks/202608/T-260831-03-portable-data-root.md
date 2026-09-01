---
id: T-260831-03
title: Resolve the data root beside the executable when the build is portable
status: in-progress
category: data
plan_ref: X-09
created: 2026-08-31
closed:
---

## Why

A portable build that stores its data in `%APPDATA%\Solo CRM` is not portable —
it is an installed app with an inconvenient launcher. Today
[`resolveDataRoot()`](../../../electron/main/db/data-root.ts) returns
`app.getPath('userData')` unless a `data-location.json` pointer names something
else, and that is the only behaviour there is. Nothing in the app knows what a
portable build is.

This is the code half of the decision recorded in T-260831-01. **It cannot start
until ADR-013 is accepted**, because the mechanism, the failure behaviour and the
pointer-file semantics are all that ADR's to fix.

## Scope

**In:**

- Teach `resolveDataRoot()` to return the portable root when the build is marked
  portable, by whatever mechanism ADR-013 fixed, and to keep returning
  `app.getPath('userData')` byte-for-byte otherwise. A non-portable build's
  resolution must not change in any observable way.
- Implement ADR-013's rule for a portable build whose root cannot be determined —
  the variable absent, empty, relative, or naming the extraction directory. Per
  ADR-006 item 4 the house style is to fail startup loudly through the existing
  `dialog.showErrorBox` + `app.exit(1)` path in
  [`electron/main/index.ts`](../../../electron/main/index.ts) rather than fall
  back; ADR-013 confirms or overrides that.
- **Refuse a root inside the extraction directory specifically.** Under
  electron-builder's single-file `portable` target, `process.execPath` and
  `app.getPath('exe')` both point into `$PLUGINSDIR\app` or
  `$TEMP\<UNPACK_DIR_NAME>`, which `portable.nsi` deletes with
  `RMDir /r $INSTDIR` after the app exits. A database created there is destroyed
  on close with no error at any point. This check is the difference between a
  loud refusal and silent total data loss, and it is the single most important
  line in this task.
- Apply ADR-013's pointer-file decision, including the cross-contamination case:
  the pointer's fixed home is `app.getPath('userData')`, which a portable build
  shares with any installed copy on the same machine, so a portable run that
  writes a pointer there would move the *installed* app's data root.
- Keep `resolveDatabasePath()` the single guarded seam. All of this composes
  **inside** `resolveDataRoot()`. `connection.test.ts` pins that every
  Database-owning module binds `dbPath` from `resolveDatabasePath` and nothing
  else; a portable path that reaches `new Database(...)` by any other route is a
  bypass of the sync-folder guard, not a shortcut.
- Leave the sync-folder guard applying to the portable root exactly as ADR-013
  says. If the refusal message is to name the portable case, that wording lands
  here.

**Out:** the packaging config that produces a portable artifact
(T-260831-04); the hand-driven QA (T-260831-05); any renderer or settings-UI
change. If ADR-013 decides the data-root UI must be hidden or disabled in
portable mode, that is a `ui` task and gets scoped separately rather than folded
in here.

## Touches

- `electron/main/db/data-root.ts` and `data-root.test.ts`
- `electron/main/db/connection.ts` — only if the composition genuinely needs it
- `electron/main/index.ts` — startup failure message, if ADR-013 requires new wording
- possibly `electron/main/db/move-data-root.ts`, per ADR-013's pointer decision

## Acceptance

- [ ] With no portable marker present, `resolveDataRoot()` returns exactly what
      it returns today, pointer file honoured identically — proven by the
      existing `data-root.test.ts` suite passing unmodified.
- [ ] With the build marked portable and a valid portable directory supplied,
      `resolveDataRoot()` returns that directory and `resolveDatabasePath()`
      returns `<that directory>/solocrm.db`.
- [ ] With the build marked portable and the directory absent/empty/relative,
      startup fails with a message naming the cause. It does **not** silently
      return `app.getPath('userData')`.
- [ ] With the build marked portable and the supplied directory equal to (or
      inside) the extraction directory, resolution is refused with a message
      saying the data would be deleted when the app closes. A test asserts this
      by path shape, without needing a real portable launch.
- [ ] A portable root inside a OneDrive/Dropbox path is still refused by
      `assertPathOutsideSyncFolder`, with `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` still
      the only override.
- [ ] `connection.test.ts`'s "neither module that constructs a Database gets its
      path from anywhere but resolveDatabasePath" test passes unmodified.
- [ ] Tests cover the portable cases without requiring a packaged build — the
      marker and directory are injectable the way `userDataDir` already is, and
      that injection stays test-only, never a production escape hatch (ADR-006's
      `DataRootOptions` note).
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:index` all
      exit 0.

## Risks

- **Silent data loss is the headline risk of this whole batch, and it lives
  here.** Every wrong version of this task still launches, still shows a working
  app, and still loses everything on exit or on the next launch. Nothing about
  it is loud. It sits squarely on the AGENTS.md gotcha class of "silently wrong
  rather than loudly broken".
- **A second route to the database.** The tempting shortcut is to read the
  portable directory at the `openDatabase` call site or in `index.ts`. That
  reintroduces exactly the bypass T-260828-57 closed, and the guard's whole
  design depends on it not existing.
- **Pointer cross-contamination between an installed and a portable copy** on one
  machine, in both directions — the portable run following the installed app's
  pointer, and the portable run overwriting it.
- Comes near three AGENTS.md gotchas: the sync-folder rule, the
  `resolveDatabasePath()` single-seam rule, and the renderer-never-touches-the-
  filesystem rule (nothing here may leak a path resolution into the renderer).
