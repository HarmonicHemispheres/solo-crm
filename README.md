![Solo CRM — a CRM for solo founders](assets/solocrm-banner.svg)

# Solo CRM

A CRM for solo founders. Client, project, contact and revenue tracking for a
one-person consultancy — local-first, no account, no server, no telemetry.

**Status:** planning. No application code yet.

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
