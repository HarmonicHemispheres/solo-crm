import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { TodoSheet } from './TodoSheet'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** A full `taskSchema`-shaped row — `window.crm` is typed, so a mocked `tasks:create` response has to satisfy it even though these tests only assert on what was *sent*. */
const STUB_TASK_ROW = {
  id: 'new-task',
  title: 'stub',
  status: null,
  isNextStep: false,
  dueOn: null,
  waitingSince: null,
  doneAt: null,
  companyId: null,
  engagementId: null,
  personId: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}) {
  window.crm = stubCrm(overrides)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TodoSheet onClose={onClose} />
    </QueryClientProvider>
  )
  return { onClose }
}

describe('TodoSheet', () => {
  it('writes exactly the columns its footer claims, field for field', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_TASK_ROW } }
    })
    renderSheet(vi.fn(), { 'tasks:create': create })

    fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: 'Send the countersigned SOW' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      title: 'Send the countersigned SOW',
      status: 'todo',
      dueOn: null,
      companyId: null,
      engagementId: null,
      personId: null
    })
  })

  it('picks up a due date, a non-default state, and every optional link', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_TASK_ROW } }
    })
    const company = {
      id: 'co-1',
      name: 'Acme Co',
      kind: null,
      website: null,
      billsDirectly: true,
      billedViaCompanyId: null,
      introducedByPersonId: null,
      cadenceDays: null,
      lastTouchAt: null,
      notes: null,
      since: null,
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z'
    }
    renderSheet(vi.fn(), {
      'tasks:create': create,
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [company] }))
    })

    fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: 'Follow up' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on them' }))

    const companySelect = screen.getByLabelText('Company') as HTMLSelectElement
    await waitFor(() => expect(within(companySelect).getByText('Acme Co')).toBeTruthy())
    fireEvent.change(companySelect, { target: { value: 'co-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      title: 'Follow up',
      status: 'waiting',
      dueOn: '2026-09-15',
      companyId: 'co-1',
      engagementId: null,
      personId: null
    })
  })

  it('names the field on a validation failure and does not close the sheet or lose input', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'tasks:create': create })

    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    // Against the field, under the label the form gives it (T-260828-53 item 2).
    expect(alert.textContent).toBe('What needs doing is required')
    const titleField = screen.getByLabelText('What needs doing')
    expect(titleField.getAttribute('aria-invalid')).toBe('true')
    expect(titleField.getAttribute('aria-describedby')).toBe(alert.id)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Due') as HTMLInputElement).value).toBe('2026-09-15')
  })
})
