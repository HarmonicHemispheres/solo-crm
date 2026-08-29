# ADR-010 — A polymorphic attachment is cascaded with its entity, by trigger

- **Status:** accepted
- **Date:** 2026-08-29
- **Task:** T-260828-41
- **Supersedes nothing. Settles:** the open question `links.ts` (T-260828-55)
  and `links.ts`'s `deleteLink` header both defer to this task — "what happens
  to a link when its entity disappears", and its create-side twin, "may a link
  name an entity that does not exist".

## Context

Three tables reference an entity polymorphically — `entity_type` +
`entity_id`, no foreign key, because no single-table foreign key can span
`companies`, `people` and `engagements`:

| table | written by | rows today |
| --- | --- | --- |
| `links` | `links.ts` (T-260828-48), `seed/index.ts` | yes — every seeded company carries links |
| `taggings` | nothing yet | no |
| `external_refs` | nothing yet (P4 integrations) | no |

SQLite therefore enforces nothing on either side of the reference, and neither
does the repository layer:

- **Delete side.** `deleteCompany`/`deletePerson`/`deleteEngagement` run
  `refuseIfReferenced` over every *real* foreign key pointing at the row. None
  of these three tables holds one, so a successful delete strands their rows
  silently — not even a raw `SQLITE_CONSTRAINT` error. A seeded database
  reaches this state on the first company delete.
- **Create side.** `addLink` accepts any `entityId` string that parses. A typo
  creates a link no view can reach.

The two are one question. Answering only the delete side would leave
`addLink` free to recreate the orphan a second later.

## Decision

**Cascade.** When a company, person or engagement is deleted, its `links`,
`taggings` and `external_refs` rows are deleted in the same transaction. And
symmetrically: a `links` row may not be created (or repointed) to name an
entity that does not exist.

**Both halves are enforced by triggers in migration 0004, not by code in each
repository.**

- `trg_companies_attachments_ad`, `trg_people_attachments_ad`,
  `trg_engagements_attachments_ad` — `AFTER DELETE`, three `DELETE`s each.
- `trg_links_entity_exists_bi` / `_bu` — `BEFORE INSERT` / `BEFORE UPDATE OF
  entity_type, entity_id`, `RAISE(ABORT)` when no parent row matches.

`referential-guard.ts` holds the TypeScript declaration of which attachment
tables exist and which entity type each parent carries, and its test asserts a
trigger exists for every (parent, attachment) pair — so adding a fourth
attachment table fails a test rather than being silently uncovered.

## Why cascade rather than refuse

Refusing is what this schema already does for every real foreign key, so
symmetry argues for it. It was rejected on three counts:

1. **A refusal has to be actionable, and this one would not be.** A refusal
   sentence names what blocks the delete so the user can clear it — "3 tasks
   reference this company". Of the three attachment tables, only `links` is
   ever shown to a user. `taggings` and `external_refs` are bookkeeping; a
   company that could not be deleted because of an `external_refs` row written
   by a Stripe sync the user did not know ran is a dead end, not a safeguard.
2. **These are attachments, not records.** A link is a property *of* a
   company, the way `notes` is — it has no meaning once the company is gone,
   and nothing else in the app references it. That is the case where a foreign
   key would have been declared `ON DELETE CASCADE`, and the only reason it
   is not one is that SQLite cannot express a foreign key with three possible
   parents. The polymorphic shape is a limitation of the storage engine; it
   should not change the semantics.
3. **Refusing does not actually prevent the loss.** Every entity delete this
   app allows is already gated behind `refuseIfReferenced` for the references
   that matter. By the time a delete is permitted, the user has decided the
   entity is going. Making them delete its links one at a time first deletes
   the same data with more steps.

The data-loss risk this task's Risks section names is real and is accepted
deliberately, not by default: **deleting an entity destroys its links, tags and
external references, with no undo.** That is what this ADR records. The
mitigation is upstream, in the refusal gates that make an entity delete rare in
the first place, not in a second confirmation nobody would read.

## Why a trigger rather than a call in each `deleteX`

The scope asked for the cascade "in the shared refusal helper so all six
repositories inherit it rather than each remembering". A trigger is the
stronger form of the same intent:

- It cannot be forgotten. A seventh repository added next month inherits it
  without knowing it exists — which is exactly the failure mode
  `refuseIfReferenced` was extracted to prevent, one level down.
- It covers writers that are not repositories. `seed/index.ts` deletes and
  reseeds; the timelog and Stripe importers (P4) will write and delete rows
  without going through a `deleteX`. A TypeScript helper covers none of them.
- It runs inside the deleting statement's own transaction by construction, so
  "in the same transaction" is a property of SQLite rather than a convention
  each caller has to keep. `deleteCompany` already wraps its pre-check and
  delete in `db.transaction()`; the cascade is inside that too.

The cost is that the cascade is not visible in the repository source. That is
paid for by the declaration in `referential-guard.ts` and the test that ties it
to the installed triggers, and by this ADR.

## Consequences

- `addLink` can now fail with a `RefusalError` (`reason: 'unknown-entity'`)
  where it previously always succeeded. That is a behaviour change for any
  caller that was passing an unchecked id.
- The three composite `(entity_type, entity_id)` indexes migration 0004 adds
  are not optional: without them each cascade is a full scan of all three
  attachment tables.
- A `links` row whose `entity_type` is NULL or an unrecognised string can no
  longer be created, and any that already exist are left alone by the cascade
  rather than swept up by whichever parent delete ran last. Migration 0004
  does not delete pre-existing rows of that shape — a migration that quietly
  removed user data would be the loss this ADR is careful about, arriving by
  the back door.
