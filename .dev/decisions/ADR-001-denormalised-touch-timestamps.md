---
id: ADR-001
title: Touch timestamps are denormalised columns on companies and people
status: accepted
date: 2026-08-28
---

## Context

Cadence health is the reason the Today view exists (§6.1), and the decay ring is
the app's central motif. Both need one number per company: how long since the
last touch. Nothing in the requirements §5 schema holds it.

Everything else already assumes it does:

- §7 specifies the Gmail adapter writing `companies.last_touch` and
  `people.last_contact`.
- The mockup's table registry selects `last_touch` and `last_contact`
  (`planning/solo-crm-mockup.html:844-845`).
- `decay()` (`:982`) is `days(c.lastTouch) / c.cadence`, and the Today "going
  quiet" list, the company cards, the company detail header and the command
  palette hint all render its output.

The obvious alternative is to derive the value as `MAX(activity.occurred_at)`
per company and store no column at all. That works only if every touch produces
an activity row, and one source cannot produce one: §7 has Gmail pulling **a
last-contacted timestamp only, no message bodies**. There is no message to build
an activity row from, and §6.8 makes `activity` an append-only log a human reads.

This decision is recorded because it denormalises deliberately, which looks like
an oversight to anyone reading the schema cold.

## Decision

`companies.last_touch_at` and `people.last_contact_at` are real columns —
ISO-8601 UTC `TEXT`, nullable, null meaning never touched rather than touched
long ago.

The rules that go with them:

1. **The repository layer maintains them on `activity` insert**, in the same
   transaction. An activity row naming a company or a person advances that row's
   timestamp when the new `occurred_at` is later than what is stored. This is
   already scoped as P1-05.
2. **The timestamp never retreats.** Activity cannot be deleted (G8), and a
   backdated entry logged after the fact does not make a relationship staler
   than it is.
3. **The Gmail adapter writes the columns directly**, without creating an
   activity row.
4. **No query derives staleness from `MAX(activity.occurred_at)`.** Staleness is
   `now - last_touch_at` measured against that company's `cadence_days`.
5. The column is the source of truth for *cadence*. `activity` is the source of
   truth for *what happened*. Neither is a cache of the other, and they are
   allowed to differ.

Requirements §5 is amended as of 2026-08-28 to carry both columns.

## Consequences

**Easier.** The Today "going quiet" query is one indexed scan over `companies`
with no join and no per-company aggregate. §8 budgets any view at under 100ms at
ten times current volume; a correlated `MAX` over `activity` for every company on
the app's most-opened view is the first thing that would miss it.

**Easier.** Gmail integrates without inventing rows. The activity feed stays a
list of things that actually happened, which is the only reason it is worth
reading.

**Easier.** Logging a touch resets the cadence clock (§6.9) as a single write in
a transaction that is already open, so `⌘L` stays inside its five-second budget.

**Harder — two writers.** The activity repository and the Gmail adapter both
write the column. They can disagree with the contents of `activity`, and that is
by design. Code that treats `last_touch_at` as a cache of the activity table
will be wrong about every emailed contact.

**Harder — a forgettable update path.** Any future code that inserts activity by
some other route silently stops the ring moving. The failure mode is a stale
number, not an error. Insertion must go through the activity repository, which is
what G8 requires anyway.

**Forecloses an exact rebuild.** "Recompute last touch from history" is not a
repair that can be run, because the Gmail-sourced values have no history to
recompute from. The best a rebuild can do is
`MAX(last_touch_at, MAX(activity.occurred_at))` — it can only move the value
forward, never correct one that is too recent.

## Alternatives

**Derive it from `MAX(activity.occurred_at)`.** Lost because the Gmail adapter
(§7) supplies a timestamp with no message body, so there is no activity row to
hang it on. The derived value would silently ignore email — the single largest
source of contact in this business — and the ring would show a client as going
quiet on the day they replied. It also costs a per-company aggregate on the
hottest view in the app.

**Derive it, and have Gmail write synthetic activity rows.** Lost because §7
forbids pulling message bodies and §6.8 makes `activity` append-only. Every
synthetic row would be a permanent, titleless, bodiless entry in a log the
operator reads daily. It degrades a user-facing surface to avoid two columns.

**A trigger-maintained cadence table, or a materialised view.** Lost because it
is the same denormalisation with a second table and a trigger to keep correct,
and SQLite has no materialised views. Two columns on tables that already exist
are strictly cheaper than a third table that exists only to hold them.

**Compute in the renderer from a loaded activity list.** Lost twice over: it
fails §8's performance requirement at ten times data volume, and it means
shipping the whole activity table across the IPC boundary to draw one ring.
