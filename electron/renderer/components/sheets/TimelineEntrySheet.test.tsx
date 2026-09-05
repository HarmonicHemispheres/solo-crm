import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { TimelineEntrySheet } from './TimelineEntrySheet'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** A full `taskSchema`-shaped row — `window.crm` is typed, so a mocked `tasks:create` response has to satisfy it even though these tests only assert on what was *sent*. */
const STUB_TASK_ROW = {
  id: 'new-task',
  title: 'stub',
  body: null,
  kind: 'task',
  status: null,
  isNextStep: false,
  occurredAt: null,
  dueOn: null,
  waitingSince: null,
  doneAt: null,
  companyId: null,
  engagementId: null,
  personId: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

/** The same, `activitySchema`-shaped, for `activity:log`. */
const STUB_ACTIVITY_ROW = {
  id: 'new-activity',
  occurredAt: '2026-08-28T00:00:00.000Z',
  kind: 'note',
  title: 'stub',
  body: null,
  dueOn: null,
  companyId: null,
  personId: null,
  engagementId: null,
  source: 'manual' as const,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

const COMPANY = {
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

function renderSheet(
  initialType: 'event' | 'todo' = 'event',
  overrides: Parameters<typeof stubCrm>[0] = {},
  onClose = vi.fn()
) {
  window.crm = stubCrm(overrides)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TimelineEntrySheet onClose={onClose} initialType={initialType} />
    </QueryClientProvider>
  )
  return { onClose }
}

function createTaskSpy() {
  return vi.fn(async (input: unknown) => {
    void input
    return { ok: true as const, data: { ok: true as const, data: STUB_TASK_ROW } }
  })
}

function logActivitySpy() {
  return vi.fn(async (input: unknown) => {
    void input
    return { ok: true as const, data: { ok: true as const, data: STUB_ACTIVITY_ROW } }
  })
}

describe('TimelineEntrySheet', () => {
  it('offers the same six fields on both halves — only the state chip is a todo’s alone', async () => {
    renderSheet('event')

    for (const label of [
      'Short description',
      'Full description',
      'Date — when it happened',
      'Due — when it should happen',
      'Company',
      'Person',
      'Engagement'
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByRole('group', { name: 'Category' })).toBeTruthy()
    // An `activity` row has no lifecycle to be in — G8.
    expect(screen.queryByRole('group', { name: 'State' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Todo' }))
    await waitFor(() => expect(screen.getByRole('group', { name: 'State' })).toBeTruthy())
    for (const label of ['Short description', 'Full description', 'Date — when it happened', 'Due — when it should happen']) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it('writes a todo through tasks:create with every one of the shared fields', async () => {
    const create = createTaskSpy()
    renderSheet('todo', { 'tasks:create': create, 'companies:list': vi.fn(async () => ({ ok: true as const, data: [COMPANY] })) })

    fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Send the countersigned SOW' } })
    fireEvent.change(screen.getByLabelText('Full description'), { target: { value: 'Two copies, both initialled.' } })
    fireEvent.change(screen.getByLabelText('Due — when it should happen'), { target: { value: '2026-09-15' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Meeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on them' }))

    const companySelect = screen.getByLabelText('Company') as HTMLSelectElement
    await waitFor(() => expect(within(companySelect).getByText('Acme Co')).toBeTruthy())
    fireEvent.change(companySelect, { target: { value: 'co-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      title: 'Send the countersigned SOW',
      body: 'Two copies, both initialled.',
      kind: 'meeting',
      status: 'waiting',
      // A todo opens undated — it is usually about the future — so nothing
      // was typed here and nothing is sent.
      occurredAt: null,
      dueOn: '2026-09-15',
      companyId: 'co-1',
      engagementId: null,
      personId: null
    })
  })

  it('writes an event through activity:log, dated today, with the due date it was given', async () => {
    const log = logActivitySpy()
    renderSheet('event', { 'activity:log': log })

    fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Kickoff call' } })
    fireEvent.change(screen.getByLabelText('Due — when it should happen'), { target: { value: '2026-09-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    const sent = log.mock.calls[0][0] as Record<string, unknown>
    expect(sent.title).toBe('Kickoff call')
    expect(sent.dueOn).toBe('2026-09-20')
    expect(sent.source).toBe('manual')
    expect(sent.body).toBeNull()
    // Today's entry carries a real instant, not that day's midnight — see the
    // component's `happenedAtTimestamp`.
    expect(typeof sent.occurredAt).toBe('string')
    expect(sent.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('refuses an event with no date, names the field, and keeps the sheet and its input', async () => {
    const log = logActivitySpy()
    const { onClose } = renderSheet('event', { 'activity:log': log })

    fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Something that happened' } })
    fireEvent.change(screen.getByLabelText('Date — when it happened'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Date is required for an event')
    expect(log).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Short description') as HTMLInputElement).value).toBe('Something that happened')
  })

  it('names the field on a missing short description and does not close the sheet or lose input', async () => {
    const create = createTaskSpy()
    const { onClose } = renderSheet('todo', { 'tasks:create': create })

    fireEvent.change(screen.getByLabelText('Due — when it should happen'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    // Against the field, under the label the form gives it (T-260828-53 item 2).
    expect(alert.textContent).toBe('Short description is required')
    const titleField = screen.getByLabelText('Short description')
    expect(titleField.getAttribute('aria-invalid')).toBe('true')
    expect(titleField.getAttribute('aria-describedby')).toBe(alert.id)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Due — when it should happen') as HTMLInputElement).value).toBe('2026-09-15')
  })

  it('offers the operator’s own categories, not a hardcoded four', async () => {
    window.crm = stubCrm({
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'timeline.kinds' as const, value: [{ id: 'follow-up', label: 'Follow up', tone: 'gold' as const }] }
      }))
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TimelineEntrySheet onClose={vi.fn()} initialType="todo" />
      </QueryClientProvider>
    )

    const group = await waitFor(() => screen.getByRole('group', { name: 'Category' }))
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Follow up' })).toBeTruthy())
    // The seeded defaults are gone because the operator removed them; nothing
    // in this form re-adds them.
    expect(within(group).queryByRole('button', { name: 'Meeting' })).toBeNull()
    // And the write files under the only category there is, not under the
    // `task` default that no longer exists.
    expect(within(group).getByRole('button', { name: 'Follow up' }).getAttribute('aria-pressed')).toBe('true')
  })
})
