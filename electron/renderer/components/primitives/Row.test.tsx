import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Row } from './Row'

describe('Row', () => {
  it('without actions, renders as a single clickable <button> — the mockup\'s .row is always a plain button', () => {
    const onClick = vi.fn()
    const { container } = render(<Row onClick={onClick} title="Acme Co" subtitle="every 14d" />)
    const button = container.querySelector('button.row') as HTMLButtonElement
    expect(button).toBeTruthy()
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('with actions, keeps the navigable content and the actions as siblings rather than nesting a <button> inside a <button> (invalid HTML, and would double-fire clicks)', () => {
    const onClick = vi.fn()
    const { container } = render(
      <Row
        onClick={onClick}
        title="Acme Co"
        actions={<button aria-label="Remove">×</button>}
      />
    )
    const hitButton = container.querySelector('.row-hit') as HTMLElement
    expect(hitButton.tagName).toBe('BUTTON')
    // the action button must not be a descendant of the row-hit button
    expect(hitButton.querySelector('button')).toBeNull()

    const removeButton = screen.getByRole('button', { name: 'Remove' })
    expect(hitButton.contains(removeButton)).toBe(false)
  })
})
