import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'electron/**/*.test.tsx'],
    environment: 'node'
  }
})
