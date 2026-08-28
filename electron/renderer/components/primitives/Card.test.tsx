import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('header with a count chip', () => {
    render(
      <Card>
        <Card.Header title="Going quiet" count={4} />
      </Card>
    )
    expect(screen.getByText('Going quiet')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('header with actions (also covers the legend case — a legend is just content in the same slot)', () => {
    render(
      <Card>
        <Card.Header title="Revenue" actions={<span data-testid="legend">recurring · fixed</span>} />
      </Card>
    )
    expect(screen.getByTestId('legend')).toBeTruthy()
  })

  it('supports more than one header+body section inside one card, like the dashboard\'s "Next up" + "Linked systems" card', () => {
    const { container } = render(
      <Card>
        <Card.Header title="Next up" count={2} />
        <div>todo rows</div>
        <Card.Header title="Linked systems" />
        <div>link rows</div>
      </Card>
    )
    const headers = container.querySelectorAll('.card-h')
    expect(headers).toHaveLength(2)
    expect(headers[0].textContent).toContain('Next up')
    expect(headers[1].textContent).toContain('Linked systems')
  })
})
