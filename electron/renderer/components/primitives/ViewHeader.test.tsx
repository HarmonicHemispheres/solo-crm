import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ViewHeader } from './ViewHeader'

describe('ViewHeader', () => {
  it('renders the title and, without a description, no info button', () => {
    render(<ViewHeader icon={<svg />} accent="var(--verdigris)" title="Today" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'About this view' })).toBeNull()
  })

  it('toggles the info popover open/closed, with aria-expanded tracking state', () => {
    render(
      <ViewHeader icon={<svg />} accent="var(--verdigris)" title="Today" description="What this view shows." />
    )
    const infoButton = screen.getByRole('button', { name: 'About this view' })
    expect(infoButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('What this view shows.')).toBeNull()

    fireEvent.click(infoButton)
    expect(infoButton.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('What this view shows.')).toBeTruthy()

    fireEvent.click(infoButton)
    expect(infoButton.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the popover on Escape', () => {
    render(
      <ViewHeader icon={<svg />} accent="var(--verdigris)" title="Today" description="What this view shows." />
    )
    fireEvent.click(screen.getByRole('button', { name: 'About this view' }))
    expect(screen.getByText('What this view shows.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('What this view shows.')).toBeNull()
  })

  it('renders the actions slot', () => {
    render(
      <ViewHeader
        icon={<svg />}
        accent="var(--verdigris)"
        title="Revenue"
        actions={<button>Roll up by model</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Roll up by model' })).toBeTruthy()
  })
})
