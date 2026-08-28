# Conventions

Dates and money are represented one way everywhere in Solo CRM — main,
renderer, SQLite. The rules below are enforced, not just documented: the zod
primitives in [`electron/shared/types.ts`](electron/shared/types.ts) and the
helpers in [`electron/shared/format.ts`](electron/shared/format.ts) are the
enforcement. This file explains them; it does not stand in for them.

## The rules

- **Dates are ISO `TEXT`, `YYYY-MM-DD`.** No time component, no timezone —
  enforced by `dateOnlySchema`.
- **Timestamps are ISO-8601 UTC `TEXT`**, millisecond precision, always ending
  in `Z` — the exact format `Date#toISOString()` produces — enforced by
  `timestampSchema`.
- **SQLite must not default timestamps.** `CURRENT_TIMESTAMP` and
  `datetime('now')` produce `2026-08-28 10:15:00` — space separator, no `Z`, no
  milliseconds — which `timestampSchema` rejects. `created_at` / `updated_at`
  are written from JS via `nowTimestamp()`; if a SQL-side value is ever
  unavoidable, it is `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, never the default.
- **Money is integer cents, always.** A column holding money ends its name in
  `_cents` so a bare number is visibly suspect — enforced by `centsSchema`,
  which rejects any non-integer value.
- **`period_month` is the first day of the month, as a date.** `2026-08-01`,
  never `2026-08` or a day other than `01` — enforced by `periodMonthSchema`.
- **Durations and hours are `numeric`** — floating point, per §5's
  `time_entries.hours` — enforced by `hoursSchema`.
- **No `Date` object crosses the IPC boundary.** Serialise with
  `formatDateOnly` / `formatTimestamp` at the edge; a raw `Date` fails every
  schema above with a message saying so.

## Why hours are floating point and money is not

This looks like an inconsistency and is a deliberate one. `time_entries.hours`
is SQLite `REAL` — floating point — while every `_cents` column is an integer.
Money stays exact because [ADR-003](.dev/decisions/ADR-003-materialised-revenue.md)
requires `SUM(amount_cents) … GROUP BY` to agree to the cent across three
attributions; a float column would reintroduce the rounding ADR-003 exists to
rule out. Hours have no such requirement — 2.5 hours is a real, exact value,
and nothing sums hours the way §6.7 sums revenue. Do not "fix" this asymmetry
by making hours an integer (minutes) or money a float; both would contradict
the decision that put them where they are.

## What this file does not cover

- **Currency selection and display** (§6.11 identity settings, P2-01) —
  which currency is configured and how a `_cents` value is rendered with a
  symbol is that task's problem, not this file's.
- **Locale-aware formatting** beyond the single configured currency.
- **Timezone handling for calendar events** (P4-06) — that task should read
  this file, not the other way around.
