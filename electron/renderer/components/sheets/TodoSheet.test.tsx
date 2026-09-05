import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { TodoSheet } from './TodoSheet'

/**
 * What is left of this file after the two create forms merged: `TodoSheet` is
 * now a two-line wrapper, so the only fact it owns is *which half of the
 * shared form it opens on*. Everything the form itself does — the six fields,
 * the two channels, the refusals — is `TimelineEntrySheet.test.tsx`.
 *
 * This is worth its own test rather than being folded in there because
 * `openSheet('todo')` is what the command palette and six call sites already
 * say, and a wrapper that silently opened on the event half would send every
 * one of them to the wrong channel while still rendering a plausible form.
 */

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

describe('TodoSheet', () => {
  it('opens the shared timeline form on its todo half', () => {
    window.crm = stubCrm()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TodoSheet onClose={vi.fn()} />
      </QueryClientProvider>
    )

    expect(screen.getByRole('heading', { name: 'New todo' })).toBeTruthy()
    // The Todo type chip is the selected one, and the state field — which
    // only a todo has — is rendered.
    expect(screen.getByRole('button', { name: 'Todo' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'State' })).toBeTruthy()
  })
})
