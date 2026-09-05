import { TimelineEntrySheet } from './TimelineEntrySheet'

export interface TodoSheetProps {
  onClose: () => void
}

/**
 * `.sheet` content for `FORMS.todo` (planning/solo-crm-mockup.html) — now the
 * shared timeline form, opened on its todo half.
 *
 * The form this file used to hold offered a title, a due date, three
 * references and a state. A todo now carries the same six facts an event does
 * (`electron/shared/timeline.ts`), which left this and `TimelineEntrySheet`
 * differing by exactly one field — the type selector — so the two collapsed
 * into one rather than being kept in step by hand. This file survives as the
 * name `LayerManager`'s `SheetKind` switch and the command palette both
 * already know: `openSheet('todo')` still means "the new-todo form", it just
 * resolves to a form that can also write the other half if the operator
 * changes their mind mid-entry.
 *
 * `isNextStep` still has no field, for the reason it never did:
 * `createTaskInputSchema` excludes it entirely — a task becomes the next step
 * only through `tasks:setNextStep` — so there is nothing here to write even
 * though `FORMS.todo`'s own "Mark as" chip suggests otherwise.
 */
export function TodoSheet({ onClose }: TodoSheetProps) {
  return <TimelineEntrySheet onClose={onClose} initialType="todo" />
}
