import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IconButton, type IconButtonProps } from './IconButton'

describe('IconButton', () => {
  it('renders a real <button> with the given aria-label — a real button is keyboard-focusable and Enter/Space-activatable by default, and picks up the global :focus-visible ring from base.css for free', () => {
    render(
      <IconButton aria-label="Copy path" onClick={() => {}}>
        <svg />
      </IconButton>
    )
    const button = screen.getByRole('button', { name: 'Copy path' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('does not compile without aria-label — the acceptance test for this is a type error, not a runtime one', () => {
    // @ts-expect-error aria-label is required on IconButtonProps — if this
    // stops erroring (e.g. someone makes it optional), `npm run typecheck`
    // fails on an unused `@ts-expect-error` directive instead of silently
    // passing.
    const missingLabel: IconButtonProps = { children: <svg /> }
    expect(missingLabel).toBeTruthy()
  })
})
