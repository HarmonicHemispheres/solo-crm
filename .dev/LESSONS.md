# Lessons

At most twenty lines. Each is something a check cannot enforce; anything a
check can enforce becomes a check and is deleted from here. `npm run
check:index` fails past twenty. Past twenty, the new line displaces the least
useful old one, and that is a deliberate judgement made in the same commit.

1. jsdom computes no layout. A width, overflow or visibility assertion there measures nothing; open the app.
2. A test that asserts the mechanism (bytes written, header set) can pass over garbage output. Assert the result.
3. A source-scanning test must strip comments first, or it matches prose. This has bitten three times.
4. A timeout is not a failure until it reproduces alone on a quiet machine.
5. Never revert a mutation with `git checkout <file>`; it discards every uncommitted edit in that file too.
6. Never edit a source file through PowerShell 5.1 `Get-Content`/`-replace`; it silently corrupts UTF-8.
7. Stage by explicit path. `git add -A` has committed a user's own file once.
8. On Windows, `git worktree remove` deletes through a node_modules junction into the shared install. Remove the junction first.
9. `security-review` invoked bare diffs against `origin/main`, which is far behind local `main`. Point it at a range.
10. A scope written from an assumption about a tool, not from running it, has been wrong every time it was checked. Run the tool while scoping.
11. Two changes each green alone can fail together. The full suite runs once, on the final tree, before close.
12. A UTC-midnight date compared against a local clock is off by a day west of UTC from about 17:00.
13. A partial update that does not name a column can silently NULL it. Diff against what the form was seeded with, not the record.
