import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DecayMeter } from './DecayMeter'

describe('DecayMeter', () => {
  it('always renders the fill at its final width via --w, never an animated-from-zero state', () => {
    // This is what makes prefers-reduced-motion correct without a special
    // case per component: base.css's reduced-motion media query pins
    // `.decay .fill { width: var(--w) !important }`, which only produces
    // the right *meaning* (not just "no motion") because --w is always the
    // final percentage, computed here on every render rather than by a JS
    // animation loop that would otherwise start it at 0.
    const { container } = render(<DecayMeter pct={0.5} label="7d" />)
    const fill = container.querySelector('.fill') as HTMLElement
    expect(fill.style.getPropertyValue('--w')).toBe('50%')
  })

  it('clamps pct above 1 to a 100% fill', () => {
    const { container } = render(<DecayMeter pct={1.8} label="20d" />)
    const fill = container.querySelector('.fill') as HTMLElement
    expect(fill.style.getPropertyValue('--w')).toBe('100%')
  })

  it('picks ok/warn/late the same way the mockup does: <.7 ok, >=.7 warn, >=1 late', () => {
    expect(render(<DecayMeter pct={0.3} label="3d" />).container.querySelector('.decay')?.className).toContain('ok')
    expect(render(<DecayMeter pct={0.7} label="10d" />).container.querySelector('.decay')?.className).toContain('warn')
    expect(render(<DecayMeter pct={1} label="14d" />).container.querySelector('.decay')?.className).toContain('late')
  })

  it('shows the caller-supplied label as-is', () => {
    const { getByText } = render(<DecayMeter pct={0} label="today" />)
    expect(getByText('today')).toBeTruthy()
  })

  it('treats a non-finite pct as late, never ok — missing data is maximally stale (ADR-001)', () => {
    const { container } = render(<DecayMeter pct={Number.NaN} label="—" />)
    expect(container.querySelector('.decay')?.className).toContain('late')
    const fill = container.querySelector('.fill') as HTMLElement
    expect(fill.style.getPropertyValue('--w')).toBe('100%')
  })
})
