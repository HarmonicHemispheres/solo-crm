import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's auto-cleanup relies on detecting a global test
// framework; this project doesn't set vitest's `globals: true`, so it's
// wired by hand instead — otherwise a component left mounted by one test
// would still be in the document for the next one.
afterEach(cleanup)
