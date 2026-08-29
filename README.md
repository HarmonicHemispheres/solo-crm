![Solo CRM — a CRM for solo founders](assets/solocrm-banner.svg)

# Solo CRM

A CRM for solo founders. Client, project, contact and revenue tracking for a
one-person consultancy — local-first, no account, no server, no telemetry.

**Status:** the spine is in. Repositories over the real schema, typed IPC,
FTS5 search, the create sheets and every list and detail view; a command
palette, a quick log, a read-only SQL console channel, and a branded Windows
installer. Not yet built: the integrations (P3/P4), revenue lines, and the
timelog import that every hours-used figure depends on.

## Why

Existing CRMs are built around a sales pipeline — a funnel of deals that close.
That is the wrong centre of gravity for a solo services business, where revenue
is a small number of relationships that either stay warm or quietly go cold, and
where the same client can be a billing party, a delivery partner and a referral
source at once.

Solo CRM tracks the state of every relationship against a cadence you set per
company, rolls revenue up by who pays *and* by who the work is for, and links
out to Notion, Drive and Stripe rather than becoming a fourth copy of them.

## Planning

| Document | What it covers |
|---|---|
| [Requirements](planning/solo-crm-requirements.md) | Problem, goals, data model, functional and non-functional requirements |
| [Task plan](planning/solo-crm-taskplan.md) | Phased tasks with dependencies and acceptance criteria |
| [Mockup](planning/solo-crm-mockup.html) | Interactive UI mockup — open it in a browser |
| [Agent instructions](AGENTS.md) | Stack, gotchas and references for coding agents (`.claude/rules/` holds the UI design principles) |

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron (Ubuntu / macOS) |
| Renderer | React + Vite + TypeScript |
| Data | better-sqlite3 in the main process, WAL |
| ORM / migrations | Drizzle |
| Server state | TanStack Query over a typed IPC bridge |
| Search | SQLite FTS5 |

## Cutting a release

The version in `package.json` is hand-bumped, and it is the only place a
release gets its number. Nothing derives it from the commit, the date or the
tag count — so the bump is a deliberate step, and forgetting it fails the build
rather than overwriting the last installer.

1. Run the checks — `npm run typecheck`, `npm run lint`, `npm test`, and
   `npm run check:index` last. The `verify` skill in `.claude/skills/` runs
   exactly these and reports what actually passed. `npm run dist` runs none of
   them, so nothing else stops an unbuildable tree from being packaged, or a
   month `INDEX.md` that disagrees with its task files from shipping.
2. Bump `version` in `package.json` and commit. Semver, three numeric parts —
   NSIS needs a numeric `FileVersion`, so no `-rc.1` or `+sha` suffixes.
3. `npm run dist`.

That writes `release/Solo CRM-Setup-<version>.exe`, which is also the version
Windows shows in **Apps and features**, and which the installer's maintenance
page compares against an existing install to offer *Update* rather than
*Repair*.

**The overwrite guard.** `npm run dist` runs `scripts/release-version.mjs check`
before packaging and `… record` after. `record` stamps
`release/build-manifest.json` with the version, the commit and the timestamp;
`check` refuses to build when the artifact for the current version is already
there and was built from a *different* commit. Rebuilding the same commit is
allowed and overwrites its own output. If the guard stops you, the fix is step 2
— not deleting the file.

**`release/latest.yml` is not an update feed.** electron-builder writes it on
every build and there is no auto-update wired to read it; treat it as build
output, not as a published manifest.

## Brand assets

| File | Use |
|---|---|
| [`assets/solocrm-banner.svg`](assets/solocrm-banner.svg) | Repository header (`.png` alongside it for anywhere SVG is not accepted) |
| [`assets/solocrm-logo.svg`](assets/solocrm-logo.svg) | Horizontal lockup |
| [`assets/solocrm-mark.svg`](assets/solocrm-mark.svg) | Mark alone — also the source for application icons |

The mark is a cadence ring — verdigris, carrying the gap that means a
relationship is going quiet — closed around the MagicPill Labs sparkle. Colour
follows the "Refined Alchemy" system: obsidian ground, verdigris as the working
accent, gold reserved for the one hero value in view.

---

MagicPill Labs · internal tooling
