# Solo CRM — Task Plan

**Derived from:** `solo-crm-requirements.md` (Draft v1) + `solo-crm-mockup.html`
**Owner:** Robby Boney, MagicPill Labs
**Date:** 28 August 2026

---

## How this file is used

This is the **backlog**, not the scope. It says what to build, in what order, and
what "done" looks like. The scope an agent builds from is a task file under
`.dev/tasks/YYYYMM/`, written by `scope-task` with the codebase in front of it.

| | |
|---|---|
| **The ID** (`P1-03`) | Permanent. Goes in the `plan_ref` field of the `.dev` task that implements it, so the plan and `.dev/` stay joinable. |
| **The category** | The same vocabulary as [.dev/README.md](../.dev/README.md), so it is decided once, here. It routes the review gate: 🗄 `data` → `architecture-review`, 🔌 `ipc` and 🔗 `integration` → `security-review`, 🎨 `ui` → `ui-design.md` loads automatically. |
| **`+gate`** | An escalation past the category default, where the diff will reach further than its directory suggests. |
| **The checkboxes** | The outer box ticks when the `.dev` task closes `● done`. The inner boxes are the acceptance criteria — a starting point for the scope, sharpened by `scope-task` against real code. |

**Do not scope all of this at once.** Pick a batch that can run together, scope
it, run it, come back. A month index holding seventy open tasks tells you
nothing.

Sizes assume one developer: **XS** under 2h · **S** half a day · **M** one day ·
**L** two days · **XL** three or more — split it if it is still XL after you
start.

Categories: 🗄 data · 🔌 ipc · 🎨 ui · 🔗 integration · 📦 build · 📄 docs

**On the "one weekend" target for Phase 1.** As specified in §9 — five
repositories, FTS5, the palette, six views, five create forms, links with cached
favicons — Phase 1 is roughly 12–16 working days, and Phase 0 has to land first.
That is not an argument to cut the phase; it is an argument to be honest about
the calendar. **P1-CUT** below marks the subset that is genuinely usable the
evening it merges, so the tool starts earning its keep while the rest lands.

---

## Section A — Decisions before code

Two kinds of thing block Phase 0: the open questions from §11, and gaps between
the requirements schema and what the mockup actually needs. Each carries a
recommendation. **Nothing here should stop work for more than an hour**, but
G1–G8 change the DDL, so they are settled and recorded before P0-05 writes it.

- [ ] **D-01 · Settle the schema gaps and record them as ADRs** — 📄 docs · S · after —
  Work through G1–G8 below, then write the ones that constrain future changes
  into `.dev/decisions/` as ADRs. G1, G2, G5 and G7 each bind code that has not
  been written yet; an ADR is what stops the question being re-litigated in
  November.
  - [ ] Each of G1–G8 is marked accepted, amended or rejected, with a reason
  - [ ] At least G1, G2, G5 and G7 exist as `ADR-NNN-*.md` files
  - [ ] `planning/solo-crm-requirements.md` §5 is amended to match, so the DDL in
        the requirements and the DDL in P0-05 cannot disagree

- [ ] **D-02 · Decide the Pipeline view** — 📄 docs · XS · after —
  A.2 below. The answer determines whether P1-15 ships a nav item.
  - [ ] Recorded as an ADR, including which option was chosen and why
  - [ ] P1-15's scope updated to match before it is scoped

### A.1 Schema gaps — these change the DDL, so settle them first

| # | Gap | Evidence | Recommendation |
|---|---|---|---|
| **G1** | `companies.last_touch` and `people.last_contact` are written by the Gmail adapter (§7) and read by the mockup's table registry, but neither column exists in the §5 DDL. | Mockup `TABLES.companies` selects `last_touch`; `decay()` and the whole Today view depend on it. | Add `companies.last_touch_at` and `people.last_contact_at`. Denormalised, maintained on `activity` insert. Not derived from `MAX(occurred_at)`: the Gmail adapter pulls a timestamp with no activity row to hang it on, so the column is needed regardless. |
| **G2** | No `settings` table. §6.11 needs identity, per-kind default cadence, integration toggles, backup folder and appearance; §6.13 needs view mode remembered per view. | Mockup keeps all of it in module-level JS that dies on reload. | Add `settings(key text pk, value text /* json */, updated_at)`. One table, typed accessors in the repo layer. Secrets never go here (see G7). |
| **G3** | `engagements.status` includes `lost` in the schema; the mockup's status list and create form omit it. | §5 DDL vs mockup `FORMS.engagement`. | Keep `lost` in the schema, add it to the form. Work that dies needs somewhere to go, or it stays `Proposed` forever and inflates the book. |
| **G4** | `milestones` carries `amount_cents` and `expected_month` — both required to generate fixed-scope revenue lines — but the mockup's create form asks only "Milestones: 4". | Mockup `MODEL_FIELDS.fixed`. | UI gap, not a schema gap. The engagement form needs a real milestone editor before P3 revenue is anything but a guess. Tracked as **P3-09**. |
| **G5** | `revenue_lines` is never exercised by the mockup. Its revenue chart is a hardcoded 15-element array and its metrics are computed live off engagement columns. | Mockup `revMonths`, `mrr()`, `backlog()`, `runRate()`. | **The highest-risk carry-over in the project.** §5 is explicit that revenue is materialised so every question is one `SUM … GROUP BY`. Porting the mockup's per-model branching would quietly undo that decision. Tracked as **P3-05**, and named in `architecture-review` as a standing thing to flag. |
| **G6** | `search_fts` is one line in the schema with no sync mechanism. | §5. | FTS5 external-content table plus `AFTER INSERT/UPDATE/DELETE` triggers on all five source tables. Tracked as **P1-06**. |
| **G7** | Nowhere to put Stripe and Google credentials. | §7 integrations vs §5 schema. | Electron `safeStorage`, encrypted, in `userData` — **not** in the database. Consequence: the nightly JSON backup can never leak a key, which is why this is a schema decision and not an implementation detail. |
| **G8** | `activity` is described as append-only but nothing enforces it. | §6.8. | Enforce at the repository boundary: no update or delete channel is exposed for `activity`. Corrections are new rows. |

### A.2 The Pipeline view — a genuine conflict

The mockup ships a **Pipeline** nav item with a five-column board (Lead →
Qualified → Scoped → Proposed → Committed), per-item probability bars, and its
own seed array. None of `stage`, `probability` or a pipeline table exists in §5,
and §1 opens by rejecting the sales funnel as the wrong centre of gravity for
this business.

1. **Drop it.** Engagements grouped by status (§6.4 cards view) already show the
   whole book, and `status` already spans `proposed | pending | active | held |
   delivered | lost`. Nothing is lost but a nav item. *Recommended.*
2. **Derive it.** Keep the board, render it from `engagements.status` with a
   fixed status→column map, add no columns. Costs a day, adds no schema, but
   preserves a surface the requirements argue against.
3. **Build it as drawn.** Requires `stage` and `probability` columns and a second
   source of truth for "how likely is this". Contradicts §2 and §12's
   scope-creep risk.

Take (1) unless the board earns itself back in the first month of real use.

### A.3 Open questions from §11 — none of these block, none need a task

| Q | Recommendation |
|---|---|
| Naslund Waste — direct client or EZDeploy end client? | **Direct.** It holds its own SOW, its own budget line and its own signature path. One field, changeable in five seconds if wrong. Data entry, not code. |
| Should equity positions live here? | **Yes, as modelled** — engagement with `billing_model = 'equity'`, no revenue lines, excluded from every revenue aggregate. One `WHERE` clause in P3-05, and it is the only place the position is written down. |
| Do products need a fulfilment concept? | **No.** A product sells as a fixed-scope engagement with one milestone. Revisit when a single product has sold three times. |
| Is the timesheet still the system of record for hours? | **Yes — Solo CRM imports.** Hours entered in a tool you open between calls will not get entered; the daily timesheet already has the habit attached. Reversing this later is an import-direction change, not a schema change. Constrains P4-03's design only. |

---

## Phase 0 — Scaffold

Nothing user-visible ships here. The point is that every later task is a feature
task.

- [ ] **P0-01 · Toolchain** — 📦 build · M · after —
  electron-vite + React + TypeScript + electron-builder. Main / preload /
  renderer split matching the §4 process model directory layout exactly.
  - [ ] `npm run dev` gives HMR in the renderer and auto-restart in main
  - [ ] `npm run build` produces a package that launches
  - [ ] `npm run typecheck`, `lint` and `test` all exist and exit zero — `verify`
        reports a missing command rather than silently running a smaller set

- [ ] **P0-02 · Renderer security baseline** — 🔌 ipc · S · after P0-01
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a CSP with
  no remote origins, no `webSecurity` overrides.
  - [ ] A test asserts `window.require`, `window.process` and `window.module` are
        `undefined` in the renderer, and it runs in CI
  - [ ] The CSP names no remote origin
  - [ ] Loading a `file://` path outside the app bundle fails

- [ ] **P0-03 · Database boot** — 🗄 data · M · after P0-01
  better-sqlite3 rebuilt for the Electron ABI. Database at
  `app.getPath('userData')/solocrm.db`, WAL, foreign keys on, busy timeout set.
  - [ ] First launch creates the file; `PRAGMA journal_mode` returns `wal`
  - [ ] `PRAGMA foreign_keys` returns `1` on every connection, not just the first
  - [ ] Killing the app mid-write leaves an openable database

- [ ] **P0-04 · Sync-folder guard** — 🗄 data · XS · after P0-03
  §4 warns the database must never sit in Drive, Dropbox or iCloud. Make that a
  check, not a comment.
  - [ ] A `userData` path under `Google Drive`, `Dropbox`, `iCloud Drive` or
        `OneDrive` produces an explanatory dialog and a clean exit
  - [ ] No database file is created in that case
  - [ ] The check is cased and separator-insensitive across platforms

- [ ] **P0-05 · Drizzle schema + migrations** — 🗄 data · L · after P0-03, D-01 · +architecture-review
  Full §5 schema including the A.1 additions. UUID primary keys, `created_at` /
  `updated_at` on every table.
  - [ ] A fresh database and one three migrations behind arrive at an identical
        schema — compared by dumping `sqlite_master`, not by eye
  - [ ] Every table has a UUID primary key, `created_at` and `updated_at`
  - [ ] The schema version is readable over IPC and shows in the Data view
  - [ ] Migrations apply to a seeded copy, not only to an empty file

- [ ] **P0-06 · Date and money conventions** — 📄 docs · XS · after P0-05
  Dates as ISO `TEXT` (`YYYY-MM-DD`), timestamps as ISO-8601 UTC `TEXT`, money as
  integer cents, `period_month` as the first of the month. No `Date` objects
  cross the IPC boundary.
  - [ ] Written down in `CONVENTIONS.md`
  - [ ] Enforced by the zod schemas in P0-07 — a `Date` in a payload fails
        validation rather than serialising to a string nobody chose

- [ ] **P0-07 · Typed IPC bridge** — 🔌 ipc · L · after P0-02, P0-05
  Channel registry with zod-validated payloads both ways, a single error
  envelope, `window.crm.*` generated from one shared type.
  - [ ] Adding a channel requires editing exactly one registry file
  - [ ] A payload failing validation returns a typed error, and nothing throws
        across the bridge
  - [ ] No `fs`, `path` or database symbol is reachable from renderer code —
        asserted by a lint rule, not by inspection

- [ ] **P0-08 · TanStack Query over IPC** — 🎨 ui · S · after P0-07
  Treat IPC as the fetch layer. Query-key convention, invalidation helpers per
  entity, an optimistic-update helper for inline interactions.
  - [ ] Completing a todo updates the list, the rail count and the Today metrics
        from one mutation with no manual refetch
  - [ ] A failed mutation rolls the optimistic update back and surfaces the error

- [ ] **P0-09 · Design tokens and primitives** — 🎨 ui · L · after P0-01
  Lift the mockup's CSS variables into `tokens.css` verbatim. Build the
  primitives it uses everywhere: `Card`, `Row`, `Stat`, `Tag`, `ModelTag`,
  `Ring`, `DecayMeter`, `Toggle`, `Chip`, `Sheet`, `Toast`, `QuickAdd`,
  `ViewHeader`.
  - [ ] Every token in the mockup's `:root` exists in `tokens.css` with the same
        value
  - [ ] No component file contains a hex colour — enforced by lint
  - [ ] Changing one token moves every surface that uses it
  - **Why it is L and not S:** the mockup is one 149 KB file. Ported as-is it
    becomes an unmaintainable renderer. This task decides whether Phases 2–5 are
    pleasant or grim.

- [ ] **P0-10 · App shell** — 🎨 ui · M · after P0-09
  Rail with the three nav groups, counts and database chip; topbar with
  breadcrumb, search button and New menu; router; the 900px collapse.
  - [ ] Every route in the mockup resolves and highlights its nav item
  - [ ] `Esc` closes any open layer — palette, sheet, menu, popover
  - [ ] Below 900px the rail collapses and the topbar keeps its actions

- [ ] **P0-11 · Dev seed** — 🗄 data · S · after P0-05
  Port the mockup's seed data — ten companies, seven people, eleven engagements,
  eleven todos, ten activity rows, nine catalogue items with versions.
  - [ ] `npm run seed` populates a database from a fixture file
  - [ ] Row counts match the mockup's arrays exactly
  - [ ] Re-running it is idempotent or refuses on a non-empty database — it never
        half-seeds

---

## Phase 1 — Spine

§9: *"the majority of the value and usable immediately."*

**P1-CUT — the subset that makes it start.** After Phase 0, ship P1-01, P1-03,
P1-04, P1-05, P1-07, P1-09, P1-10, P1-12 and **X-09**. That is: companies,
engagements, tasks, activity, the channels to reach them, quick-log, the palette,
company detail, and an *installed* app. Real data goes in and Notion stops being
the relationship system of record. Everything else in Phase 1 is real value but
is not what makes it start.

### Repositories

- [ ] **P1-01 · Companies repository** — 🗄 data · M · after P0-05
  CRUD, `kind`, `bills_directly`, `billed_via_company_id`,
  `introduced_by_company_id`, `cadence_days`, `budget_note`, `since`.
  - [ ] Every column round-trips through create and update
  - [ ] `billed_via_company_id` cannot point at itself, enforced in the database
  - [ ] Deleting a company that is a billing party for another is refused with a
        reason, not a foreign-key error string

- [ ] **P1-02 · People + affiliations repository** — 🗄 data · M · after P0-05
  People independent of companies. Affiliations carry `title`, `is_primary`,
  `started`, `ended`.
  - [ ] Moving a person to a new company closes the old affiliation with an
        `ended` date and opens a new one, in one transaction
  - [ ] Querying a person returns both affiliations, the closed one marked
  - [ ] `people` has no `company_id` column — §5: *"a `company_id` on `people`
        would erase a contact's history the day they move"*

- [ ] **P1-03 · Engagements repository** — 🗄 data · L · after P1-01
  `billing_company_id` and `client_company_id` as independent columns.
  Model-specific fields per §5. `agreed_rate_cents` written once at creation.
  - [ ] An engagement with billing ≠ client persists both and reads back from
        either side
  - [ ] `ends_on = NULL` survives a round trip — no sentinel date is substituted
  - [ ] `status` accepts `lost` (G3)
  - [ ] Model-inappropriate fields are rejected: a retainer cannot carry
        `contract_value_cents`

- [ ] **P1-04 · Tasks repository** — 🗄 data · M · after P1-01
  `todo | waiting | done`, `is_next_step`, `due_on`, `waiting_since`, `done_at`,
  optional company / engagement / person links.
  - [ ] Setting `is_next_step` clears it from every other open task for the same
        company, in one transaction
  - [ ] Moving a task to `waiting` sets `waiting_since`; moving it back clears it
  - [ ] Open-task counts exclude `waiting` and `done`

- [ ] **P1-05 · Activity repository + last-touch maintenance** — 🗄 data · S · after P1-01, P1-02
  Append-only (G8). Insert updates `companies.last_touch_at` and
  `people.last_contact_at` in the same transaction (G1).
  - [ ] The repository exposes no update or delete function for `activity`
  - [ ] Inserting activity moves the company's `last_touch_at` atomically —
        killing the process mid-insert leaves neither written
  - [ ] An activity row with no company still writes the person's
        `last_contact_at`

- [ ] **P1-06 · FTS5 index + triggers** — 🗄 data · M · after P1-01…P1-05 · +architecture-review
  External-content FTS5 over `companies.name`, `people.name`, `engagements.name`,
  `tasks.title`, `activity.body`, with triggers on each source table (G6).
  - [ ] Renaming a company changes its search result with no rebuild step
  - [ ] `INSERT … DELETE … INSERT` leaves no orphan rows — verified by comparing
        the FTS row count to the source count
  - [ ] A rebuild command exists and produces an index identical to the
        incremental one

### The boundary

- [ ] **P1-07 · Entity IPC channels** — 🔌 ipc · M · after P1-01…P1-06
  One task, not five: the channel registry is a single file, and five subagents
  editing it concurrently would conflict whatever their scopes claim. Exposes
  companies, people, engagements, tasks, activity and search.
  - [ ] Every repository function reachable from the renderer has a zod schema on
        both sides
  - [ ] No `activity` update or delete channel exists (G8)
  - [ ] The renderer's generated `window.crm` types compile against the main
        process's handlers — a drift between them fails `tsc`

### Capture

- [ ] **P1-08 · Create sheets** — 🎨 ui · L · after P1-07, P0-10
  Company, person, engagement, todo. Chip groups for enumerations. The engagement
  form asks **"Billed to"** and **"Work is for"** as separate questions and swaps
  in model-specific fields (§6.4).
  - [ ] Each form writes exactly the columns its footer claims
  - [ ] Changing billing model swaps the fields without losing what was typed
  - [ ] "Work is for" defaults to the billing company and stops tracking it once
        edited
  - [ ] Every form is completable by keyboard alone

- [ ] **P1-09 · Quick log (⌘L)** — 🎨 ui · M · after P1-07
  From anywhere. Who / kind / one line. Writes activity and resets the cadence
  clock.
  - [ ] Open-to-saved is under five seconds by keyboard alone (§2, goal 4) —
        measured, not estimated
  - [ ] Saving moves the company out of "going quiet" without a manual refresh
  - [ ] An empty note is refused rather than saved blank

- [ ] **P1-10 · Command palette (⌘K)** — 🎨 ui · L · after P1-07
  Searches companies, people, engagements, catalogue, todos and activity notes;
  leads with create commands; arrows and enter; a kind label and hint per row.
  - [ ] Results update within one frame of a keystroke at 10× data volume (§8)
  - [ ] Every create command in the New menu is reachable from the palette
  - [ ] Enter on each result type lands on the right view

### Records

- [ ] **P1-11 · Companies view** — 🎨 ui · M · after P1-07, P0-09
  Card and list presentation (§6.13), toggled in the view header. Cards carry
  identity colour, cadence ring, kind, active engagement count, end-client count.
  - [ ] Both presentations render the same record set — same count, same order
  - [ ] The list's columns sort, and sorting survives the card/list switch
  - [ ] End clients do not appear as top-level rows

- [ ] **P1-12 · Company detail — engagements, end clients, details** — 🎨 ui · L · after P1-07
  Engagements billed to this company; engagements delivered here but billed
  elsewhere; end clients where this company is the billing party; the details
  card.
  - [ ] EZDeploy shows the Samay build under *billed here* marked "for W+K", with
        W+K and Programetrix as end clients
  - [ ] W+K shows the same engagement as *delivered here, billed to EZDeploy*
  - [ ] A company where billing and client are the same renders no "via" marker

- [ ] **P1-13 · Company detail — todos, activity, contacts** — 🎨 ui · M · after P1-12
  Todos with the next step called out, the activity timeline, and contacts.
  - [ ] The next step is visually distinct from ordinary todos
  - [ ] Inline completion and quick-add both work without leaving the page
  - [ ] Contacts list current affiliations only, with historical ones behind a
        disclosure

- [ ] **P1-14 · People view + person detail** — 🎨 ui · M · after P1-07
  Card and list grid; detail showing role, email, current company and shared
  history across affiliations.
  - [ ] A person with two affiliations shows both, the closed one visibly historical
  - [ ] Activity involving that person appears regardless of which company it hung on

- [ ] **P1-15 · Engagements cards view** — 🎨 ui · M · after P1-07, D-02
  Grouped by status, each card showing billing model, date range and
  model-appropriate progress. D-02 decides whether a Pipeline nav item ships.
  - [ ] Retainers show hours against allowance, fixed scopes show milestones, T&M
        shows hours against estimate
  - [ ] No card renders a progress shape that does not apply to its model
  - [ ] Hours-derived figures are visibly marked provisional until P4-05

- [ ] **P1-16 · Todos view** — 🎨 ui · M · after P1-07
  Grouped by date (Overdue / Today / This week / Later / No date / Waiting) or by
  client. Inline completion, inline quick-add on every group.
  - [ ] Waiting items are excluded from the owed count but age visibly (§5)
  - [ ] Both groupings show the same open tasks, partitioned differently
  - [ ] Quick-add in a dated group creates a task already in that bucket

- [ ] **P1-17 · Activity view** — 🎨 ui · S · after P1-07
  Append-only log across companies, people and engagements.
  - [ ] One row appears in the global log and on its company, person and
        engagement
  - [ ] The view offers no edit or delete affordance

### Links

- [ ] **P1-18 · Links repository + kind detection** — 🗄 data · S · after P1-01
  Paste a URL on any entity; the host determines kind; title is editable.
  - [ ] Each host in the mockup's `linkKind` map resolves to its kind
  - [ ] An unrecognised host stores `web` rather than failing
  - [ ] Links attach to companies, people and engagements through one table

- [ ] **P1-19 · Favicon fetch + cache** — 🔗 integration · M · after P1-18 · +security-review
  Fetched **once by the main process** and cached in the `favicons` table (§6.10).
  - [ ] No third-party favicon service is contacted from any code path —
        asserted by a test, not by reading the diff
  - [ ] A host is fetched once; the second link to it reads the cache
  - [ ] With the network off, links still render using the per-kind fallback set
  - [ ] The renderer never issues the fetch

- [ ] **P1-20 · Links UI** — 🎨 ui · S · after P1-18, P1-19
  The link rows on company detail, with paste-to-add and inline title editing.
  - [ ] Pasting a URL adds a row with the right icon without a dialog
  - [ ] A cached favicon renders; a missing one falls back without layout shift

---

## Phase 2 — Cadence and structure

Phase 1 makes it a good record. Phase 2 makes it tell you something.

- [ ] **P2-01 · Settings repository** — 🗄 data · S · after P0-05
  The `settings` table from G2, typed accessors, defaults on first boot.
  - [ ] A key written, the app restarted, the key read back unchanged
  - [ ] Reading an unset key returns its declared default, not `undefined`
  - [ ] No credential is storable here — the type forbids it (G7)

- [ ] **P2-02 · Default cadence per kind** — 🎨 ui · S · after P2-01
  Defaults per company kind; new companies inherit; any company overrides its own.
  - [ ] Changing the Client default moves companies still on the inherited value
        and leaves overridden ones alone
  - [ ] A company's own override survives a change to its kind's default
  - [ ] The settings surface states which companies a change will move, before it
        is made

- [ ] **P2-03 · Decay computation + meters** — 🎨 ui · S · after P1-11, P2-02
  `days_since_last_touch / cadence_days`, not a global threshold. Ring and meter
  components; ok / warn / late bands.
  - [ ] A retainer client at eight days reads late and a channel at eight days
        reads fine, from the same function (§5)
  - [ ] The bands come from tokens, and `prefers-reduced-motion` keeps the width
        while dropping the animation
  - [ ] A company never touched shows a determinate state, not `NaN`

- [ ] **P2-04 · Today view** — 🎨 ui · L · after P2-03, P1-16
  Hero metrics; **Going quiet** sorted by how far past each company's own
  cadence, each row showing the owed next step; Next up with inline completion
  and quick-add; the twelve-month revenue chart; the linked-systems strip.
  - [ ] Going quiet sorts by ratio, not by raw days
  - [ ] Every row links to the action, not to a number
  - [ ] The view renders under 100ms at 10× data volume (§8)
  - [ ] With nothing overdue it says so rather than rendering an empty card

- [ ] **P2-05 · Next step surfacing** — 🎨 ui · S · after P2-04
  One `is_next_step` per relationship, on Today and company detail.
  - [ ] Going quiet rows show the owed step where one exists
  - [ ] A company with none prompts to name one, inline
  - [ ] Marking a new next step visibly clears the old one

- [ ] **P2-06 · End clients** — 🎨 ui · M · after P1-12
  `bills_directly = false`. Own contacts, budget, cadence clock and activity log.
  - [ ] W+K has its own cadence clock and its own next step
  - [ ] W+K never appears as a payer anywhere, while the Samay money lands on
        EZDeploy
  - [ ] An end client is reachable from its billing party and from search, but
        not from the top-level companies grid

- [ ] **P2-07 · Waiting ageing** — 🎨 ui · XS · after P1-16
  `waiting_since` drives visible age; waiting items stay out of the owed count.
  - [ ] A 40-day waiting item is visually louder than a 2-day one
  - [ ] Neither inflates "open todos"

- [ ] **P2-08 · View-mode persistence** — 🎨 ui · XS · after P2-01, P1-11, P1-14
  Card / list choice remembered per view (§6.13).
  - [ ] Companies as list and People as cards both survive a restart,
        independently of each other

---

## Phase 3 — Money

- [ ] **P3-01 · Catalogue repositories** — 🗄 data · M · after P0-05
  `service_categories`, `services`, `service_versions`.
  - [ ] A service always has at least one version — creating one without a rate
        is refused
  - [ ] Version effective ranges cannot overlap for the same service
  - [ ] Archiving sets a flag; nothing is deleted

- [ ] **P3-02 · Price versioning** — 🗄 data · M · after P3-01 · +architecture-review
  Closing the current version and appending the next, with an effective date.
  - [ ] Appending a version sets the previous one's `effective_to` to the day
        before, with no gap and no overlap
  - [ ] The count of engagements unaffected by the change is queryable, so
        P3-08 can state it
  - [ ] Deleting a version is impossible while an engagement references it

- [ ] **P3-03 · Rate snapshot on engagement create** — 🗄 data · S · after P3-01, P1-03
  The price list is read exactly once, when a proposal is created.
  - [ ] Deleting the `service_version` an engagement was sold from changes
        nothing about that engagement's numbers
  - [ ] Changing a price from $3,500 to $4,500 leaves every existing
        `agreed_rate_cents` untouched — verified by reading rows back, not by
        reasoning
  - [ ] No query joins an engagement to a live price to display its rate

- [ ] **P3-04 · Milestones repository** — 🗄 data · S · after P1-03
  Name, sort, `amount_cents`, `expected_month`, `completed_at` (G4).
  - [ ] Milestone amounts are queryable as a sum per engagement
  - [ ] Completing a milestone sets `completed_at`; uncompleting clears it
  - [ ] Reordering is stable and does not renumber unrelated rows

- [ ] **P3-05 · Revenue line generator** — 🗄 data · XL · after P3-04, P1-03 · +architecture-review
  **The task that decides whether §5's central decision survives contact** (G5).
  Materialise, do not compute: retainers generate one row per month; fixed scopes
  one row per milestone at its expected month; T&M estimates that actuals
  overwrite; equity nothing.
  - [ ] Every revenue figure in the app comes from one
        `SUM … GROUP BY period_month, status` — grepping the revenue module for
        `billing_model` finds only the generator
  - [ ] Regenerating after an engagement edit never touches a row already
        `invoiced` or `paid`
  - [ ] An equity engagement generates zero rows
  - [ ] A rolling retainer generates rows to a stated horizon and no further
  - [ ] Regeneration is idempotent — running it twice changes no row

- [ ] **P3-06 · Revenue rollup queries** — 🗄 data · M · after P3-05
  Billing party, end client and model attributions; recurring monthly, fixed
  backlog, T&M run rate, concentration.
  - [ ] The three rollups agree to the cent
  - [ ] End clients contribute under *end client* and never as a payer under
        *billing party* (§6.2)
  - [ ] Concentration is the largest payer's share of YTD, and is stable across
        rollup switches

- [ ] **P3-07 · Catalogue view** — 🎨 ui · L · after P3-01
  A management surface, not an analytics surface (§6.5). Create, edit, duplicate,
  archive; categories; filter; quick-add parsing.
  - [ ] `Name, 4500`, `Name, 4500/mo` and `Name, 175/hr` each parse to the right
        unit and model
  - [ ] Archive never deletes, and archived items stay attached to what was sold
        at their rate
  - [ ] Deleting a category holding items is refused with a reason

- [ ] **P3-08 · Change-price sheet** — 🎨 ui · S · after P3-02, P3-07
  A distinct action, not an edit field.
  - [ ] The sheet states how many signed engagements are unaffected, from P3-02's
        query
  - [ ] Price is not editable anywhere else in the catalogue UI

- [ ] **P3-09 · Milestone editor** — 🎨 ui · M · after P3-04, P1-08
  The engagement create and edit forms get real milestone rows (G4).
  - [ ] A four-milestone fixed scope produces four dated, priced rows
  - [ ] The form says so when the amounts do not sum to the contract value, and
        does not silently accept it
  - [ ] Editing milestones on a signed engagement warns before regenerating
        revenue lines

- [ ] **P3-10 · Revenue view** — 🎨 ui · L · after P3-06
  The rollup toggle and the four metrics.
  - [ ] Switching rollup changes attribution and not the total
  - [ ] Every figure is traceable to `revenue_lines` — no number is computed in
        the component

- [ ] **P3-11 · Stacked monthly chart** — 🎨 ui · M · after P3-05
  Twelve months, stacked by model, projected months visually distinct from
  actuals. Replaces the mockup's hardcoded array on Revenue and Today.
  - [ ] The chart reads `revenue_lines`; the mockup's `revMonths` array appears
        nowhere in the codebase
  - [ ] A newly signed engagement changes it with no code change
  - [ ] Projected and actual are distinguishable without colour alone

- [ ] **P3-12 · Engagement timeline** — 🎨 ui · L · after P1-15, P3-04
  Gantt grouped by billing party. Model colours, milestone ticks, rolling
  retainers fading at the right edge, dashed unsigned bars, today marker.
  - [ ] `ends_on = NULL` renders as a fade, not a bar ending at an invented date
  - [ ] Milestone ticks sit at their `expected_month`, filled when completed
  - [ ] Unsigned work is distinguishable from signed without relying on colour

---

## Phase 4 — Integrations

All adapters **pull-only and one-way** (§7). That constraint is the feature.

- [ ] **P4-01 · Sync framework + credential storage** — 🔗 integration · M · after P0-07 · +security-review
  Adapter interface, `external_refs` mapping, `last_synced_at`, per-source
  status. Credentials in `safeStorage` (G7).
  - [ ] The adapter interface exposes no write method — the type system makes
        writing back impossible, not the code review
  - [ ] No credential reaches the database, asserted by a test that greps a
        backup export
  - [ ] A failing adapter does not block the others or the app's boot

- [ ] **P4-02 · Stripe adapter** — 🔗 integration · L · after P4-01, P3-05
  Invoices, payment status and customer ids → `revenue_lines.status`, `paid_at`,
  `stripe_invoice_id`.
  - [ ] Marking an invoice paid in Stripe moves the matching revenue line to
        `paid` on the next pull
  - [ ] An unmatched invoice surfaces for manual mapping rather than being
        dropped silently
  - [ ] Pulling twice produces no duplicate rows

- [ ] **P4-03 · Timelog CSV import** — 🔗 integration · L · after P4-01
  Client-attributed hours → `time_entries`. Column mapping, idempotent re-import.
  - [ ] Importing the same file twice produces the same row count
  - [ ] A row whose client cannot be matched is reported, not discarded
  - [ ] A malformed file fails before writing anything

- [ ] **P4-04 · time_entries aggregates** — 🗄 data · M · after P4-03
  Hours per engagement per month, hours against retainer allowance, hours against
  T&M estimate, effective hourly rate.
  - [ ] Aggregates over 20k time entries return under the §8 budget
  - [ ] An engagement with no entries returns zero, not null

- [ ] **P4-05 · Hours-derived UI goes live** — 🎨 ui · M · after P4-04
  Switch every hours figure from placeholder to `time_entries`.
  - [ ] No view reads an `hours_used` value a human typed
  - [ ] The provisional marking added in P1-15 is removed in the same change
  - **Until this lands, every hours figure in the app is decoration.** §7: *"every
    hours figure in the app is derived from `time_entries`."*

- [ ] **P4-06 · Google Calendar adapter** — 🔗 integration · L · after P4-01
  Events matching a known company domain or attendee → `activity`
  (`source = 'gcal'`).
  - [ ] A meeting logged manually and pulled from Calendar produces one activity
        row, not two
  - [ ] An event matching no company is skipped rather than filed against a guess
  - [ ] Pulled activity updates `last_touch_at` the same way manual activity does

- [ ] **P4-07 · Gmail adapter** — 🔗 integration · M · after P4-01 · +security-review
  Last-contacted timestamp only.
  - [ ] A test asserts no message body, subject or recipient list reaches the
        database
  - [ ] The requested OAuth scope is the narrowest one that returns a timestamp,
        and the scope string is in the diff for review

- [ ] **P4-08 · Integration settings surface** — 🎨 ui · S · after P4-01, P2-01
  Per-source toggles and status; the UI states that Solo CRM never writes back.
  - [ ] Disabling a source stops its pulls without losing what it already wrote
  - [ ] Each source shows its own last-sync time, not a global one

---

## Phase 5 — Judgement metrics

The phase where the tool starts having opinions. Everything here depends on
P4-03 being real.

- [ ] **P5-01 · Effective hourly rate** — 🎨 ui · M · after P4-05
  Across every model, on the engagement card and detail.
  - [ ] A fixed build at $18,000 / 86 hours and a retainer at $6,500/mo / 20
        hours are directly comparable on one screen (§10.2)
  - [ ] An engagement with no hours shows "no hours yet", not a division result

- [ ] **P5-02 · Completed but uninvoiced** — 🎨 ui · M · after P3-05, P4-02
  §10.3 — the most common way money goes missing in a solo shop.
  - [ ] Completing a milestone with no invoiced revenue line raises it on Today
        within one refresh
  - [ ] It clears when the matching invoice arrives from Stripe

- [ ] **P5-03 · Retainer renewals** — 🎨 ui · S · after P1-03
  `renews_on` exists in the schema with no UI.
  - [ ] A retainer renewing within 30 days appears on Today with its current rate
        and the date it was last changed
  - [ ] Renewing it advances `renews_on` rather than creating a second engagement

- [ ] **P5-04 · Capacity** — 🎨 ui · M · after P4-04, P3-05
  One operator. 180 committed hours in a 160-hour month is a warning.
  - [ ] The warning appears before the month starts, not during it
  - [ ] Capacity per month is a setting, not a constant

- [ ] **P5-05 · Concentration alert** — 🎨 ui · XS · after P3-06, P3-10
  - [ ] The largest payer's share of YTD is visible on Revenue
  - [ ] Crossing the threshold is visible without going looking for it

---

## Cross-cutting

- [ ] **X-01 · Workspace → Data** — 🎨 ui · M · after P0-05 · *phase 1 tail*
  Database size, page size, WAL size, copyable path, journal mode, schema version
  and last migration date, last backup, last integrity check. Per-table row
  counts with size bars.
  - [ ] Every figure is read live from the file, not cached at boot
  - [ ] Clicking a table loads `SELECT * FROM <table> LIMIT 20` into the console
  - [ ] The path copies to the clipboard

- [ ] **X-02 · Read-only query channel** — 🔌 ipc · M · after P0-07 · +security-review · *phase 1 tail*
  A **second better-sqlite3 connection opened readonly** against the same file,
  *and* a rejection of any statement where `stmt.readonly` is false — belt and
  braces, because `PRAGMA` and `ATTACH` slip past a naive `^SELECT` regex.
  - [ ] `DELETE FROM companies`, `PRAGMA writable_schema = 1` and
        `ATTACH DATABASE …` are each refused with a message naming why
  - [ ] A legitimate four-table join returns rows
  - [ ] The rejection is explicit — nothing is silently ignored (§6.12)
  - [ ] The write connection is unreachable from this channel

- [ ] **X-03 · Query console UI** — 🎨 ui · S · after X-02, X-01
  Results as a table with row count and execution time; saved snippets.
  - [ ] A rejected statement shows its reason, not a generic failure
  - [ ] Execution time and row count are shown for every successful run
  - **Why it is worth building early:** §6.12 — the schema encodes decisions the
    UI deliberately does not expose. The console is what keeps pressure off the
    UI to grow an analytics surface for every one-off question.

- [ ] **X-04 · Nightly JSON backup** — 🗄 data · M · after P2-01 · *phase 2*
  Whole database to timestamped JSON in a chosen folder, last 30 kept. JSON
  rather than a `.db` copy so a corrupted database is still recoverable and the
  format is diffable (§8).
  - [ ] A backup restores into an empty database with identical row counts per
        table
  - [ ] No credential appears anywhere in the file (G7)
  - [ ] The 31st backup removes the oldest, and only the oldest

- [ ] **X-05 · Maintenance actions** — 🗄 data · XS · after X-01 · *phase 2*
  Export snapshot, `VACUUM` + `ANALYZE`, `integrity_check`.
  - [ ] Each reports its result and elapsed time rather than a silent toast
  - [ ] A failing integrity check is stated plainly, not swallowed

- [ ] **X-06 · Accessibility pass** — 🎨 ui · M · after P0-09 · *continuous, audited once per phase*
  - [ ] Every view is reachable and operable without a mouse
  - [ ] Focus is visible on every interactive element against the obsidian ground
  - [ ] `prefers-reduced-motion` removes animation without removing meaning — the
        decay bars still show their width
  - [ ] Dialogs, switches and the palette carry correct roles and labels

- [ ] **X-07 · Performance harness** — 📦 build · M · after P0-11 · *after phase 3*
  10× volume — roughly 100 companies, 500 engagements, 20k time entries.
  - [ ] Per-view render time is recorded in CI
  - [ ] A regression past the §8 budget fails the build
  - [ ] Palette results are measured against a one-frame budget, not eyeballed
  - **An unmeasured non-functional requirement is a wish.**

- [ ] **X-08 · Error handling** — 🔌 ipc · S · after P0-07 · *phase 1*
  IPC error envelope surfaced with a reason; migration failure leaves the
  previous database intact.
  - [ ] A deliberately broken migration produces a readable dialog and a database
        still openable by the previous build
  - [ ] No error path shows a raw stack trace to the user or swallows one silently

- [ ] **X-09 · Packaging** — 📦 build · M · after P0-01 · *phase 1 tail*
  Ubuntu (deb / AppImage) and macOS (dmg). Icons from `assets/solocrm-mark.svg`.
  - [ ] It is installed and in the dock on both machines
  - [ ] The packaged app finds its database in `userData`, not next to the binary
  - **Do this at the end of Phase 1, not at the end of the project.** §12's
    abandonment risk is not theoretical, and a tool that has to be run from a
    terminal does not get opened between calls.

---

## Traceability

| Requirement | Tasks |
|---|---|
| §4 Architecture / process model | P0-01, P0-02, P0-03, P0-04, P0-07 |
| §5 Data model + modelling decisions | D-01, P0-05, P1-02, P1-03, P3-03, P3-05, P3-12 |
| §6.1 Today | P2-04, P2-05, P3-11, P5-02 |
| §6.2 Companies | P1-01, P1-11, P1-12, P1-13, P2-06 |
| §6.3 People | P1-02, P1-14 |
| §6.4 Engagements | P1-03, P1-08, P1-15, P3-12 |
| §6.5 Catalogue | P3-01, P3-02, P3-07, P3-08 |
| §6.6 Todos | P1-04, P1-16, P2-05, P2-07 |
| §6.7 Revenue | P3-05, P3-06, P3-10, P3-11, P5-05 |
| §6.8 Activity | P1-05, P1-17 |
| §6.9 Search and capture | P1-06, P1-09, P1-10 |
| §6.10 Links | P1-18, P1-19, P1-20 |
| §6.11 Settings | P2-01, P2-03, P4-08, X-04, X-06 |
| §6.12 Data + console | X-01, X-02, X-03, X-05 |
| §6.13 View modes | P1-11, P1-14, P2-08 |
| §7 Integrations | P4-01 … P4-08 |
| §8 Non-functional | P0-04, X-04, X-06, X-07 |
| §10 Known gaps | P4-03, P5-01, P5-02, P5-03, P5-04 |
| §11 Open questions | D-01, D-02, A.3 (no task) |

## Explicitly not built

Straight from §2, restated here so the plan can be checked against it: no
multi-user, teams, permissions or shared workspaces. No replacement for Stripe
invoicing, Drive storage or Notion knowledge. No marketing automation, email
sequences, lead scoring or web forms. No productization work. The Turso / libSQL
sync path is designed *for* by the UUID and `updated_at` conventions in P0-05 and
built by nobody in v1.

## Rough shape of the calendar

| Phase | Tasks | Size |
|---|---|---|
| Decisions | 2 | ~1 day |
| Phase 0 | 11 | ~8 days |
| Phase 1 | 20 | ~15 days *(P1-CUT ≈ 3–4 days once Phase 0 is in)* |
| Phase 2 | 8 | ~5 days |
| Phase 3 | 12 | ~13 days |
| Phase 4 | 8 | ~11 days |
| Phase 5 | 5 | ~5 days |
| Cross-cutting | 9 | ~8 days |
| **Total** | **75** | **~66 days** |

The number that matters is not the total — it is the three or four days to
P1-CUT after Phase 0, because a tool being used is the only version of this that
survives §12.
