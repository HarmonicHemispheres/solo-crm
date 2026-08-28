import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Chip } from './Chip'

describe('Chip', () => {
  it('reflects selected as aria-pressed + the .on class', () => {
    render(<Chip selected>Client</Chip>)
    const chip = screen.getByRole('button', { name: 'Client' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.className).toContain('on')
  })

  it('a plain action chip (no selected prop) is not announced as a toggle', () => {
    render(<Chip onClick={() => {}}>Run</Chip>)
    const chip = screen.getByRole('button', { name: 'Run' })
    expect(chip.hasAttribute('aria-pressed')).toBe(false)
  })
})
