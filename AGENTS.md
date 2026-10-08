# AGENTS.md

Instructions for any coding agent (Codex, Copilot, Cursor, Claude, Aider, ...)
working in SerikaCord. `CLAUDE.md` has the full architecture map, conventions
and gotchas; `docs/architecture/` has the deep dives. The rules below stand on
their own.

## Project in one paragraph

SerikaCord is a Discord-style chat app. A single Bun process (`server.ts`)
serves the bot WebSocket gateway (`/api/v10/gateway`), raw SSE streams
(`/api/channels/:id/stream`, `/api/dms/:id/stream`, `/api/users/@me/activity`),
the REST API (Elysia, `src/lib/api/*`, mounted at `/api`) and proxies every
other request to Next.js 16 (app router, built with webpack). Data is in
Postgres via Drizzle (`src/lib/db/schema.ts`, thin models in `src/lib/models`)
and Redis (cache, sessions, rate limits, cross-instance pub/sub). Media is on
Backblaze B2 behind `cdn.serika.chat`.

## Hard safety rules

- **The database and Redis are production data shared by canary and prod.**
  No destructive SQL, no `drizzle-kit push`/`migrate`, no ad-hoc writes. Don't
  connect to them unless the owner asked.
- **Schema changes must be additive and idempotent** (`CREATE TABLE IF NOT
  EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER
  TYPE ... ADD VALUE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`).
  Put them in `drizzle/manual_<name>.sql`, update `schema.ts`, and tell the
  owner to apply the file. Never drop or rewrite columns, tables or enums.
- **Never test in public servers or with real users.** Use your own test
  server/DM.
- **Don't push, tag, force-push or touch the remote** unless explicitly asked.
  `canary` is the dev branch (auto-deploys via Coolify); `main` is production.
- **The owner may have uncommitted work in the tree.** Never stash, reset,
  checkout/restore, clean, or commit files you didn't change. Stage paths
  explicitly.
- Never print or commit secrets from `.env`.

## Must-follow conventions

1. User-facing text goes through `gt("literal string")` / `<T>` (gt-next).
   The argument must be a literal; interpolate with `{name}` params.
2. Colors use theme CSS variables (`var(--app-accent)`, `var(--app-bg)`,
   `var(--app-surface)`, `var(--app-text)`, `var(--app-border)`, ...), never
   hard-coded hex for theme roles.
3. Channels and DMs share one chat engine (`src/hooks/useChatSession.ts`,
   `src/components/chat/MessageList.tsx` and friends). Add chat features
   there; the two containers (`ChatArea.tsx`, `app/dm/[recipientId]/page.tsx`)
   both need wiring for container-level features.
4. Live events: `publishToChannel` / `publishToDm` / `emitDmListUpdate` /
   `notifyChannelActivity` / `fanoutToUsers`. Never raw Redis topics.
5. Any module-level realtime registry uses `processShared()` from
   `src/lib/realtime/processShared.ts`.
6. Messages created by bots, webhooks, interactions or the system must call
   `signalChannelMessage` / `signalDmMessage`
   (`src/lib/services/messageSignals.ts`).
7. Startup fetches go through `sharedGet()` (`src/lib/bootFetch.ts`) and the
   URL list in `src/components/boot/BootPrefetch.tsx`.
8. Heavy dialogs: `next/dynamic` + `<MountWhenOpened>`.
9. Model `find`/`findOne` only honor whitelisted filter keys; unknown keys are
   ignored silently. Add the `case` before using a new key.
10. Never switch the build to Turbopack (breaks gt-next compile-time hashing).
11. New API routes: authenticate, check access (`checkChannelAccess` /
    permission helpers), validate the body with `t.Object`, rate limit writes
    with `checkRateLimit`, publish realtime events, call message signals. See
    `docs/architecture/api.md`.

## Verify before handing off

```sh
npx tsc --noEmit -p tsconfig.json   # zero errors
npx eslint <files you touched>       # no new errors
bun run test                         # unit tests (no DB/network)
bun run check:theme                  # UI changes (needs ripgrep)
bun run check:chat-media             # chat media changes (needs ripgrep)
```

Then test by hand on `bun run dev` with your own account: channel and DM,
second tab for live updates, light/dark theme, mobile width. For user-visible
changes add a bullet under `## Unreleased` in `CHANGELOG.md`. Use
conventional commit messages (`feat:`, `fix(scope):`, `perf:`, `docs:`).
