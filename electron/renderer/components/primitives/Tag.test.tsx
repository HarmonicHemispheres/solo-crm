import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tag } from './Tag'
import { ModelTag } from './ModelTag'

describe('Tag', () => {
  it('default variant adds no modifier class', () => {
    render(<Tag>Client</Tag>)
    expect(screen.getByText('Client').className).toBe('tag')
  })

  it('a variant adds its modifier class, matching the mockup\'s .tag.verd etc.', () => {
    render(<Tag variant="red">Late</Tag>)
    expect(screen.getByText('Late').className).toBe('tag red')
  })
})

describe('ModelTag', () => {
  it('carries the billing model as a modifier class', () => {
    render(<ModelTag model="retainer">Retainer</ModelTag>)
    expect(screen.getByText('Retainer').className).toBe('modeltag m-retainer')
  })
})
