# CLAUDE.md

Guide for Claude Code and other coding agents working in SerikaCord. Read this
first; the deep dives live in `docs/architecture/`. `AGENTS.md` is the
tool-agnostic summary of the same rules.

## What this is

SerikaCord (serika.chat) is a Discord-style chat platform: servers, channels,
roles and permissions, DMs and group DMs, forums/threads/tickets, voice and
video (WebRTC), a Discord-v10-compatible bot API + gateway, a Discord bridge,
and Qt/Tauri desktop and Capacitor mobile shells that load the hosted web app.
One Bun process serves everything.

## Safety rules (read before touching anything)

1. **The Postgres and Redis behind canary are PRODUCTION data, shared by canary
   and prod.** Never run destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without a
   precise `WHERE`, `ALTER ... DROP`, type rewrites). Never run `drizzle-kit
   push`/`migrate` against it. Don't connect to the DB or Redis "just to check"
   unless the owner asked you to.
2. **Schema changes are additive and idempotent**: `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TYPE ... ADD
   VALUE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`. Today they ship as
   `drizzle/manual_<name>.sql` that the owner applies by hand (there is no
   migration runner in `package.json`); if you add boot-time DDL instead, it
   must be idempotent too. Update `src/lib/db/schema.ts` to match and say in
   your report what the owner must apply. See `docs/architecture/data-model.md`.
3. **Never test in public servers or real users' DMs.** Use your own test
   server/DM. Never message, ping or DM real users from tests.
4. **Branches**: `canary` is the development branch and deploys automatically
   via Coolify; `main` is production and only takes release merges. Never push,
   tag, force-push or touch the remote unless the owner explicitly asks.
5. **The owner often has uncommitted WIP in the working tree.** Never `git
   stash`, `git reset --hard`, `git checkout -- <file>`, `git clean`, or commit
   files/hunks you didn't write. Stage only your own changes (`git add <path>`,
   not `git add -A` in the main checkout). If a file mixes your hunks with
   theirs, stage only yours and verify the staged snapshot typechecks.
6. Secrets live in `.env` (template: `.env.example`). Never print, commit or
   paste them anywhere.

## Architecture map

```
browser ──HTTP/SSE/WS──▶ Bun.serve (server.ts, $PORT)
                           ├─ /api/v10/gateway  → bot WebSocket (src/lib/gateway/core.ts GatewayHub)
                           ├─ /api/channels/:id/stream, /api/dms/:id/stream,
                           │  /api/users/@me/activity → raw SSE fast path (handleSSE / handleActivitySSE)
                           ├─ /api/*            → Elysia `api.handle(req)` (src/lib/api/index.ts) — no Next hop
                           └─ everything else   → proxied to internal Next.js (node:http on $PORT+1)
Elysia routes ─▶ thin models (src/lib/models) ─▶ Drizzle ─▶ Postgres (src/lib/db/schema.ts)
             ─▶ Redis (src/lib/db/redis.ts): cache, sessions, rate limits, pub/sub buses
realtime: publishToChannel / publishToDm / notifyChannelActivity / fanoutToUsers
          → local delivery via process-wide registries + Redis bus for other instances
bots: app publishes `gateway:dispatch` (src/lib/services/gatewayEvents.ts) → GatewayHub → bots
media: Backblaze B2 behind cdn.serika.chat (config.CDN_URL, wsrv.nl transforms)
```

- `server.ts` imports `./gt-preload` **first**, forces webpack (`next({ dev,
  webpack: true })`), calls `initializeAPI()`, starts the SSE Redis bridges,
  the presence keepalive, the voice bridge and (unless `DISABLE_DISCORD_BOT=1`)
  the Discord bridge bot behind a Redis leader lock.
- `src/app/api/[[...slug]]/route.ts` still forwards to the same Elysia app;
  it is only used when running Next alone (`dev:next`), where the SSE fast path
  and realtime registries are absent.
- `scripts/gateway.ts` (`bun run gateway`) is an optional standalone gateway
  for scale-out; normal deploys use the in-process one.
- `serika-accounts/` is the separate accounts/OAuth service (git submodule);
  SerikaCord trusts its tokens. `desktop-QT/`, `desktop-tauri/` (deprecated),
  `mobile/` are client shells.

## Directory map

| Path | What lives there |
|------|------------------|
| `server.ts` | Bun entry: routing, SSE fast paths, gateway WS, bridges, Discord bot leader lock |
| `src/lib/api/` | Elysia route modules (`index.ts` mounts them all under `/api`) |
| `src/lib/services/` | Server business logic (auth, presence, gateway events, message signals, storage, system DMs) and some client services (notifications, voice) |
| `src/lib/models/` | Thin model objects over Drizzle (`find`/`findOne` whitelist — see gotchas) |
| `src/lib/db/` | `postgres.ts` (pool + `db`), `schema.ts`, `redis.ts` (`getRedis`, `getPublisher`, `cache`) |
| `src/lib/realtime/processShared.ts` | Process-wide registries for SSE connection maps |
| `src/lib/security/` | Rate limits, sanitization, encryption at rest, SVG sanitizer, UUID param guard |
| `src/lib/permissions/bits.ts` | Canonical Discord-numbered permission bits |
| `src/lib/roles/` | Client permission helpers (bitfield strings, channel overwrite mirror) |
| `src/lib/chat/` | Pure chat helpers: message normalize/group/reactions, markdown parser, search query, TTS |
| `src/lib/gateway/core.ts` | Transport-agnostic bot gateway protocol |
| `src/lib/discord/` | Discord bridge bot + consent |
| `src/app/` | Next app router pages; `channels/` and `dm/` are the app shell |
| `src/components/boot/` | `BootPrefetch`, `AppProviders`, `AppShellProviders`, `ChunkReloadGuard` |
| `src/components/chat/` | Shared chat UI (`MessageList`, `MessageGroup`, `MessageBar`, `ChatArea`) |
| `src/contexts/` | `AuthContext`, `ThemeContext`, `ServerContext` (+ `ServerMembersContext`), `UnreadContext` |
| `src/hooks/` | `useChatSession` (chat engine), `usePermissions`, `useAppHotkeys`, ... |
| `drizzle/` | Generated migrations `0000`–`0003` + hand-applied `manual_*.sql` |
| `scripts/` | Theme/media checks, translation sync, one-off data scripts (several write to the DB — read before running) |
| `tests/` | `bun test` unit tests for pure modules |
| `docs/architecture/` | realtime, data model, API, frontend, security deep dives |

## Commands

All of these exist in `package.json` / `scripts/`:

| Command | What it does |
|---------|--------------|
| `bun run dev` | Full dev server (`bun server.ts`): SSE fast paths, gateway, bridges. Use this, not `dev:next`, to test realtime. Needs `.env` with Postgres + Redis (that is production data, see safety rules) |
| `bun run dev:next` | `next dev --webpack` only: no SSE fast path, no gateway, realtime mostly broken |
| `bun run build` | `next build --webpack` (never Turbopack, see gotchas) |
| `bun run start` | Production server (`bun server.ts`, `NODE_ENV=production`) |
| `npx tsc --noEmit -p tsconfig.json` | Typecheck (must be zero errors) |
| `npx eslint <files>` | Lint touched files (`bun run lint` lints everything; there are known pre-existing errors) |
| `bun run test` | `bun test tests`: unit tests, no DB or network |
| `bun run check:theme` | Fails on hard-coded dark colors in shell files (needs `rg`) |
| `bun run check:chat-media` | Fails on hard-coded chat media sizing (needs `rg`) |
| `npx gt translate` / `npx gt download` | Send new strings to General Translation / download results |
| `bun run translate:push` / `:pull` / `:sync` / `:status` / `:keys` | Serika Translate sync (`scripts/sync-translations.js`) |
| `bun run gateway` | Optional standalone bot gateway |

Releases are cut by the maintainer with `bun run release:dry` then
`bun run release <patch|minor|major> --commit --tag` (bumps every version file,
moves `## Unreleased` into a dated section, never pushes); pushing the `v*` tag
triggers the GitHub `Release Build` workflows. Agents don't cut releases; they
add `## Unreleased` entries (`bun run changelog <Kind> "..."`). The UI reads the
version from `src/lib/version.ts` — never hard-code it. See `AI-READ-THIS.md`.

## Core conventions

- **i18n**: every user-facing string goes through `gt()` (`useGT()` client,
  `getGT()` server) or `<T>`. The argument to `gt()` must be a **string
  literal** (the compile-time plugin rejects `gt(variable)` and breaks `next
  build`). Interpolate with `gt("Hi {name}", { name })`. Chat components use
  `useChatGt()`; interpolated chat strings must be registered in the `map` in
  `src/components/chat/ChatGtContext.tsx`. Full guide: `AI-READ-THIS.md`.
- **Theme**: colors come from CSS variables (`var(--app-accent)`,
  `var(--app-bg)`, `var(--app-surface)`, `var(--app-text)`, `var(--app-muted)`,
  `var(--app-border)`, shadcn tokens like `--background`/`--foreground`).
  ThemeContext sets them; never hard-code hex colors for theme roles. Use
  `--app-accent` (has a fallback) rather than `--accent-color`.
- **One chat engine for channels and DMs**: `useChatSession` (messages, SSE,
  optimistic sends, pins, pagination, SWR cache) + `MessageList` /
  `MessageGroup` / `MessageBar` / `MessageContextMenu`. The containers
  `src/components/chat/ChatArea.tsx` (channels) and
  `src/app/dm/[recipientId]/page.tsx` (DMs) wire them separately: a
  container-level feature usually needs both edited. Never fork chat logic per
  surface.
- **`MessageGroup` is memoized with a custom `arePropsEqual`**: if you add a
  prop, add it to the comparator or it silently stops updating.
- **Startup data**: `BootPrefetch` (in `src/app/channels/layout.tsx` and
  `src/app/dm/layout.tsx`) starts core GETs from inline HTML; consumers read
  them with `sharedGet(url)` from `src/lib/bootFetch.ts` (4s TTL, dedupes
  in-flight GETs). If you change a startup URL, change it in both places.
- **Server and unread state** are mounted once in `AppShellProviders` (via
  `AppProviders` in the root layout) for `/channels/*` and `/dm/*`. Don't mount
  another `ServerProvider`/`UnreadProvider` in a layout.
- **Realtime registries**: any module-level map of live connections or
  realtime state must be created with `processShared(key, init)` from
  `src/lib/realtime/processShared.ts` (Bun's and Next's copies of the API
  modules must share it).
- **Publishing live events**: use `publishToChannel` (channels.ts) /
  `publishToDm` (dms.ts) / `emitDmListUpdate` / `notifyChannelActivity` /
  `fanoutToUsers` (activity.ts). Never publish raw Redis topics for client
  events; topics without a subscriber are silently dropped.
- **Messages created outside the user send routes** (bot API, webhooks,
  interaction replies, system DMs, bridges) must call `signalChannelMessage` /
  `signalDmMessage` from `src/lib/services/messageSignals.ts` so unread badges
  and notifications fire. Bot-visible events also go through the emit helpers
  in `src/lib/services/gatewayEvents.ts`.
- **Lazy UI**: heavy dialogs/panels are `next/dynamic` and wrapped in
  `<MountWhenOpened open={...}>` (`src/components/ui/MountWhenOpened.tsx`) so
  their chunk loads on first open. Never mount `FullProfileDialog`/profile
  cards or anything that polls (`useUserActivity`, `useCurrentTime`) eagerly in
  a per-message component.
- **Context values** are memoized (`useMemo`/`useCallback`). Member lists live
  in `ServerMembersContext` (`useServerMembers`), not `useServer()`. New member
  fields that must update live need adding to the `sig()` comparison in
  `ServerContext` fetchMembers.
- **Module-level server caches** use `BoundedMap` (`src/lib/utils/boundedMap.ts`).
- **React Compiler is on**: no setState inside effects, matching `useMemo`
  deps, and never shadow a prop with a same-named derived local.
- New keyboard shortcuts go in the `HOTKEYS` table in `src/lib/keybinds.ts`.
- Media URLs are built from `config.CDN_URL`; render images through
  `cdnImage()` (`src/lib/utils.ts`) except chat attachments.

## Gotchas

- **Model `find`/`findOne` whitelist**: models in `src/lib/models` translate
  filter keys through a `switch`; an unknown key is **silently ignored** and
  the query returns an arbitrary row. Before passing a new filter key, add its
  `case` to that model.
- **Elysia redirects**: `set.redirect` produced a 302 without `Location` and
  `redirect()` threw. Return a raw `Response` with a `Location` header (and
  manual `Set-Cookie`), like `oauthRedirect()` in `src/lib/api/auth.ts`.
- **gt-next needs webpack**: Turbopack disables the gt compile-time plugin and
  every `gt()` re-hashes per render on non-English locales. Keep `--webpack`
  in scripts and `webpack: true` in `server.ts`. `getLocale.ts` must stay at
  the repo root.
- `next build` prints `loadTranslations() ... could not be resolved` warnings;
  they are expected.
- Message content is encrypted at rest (`encryptForStorage` /
  `decryptFromStorage`) and HTML-escaped by `sanitizeInput`; the client
  decodes with `decodeHtmlEntities` and renders as React text.
- The `/api/users/@me/activity` stream has two implementations (Elysia
  handler in `index.ts` for Next-only dev, raw handler in `server.ts`). Both
  register into the same map; keep them in step.

## Before you hand off (verification checklist)

1. `npx tsc --noEmit -p tsconfig.json`: zero errors.
2. `npx eslint <every file you touched>`: no new errors.
3. `bun run test` passes; add tests in `tests/` for new pure logic.
4. UI changes: `bun run check:theme` and `bun run check:chat-media`.
5. New strings are wrapped in `gt()`/`<T>` with literal arguments.
6. Manual browser check on `bun run dev` with your own test account/server:
   the feature works in a channel AND a DM if it touches chat; live updates
   arrive in a second tab/device; light and dark theme; mobile width.
7. User-visible change: add a bullet under `## Unreleased` in `CHANGELOG.md`
   (category headings: Features, Bug Fixes, Performance, Security). Plain
   language, what the user notices, issue key like `(CORD-12)` if there is one.
8. Schema change: `schema.ts` updated + idempotent `drizzle/manual_*.sql`, and
   the report tells the owner to apply it.
9. Commit only your own files with a conventional message
   (`fix(dm): ...`, `feat: ...`, `perf: ...`, `docs: ...`).

Slash commands in `.claude/commands/` (`/check`, `/changelog`,
`/review-security`, `/new-api-route`, `/deploy-status`) and subagents in
`.claude/agents/` automate parts of this.
