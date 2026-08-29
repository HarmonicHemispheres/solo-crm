/**
 * A single-parent chain walk, shared by the seed loader's
 * `orderCompaniesForInsert` (`seed/index.ts`) and the companies repository's
 * `billed_via_company_id` / `introduced_by_company_id` cycle guard
 * (T-260828-42, `repositories/companies.ts`). Both walk a chain where a node
 * names at most one parent and both must refuse — not hang, not silently
 * misorder — when the chain loops back on itself. T-260828-42's Scope is
 * explicit that this must be ONE traversal both callers use, not two
 * hand-rolled ones free to drift; this module is that one traversal.
 *
 * `walkChain` is deliberately generic over `Node` rather than tied to a row
 * shape or an id string: the seed loader walks `CompanySeed` objects looked
 * up by fixture `key` (a company's real database id does not exist yet at
 * seed time), while the repository walks bare `id` strings resolved with a
 * live query. Both instantiate the same function.
 */

/** A generous runaway guard, not a policy — see T-260828-42's Risks. No real
 *  billing arrangement in this app nests anywhere close to this deep; this
 *  bound exists purely so a pre-existing bad chain already sitting in an old
 *  database cannot make the walk itself hang. */
export const MAX_CHAIN_DEPTH = 50

export class ChainCycleError<Node> extends Error {
  constructor(
    /** The node at which the walk revisited an id already seen earlier on this same walk. */
    readonly node: Node,
    message: string
  ) {
    super(message)
    this.name = 'ChainCycleError'
  }
}

export class ChainDepthExceededError<Node> extends Error {
  constructor(
    readonly start: Node,
    readonly maxDepth: number
  ) {
    super(`chain walk from the starting node exceeded ${maxDepth} steps without terminating`)
    this.name = 'ChainDepthExceededError'
  }
}

/**
 * Walks the parent chain starting at `start`, following `getParent` until it
 * returns `null` (the root — no parent). Returns the visited nodes in walk
 * order, starting with `start` itself.
 *
 * Throws `ChainCycleError` the instant the walk would revisit a node already
 * seen earlier on *this* walk — the shape a two-step cycle (A's parent is B,
 * B's parent is A) and a longer one both take, detected the moment it closes
 * rather than by comparing full chains after the fact. Throws
 * `ChainDepthExceededError` if the chain has not terminated after `maxDepth`
 * steps, so a pre-existing bad chain this walk did not create — one already
 * sitting in an old database, say — cannot hang the walk itself; that bound
 * fires before cycle detection ever needs to for a chain that is merely very
 * long rather than actually looping.
 *
 * `identity` turns a node into the string `Set` needs to compare by — a
 * fixture `key` for the seed loader's in-memory walk over `CompanySeed`, a
 * plain database id for the repository's DB-backed walk.
 */
export function walkChain<Node>(
  start: Node,
  getParent: (node: Node) => Node | null,
  identity: (node: Node) => string,
  maxDepth: number = MAX_CHAIN_DEPTH
): readonly Node[] {
  const chain: Node[] = [start]
  const seen = new Set<string>([identity(start)])
  let current = start

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const parent = getParent(current)
    if (parent === null) return chain

    const parentKey = identity(parent)
    if (seen.has(parentKey)) {
      throw new ChainCycleError(parent, `chain walk loops back to a node already seen ("${parentKey}")`)
    }
    seen.add(parentKey)
    chain.push(parent)
    current = parent
  }

  throw new ChainDepthExceededError(start, maxDepth)
}
