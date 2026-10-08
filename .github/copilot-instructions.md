# Copilot instructions for SerikaCord

Full guide: [`CLAUDE.md`](../CLAUDE.md) (architecture, conventions, gotchas) and
[`AGENTS.md`](../AGENTS.md). Deep dives: [`docs/architecture/`](../docs/architecture/).

Critical rules:

- The Postgres and Redis used by canary are **production data shared with
  prod**. No destructive SQL, no `drizzle-kit push`/`migrate`. Schema changes
  are additive and idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) in
  `drizzle/manual_*.sql` plus `src/lib/db/schema.ts`.
- Never test in public servers or with real users.
- Don't push, tag or rewrite history; `canary` is the dev branch and
  auto-deploys. Don't stash, reset or commit the owner's uncommitted work.
- Wrap user-facing strings in `gt("literal")` / `<T>`; use theme CSS
  variables, not hex colors.
- Channels and DMs share `useChatSession` + `MessageList`; publish live events
  with `publishToChannel` / `publishToDm`; non-user message creators call
  `signalChannelMessage` / `signalDmMessage`; realtime registries use
  `processShared()`.
- Model `find`/`findOne` ignore unknown filter keys silently: add the `case`
  first.
- Before finishing: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <files>`,
  `bun run test`, and a `## Unreleased` entry in `CHANGELOG.md` for
  user-visible changes.
