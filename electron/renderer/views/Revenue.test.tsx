import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Revenue } from './Revenue'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

describe('Revenue (T-260902-01)', () => {
  it('renders the view header and says why the body is empty, instead of a bare heading', () => {
    render(<Revenue />)
    expect(screen.getByRole('heading', { level: 1, name: 'Revenue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'About this view' })).toBeTruthy()
    expect(screen.getByText(/has not been built/)).toBeTruthy()
  })

  // ADR-003: no revenue figure is computed off engagement columns anywhere
  // but the generator, and this view reads nothing at all until
  // T-260902-05 replaces it with reads of `revenue_lines`. A `window.crm`
  // that throws on any access is the check: a stray `engagements:list` to
  // sum something from would fail the render, not pass quietly.
  it('reads nothing — any window.crm access fails the render', () => {
    window.crm = new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`Revenue read window.crm.${String(prop)} — this view must not read data yet (ADR-003)`)
        }
      }
    ) as never
    expect(() => render(<Revenue />)).not.toThrow()
    expect(screen.getByRole('heading', { level: 1, name: 'Revenue' })).toBeTruthy()
  })
})
