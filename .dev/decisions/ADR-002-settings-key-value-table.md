---
id: ADR-002
title: Workspace settings live in one key/value table, exempt from the UUID key rule
status: accepted
date: 2026-08-28
---

## Context

§6.11 asks the workspace to remember identity (name, operator, currency, fiscal
year start), a default cadence per company kind, integration toggles with
per-source status, the nightly backup toggle and its target folder, and
appearance preferences. §6.13 adds card-or-list mode remembered *per view*.
Requirements §5 has no table for any of it.

The mockup keeps the lot in module-level JavaScript, which is why its view
toggles reset on reload. That is fine for a mockup and unusable in the product.

What these values have in common is that they are a dozen-odd unrelated scalars
with no relationships to anything, set once by one operator, and that the list
grows by one every time a preference is added. §6.13 guarantees the growth: a new
view means a new remembered mode.

Against that sits the AGENTS.md rule that **every table gets a UUID primary key
and `created_at` / `updated_at`**, bought deliberately so a later Turso/libSQL
sync is a drop-in. A table keyed by name conflicts with the first half of it, so
the exemption has to be stated rather than assumed.

## Decision

One table:

```sql
settings (
  key        text primary key,
  value      text not null,   -- json
  updated_at timestamp not null
)
```

The rules that go with it:

1. **`value` is JSON**, so a setting can be a scalar, a list or a small object
   without a migration.
2. **The renderer never reads raw rows.** The repository layer (P2-01) exposes
   one typed accessor per setting, and the accessor owns its key, its zod schema
   and its default. An unknown key or a value that fails its schema reads as the
   default rather than throwing.
3. **Keys are declared in one module.** A key composed at a call site is a
   defect, because it makes "what settings exist" unanswerable by grep.
4. **`settings` is the one table exempt from the UUID primary key rule.** The key
   *is* the identity. A surrogate UUID would permit two rows both claiming
   `appearance.density`, with no answer to which one is live. It keeps
   `updated_at`, because last-write-wins is exactly what a future replica needs,
   and omits `created_at`, because a setting has no creation event worth
   recording — its default was in force before the row existed.
5. **No secret may ever be stored here.** See ADR-004, which states that rule as
   a property of this table rather than as a note about Stripe.

Requirements §5 is amended as of 2026-08-28 to carry the table.

## Consequences

**Easier.** Adding a preference is a new accessor and a default — no migration,
no DDL, no new IPC channel. Given §6.13, preferences will be added for the life
of the project.

**Easier.** The whole workspace configuration exports in the nightly JSON backup
(§8) as one small table, and by ADR-004 it can never carry a credential, so the
export needs no redaction step.

**Harder — no database-level typing.** `value` is text. A malformed row is caught
at the accessor, not by SQLite. That is precisely why the accessor and not the
caller owns the schema and the default; a caller that parses `value` itself has
moved the type into the wrong place.

**Harder — no foreign keys.** "Default cadence for `kind = client`" cannot
reference a kinds table, because kinds are an enum comment in §5, not rows. The
accessor validates the key set instead. Accepted; nothing else wants to point at
a setting.

**Cost — a magic-string key space.** Mitigated by rule 3, but it is a real cost:
the compiler cannot tell you that `appearance.compact` was renamed.

**Forecloses per-setting history.** Writing overwrites; the previous value is
gone. Nothing in §6.11 asks for history, and `updated_at` answers the only
question anyone has actually needed ("when did this last change").

## Alternatives

**A single-row `workspace` table with a typed column per setting.** Lost because
§6.13's remembered view mode is per view, so the column list grows with every
view added. It would become the most-migrated table in the schema, and each
migration would exist to store one enum with two values.

**A JSON file in `userData` beside the database.** Lost because it is a second
store to keep consistent, and the nightly export (§8) copies *tables*. Settings
would silently fall out of every backup — a failure nobody notices until a
restore, which is the worst time to find out.

**`localStorage` in the renderer.** Lost because §4 makes the renderer a
consumer, not a source of truth; it touches no storage the main process does not
mediate. It also puts the operator's configuration outside the backup and
outside the database entirely.

**Per-domain tables — `integration_settings`, `appearance_settings`, and so on.**
Lost because it multiplies tables to hold a dozen scalars that one person sets
once, and each still needs its own accessor. The grouping is real, but it is a
naming convention on keys, not a schema.

**Give `settings` a UUID primary key with a unique index on `key`, keeping the
AGENTS.md rule uniform.** Lost because the rule buys sync-readiness, and a text
primary key that is globally unique by construction is already sync-ready. No
other table references a setting, so there is no foreign key wanting a stable
surrogate — the UUID would add nothing except a second way for the table to hold
two rows for the same key.
