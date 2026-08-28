import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Toast } from './Toast'

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('has no "show" class and no message while hidden', () => {
    const { container } = render(<Toast message={null} onDismiss={() => {}} />)
    const toast = container.querySelector('.toast') as HTMLElement
    expect(toast.className).not.toContain('show')
  })

  it('shows the message and self-dismisses after the given duration', () => {
    const onDismiss = vi.fn()
    const { container, getByText } = render(<Toast message="Saved" onDismiss={onDismiss} durationMs={2500} />)
    const toast = container.querySelector('.toast') as HTMLElement
    expect(toast.className).toContain('show')
    expect(getByText('Saved')).toBeTruthy()

    vi.advanceTimersByTime(2499)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
