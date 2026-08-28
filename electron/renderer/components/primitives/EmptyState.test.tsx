import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the message with no action wrapper when action is omitted', () => {
    const { container } = render(<EmptyState>Everyone is current.</EmptyState>)
    expect(screen.getByText('Everyone is current.')).toBeTruthy()
    expect(container.querySelector('.empty-action')).toBeNull()
  })

  it('renders the action slot below the message when given', () => {
    render(
      <EmptyState action={<button>Add one</button>}>
        No contacts.
      </EmptyState>
    )
    expect(screen.getByRole('button', { name: 'Add one' })).toBeTruthy()
  })
})
