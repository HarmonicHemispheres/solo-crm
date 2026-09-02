import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, type ButtonProps } from './Button'

describe('Button', () => {
  it('renders a real <button type="button"> — Enter/Space activation and the global focus ring come free, and it never accidentally submits a form', () => {
    render(
      <Button variant="primary" onClick={() => {}}>
        Save
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('variant="primary" renders exactly "btn btn-prim" — the class string the mockup pairs with .btn-prim, byte for byte', () => {
    render(<Button variant="primary">Create</Button>)
    expect(screen.getByRole('button', { name: 'Create' }).className).toBe('btn btn-prim')
  })

  it('variant="ghost" renders exactly "btn btn-ghost"', () => {
    render(<Button variant="ghost">Cancel</Button>)
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe('btn btn-ghost')
  })

  it('does not compile without a variant — there is no variantless button, because bare "btn" sets no background and no colour and renders light text on the user agent\'s white ButtonFace', () => {
    // @ts-expect-error `variant` is required — omitting it is the bug
    // T-260901-01 closed. If this stops erroring, npm run typecheck fails on
    // the unused directive rather than letting a colourless button ship.
    const noVariant: ButtonProps = { children: 'Plain' }
    expect(noVariant).toBeTruthy()
  })

  it('forwards native button props — disabled, onClick, aria-* — the way the raw markup it replaces did', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" onClick={onClick} aria-expanded={false} aria-haspopup="menu">
        New
      </Button>
    )
    const button = screen.getByRole('button', { name: 'New' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    button.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled renders the native attribute (styled by .btn:disabled, not a class toggle)', () => {
    render(
      <Button variant="primary" disabled>
        Create
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('forwards a ref to the underlying <button> — NewMenu focuses its trigger back through this ref after a sheet closes', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} variant="primary">
        New
      </Button>
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'New' }))
  })

  it('variant="danger" renders exactly "btn btn-danger"', () => {
    // T-260902-09's third variant. It exists for one control — the confirm
    // button in `ConfirmDelete` — because `.claude/rules/ui-design.md` names
    // destructive confirmation as a place a text label is required, and a
    // delete-everything button that looks like Cancel is the one mistake in
    // this app that cannot be undone.
    render(<Button variant="danger">Delete all 4</Button>)
    expect(screen.getByRole('button', { name: 'Delete all 4' }).className).toBe('btn btn-danger')
  })

  it('does not compile with a variant the mockup does not have — the acceptance test for the closed union is a type error, not a renders-unstyled fallback', () => {
    // The example used to be 'danger', which T-260902-09 made real. The
    // property under test is unchanged and is not about any particular word:
    // the union is closed, so a variant nobody declared is a compile error
    // rather than a button that renders unstyled (T-260901-01's actual bug).
    // @ts-expect-error 'subtle' is not a member of ButtonVariant — if this
    // stops erroring, npm run typecheck fails on the unused directive
    // instead of silently passing.
    const bad: ButtonProps = { children: 'Maybe', variant: 'subtle' }
    expect(bad).toBeTruthy()
  })
})
