import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { ConfirmDelete } from './ConfirmDelete'
import type { DeletionImpact } from '../../../shared/deletion'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/**
 * The confirmation in front of every delete (T-260902-09).
 *
 * The dialog's whole job is to state, accurately, what pressing the red
 * button will destroy. Everything below is about that one property: the
 * numbers on screen, the number on the button, and the fact that nothing is
 * deleted until the button is pressed.
 */

const IMPACT: DeletionImpact = {
  entity: 'company',
  id: 'ez',
  name: 'EZDeploy',
  entries: [
    { label: 'todos', count: 3, action: 'delete' },
    { label: 'activity records', count: 1, action: 'delete' },
    { label: 'engagements', count: 3, action: 'delete' },
    { label: 'companies that bill through it', count: 2, action: 'clear' }
  ]
}

function renderConfirm(impact: DeletionImpact = IMPACT, overrides: Parameters<typeof stubCrm>[0] = {}, onDeleted = vi.fn()) {
  const crm = stubCrm({
    'companies:deleteImpact': vi.fn(async () => ({ ok: true as const, data: impact })),
    ...overrides
  })
  window.crm = crm
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ConfirmDelete entity="company" id={impact.id} name={impact.name} onClose={onClose} onDeleted={onDeleted} />
    </QueryClientProvider>
  )
  return { crm, onClose, onDeleted }
}

describe('ConfirmDelete', () => {
  it('lists every attached record, and counts ROWS on the button, not lines in the list', async () => {
    // The bug this pins, found by driving the real app: the button read
    // "Delete all 4" — one per *entry* — over a list adding up to seven
    // rows. A confirmation that under-states what it destroys is worse than
    // no confirmation, because the operator has been told a number by the
    // app itself. 3 + 1 + 3 attached, plus the company = 8.
    renderConfirm()

    await screen.findByText('todos')
    expect(screen.getByRole('button', { name: 'Delete all 8' })).toBeTruthy()
  })

  it('keeps the unlinked records out of the delete count and under their own heading', async () => {
    // "2 companies that bill through it" survive — they lose a pointer. They
    // are listed, because it is a consequence, but they are not in the 8:
    // saying otherwise would claim the operator is losing two companies.
    renderConfirm()

    await screen.findByText('companies that bill through it')
    expect(screen.getByText('This would also delete:')).toBeTruthy()
    expect(screen.getByText('These would be kept, and unlinked:')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete all 8' })).toBeTruthy()
  })

  it('deletes nothing until the button is pressed, and then passes cascade', async () => {
    const del = vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'ez' } } }))
    const { onDeleted, onClose } = renderConfirm(IMPACT, { 'companies:delete': del })

    await screen.findByText('todos')
    // The dialog has been open and fully rendered, and nothing has happened.
    expect(del).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete all 8' }))

    // `cascade: true` is what separates this from the refusing delete every
    // other caller gets. It is set here and nowhere else.
    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 'ez', cascade: true }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('will not delete before the impact has arrived', async () => {
    // Nobody agrees to a list they have not been shown. The confirm button
    // is disabled until the counts are on screen — with a never-resolving
    // impact read, it stays that way.
    const del = vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'ez' } } }))
    window.crm = stubCrm({
      'companies:deleteImpact': vi.fn(() => new Promise<never>(() => {})),
      'companies:delete': del
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ConfirmDelete entity="company" id="ez" name="EZDeploy" onClose={vi.fn()} />
      </QueryClientProvider>
    )

    const confirm = await screen.findByRole('button', { name: 'Delete' })
    // `toBeDisabled` is jest-dom's; this project does not load it (see
    // test-setup.ts, which wires cleanup and nothing else).
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm)
    expect(del).not.toHaveBeenCalled()
    // And it still names its subject, from the prop, rather than showing a
    // dialog about nothing while it waits.
    expect(screen.getByText('EZDeploy')).toBeTruthy()
  })

  it('a record nothing points at gets no list at all', async () => {
    renderConfirm({ entity: 'company', id: 'lonely', name: 'Lonely Co', entries: [] })

    await screen.findByText('Nothing else references it. This cannot be undone.')
    expect(screen.queryByText('This would also delete:')).toBeNull()
    // No count to put on the button when nothing else is going.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('shows a refusal from main instead of closing as though it worked', async () => {
    const del = vi.fn(async () => ({
      ok: true as const,
      data: { ok: false as const, error: { code: 'refused' as const, message: 'Cannot delete "EZDeploy": the database is read-only.' } }
    }))
    const { onClose } = renderConfirm(IMPACT, { 'companies:delete': del })

    await screen.findByText('todos')
    fireEvent.click(screen.getByRole('button', { name: 'Delete all 8' }))

    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('read-only'))
    // Still open, with the message — a dialog that closed here would look
    // exactly like a successful delete.
    expect(onClose).not.toHaveBeenCalled()
  })
})
