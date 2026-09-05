import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { PersonSheet } from './PersonSheet'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** Full `personSchema`/`affiliationSchema`-shaped rows — `window.crm` is typed, so a mocked response has to satisfy the schema even though these tests only assert on what was *sent*. */
const STUB_PERSON_ROW = {
  id: 'p-1',
  name: 'stub',
  email: null,
  phone: null,
  notes: null,
  lastContactAt: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

const STUB_AFFILIATION_ROW = {
  id: 'aff-1',
  personId: 'p-1',
  companyId: 'co-1',
  title: null,
  isPrimary: null,
  started: '2026-08-28',
  ended: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

const STUB_COMPANIES = [
  {
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
]

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}) {
  window.crm = stubCrm({ 'companies:list': vi.fn(async () => ({ ok: true as const, data: STUB_COMPANIES })), ...overrides })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PersonSheet onClose={onClose} />
    </QueryClientProvider>
  )
  return { onClose }
}

describe('PersonSheet', () => {
  it('writes exactly the columns its footer claims when no company is picked', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_PERSON_ROW } }
    })
    const addAffiliation = vi.fn()
    renderSheet(vi.fn(), { 'people:create': create, 'people:addAffiliation': addAffiliation })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({ name: 'Jane Doe', email: null, phone: null, notes: null })
    expect(addAffiliation).not.toHaveBeenCalled()
  })

  it('opens the first affiliation when a company is picked, carrying the title across', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_PERSON_ROW } }
    })
    const addAffiliation = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION_ROW } }
    })
    renderSheet(vi.fn(), { 'people:create': create, 'people:addAffiliation': addAffiliation })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@acme.com' } })

    const companySelect = screen.getByLabelText('Company') as HTMLSelectElement
    await waitFor(() => expect(within(companySelect).getByText('Acme Co')).toBeTruthy())
    fireEvent.change(companySelect, { target: { value: 'co-1' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Head of operations' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(addAffiliation).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({ name: 'Jane Doe', email: 'jane@acme.com', phone: null, notes: null })
    const affiliationInput = addAffiliation.mock.calls[0][0] as Record<string, unknown>
    expect(affiliationInput.personId).toBe('p-1')
    expect(affiliationInput.companyId).toBe('co-1')
    expect(affiliationInput.title).toBe('Head of operations')
    expect(typeof affiliationInput.started).toBe('string')
    expect(affiliationInput.started).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('retrying after addAffiliation fails resumes at the affiliation instead of creating a second person', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_PERSON_ROW } }
    })
    let addAffiliationAttempt = 0
    const addAffiliation = vi.fn(async (input: unknown) => {
      void input
      addAffiliationAttempt += 1
      if (addAffiliationAttempt === 1) {
        // The IPC envelope itself succeeded; the repository refused the
        // mutation — MutationResult's `{ ok: false }` branch, nested inside
        // a successful IpcResult, not the outer envelope's own error shape.
        return {
          ok: true as const,
          data: { ok: false as const, error: { code: 'refused' as const, message: 'that company no longer exists' } }
        }
      }
      return { ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION_ROW } }
    })
    const { onClose } = renderSheet(vi.fn(), { 'people:create': create, 'people:addAffiliation': addAffiliation })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } })
    const companySelect = screen.getByLabelText('Company') as HTMLSelectElement
    await waitFor(() => expect(within(companySelect).getByText('Acme Co')).toBeTruthy())
    fireEvent.change(companySelect, { target: { value: 'co-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(addAffiliation).toHaveBeenCalledTimes(1))
    await screen.findByRole('alert')
    expect(create).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    // Retry — the same person must not be created a second time.
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(addAffiliation).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(create).toHaveBeenCalledTimes(1)
    const secondAttemptPersonId = (addAffiliation.mock.calls[1][0] as Record<string, unknown>).personId
    expect(secondAttemptPersonId).toBe('p-1')
  })

  it('a second submit while the first is still in flight does not create a second person', async () => {
    // The `if (mutation.isPending) return` guard, tested directly. The Create
    // button's `disabled` is not what stops this: a form submit — the fast
    // double-Enter the guard was added for at review — never goes through
    // that button at all, so with the guard deleted `people:create` runs
    // twice and two rows land.
    let release: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      release = resolve
    })
    const create = vi.fn(async (input: unknown) => {
      void input
      await inFlight
      return { ok: true as const, data: { ok: true as const, data: STUB_PERSON_ROW } }
    })
    const { onClose } = renderSheet(vi.fn(), { 'people:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } })
    const form = document.querySelector('form.sheet-form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)

    release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('shows the new person in the people list even when the affiliation write fails after them', async () => {
    // `people:create` and `people:addAffiliation` are two IPC calls, not one
    // transaction: when the second fails the person row is already committed.
    // `useSheetMutation` only invalidates in `onSuccess`, so without
    // PersonSheet's own invalidation the list keeps its pre-create data and a
    // caller who cancels here cannot see a person who really exists
    // (T-260828-53 item 5).
    let stored: Array<typeof STUB_PERSON_ROW> = []
    const peopleList = vi.fn(async () => ({ ok: true as const, data: stored }))
    const create = vi.fn(async (input: unknown) => {
      void input
      stored = [{ ...STUB_PERSON_ROW, name: 'Jane Doe' }]
      return { ok: true as const, data: { ok: true as const, data: STUB_PERSON_ROW } }
    })
    const addAffiliation = vi.fn(async (input: unknown) => {
      void input
      return {
        ok: true as const,
        data: { ok: false as const, error: { code: 'refused' as const, message: 'that company no longer exists' } }
      }
    })

    function PeopleProbe() {
      const query = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
      return <div data-testid="people-list">{(query.data ?? []).map((person) => person.name).join(', ')}</div>
    }

    window.crm = stubCrm({
      'companies:list': vi.fn(async () => ({ ok: true as const, data: STUB_COMPANIES })),
      'people:list': peopleList,
      'people:create': create,
      'people:addAffiliation': addAffiliation
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PeopleProbe />
        <PersonSheet onClose={vi.fn()} />
      </QueryClientProvider>
    )

    await waitFor(() => expect(peopleList).toHaveBeenCalled())
    expect(screen.getByTestId('people-list').textContent).toBe('')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } })
    const companySelect = screen.getByLabelText('Company') as HTMLSelectElement
    await waitFor(() => expect(within(companySelect).getByText('Acme Co')).toBeTruthy())
    fireEvent.change(companySelect, { target: { value: 'co-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // The affiliation failed and the sheet stayed open — and the person who
    // was nonetheless created is on the list.
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByTestId('people-list').textContent).toBe('Jane Doe'))
  })

  it('names the field on a validation failure and does not close the sheet or lose input', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'people:create': create })

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    // Against the Name field, under the label the form gives it.
    expect(alert.textContent).toBe('Name is required')
    const nameField = screen.getByLabelText('Name')
    expect(nameField.getAttribute('aria-invalid')).toBe('true')
    expect(nameField.getAttribute('aria-describedby')).toBe(alert.id)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('jane@acme.com')
  })
})
