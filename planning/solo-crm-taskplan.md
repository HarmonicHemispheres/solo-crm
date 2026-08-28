# Solo CRM — Task Plan

**Derived from:** `solo-crm-requirements.md` (Draft v1) + `solo-crm-mockup.html`
**Owner:** Robby Boney, MagicPill Labs
**Date:** 27 August 2026

---

## How to read this

Every task has an ID, a size, its dependencies, and a **done-when** line that is a test rather than a feeling. Sizes assume one developer:

| | |
|---|---|
| **XS** | under 2 hours |
| **S** | half a day |
| **M** | one day |
| **L** | two days |
| **XL** | three days or more — split it if it stays XL after you start |

Phases match §9 of the requirements, with a **Phase 0** added in front. The requirements assume the shell exists; it does not, and the spine cannot be built on nothing.

**On the "one weekend" target for Phase 1.** As specified — five repositories, FTS5, the palette, six views, five create forms, links with cached favicons — Phase 1 is roughly 12–16 working days, not a weekend. That is not an argument to cut the phase; it is an argument to be honest about the calendar. **P1-CUT** below marks the subset that is genuinely usable by Sunday night, so the tool starts earning its keep while the rest lands.

---

## Section A — Decisions before code

Two kinds of thing block Phase 0: the open questions from §11, and gaps between the requirements schema and what the mockup actually needs. Each carries a recommendation. **Nothing here should stop work for more than an hour.**

### A.1 Schema gaps — these change the DDL, so settle them first

| # | Gap | Evidence | Recommendation |
|---|---|---|---|
| **G1** | `companies.last_touch` and `people.last_contact` are written by the Gmail adapter (§7) and read by the mockup's table registry, but neither column exists in the §5 DDL. | Mockup `TABLES.companies` selects `last_touch`; `decay()` and the whole Today view depend on it. | Add `companies.last_touch_at` and `people.last_contact_at`. Denormalised, maintained on `activity` insert. Not derived from `MAX(occurred_at)`: the Gmail adapter pulls a timestamp with no activity row to hang it on, so the column is needed regardless. |
| **G2** | No `settings` table. §6.11 needs identity, per-kind default cadence, integration toggles, backup folder and appearance; §6.13 needs view mode remembered per view. | Mockup keeps all of it in module-level JS that dies on reload. | Add `settings(key text pk, value text /* json */, updated_at)`. One table, typed accessors in the repo layer. Secrets never go here (see G7). |
| **G3** | `engagements.status` includes `lost` in the schema; the mockup's status list and create form omit it. | §5 DDL vs mockup `FORMS.engagement`. | Keep `lost` in the schema, add it to the form. Work that dies needs somewhere to go, or it stays `Proposed` forever and inflates the book. |
| **G4** | `milestones` carries `amount_cents` and `expected_month` — both required to generate fixed-scope revenue lines — but the mockup's create form asks only "Milestones: 4". | Mockup `MODEL_FIELDS.fixed`. | UI gap, not a schema gap. The engagement form needs a real milestone editor (name, amount, expected month) before P3 revenue is anything but a guess. Tracked as **P3-05**. |
| **G5** | `revenue_lines` is never exercised by the mockup. Its revenue chart is a hardcoded 15-element array and its metrics are computed live off engagement columns. | Mockup `revMonths`, `mrr()`, `backlog()`, `runRate()`. | **The highest-risk carry-over in the project.** §5 is explicit that revenue is materialised so every question is one `SUM … GROUP BY`. Porting the mockup's per-model branching would quietly undo that decision. Tracked as **P3-06** with its own done-when. |
| **G6** | `search_fts` is one line in the schema with no sync mechanism. | §5. | FTS5 external-content table plus `AFTER INSERT/UPDATE/DELETE` triggers on all five source tables. Tracked as **P1-06**. |
| **G7** | Nowhere to put Stripe and Google credentials. | §7 integrations vs §5 schema. | Electron `safeStorage`, encrypted, in `userData` — **not** in the database. Consequence: the nightly JSON backup can never leak a key, which is why this is a schema decision and not an implementation detail. |
| **G8** | `activity` is described as append-only but nothing enforces it. | §6.8. | Enforce at the repository boundary: no update or delete channel is exposed for `activity`. Corrections are new rows. |

### A.2 The Pipeline view — a genuine conflict

The mockup ships a **Pipeline** nav item with a five-column board (Lead → Qualified → Scoped → Proposed → Committed), per-item probability bars, and its own seed array. None of `stage`, `probability` or a pipeline table exists in §5, and §1 opens by rejecting the sales funnel as the wrong centre of gravity for this business.

Three honest options:

1. **Drop it.** Engagements grouped by status (§6.4 cards view) already show the whole book, and `status` already spans `proposed | pending | active | held | delivered | lost`. Nothing is lost but a nav item. *Recommended.*
2. **Derive it.** Keep the board, render it from `engagements.status` with a fixed status→column map, add no columns. Costs a day, adds no schema, but preserves a surface the requirements argue against.
3. **Build it as drawn.** Requires `stage` and `probability` columns and a second source of truth for "how likely is this". Contradicts §2 and §12's scope-creep risk.

Take (1) unless the board earns itself back in the first month of real use. Tracked as **P1-13**.

### A.3 Open questions from §11 — none of these block

| Q | Recommendation | Blocks |
|---|---|---|
| Naslund Waste — direct client or EZDeploy end client? | **Direct.** It holds its own SOW, its own budget line and its own signature path in the mockup data. One field, changeable in five seconds if wrong. | Nothing. Data entry. |
| Should equity positions live here? | **Yes, as modelled** — engagement with `billing_model = 'equity'`, no revenue lines, excluded from every revenue aggregate. It costs one `WHERE` clause and it is the only place the position is written down. | Nothing. One exclusion in P3-06. |
| Do products need a fulfilment concept? | **No.** A product sells as a fixed-scope engagement with one milestone. Revisit when a single product has sold three times. | Nothing. |
| Is the timesheet still the system of record for hours? | **Yes — Solo CRM imports.** Hours entered in a tool you open between calls will not get entered; the daily timesheet already has the habit attached to it. Reversing this later is an import-direction change, not a schema change. | Phase 4 design only. |

---

## Phase 0 — Scaffold

Nothing user-visible ships here. The point is that every later task is a feature task.

### P0-01 · Toolchain — **M**
electron-vite + React + TypeScript + electron-builder. Main / preload / renderer split matching the §4 process model directory layout exactly.
**Done when:** `npm run dev` gives HMR in the renderer and auto-restart in main; `npm run build` produces a runnable local package.

### P0-02 · Security baseline — **S** · *needs P0-01*
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a CSP with no remote origins, no `webSecurity` overrides.
**Done when:** a smoke test asserts `window.require`, `window.process` and `window.module` are all `undefined` in the renderer, and the test runs in CI.

### P0-03 · Database boot — **M** · *needs P0-01*
better-sqlite3 rebuilt for the Electron ABI. Database at `app.getPath('userData')/solocrm.db`, WAL, foreign keys on, busy timeout set.
**Done when:** first launch creates the file; `PRAGMA journal_mode` returns `wal`; the app survives a hard kill mid-write with no corruption.

### P0-04 · Sync-folder guard — **XS** · *needs P0-03*
§4 warns the database must never sit in Drive, Dropbox or iCloud. Make that a check, not a comment: on boot, test the resolved path against known sync-daemon roots (`Google Drive`, `Dropbox`, `iCloud Drive`, `OneDrive`) and refuse to open with an explanatory dialog.
**Done when:** pointing `userData` at a Dropbox folder produces the dialog and a clean exit rather than a database.

### P0-05 · Drizzle schema + migrations — **L** · *needs P0-03, A.1*
Full §5 schema including the A.1 additions. UUID primary keys, `created_at`/`updated_at` on every table. Migrations run on boot; schema version recorded and readable.
**Done when:** a fresh database and a database three migrations behind both arrive at the same schema, and the version shows in the Data view.

### P0-06 · Date and money conventions — **XS** · *needs P0-05*
Dates as ISO `TEXT` (`YYYY-MM-DD`), timestamps as ISO-8601 UTC `TEXT`, money as integer cents, `period_month` as the first of the month. No `Date` objects cross the IPC boundary.
**Done when:** written down in `CONVENTIONS.md` and enforced by the zod schemas in P0-07.

### P0-07 · Typed IPC bridge — **L** · *needs P0-02, P0-05*
Channel registry with zod-validated payloads both ways, a single error envelope, `window.crm.*` surface generated from one shared type. The renderer touches neither the database nor the filesystem.
**Done when:** adding a channel requires editing exactly one registry file, and a payload that fails validation returns a typed error instead of throwing across the bridge.

### P0-08 · TanStack Query over IPC — **S** · *needs P0-07*
Treat IPC as the fetch layer. Query-key convention, invalidation helpers per entity, an optimistic-update helper for the inline interactions (todo completion, next-step toggle).
**Done when:** completing a todo updates the list, the sidebar count and the Today metrics from one mutation with no manual refetch.

### P0-09 · Design tokens and primitives — **L** · *needs P0-01*
Lift the mockup's CSS variables into `tokens.css` verbatim — obsidian ground, verdigris accent, one gold hero per view. Build the primitives the mockup uses everywhere: `Card`, `Row`, `Stat`, `Tag`, `ModelTag`, `Ring`, `DecayMeter`, `Toggle`, `Chip`, `Sheet`, `Toast`, `QuickAdd`, `ViewHeader`.
**Done when:** a token change propagates everywhere with no per-component overrides, and no component hardcodes a hex value.
**Why it is L and not S:** the mockup is one 149 KB file. Ported as-is it becomes an unmaintainable renderer. This is the task that decides whether Phases 2–5 are pleasant or grim.

### P0-10 · App shell — **M** · *needs P0-09*
Rail with the three nav groups, counts and database chip; topbar with breadcrumb, search button and New menu; router; the 900px collapse for small windows.
**Done when:** every route in the mockup resolves, the active nav item highlights, and `Esc` closes any open layer.

### P0-11 · Dev seed — **S** · *needs P0-05*
Port the mockup's seed data — ten companies, seven people, eleven engagements, eleven todos, ten activity rows, nine catalogue items with versions — into a loadable dev fixture.
**Done when:** `npm run seed` produces a database whose Today view matches the mockup screen for screen. Every later view then gets built against realistic data instead of two rows of `foo`.

---

## Phase 1 — Spine

§9: *"the majority of the value and usable immediately."*

**P1-CUT — the genuine weekend subset.** If only one weekend exists, ship P1-01, P1-03, P1-04, P1-05, P1-07, P1-08, P1-11 and X-08. That is: companies, engagements, tasks, activity, the palette, quick-log, company detail, and an *installed* app. Real data goes in and Notion stops being the relationship system of record. Everything else in Phase 1 is real value but is not what makes it start.

### P1-01 · Companies repository + IPC — **M** · *needs P0-07*
CRUD, `kind`, `bills_directly`, `billed_via_company_id`, `introduced_by_company_id`, `cadence_days`, `budget_note`, `since`.
**Done when:** creating a company through IPC round-trips every field, and `billed_via_company_id` cannot point at itself.

### P1-02 · People + affiliations — **M** · *needs P0-07*
People independent of companies. Affiliations carry `title`, `is_primary`, `started`, `ended`.
**Done when:** moving a person to a new company closes the old affiliation with an `ended` date and opens a new one — the previous employer stays visible on their detail page. §5: *"a `company_id` on `people` would erase a contact's history the day they move."*

### P1-03 · Engagements repository — **L** · *needs P1-01*
`billing_company_id` and `client_company_id` as independent columns. Model-specific fields per §5. `agreed_rate_cents` written once at creation.
**Done when:** an engagement with billing ≠ client persists both, revenue attributes to the biller and delivery to the client, and no code path re-reads the price list after creation.

### P1-04 · Tasks repository — **M** · *needs P1-01*
`todo | waiting | done`, `is_next_step`, `due_on`, `waiting_since`, `done_at`, optional company / engagement / person links.
**Done when:** setting `is_next_step` on a task clears it from any other open task for the same company, in one transaction.

### P1-05 · Activity repository — **S** · *needs P1-01*
Append-only. Insert and read only — no update or delete channel exists (G8). Insert updates `companies.last_touch_at` and `people.last_contact_at` in the same transaction.
**Done when:** the IPC surface has no way to mutate a row, and logging a touch moves the company's last-touch timestamp atomically.

### P1-06 · FTS5 + triggers — **M** · *needs P1-01…P1-05*
External-content FTS5 over `companies.name`, `people.name`, `engagements.name`, `tasks.title`, `activity.body`, with insert/update/delete triggers on each source table.
**Done when:** renaming a company is reflected in search results with no rebuild, and `INSERT … DELETE … INSERT` leaves no orphan rows in the index.

### P1-07 · Command palette — **L** · *needs P1-06, P0-10*
`⌘K`. Searches companies, people, engagements, catalogue items, todos and activity notes; leads with create commands; arrow keys and enter; a kind label and context hint per row.
**Done when:** results update within one frame of a keystroke at 10× data volume (§8), and every create command in the New menu is also reachable from the palette.

### P1-08 · Quick log — **M** · *needs P1-05*
`⌘L` from anywhere. Who / kind / one line. Writes activity and resets the cadence clock.
**Done when:** open-to-saved is under five seconds with the keyboard only (§2, goal 4), and the toast names the company that just went current.

### P1-09 · Create sheets — **L** · *needs P1-01…P1-04*
Company, person, engagement, todo. Chip groups for enumerations. The engagement form asks **"Billed to"** and **"Work is for"** as separate questions and swaps in model-specific fields (§6.4).
**Done when:** each form writes exactly the columns its footer claims, and choosing a billing model changes the fields without losing what was already typed.

### P1-10 · Companies view — **M** · *needs P1-01, P0-09*
Card and list presentation (§6.13), toggled in the view header, remembered per view. Cards carry identity colour, cadence ring, kind, active engagement count, end-client count. List gives aligned sortable columns.
**Done when:** the choice survives a restart (settings, per G2), and both presentations render the same record set.

### P1-11 · Company detail — **XL** · *needs P1-01…P1-05*
The densest screen in the app. On one page: engagements billed to this company; engagements delivered here but billed elsewhere; end clients where this company is the billing party; todos with the next step called out; activity timeline; contacts; details; links.
**Done when:** opening EZDeploy shows the Samay build under *billed here* with a "for W+K" marker, plus W+K and Programetrix as end clients — and W+K's own page shows the same engagement as *delivered here, billed to EZDeploy*. Split into sub-tasks per card if it is still XL on day two.

### P1-12 · People view + person detail — **M** · *needs P1-02*
Card and list grid; detail showing role, email, current company and shared history across affiliations.
**Done when:** a person with two affiliations shows both, with the closed one visibly historical.

### P1-13 · Engagements cards view — **M** · *needs P1-03*
Grouped by status, each card showing billing model, date range, effective hourly rate and model-appropriate progress. Resolve A.2 here — either drop the Pipeline nav item or derive it from `status`.
**Done when:** retainers show hours against allowance, fixed scopes show milestones, T&M shows hours against estimate, and no card renders a progress shape that does not apply to its model. *(Hours figures stay provisional until P4-03 — see P4-04.)*

### P1-14 · Todos view — **M** · *needs P1-04*
Grouped by date (Overdue / Today / This week / Later / No date / Waiting) or by client. Inline completion, inline quick-add on every group.
**Done when:** waiting items are excluded from the "things you owe" count but age visibly, per §5.

### P1-15 · Activity view — **S** · *needs P1-05*
Append-only log across companies, people and engagements.
**Done when:** the same entry appears in the global log and on its company, person and engagement, from one row.

### P1-16 · Links + favicon cache — **M** · *needs P1-01*
Paste a URL on a company; host determines kind and icon; title editable. Favicons fetched **once by the main process** and cached in the `favicons` table (§6.10). Ship the mockup's inline SVG set as the per-kind fallback for known hosts and offline use.
**Done when:** no third-party favicon service is contacted from any code path — asserted by a test — and links render correctly with the network off.

---

## Phase 2 — Cadence and structure

Phase 1 makes it a good record. Phase 2 makes it tell you something.

### P2-01 · Settings persistence — **S** · *needs P0-05, G2*
`settings` table, typed accessors, defaults on first boot.
**Done when:** every toggle in §6.11 survives a restart.

### P2-02 · Per-kind default cadence — **S** · *needs P2-01*
Defaults per company kind; new companies inherit; any company overrides its own.
**Done when:** changing the Client default moves companies still on the inherited value and leaves overridden ones alone.

### P2-03 · Decay computation — **S** · *needs P1-05, P2-02*
`days_since_last_touch / cadence_days`, not a global threshold. Ring and meter components; ok / warn / late bands.
**Done when:** a retainer client at eight days reads late and a referral channel at eight days reads fine, from the same function (§5).

### P2-04 · Today view — **L** · *needs P2-03, P1-04*
Hero metrics (recurring monthly, fixed backlog, open todos, cadence health); **Going quiet** sorted by how far past each company's own cadence, each row showing the owed next step rather than a day count; Next up with inline completion and quick-add; twelve-month revenue chart; linked-systems strip.
**Done when:** the view leads with what is owed, not what is stored (§12), and every row is a link to the action rather than a number.

### P2-05 · Next step — **S** · *needs P1-04, P2-04*
One `is_next_step` per relationship, surfaced on Today and on company detail.
**Done when:** the Going quiet rows show the owed step where one exists and prompt to name one where it does not.

### P2-06 · End clients — **M** · *needs P1-01, P1-11*
`bills_directly = false`. Own contacts, budget, cadence clock and activity log. Never appears in a revenue rollup as a payer.
**Done when:** W+K has its own cadence clock and never contributes a payer row to revenue, while the Samay engagement's money still lands on EZDeploy.

### P2-07 · Waiting ageing — **XS** · *needs P1-14*
`waiting_since` drives visible age; waiting items stay out of the owed count.
**Done when:** a 40-day waiting item is visually louder than a 2-day one and neither inflates "open todos".

### P2-08 · View-mode persistence — **XS** · *needs P2-01, P1-10*
Card / list choice remembered per view (§6.13).
**Done when:** Companies as list and People as cards both survive a restart independently.

---

## Phase 3 — Money

### P3-01 · Catalogue repositories — **M** · *needs P0-05*
`service_categories`, `services`, `service_versions`.
**Done when:** a service always has at least one version, and versions never overlap in their effective ranges.

### P3-02 · Catalogue view — **L** · *needs P3-01*
A management surface, not an analytics surface (§6.5). Create, edit, duplicate, archive; create / rename / delete categories; filter all / services / products; quick-add parsing `Name, 4500`, `Name, 4500/mo`, `Name, 175/hr`.
**Done when:** archive never deletes, archived items stay attached to everything sold at their rate, and deleting a category with items in it is refused with a reason.

### P3-03 · Change price — **M** · *needs P3-01*
A distinct action, not an edit field. Closes the current version, appends the next with an effective date, and states how many signed engagements are unaffected.
**Done when:** changing a price from $3,500 to $4,500 leaves every existing engagement's `agreed_rate_cents` untouched, verified by a test that reads the rows back.

### P3-04 · Rate snapshot on creation — **S** · *needs P3-01, P1-03*
The price list is read exactly once, when a proposal is created.
**Done when:** deleting the `service_version` an engagement was sold from changes nothing about that engagement's numbers.

### P3-05 · Milestones — **M** · *needs P1-03, G4*
Name, sort, `amount_cents`, `expected_month`, `completed_at`. The engagement create and edit forms get a real milestone editor.
**Done when:** a four-milestone fixed scope has four dated, priced rows whose amounts sum to the contract value, and the form says so when they do not.

### P3-06 · Revenue line generator — **XL** · *needs P3-05, P1-03*
**The task that decides whether §5's central decision survives contact.** Materialise, do not compute: retainers generate one row per month; fixed scopes generate one row per milestone at its expected month; T&M generates estimates that actuals overwrite. Equity generates nothing. Regeneration on engagement edit must never touch a row already `invoiced` or `paid`.
**Done when:** every revenue question in the app is one `SUM … GROUP BY period_month, status` with no branching on billing model — grep the revenue module for `billing_model` and find only the generator.

### P3-07 · Revenue view — **L** · *needs P3-06*
Rollup toggle: billing party / end client / model — same totals, different attribution. Recurring monthly, fixed backlog, T&M run rate, concentration as the largest payer's share of YTD.
**Done when:** the three rollups agree to the cent, and end clients appear under *end client* while never appearing as a payer under *billing party* (§6.2).

### P3-08 · Stacked monthly chart — **M** · *needs P3-06*
Twelve months, stacked by model, projected months visually distinct from actuals. Replaces the mockup's hardcoded array on both Revenue and Today.
**Done when:** the chart reads from `revenue_lines` and a newly signed engagement changes it with no code change.

### P3-09 · Engagement timeline — **L** · *needs P1-03, P3-05*
Gantt grouped by billing party. Bars coloured by model, milestone ticks on fixed bars, rolling retainers fading at the right edge, dashed bars for unsigned work, today marker.
**Done when:** `ends_on = NULL` renders as a fade rather than a bar ending at an invented date (§5).

---

## Phase 4 — Integrations

All adapters **pull-only and one-way** (§7). That constraint is the feature.

### P4-01 · Sync framework — **M** · *needs P0-07*
Adapter interface, `external_refs` mapping, `last_synced_at`, per-source status for the strip and settings. Credentials in `safeStorage` (G7).
**Done when:** the adapter interface exposes no write method — the type system makes writing back impossible, not the code review.

### P4-02 · Stripe — **L** · *needs P4-01, P3-06*
Invoices, payment status and customer ids → `revenue_lines.status`, `paid_at`, `stripe_invoice_id`.
**Done when:** marking an invoice paid in Stripe moves the matching revenue line to `paid` on the next pull, and an unmatched invoice surfaces for manual mapping rather than being dropped silently.

### P4-03 · Timelog CSV import — **L** · *needs P4-01*
Client-attributed hours → `time_entries`. Column mapping, idempotent re-import on a stable dedupe key.
**Done when:** importing the same file twice produces the same row count. §7: *"every hours figure in the app is derived from `time_entries`."*

### P4-04 · Hours-derived UI goes live — **M** · *needs P4-03*
Switch retainer hours-used, T&M hours-against-estimate and effective hourly rate from placeholder fields to `time_entries` aggregates.
**Done when:** no view reads an `hours_used` value that a human typed. Until this lands, every hours figure in the app is decoration — mark them provisional in the UI from P1-13 onward so nobody trusts them by accident.

### P4-05 · Google Calendar — **L** · *needs P4-01*
Events matching a known company domain or attendee → `activity` with `source = 'gcal'`. Dedupe against manual entries.
**Done when:** a meeting logged manually and pulled from Calendar produces one activity row, not two.

### P4-06 · Gmail — **M** · *needs P4-01*
Last-contacted timestamp only. No message bodies, ever.
**Done when:** a test asserts no message body reaches the database, and the requested OAuth scope is the narrowest one that returns a timestamp.

### P4-07 · Integration settings — **S** · *needs P4-01*
Per-source toggles and status; the UI states plainly that Solo CRM never writes back.
**Done when:** disabling a source stops its pulls without losing what it already wrote.

---

## Phase 5 — Judgement metrics

The phase where the tool starts having opinions. Everything here depends on P4-03.

### P5-01 · Effective hourly rate — **M** · *needs P4-04*
Across every model, on the engagement card and detail. §10.2: $18,000 over 86 hours is ≈$125/hr; $6,500/mo over 20 hours is ≈$330/hr. That comparison is how pricing improves.
**Done when:** the two engagements above are directly comparable on one screen.

### P5-02 · Completed but uninvoiced — **M** · *needs P3-06*
A finished milestone that was never invoiced is the most common way money goes missing in a solo shop (§10.3). Surface it on Today.
**Done when:** completing a milestone with no invoiced revenue line raises it on Today within one refresh.

### P5-03 · Retainer renewals — **S** · *needs P1-03*
`renews_on` exists in the schema with no UI. Give rolling work a renegotiation trigger.
**Done when:** a retainer renewing within 30 days appears on Today with the current rate and the date it was last changed.

### P5-04 · Capacity — **M** · *needs P4-04, P3-06*
One operator. Warn when a month holds more committed hours than capacity.
**Done when:** 180 committed hours against a 160-hour month warns before the month starts, not during it.

### P5-05 · Concentration alert — **XS** · *needs P3-07*
Largest payer as a share of YTD, raised when it crosses a threshold.
**Done when:** the number is visible on Revenue and warns without needing to be sought out.

---

## Cross-cutting

### X-01 · Workspace → Data — **M** · *phase 1 tail* · *needs P0-05*
Database size, page size, WAL size, copyable path, journal mode, schema version and last migration date, last backup, last integrity check. Per-table row counts with relative size bars; clicking a table loads `SELECT * FROM <table> LIMIT 20` into the console.
**Done when:** every figure is read live from the file rather than cached at boot.

### X-02 · Query console — **M** · *phase 1 tail* · *needs X-01*
Read-only. Open a **second better-sqlite3 connection in readonly mode** against the same file, and additionally reject any statement where `stmt.readonly` is false — belt and braces, because `PRAGMA` and `ATTACH` slip past a naive `^SELECT` regex. Writes are rejected with an explicit message rather than silently ignored. Results as a table with row count and execution time; saved snippets.
**Done when:** `DELETE FROM companies`, `PRAGMA writable_schema = 1` and `ATTACH DATABASE …` are each refused with a message naming why, and a legitimate four-table join returns rows.
**Why it is worth building early:** §6.12 — the schema encodes decisions the UI deliberately does not expose. The console is what keeps pressure off the UI to grow an analytics surface for every one-off question.

### X-03 · Nightly backup — **M** · *phase 2* · *needs P2-01*
Whole database to timestamped JSON in a chosen folder, last 30 kept. JSON rather than a `.db` copy so a corrupted database is still recoverable and the format is diffable (§8).
**Done when:** a backup restores into an empty database and produces identical row counts, and no credential appears anywhere in the file (G7).

### X-04 · Maintenance actions — **XS** · *phase 2* · *needs X-01*
Export snapshot, `VACUUM` + `ANALYZE`, `integrity_check`.
**Done when:** each reports its result and elapsed time rather than a silent toast.

### X-05 · Accessibility — **M** · *continuous*
Full keyboard navigation, visible focus rings, `prefers-reduced-motion` honoured throughout, dialog and switch roles, an appearance toggle that also forces motion off.
**Done when:** every view is reachable and operable without a mouse, and reduced motion removes animation without removing meaning — the decay bars must still show their width.

### X-06 · Performance harness — **M** · *after phase 3* · *needs P0-11*
Generate 10× volume — roughly 100 companies, 500 engagements, 20k time entries — and measure. §8: any view under 100ms, palette results within one frame of a keystroke.
**Done when:** the numbers are recorded per view in CI and a regression past budget fails the build. An unmeasured NFR is a wish.

### X-07 · Error handling — **S** · *phase 1* · *needs P0-07*
IPC error envelope surfaced as a toast with a reason; migration failure leaves the previous database intact and says what happened.
**Done when:** a deliberately broken migration produces a readable dialog and a database still openable by the previous build.

### X-08 · Packaging — **M** · *phase 1 tail* · *needs P0-01*
Ubuntu (deb / AppImage) and macOS (dmg). App icons from the new mark.
**Done when:** it is installed and in the dock on both machines. **Do this at the end of Phase 1, not at the end of the project** — §12's abandonment risk is not theoretical, and a tool that has to be run from a terminal does not get opened between calls.

---

## Traceability

| Requirement | Tasks |
|---|---|
| §4 Architecture / process model | P0-01, P0-02, P0-03, P0-04, P0-07 |
| §5 Data model + modelling decisions | P0-05, P1-02, P1-03, P3-04, P3-06, P3-09 |
| §6.1 Today | P2-04, P2-05, P3-08, P5-02 |
| §6.2 Companies | P1-01, P1-10, P1-11, P2-06 |
| §6.3 People | P1-02, P1-12 |
| §6.4 Engagements | P1-03, P1-09, P1-13, P3-09 |
| §6.5 Catalogue | P3-01, P3-02, P3-03 |
| §6.6 Todos | P1-04, P1-14, P2-05, P2-07 |
| §6.7 Revenue | P3-06, P3-07, P3-08, P5-05 |
| §6.8 Activity | P1-05, P1-15 |
| §6.9 Search and capture | P1-06, P1-07, P1-08 |
| §6.10 Links | P1-16 |
| §6.11 Settings | P2-01, P2-02, P4-07, X-03, X-05 |
| §6.12 Data + console | X-01, X-02, X-04 |
| §6.13 View modes | P1-10, P1-12, P2-08 |
| §7 Integrations | P4-01 … P4-07 |
| §8 Non-functional | P0-04, X-03, X-05, X-06 |
| §10 Known gaps | P4-03, P5-01, P5-02, P5-03, P5-04 |

## Explicitly not built

Straight from §2, restated here so the plan can be checked against it: no multi-user, teams, permissions or shared workspaces. No replacement for Stripe invoicing, Drive storage or Notion knowledge. No marketing automation, email sequences, lead scoring or web forms. No productization work. The Turso / libSQL sync path is designed *for* by the UUID and `updated_at` conventions in P0-05 and built by nobody in v1.

## Rough shape of the calendar

| Phase | Size |
|---|---|
| Phase 0 | ~8 days |
| Phase 1 | ~14 days *(P1-CUT ≈ 2–3 days to first real use)* |
| Phase 2 | ~4 days |
| Phase 3 | ~11 days |
| Phase 4 | ~10 days |
| Phase 5 | ~5 days |
| Cross-cutting | ~7 days |

Roughly 60 working days end to end. The number that matters is not that one — it is the two to three days to P1-CUT, because a tool being used is the only version of this that survives §12.
