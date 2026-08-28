import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  const options = [
    { value: 'date', label: 'By date' },
    { value: 'client', label: 'By client' }
  ] as const

  it('marks the active option with aria-pressed and the mockup on class, and reports a click as onChange rather than owning the state itself', () => {
    const onChange = vi.fn()
    render(<Toggle options={options} value="date" onChange={onChange} aria-label="Group by" />)

    const active = screen.getByRole('button', { name: 'By date' })
    const inactive = screen.getByRole('button', { name: 'By client' })
    expect(active.getAttribute('aria-pressed')).toBe('true')
    expect(active.className).toContain('on')
    expect(inactive.getAttribute('aria-pressed')).toBe('false')

    inactive.click()
    expect(onChange).toHaveBeenCalledWith('client')
  })

  it('every option is a real button, so Tab/Enter/Space work without extra wiring', () => {
    render(<Toggle options={options} value="date" onChange={() => {}} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON')
    }
  })
})
