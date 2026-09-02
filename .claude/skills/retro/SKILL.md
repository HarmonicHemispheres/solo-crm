---
name: retro
description: After a task closes, ask one question — did anything go wrong that a check could catch? — and turn the answer into a check, or one line in .dev/LESSONS.md, or nothing. Use at the end of build-task, or when the user says "retro", "what did we learn", "add a lesson".
---

# Retro

One question: **did anything go wrong in this task that the next session
would otherwise repeat?**

If nothing did, say so in one line and stop. Most tasks end here.

If something did, it gets exactly one of three treatments, in this order of
preference:

1. **It can be a check.** A test, a lint rule, a line in
   `scripts/check-task-index.mjs`, a hook. Write the check now, in this
   session, and cite the incident in a one-line comment beside it. Nothing
   goes in prose.
2. **It cannot be a check.** One line in [.dev/LESSONS.md](../../../.dev/LESSONS.md),
   phrased as the thing to do, not the story of what happened. The file holds
   at most twenty; `check:index` fails past that. If it is full, the new line
   displaces the least useful old one, and you say which and why.
3. **Neither.** It was not worth recording.

**Never add a paragraph to a skill, a rule, AGENTS.md or .dev/README.md
because of one incident.** That is how the previous process grew to eleven
thousand words. A rule earns its place in those files only after the same
lesson has been displaced from LESSONS.md and come back.

Report the treatment chosen in one line.
