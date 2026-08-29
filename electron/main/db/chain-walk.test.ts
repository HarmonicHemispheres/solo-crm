import { describe, expect, it } from 'vitest'
import { ChainCycleError, ChainDepthExceededError, MAX_CHAIN_DEPTH, walkChain } from './chain-walk'

/**
 * `walkChain` tested as the primitive it is, NOT through a repository
 * (T-260828-56's Risks are explicit about this). Going through
 * `createCompany` reproduces coverage that already exists in
 * `repositories/companies.test.ts` and misses the branch that matters: the
 * repository's own `chain.includes(selfId)` check and the depth bound between
 * them cover every case those tests exercise, so the `seen.has(...)` throw
 * could be replaced with dead code and the whole suite stayed green.
 *
 * The fixture below is a plain string -> string parent map, so a cycle can be
 * built directly at whatever length a case needs and `maxDepth` can be passed
 * explicitly where the point is the bound rather than the default.
 */

/** Builds the `getParent`/`identity` pair `walkChain` takes from a plain parent map. */
function chainOver(parents: Readonly<Record<string, string | null>>) {
  const getParent = (node: string): string | null => parents[node] ?? null
  const identity = (node: string): string => node
  return { getParent, identity }
}

/** `a -> b -> c -> ... -> null`, `length` nodes, no cycle. Returns the map and the deepest node to start a walk from. */
function linearChain(length: number): { parents: Record<string, string | null>; leaf: string } {
  const parents: Record<string, string | null> = {}
  for (let i = 0; i < length; i += 1) {
    parents[`n${i}`] = i === 0 ? null : `n${i - 1}`
  }
  return { parents, leaf: `n${length - 1}` }
}

describe('walkChain: chains that terminate', () => {
  it('returns just the start when it has no parent', () => {
    const { getParent, identity } = chainOver({ a: null })
    expect(walkChain('a', getParent, identity)).toEqual(['a'])
  })

  it('returns the nodes in walk order, start first and root last', () => {
    const { getParent, identity } = chainOver({ a: 'b', b: 'c', c: null })
    expect(walkChain('a', getParent, identity)).toEqual(['a', 'b', 'c'])
  })

  it('accepts a chain far deeper than any repository test builds, so tightening the cap into a policy fails here', () => {
    // The repository's own tests build chains of three. A cap lowered from 50
    // to, say, 4 would leave those green while quietly turning a runaway
    // guard into a business rule about how deep a billing arrangement may
    // nest — the exact risk T-260828-42 named. This case is what notices.
    const deep = MAX_CHAIN_DEPTH - 5
    expect(deep).toBeGreaterThan(10)
    const { parents, leaf } = linearChain(deep)
    const { getParent, identity } = chainOver(parents)

    const chain = walkChain(leaf, getParent, identity)
    expect(chain).toHaveLength(deep)
    expect(chain[0]).toBe(leaf)
    expect(chain[chain.length - 1]).toBe('n0')
  })

  it('accepts a chain exactly at the bound — maxDepth steps, the last of which reaches the root', () => {
    // `maxDepth` bounds calls to `getParent`, and reaching the root costs one
    // more call than there are edges — so a chain of exactly `maxDepth` nodes
    // is the longest that terminates. One node more and it throws; the next
    // describe asserts that side.
    const { parents, leaf } = linearChain(6)
    const { getParent, identity } = chainOver(parents)
    expect(walkChain(leaf, getParent, identity, 6)).toHaveLength(6)
  })
})

describe('walkChain: a cycle is reported as a cycle, not as depth exceeded', () => {
  it('throws ChainCycleError on a two-node cycle, well before maxDepth', () => {
    const { getParent, identity } = chainOver({ a: 'b', b: 'a' })

    let thrown: unknown
    try {
      walkChain('a', getParent, identity, MAX_CHAIN_DEPTH)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ChainCycleError)
    expect(thrown).not.toBeInstanceOf(ChainDepthExceededError)
  })

  it('throws ChainCycleError on a three-node cycle at the step that closes it, not after 50 steps', () => {
    const { getParent, identity } = chainOver({ a: 'b', b: 'c', c: 'a' })

    // A generous maxDepth: if the cycle branch were dead, this would run to
    // the bound and throw the wrong error instead.
    let thrown: unknown
    try {
      walkChain('a', getParent, identity, MAX_CHAIN_DEPTH)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ChainCycleError)
    expect(thrown).not.toBeInstanceOf(ChainDepthExceededError)
    expect((thrown as Error).message).not.toContain(String(MAX_CHAIN_DEPTH))
  })

  it('detects a cycle even when maxDepth is far larger than the loop', () => {
    // The distinguishing case: with maxDepth 1000 a 3-cycle can only be
    // caught by `seen`, never by the bound. Replace the `seen.has(...)` throw
    // with nothing and this hangs until the bound, then fails.
    const { getParent, identity } = chainOver({ a: 'b', b: 'c', c: 'a' })
    expect(() => walkChain('a', getParent, identity, 1000)).toThrow(ChainCycleError)
  })

  it("names the repeated node in ChainCycleError.node and in the message", () => {
    // The walk starts at `x`, reaches the loop at `a`, and closes back onto
    // `a` — so the repeated node is `a`, not the node the walk started from.
    const { getParent, identity } = chainOver({ x: 'a', a: 'b', b: 'c', c: 'a' })

    let thrown: unknown
    try {
      walkChain('x', getParent, identity, MAX_CHAIN_DEPTH)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ChainCycleError)
    expect((thrown as ChainCycleError<string>).node).toBe('a')
    expect((thrown as Error).message).toContain('"a"')
  })

  it('throws ChainCycleError when the start node is its own parent', () => {
    const { getParent, identity } = chainOver({ a: 'a' })

    let thrown: unknown
    try {
      walkChain('a', getParent, identity, MAX_CHAIN_DEPTH)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ChainCycleError)
    expect((thrown as ChainCycleError<string>).node).toBe('a')
  })
})

describe('walkChain: a long acyclic chain is reported as depth exceeded, not as a cycle', () => {
  it('throws ChainDepthExceededError one node past the bound, carrying the start and the bound', () => {
    const { parents, leaf } = linearChain(MAX_CHAIN_DEPTH + 1)
    const { getParent, identity } = chainOver(parents)

    let thrown: unknown
    try {
      walkChain(leaf, getParent, identity, MAX_CHAIN_DEPTH)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ChainDepthExceededError)
    expect(thrown).not.toBeInstanceOf(ChainCycleError)
    const error = thrown as ChainDepthExceededError<string>
    expect(error.start).toBe(leaf)
    expect(error.maxDepth).toBe(MAX_CHAIN_DEPTH)
  })

  it('honours an explicit maxDepth smaller than the default', () => {
    const { parents, leaf } = linearChain(10)
    const { getParent, identity } = chainOver(parents)
    expect(() => walkChain(leaf, getParent, identity, 3)).toThrow(ChainDepthExceededError)
  })
})

describe('walkChain: identity, not object equality, decides "already seen"', () => {
  it('detects a cycle between distinct objects that share an identity', () => {
    // The seed loader walks `CompanySeed` objects keyed by fixture `key`, so
    // the same logical node can arrive as two different object references.
    interface Node {
      readonly key: string
      readonly parentKey: string | null
    }
    const rows: Node[] = [
      { key: 'a', parentKey: 'b' },
      { key: 'b', parentKey: 'a' }
    ]
    // Fresh object per lookup on purpose: reference equality would miss this.
    const getParent = (node: Node): Node | null => {
      if (!node.parentKey) return null
      const found = rows.find((row) => row.key === node.parentKey)
      return found ? { ...found } : null
    }

    expect(() => walkChain({ ...rows[0] }, getParent, (node) => node.key, MAX_CHAIN_DEPTH)).toThrow(
      ChainCycleError
    )
  })
})
