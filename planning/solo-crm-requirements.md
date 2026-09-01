# Solo CRM — Requirements & Scope

**Owner:** Robby Boney, MagicPill Labs
**Status:** Draft v1 — §5 amended 28 August 2026
**Date:** 27 August 2026

> §5 is amended as schema decisions are settled, so that the DDL here and the
> DDL in the migrations cannot disagree. The reasoning for each amendment lives
> in [`.dev/decisions/`](../.dev/decisions/), not in this file. Amendments so
> far, all dated 28 August 2026:
>
> - `companies.last_touch_at` and `people.last_contact_at` (ADR-001)
> - `activity.source` — `gmail` marked reserved, with no writer (ADR-001)
> - the `settings` table; the primary-key status of `favicons`, `affiliations`
>   and `taggings` made explicit; and `created_at` / `updated_at` written into
>   nine tables that had been leaving them implicit —
>   `service_categories`, `service_versions`, `milestones`, `revenue_lines`,
>   `time_entries`, `links`, `external_refs`, `tags`, `activity` (ADR-002)
> - the `revenue_lines` modelling note sharpened to `SUM(amount_cents)`, the
>   estimate/actual replacement rule, and where `billing_model` may be branched
>   on (ADR-003)
> - the rule that `settings` may hold no secret (ADR-004)
> - `search_fts` — external content plus triggers, and P1-06 named as the
>   migration that creates them (G6)

---

## 1. Problem

Client, project, contact and revenue tracking for MagicPill Labs currently lives across Notion, Google Drive, Stripe and a daily timesheet. Nothing owns the relationship between them. The result is that facts are duplicated, upkeep costs more than it returns, and the setup decays between uses.

Existing CRMs are built around a sales pipeline — a funnel of deals that close. That is the wrong center of gravity for a solo services business, where revenue is a small number of relationships that either stay warm or quietly go cold, and where the same client can be a billing party, a delivery partner and a referral source at once.

## 2. Goals

1. One place that answers "what is the state of every client relationship" without opening four other tools.
2. Track revenue across mixed billing models — retainer, fixed-scope, T&M, equity — and roll it up by who pays, by who the work is for, and by model.
3. Surface relationships going quiet before they go cold.
4. Make capture cheap enough that it actually happens: sub-five-seconds to log a touch or a todo.
5. Be the index that links Notion, Drive and Stripe together rather than a fourth copy of their contents.

### Non-goals

- Multi-user, teams, permissions, or shared workspaces. Single operator, single machine.
- Replacing Stripe as the invoicing system, Drive as document storage, or Notion as the knowledge base.
- Marketing automation, email sequences, lead scoring, or web forms.
- Being sellable as a product. This is internal tooling; productization is a separate decision made later on evidence.

## 3. Users and context

One user. Runs a solo AI software development consultancy. Simultaneously handles sales, delivery, billing and bookkeeping. Works across a laptop and a desktop. Technical — comfortable with keyboard-driven tools and SQL.

Usage pattern is short, frequent sessions: open it between calls, check what is owed, log something, close it. The tool must be useful in ten seconds and must never require a maintenance session.

---

## 4. Architecture

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Shell | Electron (Ubuntu/macOS) | Local filesystem access, native menus, single distributable |
| Renderer | React + Vite + TypeScript | Familiar, fast HMR |
| Data access | better-sqlite3 in the main process | Synchronous, no pool, fast enough that queries feel instant for single-user |
| ORM / migrations | Drizzle | Typed queries, SQL-file migrations |
| Server state | TanStack Query over the IPC bridge | Caching and invalidation for free; treat IPC as a fetch layer |
| Search | SQLite FTS5 virtual table | Powers the command palette |

### Process model

```
electron/
  main/
    db/          schema.ts · migrations/ · repositories/
    sync/        stripe.ts · gcal.ts · gmail.ts · timelog.ts
    ipc/         typed channel handlers
    favicons/    fetch + cache
  preload/       contextBridge → window.crm.*
  renderer/      routes/ · components/ · hooks/
```

- `contextIsolation: true`, `nodeIntegration: false`. The renderer never touches the database or the filesystem; all access goes over typed IPC through the preload bridge.
- Database at `app.getPath('userData')/solocrm.db`, WAL mode enabled.
- **The database file must not be placed in a Drive, Dropbox or iCloud folder.** File-sync daemons and SQLite corrupt each other.

### Future sync

Every table uses UUID primary keys and carries `created_at` / `updated_at` — except tables keyed by natural identity (`settings` by key, `favicons` by host), see [ADR-002](../.dev/decisions/ADR-002-settings-key-value-table.md). This costs nothing now and makes a later move to Turso/libSQL embedded replicas (for laptop ↔ desktop sync) a drop-in rather than a schema rewrite. Not in scope for v1.

---

## 5. Data model

```sql
-- Companies: clients, prospects, end clients, channels
companies (
  id            uuid pk,
  name          text not null,
  kind          text,          -- client | prospect | end_client | advisory | channel
  website       text,
  bills_directly boolean default true,
  billed_via_company_id uuid null references companies(id),
  introduced_by_company_id uuid null references companies(id),
  cadence_days  integer default 14,
  last_touch_at timestamp null,  -- denormalised; maintained on activity insert
                                 -- and written directly by the Gmail adapter.
                                 -- Never derived from MAX(activity.occurred_at)
  budget_note   text,
  notes         text,
  since         date,
  created_at, updated_at
)

-- People live independently of companies
people (
  id uuid pk, name text not null, email text, phone text, notes text,
  last_contact_at timestamp null,   -- as companies.last_touch_at
  created_at, updated_at
)

-- Keeps a UUID key rather than the (person_id, company_id) pair: a person can
-- leave a company and come back, so the pair legitimately repeats. ADR-002
affiliations (
  id uuid pk,
  person_id uuid references people(id),
  company_id uuid references companies(id),
  title text, is_primary boolean, started date, ended date,
  created_at, updated_at
)

-- Offerings: what you sell, and what it costs
-- (T-260829-10 renamed these three from service_categories / services /
-- service_versions; `category_id` kept its already-generic name.)
offering_categories ( id uuid pk, name text, color text, sort integer, created_at, updated_at )

offerings (
  id uuid pk, name text not null,
  type          text,          -- service | product
  category_id   uuid references offering_categories(id),
  billing_model text,          -- retainer | fixed | tm
  unit          text,          -- fixed | from | mo | hr
  blurb         text,
  active        boolean default true,
  created_at, updated_at
)

offering_versions (
  id uuid pk, offering_id uuid references offerings(id),
  version integer, rate_cents integer,
  effective_from date, effective_to date null,
  created_at, updated_at
)

-- Engagements: the money-bearing unit
engagements (
  id uuid pk, name text not null,
  billing_company_id uuid references companies(id),   -- who is on the invoice
  client_company_id  uuid references companies(id),   -- who the work is for
  offering_version_id uuid null references offering_versions(id),
  agreed_rate_cents  integer,     -- snapshot at signature; never re-read from the price list
  billing_model text,             -- retainer | fixed | tm | equity | none
  status        text,             -- active | pending | proposed | held | delivered | lost
  started_on    date not null,
  ends_on       date null,        -- NULL = rolling
  renews_on     date null,
  -- retainer
  hours_included numeric null,
  -- fixed
  contract_value_cents integer null,
  -- tm
  hourly_rate_cents integer null, estimated_hours numeric null, not_to_exceed_cents integer null,
  notes text, created_at, updated_at
)

milestones (
  id uuid pk, engagement_id uuid references engagements(id),
  name text, sort integer, completed_at timestamp null,
  amount_cents integer null, expected_month date,
  created_at, updated_at
)

-- Materialised revenue: one row per expected/actual amount per month
revenue_lines (
  id uuid pk, engagement_id uuid references engagements(id),
  period_month date not null,
  amount_cents integer not null,
  kind    text,   -- retainer | milestone | tm_estimate | tm_actual | expense
  status  text,   -- projected | invoiced | paid
  invoiced_at timestamp null, paid_at timestamp null,
  stripe_invoice_id text null,
  created_at, updated_at
)

-- Time
time_entries (
  id uuid pk, engagement_id uuid null references engagements(id),
  company_id uuid null references companies(id),
  worked_on date, hours numeric, note text,
  source text,   -- manual | timelog_csv
  created_at, updated_at
)

-- Work
tasks (
  id uuid pk, title text not null,
  status text,              -- todo | waiting | done
  is_next_step boolean default false,
  due_on date null, waiting_since date null, done_at timestamp null,
  company_id uuid null, engagement_id uuid null, person_id uuid null,
  created_at, updated_at
)

activity (
  id uuid pk, occurred_at timestamp not null,
  kind text,                -- call | email | meeting | note
  title text, body text,
  company_id uuid null, person_id uuid null, engagement_id uuid null,
  source text,              -- manual | gcal
                            -- 'gmail' is reserved and has no writer: the Gmail
                            -- adapter writes last_touch_at / last_contact_at
                            -- columns, never activity rows. It becomes legal
                            -- only if a later decision adds synthetic rows.
                            -- ADR-001
  created_at, updated_at    -- always equal: rows are append-only (G8), never
                            -- updated. Kept anyway — uniform rule, sync-ready.
)

-- External references
links (
  id uuid pk, entity_type text, entity_id uuid,
  url text, title text, kind text,   -- drive | notion | github | figma | stripe | pdf | slack | web
  added_at timestamp,
  created_at, updated_at
)

-- Keyed by host: a natural identity, so exempt from the UUID key rule along
-- with settings. The host is what the fetch-once-and-cache path looks up.
-- Carries fetched_at and no created_at / updated_at: the row is a cache entry
-- with one timestamp that matters. ADR-002
favicons ( host text pk, bytes blob, fetched_at timestamp )

external_refs (
  id uuid pk, entity_type text, entity_id uuid,
  source text, external_id text, url text, last_synced_at timestamp,
  created_at, updated_at
)

tags ( id uuid pk, name text, color text, created_at, updated_at )

-- Keeps a UUID key; the natural triple is enforced as a unique index, not as
-- the primary key. ADR-002
taggings (
  id uuid pk, tag_id uuid references tags(id),
  entity_type text, entity_id uuid,
  created_at, updated_at,
  unique (tag_id, entity_type, entity_id)
)

-- Workspace configuration. Key/value so a preference costs an accessor, not a
-- migration. Keyed by `key` -- a natural identity -- so exempt from the UUID
-- primary key rule, along with favicons (host). Those two are the whole
-- exemption; every other table, join tables included, keeps a UUID. ADR-002
-- NON-SECRET VALUES ONLY -- credentials live in Electron safeStorage, never here
settings (
  key        text pk,
  value      text not null,   -- json
  updated_at timestamp not null
)

search_fts  -- FTS5 external-content table over companies.name, people.name,
            -- engagements.name, tasks.title, activity.body, kept in sync by
            -- AFTER INSERT/UPDATE/DELETE triggers on all five source tables.
            -- The table and its triggers are created together by P1-06's
            -- migration. Migration 0001 (P0-05) does not create either. (G6)
```

### Modelling decisions to preserve

**Billing party and delivery client are separate columns on the engagement, not a parent/child link between companies.** EZDeploy does not own W+K; EZDeploy pays, W+K receives the work. Those roles vary per engagement and either can change independently. Revenue rolls up on `billing_company_id`; touchpoints and delivery roll up on `client_company_id`. An engagement where both point at the same company is the ordinary case and needs no special handling.

**`agreed_rate_cents` is a snapshot, not a join.** The price list is read exactly once, when a proposal is created. After that the engagement owns its number. `offering_versions` gives price history; the snapshot guarantees that editing or deleting a version can never alter signed work.

**`ends_on = NULL` means rolling.** Not a far-future sentinel date. Null is the honest representation of "no agreed finish" and is what distinguishes a retainer from a fixed scope in every query.

**`revenue_lines` is materialised, not computed.** A retainer generates one row per month, to a stated horizon where `ends_on` is NULL. A fixed scope generates one row per milestone at its expected month. T&M generates `tm_estimate` rows; when actuals arrive for a month the generator deletes that month's estimate rows and writes `tm_actual` rows in the same transaction, so a month never holds both and a consumer never needs a per-kind filter to avoid double counting. `equity` and `none` generate nothing at all. Every revenue question then becomes one `SUM(amount_cents) ... GROUP BY period_month, status` with no branching on billing model. Branching on `billing_model` is legal only inside the generator that writes the lines; anywhere else it is a defect. `kind = 'expense'` lines are operator-entered — the one other writer of this table — and carry a negative `amount_cents`. See ADR-003.

**`affiliations` is its own table.** People change jobs. A `company_id` on `people` would erase a contact's history the day they move.

**`waiting` is a first-class task status.** In a services business, half of all open loops are blocked on the client. Waiting items must not inflate the count of things the operator owes, but they must age visibly so they get chased.

**Cadence is per company.** A retainer client at eight days silent is a problem; a referral channel at eight days is fine. Staleness is `days_since_last_touch / cadence_days`, not a global threshold.

**`last_touch_at` is denormalised on purpose, not derived from activity.** The Gmail adapter pulls a last-contacted timestamp and no message body, so there is no activity row to derive it from; deriving would silently ignore the largest source of contact in the business. The column is the source of truth for cadence, `activity` is the source of truth for what happened, and neither is a cache of the other. See ADR-001.

---

## 6. Functional requirements

### 6.1 Today
- Hero metrics: recurring monthly revenue, fixed backlog, open todos, cadence health.
- **Going quiet:** companies past their own cadence, sorted by how far past, each showing the owed next step rather than just a number of days.
- Next up: todos sorted by urgency, with inline completion and quick-add.
- Twelve-month revenue chart, stacked by model, with projected months distinguished.
- Linked-systems status strip (Notion, Drive, Stripe, Calendar) with last sync time.

### 6.2 Companies
- Grid of company cards with identity colour, cadence ring, kind, active engagement count and end-client count.
- **Company images** *(added 2026-09-01 — a scope addition decided in [ADR-015](../.dev/decisions/ADR-015-company-images.md); neither the original requirements nor the mockup asked for it).* A company may carry two operator-supplied images: a **logo** and a **banner**. Company detail shows both — the logo in place of the initials mark, the banner behind the header. A grid card shows both — the logo in its mark, the banner as a wash under the card's gradient. Absence is the default: a company with no image keeps its identity colour and initials, and clearing an image restores them. PNG and JPEG only, chosen through the native file picker; 512 KB cap for a logo, 1 MB for a banner. Both are stored in the database, each beside a downscaled derivative that is what the grid reads — a list never transfers originals, whatever the company count.
- **Company detail** must show, on one page: engagements billed to this company; engagements delivered here but billed elsewhere; end clients (where this company is the billing party); todos with the next step called out; activity timeline; contacts; details; links.
- End clients (`bills_directly = false`) carry their own contacts, budget, cadence clock and activity log, and must never appear in a revenue rollup as a payer.

### 6.3 People
- Grid of contact cards; detail page showing role, email, current company, shared history.
- Affiliation history preserved across job changes.

### 6.4 Engagements
- **Cards view** grouped by status, each showing billing model, date range, effective hourly rate, and model-appropriate progress:
  - Retainer → hours used against hours included, this month.
  - Fixed → milestones completed, remaining backlog value.
  - T&M → hours against estimate, against not-to-exceed.
- **Timeline view** — Gantt grouped by billing party, bars coloured by model, milestone ticks on fixed bars, rolling retainers fading at the right edge, dashed bars for unsigned work, today marker.
- Create flow asks "Billed to" and "Work is for" separately, then swaps in model-specific fields.

### 6.5 Offerings (services & products)
- Management surface, not an analytics surface: create, edit, duplicate, archive; create/rename/delete categories.
- Filter by all / services / products.
- Quick-add parses `Name, 4500` / `Name, 4500/mo` / `Name, 175/hr`.
- **Change price** is a distinct action that closes the current version and appends the next, with an effective date, and warns how many signed engagements are unaffected.
- Archive, never delete. Archived items remain attached to everything sold at their rate.

### 6.6 Todos
- Grouped by date (Overdue / Today / This week / Later / No date / Waiting) or by client.
- Inline completion, inline quick-add on every surface that can produce a todo.
- One `is_next_step` per relationship, surfaced on Today and on company detail.

### 6.7 Revenue
- Rollup toggle: **billing party / end client / model**. Same totals, different attribution.
- Metrics: recurring monthly, fixed backlog, T&M run rate, concentration (largest payer as a share of YTD).
- Stacked monthly chart, actuals and projections.

### 6.8 Activity
- Append-only log across companies, people and engagements. Manual entries plus automatic entries from calendar. **Mail contributes no activity rows** — the Gmail adapter pulls a last-contacted timestamp and writes it to `companies.last_touch_at` / `people.last_contact_at` directly, because §7 forbids pulling message bodies and there would be nothing to show in the log (ADR-001).

### 6.9 Search and capture
- `⌘K` command palette over FTS5: companies, people, engagements, offerings, todos, activity notes — plus create commands.
- `⌘L` logs a touch from anywhere.
- Logging a touch resets that company's cadence clock.

### 6.10 Links
- Paste any URL on a company; the host determines kind and icon; title is editable.
- **Favicons are fetched once by the main process and cached locally in the `favicons` table.** Do not call a third-party favicon service — it leaks every client URL and breaks offline.

### 6.11 Workspace — settings
- Identity: workspace name, operator, currency, fiscal year start.
- **Default cadence per company kind.** New companies inherit; any company overrides its own.
- Integration toggles with per-source status. All pull-only; the UI must state this.
- Backup: nightly JSON export toggle and target folder.
- Appearance: interface motion, compact density.
- Keyboard shortcut reference.

### 6.12 Workspace — data
- Database size, page size, WAL size, path (copyable), journal mode, schema version and last migration date, last backup, last integrity check.
- Per-table row counts with relative size bars. Clicking a table loads a `SELECT * FROM <table> LIMIT 20` into the console.
- **Query console** — read-only. Writes are rejected with an explicit message rather than silently ignored. Results render as a table with row count and execution time. Saved snippets for common questions.
- Maintenance actions: export snapshot, `VACUUM` + `ANALYZE`.
- Rationale: the schema encodes decisions the UI deliberately does not expose (version history, snapshot rates, affiliation ranges). A console means those questions are answerable without shipping a report for each one, and it keeps pressure off the UI to grow analytics surfaces.

### 6.13 View modes
Companies and People each support **card** and **list** presentation, toggled in the view header and remembered per view. Cards favour recognition — identity colour, cadence ring, at-a-glance state. Lists favour comparison and scanning — aligned columns, more rows per screen, sortable. Neither is the default for all cases: cards for under ~20 records, lists beyond that.


---

## 7. Integrations

All adapters are **pull-only and one-way**. Solo CRM never writes back. That constraint is what stops it becoming another thing to maintain.

| Source | Pulls | Writes to |
|---|---|---|
| Stripe | Invoices, payment status, customer ids | `revenue_lines.status`, `paid_at`, `stripe_invoice_id` |
| Google Calendar | Events matching a known company domain or attendee | `activity` (source = gcal) |
| Gmail | Last-contacted timestamp only — **no message bodies** | `companies.last_touch_at`, `people.last_contact_at` |
| Daily timelog CSV | Client-attributed hours | `time_entries` |
| Notion / Drive | Nothing. Links only. | `links` |

The timelog integration matters more than it looks: every hours figure in the app is derived from `time_entries`. Without it, retainer hours-used and effective hourly rate are hand-maintained fiction and will be wrong within two weeks.

---

## 8. Non-functional requirements

- **Local-first.** Fully functional offline. No account, no server, no telemetry.
- **Performance.** Any view renders in under 100ms at 10× current data volume (roughly 100 companies, 500 engagements, 20k time entries). Palette results update within one frame of a keystroke.
- **Privacy.** Client data never leaves the machine except through explicit, user-configured integrations. No analytics.
- **Backup.** Nightly export of the whole database to timestamped JSON in a user-chosen folder, keeping the last 30. JSON rather than a `.db` copy so that a corrupted database is still recoverable and the format is diffable.
- **Accessibility.** Full keyboard navigation, visible focus rings, `prefers-reduced-motion` respected throughout.
- **Design.** MagicPill Labs "Refined Alchemy" system: obsidian ground, verdigris as the working accent, one gold hero value per view. Colour must carry meaning — section identity, company identity, billing model, status — never decoration.

---

## 9. Build phases

**Phase 1 — Spine (target: one weekend)**
Companies, people, affiliations, engagements, activity, tasks. Command palette over FTS5. Quick-add and quick-log everywhere. This is the majority of the value and is usable immediately.

**Phase 2 — Cadence and structure**
Per-company cadence, decay meters, Today view, next-step flag, billing-vs-delivery split, end clients.

**Phase 3 — Money**
Offerings with versioning, `revenue_lines`, revenue rollups, milestones, engagement timeline.

**Phase 4 — Integrations**
Stripe first (cleanest API, highest-value data), then timelog CSV import, then calendar and mail.

**Phase 5 — Judgement metrics**
Effective hourly rate, capacity view, uninvoiced-milestone alerts, retainer renewal warnings.

---

## 10. Known gaps to close after v1

1. **Time entries.** Highest-value single addition. Everything hours-related depends on it.
2. **Effective hourly rate.** A fixed-price build at $18,000 and 86 hours is roughly $125/hr; a retainer at $6,500/mo and 20 hours is roughly $330/hr. That comparison is how pricing improves, and it is invisible in every tool currently in use.
3. **Invoiced vs completed.** A finished milestone that was never invoiced is the most common way money goes missing in a solo shop. Needs a "completed but uninvoiced" surface on Today.
4. **Retainer renewals.** `renews_on` exists in the schema but has no UI. Rolling work currently has no renegotiation trigger.
5. **Capacity.** One operator. Nothing currently warns that a month holds 180 committed hours in a 160-hour capacity.

## 11. Open questions

- Is Naslund Waste a direct client or an EZDeploy end client? One field either way, but it changes the revenue rollup.
- Should equity positions live in this system at all, given they are personal rather than MPL assets? Currently modelled as an engagement with `billing_model = equity` and zero revenue.
- Do products need their own fulfilment concept, or are they always sold as a fixed-scope engagement?
- Does the daily timesheet remain the system of record for hours, with Solo CRM importing, or does Solo CRM become the place hours are entered?

## 12. Risks

| Risk | Mitigation |
|---|---|
| Abandonment — the reason the Notion setup failed | Capture under five seconds; every session must tell the operator something they did not already know |
| Becoming a filing cabinet rather than a prompt | Today view leads with what is owed, not with what is stored |
| Duplicating Notion/Drive/Stripe | Links, not copies. Pull-only adapters |
| Schema churn once real data lands | UUID keys, `updated_at` everywhere, Drizzle migrations from day one |
| Scope creep toward a sellable product | Non-goals section is binding until v1 ships and gets used for a quarter |
