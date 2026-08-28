import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Ring } from './Ring'

describe('Ring', () => {
  it('sets stroke-dashoffset to the final value on first render — nothing animates it from a 0% start in JS, so removing the CSS transition under prefers-reduced-motion leaves the correct arc, not an empty one', () => {
    const { container } = render(<Ring pct={0.5} size={40} color="var(--verdigris)" />)
    const circles = container.querySelectorAll('circle')
    const progress = circles[1]
    // The mockup's formula, restated independently: r = size/2 - 3 (constant
    // inset, NOT minus strokeWidth — that drift is what this test catches).
    const r = 40 / 2 - 3
    const circumference = 2 * Math.PI * r
    expect(progress.getAttribute('stroke-dashoffset')).toBe(String(circumference * 0.5))
  })

  it('renders empty, not full, for a non-finite pct — missing data is maximally stale (ADR-001), never "healthy"', () => {
    const { container } = render(<Ring pct={Number.NaN} size={40} color="var(--verdigris)" />)
    const progress = container.querySelectorAll('circle')[1]
    const circumference = 2 * Math.PI * (40 / 2 - 3)
    expect(progress.getAttribute('stroke-dashoffset')).toBe(String(circumference))
  })

  it('clamps pct above 1 to a full ring (dashoffset 0)', () => {
    const { container } = render(<Ring pct={1.4} size={40} color="var(--verdigris)" />)
    const progress = container.querySelectorAll('circle')[1]
    expect(progress.getAttribute('stroke-dashoffset')).toBe('0')
  })

  it('is decorative (aria-hidden) when nothing names what it measures', () => {
    const { container } = render(<Ring pct={0.5} size={40} color="var(--verdigris)" />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('exposes an accessible name instead when aria-label is given', () => {
    const { container } = render(<Ring pct={0.5} size={40} color="var(--verdigris)" aria-label="Cadence health" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-label')).toBe('Cadence health')
  })
})
