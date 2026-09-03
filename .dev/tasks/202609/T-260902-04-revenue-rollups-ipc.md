---
id: T-260902-04
title: Revenue rollup queries and their IPC channel — three attributions, four metrics, one SUM
status: done
category: data
plan_ref: P3-06
created: 2026-09-02
closed: 2026-09-02
---

## Why

§6.7 wants the same totals attributed by billing party, by end client and
by model, plus four metrics — recurring monthly, fixed backlog, T&M run
rate, concentration — and a twelve-month series split projected/actual.
ADR-003 says each is the canonical query with a different join and group
key. This task writes them once, in main, and exposes them over one typed
channel so the view (T-260902-05) computes nothing.

## Story

As the operator, switching the rollup changes who the money is attributed
to and never the total; the four metrics agree with the chart to the cent.

## Constraints

- No `billing_model` branch outside the generator; the model rollup groups
  by `revenue_lines.kind` and the engagement's model column only as a
  `GROUP BY` key, never an `if`.
- End clients contribute under *end client* and never as a payer under
  *billing party* (§6.2).
- Money stays integer cents on the wire (`centsSchema`); months are
  `periodMonthSchema`.
- `architecture-review` and the batched `security-review` (new IPC).

## Acceptance

- [x] `revenue:summary` returns metrics, the twelve-month series by kind and
      status, and rows for the requested rollup, validated by zod.
- [x] The three rollups' totals are equal to the cent on the seeded fixture.
- [x] Concentration is the largest payer's share of YTD and is unchanged
      across rollup switches.
- [x] §8: the summary over 10× the fixture completes under 100ms in a test.
- [x] `npm test` green; nothing visible yet.

## Related

`repositories/` (new `revenue.ts`), `shared/` (new `revenue.ts`),
`main/ipc/registry.ts`, `shared/ipc-types.ts`, `renderer/lib/query-keys.ts`
(a `revenue` entity), T-260902-03.

---

## Outcome

Built with -03, -05 and -06; see -03's Outcome for the session.

**Changed:** `repositories/revenue.ts` (`revenueSummary`, `fiscalYearStart`);
`shared/revenue.ts`'s summary schema; one channel, `revenue:summary`, in
`ipc-types.ts`, `channel-names.ts`, `registry.ts` and `stub-crm.ts`; a
`revenue` query-key entity. `invalidate.engagements`, `.milestones` and
`.settings` fold the `revenue` prefix in — main regenerates or re-reads the
summary inside those writes — pinned by a test.

**Departed from scope:** Three things.

1. The response carries all three rollups, and the request carries no
   rollup. They are three cheap `GROUP BY`s over the same lines; one
   payload means the view's toggle is a lookup and Today's tiles share the
   entry (efficiency review). "Same totals" is then one set of `totals`
   against three row sets, asserted for each.
2. YTD runs from `workspace.fiscalYearStartMonth`, which existed and was
   read by nothing.
3. The join to `engagements` is a `LEFT JOIN`, so a line with no engagement
   groups under `'none'` rather than vanishing from the table while
   staying in the tiles; and every share is clamped to `[0, 1]`, since an
   expense line is negative and a share past one failed the wire schema
   and took the page down (two review findings).

**Not verified:** The batched `security-review` over the new IPC surface is
owed, with T-260902-02's and -09's.

**Elapsed:** see -03.
