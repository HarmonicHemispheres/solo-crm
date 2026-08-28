import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Stat } from './Stat'

describe('Stat', () => {
  it('default tone renders a plain .stat with a plain .v', () => {
    const { container } = render(<Stat label="Open todos" value={12} />)
    expect(container.querySelector('.stat')?.className).toBe('stat')
    expect(container.querySelector('.v')?.className).toBe('v')
  })

  it('hero tone marks the card, not just the value — ui-design.md: gold marks exactly one hero value per view, worth flagging on the prop since nothing here can enforce that', () => {
    const { container } = render(<Stat label="Recurring / month" value="$8,300" tone="hero" />)
    expect(container.querySelector('.stat')?.className).toBe('stat hero')
    expect(container.querySelector('.v')?.className).toBe('v')
  })

  it('good/bad tone colours only the value, not the card border', () => {
    const { container } = render(<Stat label="Integrity" value="ok" tone="good" />)
    expect(container.querySelector('.stat')?.className).toBe('stat')
    expect(container.querySelector('.v')?.className).toBe('v good')
  })

  it('renders meta and chart slots when given', () => {
    const { container, getByText } = render(
      <Stat label="Fixed backlog" value="$4,200" meta="unbilled milestones" chart={<svg data-testid="spark" />} />
    )
    expect(getByText('unbilled milestones')).toBeTruthy()
    expect(container.querySelector('.spark svg')).toBeTruthy()
  })
})
