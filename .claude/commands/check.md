---
description: Typecheck, lint changed files, run unit tests and theme checks
allowed-tools: Bash(npx tsc --noEmit:*), Bash(npx eslint:*), Bash(bun test:*), Bash(bun run test:*), Bash(bun run check:theme), Bash(bun run check:chat-media), Bash(git status:*), Bash(git diff:*)
---

Run the SerikaCord pre-handoff checks and report the results.

1. List the files changed relative to HEAD, staged and unstaged, plus
   untracked ones: `git status --porcelain` and `git diff --name-only HEAD`.
   Keep only `.ts`, `.tsx`, `.js`, `.mjs` files that still exist.
2. Typecheck the project: `npx tsc --noEmit -p tsconfig.json`. It must report
   zero errors.
3. Lint only the changed source files: `npx eslint <files>`. Pre-existing
   errors in files you did not touch are not yours, but report any error on a
   line you changed.
4. Unit tests: `bun run test` (runs `bun test tests`, no DB or network).
5. If any changed file is a component, page or CSS file, run
   `bun run check:theme` and `bun run check:chat-media` (both need `rg`).
6. Scan the diff (`git diff HEAD`) for: user-facing strings not wrapped in
   `gt()` / `<T>` (or `gt()` called with a non-literal), hard-coded hex colors
   for theme roles, `console.log`, and new `find`/`findOne` filter keys that
   the model's switch doesn't handle.

Report a short table: check, result, details. Don't fix anything unless
$ARGUMENTS says to. Note: the owner may have uncommitted work in the tree;
attribute findings only to files the current task touched.
