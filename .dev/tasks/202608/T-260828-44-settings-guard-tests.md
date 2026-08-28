---
id: T-260828-44
title: Make the settings credential guard's test actually guard it
status: open
category: data
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

ADR-004 keeps credentials out of the `settings` table so the nightly JSON backup
(X-04) can never leak one. T-260828-25 built the guard and it works. Its test
does not.

Review proved it by mutation: deleting `secret`, `password`, `passphrase`,
`credential`, `credentials` and `clientsecret` from `FORBIDDEN_KEY_WORDS` leaves
all 27 tests green. The test that looks like it covers this **re-declares the
word list as its own regex literal**, so it verifies its own copy rather than the
constant the runtime uses. Weaken the real list and nothing goes red.

That is the same class of defect as T-260828-20's — a test that exercises the
mechanism but never the integration — except here it sits on top of a security
constraint, where the whole point is that it holds when someone later has a
reason to loosen it.

Two smaller gaps from the same review belong with it, since all three are "the
guarantee is real but nothing pins it".

## Scope

**In:**

- Rewrite the credential-guard test to assert against `FORBIDDEN_KEY_WORDS`
  itself rather than a re-declared literal, so removing a word from the constant
  fails the suite. Drive the cases from the constant.
- Add a test that every registered key is checked — the guard is worthless if a
  key can be added to `SETTINGS_REGISTRY` without passing through
  `assertNoSecretKeys`.
- Pin the integration toggle keys to `INTEGRATION_SOURCES` the way the cadence
  keys are already pinned to `COMPANY_KINDS`. Today `INTEGRATION_SOURCES` and
  `IntegrationSource` are declared and used nowhere, and the three toggle keys
  are hand-listed, so adding a fourth source silently gets no key. The asymmetry
  with the cadence keys is the defect.
- Replace the `as never` cast in acceptance criterion 3's type-level test with a
  real compile-time assertion — an expect-error style check that fails to compile
  if `key` is widened to `string`. Today the cast typechecks trivially, so if a
  later refactor widens the key type (likely pressure from T-260828-26, where the
  key arrives as `unknown`), the runtime `ValidationError` still fires, all tests
  pass, `npm run typecheck` passes, and the type guarantee is gone with no signal.

**Out:** Any change to the guard's behaviour or to the word list itself — the
runtime is correct, this task is about the tests that are supposed to hold it.
Adding the "per-source status" keys §6.11 mentions (last synced at, last error);
ADR-004 permits them but they belong to the P4 adapter tasks that need them.
`safeStorage` credential handling (P4-01).

## Touches

- `electron/main/db/repositories/settings.test.ts`
- `electron/shared/settings.ts` — only to wire `INTEGRATION_SOURCES` into the
  registry keys; no behaviour change

## Acceptance

- [ ] Deleting any single word from `FORBIDDEN_KEY_WORDS` makes the suite fail —
      verified by actually doing it, and stated in the outcome
- [ ] Adding a key named e.g. `stripe.apiSecret` to `SETTINGS_REGISTRY` fails the
      suite
- [ ] Adding a fourth entry to `INTEGRATION_SOURCES` without a matching registry
      key fails the suite, mirroring the existing `COMPANY_KINDS` guard
- [ ] Widening `getSetting`'s `key` parameter to `string` fails `npm run
      typecheck` — verified by trying it
- [ ] No test re-declares a constant the runtime already owns

## Risks

- **Testing the test.** The acceptance criteria above are all "mutate the source
  and confirm red". Do the mutations, confirm, revert — and record in the
  outcome that they were actually run, since this whole task exists because a
  test was believed rather than checked.
- **A compile-time assertion that does not assert.** `@ts-expect-error` passes
  silently if the error moves to a different line. Prefer a type-level
  equality check that fails loudly.
