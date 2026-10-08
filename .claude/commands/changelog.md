---
description: Add an Unreleased CHANGELOG.md entry for the current change
allowed-tools: Read, Edit, Bash(git diff:*), Bash(git log:*), Bash(git status:*)
---

Add a bullet for the current change under `## Unreleased` in `CHANGELOG.md`.

Change to describe: $ARGUMENTS (if empty, read `git diff HEAD` and the last
few `git log --oneline` entries for what this task changed).

Rules:
- Only user-visible changes (features, fixes, performance users can feel,
  security). Internal refactors, docs and tests don't get an entry.
- Put it in the right category under `## Unreleased`: `### Features`,
  `### Bug Fixes`, `### Performance`, `### Security`. Create the heading if it
  is missing, in that order. Don't touch released version sections.
- Match the existing style: `- **Short bold summary** — one or two plain
  sentences on what the user notices now.` Plain words, no internal file or
  function names unless a developer-facing change needs them. Append the issue
  key if there is one, e.g. `(CORD-12)`.
- If an existing Unreleased bullet already covers the area, extend it instead
  of adding a near duplicate.
- Security entries describe the fix, not how to exploit the old behavior.
- Don't bump versions and don't add a release section; releases are cut by
  the maintainer.

Show the final bullet(s) you added.
