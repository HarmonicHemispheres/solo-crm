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

## Query keys (TanStack Query)

Requirements §4 treats IPC as a fetch layer so caching and invalidation come
free from TanStack Query rather than every view holding its own copy of
`window.crm` data. That only works if every query and mutation agrees on how
a key is built — enforced by [`electron/renderer/lib/query-keys.ts`](electron/renderer/lib/query-keys.ts),
which this section explains.

- **Every key is a tuple: `[entity, scope, id?]`.** `entity` is the domain
  noun a channel answers about (`'companies'`, `'todos'`, `'app'`) and
  matches that channel's namespace in
  [`electron/shared/ipc-types.ts`](electron/shared/ipc-types.ts)'s
  `CHANNEL_CONTRACTS`, not a UI grouping. `scope` says what shape of answer
  within that entity — `'list'`, `'detail'`, `'summary'`, or, for a
  singleton channel like the proof channels, the channel's own name
  (`'version'`, `'schemaVersion'`). `id` is present only when `scope`
  addresses one record; it is omitted entirely rather than passed as
  `undefined` for list/summary/singleton scopes, so a key never has a
  trailing `undefined` some call sites include and others don't.
- **`entity` comes first because TanStack Query key matching is a prefix
  match.** `invalidateQueries({ queryKey: ['companies'] })` invalidates
  every key starting with `'companies'` — list, every detail, everything —
  in one call. That is the property `query-keys.ts`'s `invalidate` helpers
  rely on: `invalidate.app(queryClient)` invalidates `queryKeys.app.all()`
  (`['app']`), which covers `queryKeys.app.version()` today and whatever
  else joins the `app` entity later, with the call site never needing to
  know the exact longer tuple.
- **A mutation names what it invalidates via the per-entity helper, not the
  raw key.** `query-keys.ts` exports one `invalidate.<entity>(queryClient)`
  function per entity alongside the key factories, so a mutation's
  `onSuccess`/`onSettled` reads as "this touched the `app` entity" rather
  than reconstructing `['app']` (or worse, `['app', 'version']`, which would
  miss a sibling key added later) by hand. This applies to an optimistic
  mutation too: `ipc.ts`'s `optimisticUpdate` takes the invalidate helper as
  a required `reconcile` argument rather than invalidating its own single
  `queryKey` internally, for exactly this reason — an optimistic
  todo-completion that only reconciled `['todos', 'detail', id]` would leave
  `['todos', 'list']` showing the pre-completion state.
- **Build keys with the factory, never a literal array.** `queryKeys.app.version()`,
  not `['app', 'version']` typed out at the call site — the factory is the
  one place the shape can change.

## Query cache (TanStack Query)

[`electron/renderer/lib/query-client.ts`](electron/renderer/lib/query-client.ts)
configures the `QueryClient` every query and mutation runs through. The
defaults TanStack Query ships with assume a network that can be slow, drop,
or come back — none of which describes `window.crm.*`, a synchronous local
SQLite read through IPC (T-260828-09). Every default that assumption
produces is turned off or set deliberately instead of left implicit:

- **`staleTime: Infinity`.** The only writer to this cache is this app's own
  mutations, and every one of them names what it invalidates through
  `query-keys.ts`'s `invalidate` helpers above — so correctness comes from
  explicit invalidation, not from a clock guessing when data might have
  gone stale. The alternative extremes are both wrong for §8's 100ms-at-10×
  render budget: `staleTime: 0` would redo an IPC round trip (and a
  re-render) on every remount of a query that already has cached data —
  every navigation between views pays for work the data hasn't asked for.
  A short-but-nonzero `staleTime` looks safer but only trades one failure
  for another: it does nothing to prevent the "just-completed todo
  reappears" case this task's Risks section calls out, because that case is
  a missing invalidation, not a timing window a duration would close —
  and it *would* reintroduce the zero-case's wasted round trips once the
  window elapses. `Infinity` makes the tradeoff explicit instead of
  papering over a bug behind a duration nobody sized against evidence: if a
  view ever shows stale data, the fix is the mutation's missing
  `invalidate.<entity>()` call, not a smaller number here. A future
  background writer is not this task's problem but is a known gap this
  `staleTime` choice opens: **P4-01** (the sync framework) and its adapters
  write rows the renderer never asked to change — a pull-only sync landing
  new Stripe or Calendar data with nobody calling `invalidate.<entity>()`
  would sit in the cache unseen until the next unrelated invalidation. P4-01
  needs to invalidate the entities it touches itself, the same as any
  mutation does; see "What this file does not cover" below.
- **`refetchOnWindowFocus: false`, `refetchOnReconnect: false`.** Alt-tabbing
  back into the app is not "the network might have changed since I looked
  away" — there is no network, and `navigator.onLine` flapping (real even
  fully offline on some OSes) must not trigger a refetch cascade against a
  local file.
- **`retry: false`** for both queries and mutations. An IPC call to the
  local main process fails for a reason — a validation error, a repository
  throwing — that retrying does not fix (see `IpcErrorCode` in
  `electron/shared/ipc-types.ts`); retrying only delays the typed error
  [`electron/renderer/lib/ipc.ts`](electron/renderer/lib/ipc.ts)'s `callCrm`
  throws.

`ipc.ts`'s `IpcCallError` is what every query and mutation actually throws:
`callCrm` converts a `{ ok: false }` envelope into a real `Error` subclass
(`.message`, `.code`) before TanStack ever sees it, so a component reads
`error.message`, not a plain `{ code, message }` object stringified as
`[object Object]`.

## What this file does not cover

- **Currency selection and display** (§6.11 identity settings, P2-01) —
  which currency is configured and how a `_cents` value is rendered with a
  symbol is that task's problem, not this file's.
- **Locale-aware formatting** beyond the single configured currency.
- **Timezone handling for calendar events** (P4-06) — that task should read
  this file, not the other way around.
- **Cache invalidation for data a sync job writes, not a mutation** (P4-01
  and its adapters, P4-02/06/07) — `staleTime: Infinity` in "Query cache"
  above only stays correct because every writer to the cache currently is a
  renderer mutation that calls `invalidate.<entity>()`. P4-01 adds a writer
  that isn't a mutation at all; it owns deciding how the renderer finds out
  (a push channel, a poll, invalidating on next focus) rather than this file
  guessing ahead of that task.
