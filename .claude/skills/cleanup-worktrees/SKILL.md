---
name: cleanup-worktrees
description: Remove agent worktrees under .claude/worktrees/ whose branches are merged and clean, unlink their node_modules junctions safely, prune git's worktree list and delete the merged task branches. Use after any parallel subagent run, when the user says "clean up worktrees", or when .claude/worktrees/ is growing.
---

# Clean up worktrees

Worktrees exist to parallelise a run, not to persist. Run this the same day
they are used.

```
npm run cleanup:worktrees            # report only
npm run cleanup:worktrees -- --apply # remove what the report calls safe
```

`scripts/cleanup-worktrees.mjs` does the work. For each worktree it checks
that the branch is merged into `main` and the tree is clean. A worktree that
fails either check is listed and left alone; tell the user which and why.

## Why a script and not `git worktree remove`

On Windows each worktree's `node_modules` is a **junction** to the main
checkout's install. `git worktree remove` and a recursive delete both follow
the junction and delete the shared `node_modules` for every checkout on the
machine. The script removes the junction with a non-recursive `rmdir` first,
confirms `node_modules` is gone, and only then removes the directory and runs
`git worktree prune`.

With `--apply` it also deletes local branches named `T-*` that are merged into
`main`. The commits are on `main`; the branch name adds nothing.

Report what was removed, what was kept, and the space freed.
