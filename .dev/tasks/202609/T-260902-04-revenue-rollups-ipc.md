---
id: T-260902-04
title: Revenue rollup queries and their IPC channel — three attributions, four metrics, one SUM
status: open
category: data
plan_ref: P3-06
created: 2026-09-02
closed:
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

- [ ] `revenue:summary` returns metrics, the twelve-month series by kind and
      status, and rows for the requested rollup, validated by zod.
- [ ] The three rollups' totals are equal to the cent on the seeded fixture.
- [ ] Concentration is the largest payer's share of YTD and is unchanged
      across rollup switches.
- [ ] §8: the summary over 10× the fixture completes under 100ms in a test.
- [ ] `npm test` green; nothing visible yet.

## Related

`repositories/` (new `revenue.ts`), `shared/` (new `revenue.ts`),
`main/ipc/registry.ts`, `shared/ipc-types.ts`, `renderer/lib/query-keys.ts`
(a `revenue` entity), T-260902-03.
