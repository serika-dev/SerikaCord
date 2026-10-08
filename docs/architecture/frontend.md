# Frontend

Next.js 16 app router, React 19 with the React Compiler, Tailwind v4,
shadcn/ui (Radix) in `src/components/ui`, gt-next for i18n. Built with webpack
only (`next build --webpack`, `next({ webpack: true })` in `server.ts`).

## Routing and layouts

| Route | Notes |
|-------|-------|
| `/` | landing page |
| `(auth)/login`, `(auth)/register` | split-screen auth (`AuthLayoutClient`, `RandomAuthBackground`); QR login is the default (`QRLoginPanel`) |
| `(legal)/*` | terms, privacy, guidelines |
| `/channels/me` | friends page + DM list (`/api/friends/stream`) |
| `/channels/[serverId]/[channelId]` | server channel: `ChatArea`, `ForumChannelView` for forums, `VoiceChannelView` for voice |
| `/channels/explore`, `/channels/notifications`, `/channels/profile`, `/channels/settings/*`, `/channels/messages` | app shell pages (some mobile-first) |
| `/dm/[recipientId]` | DM chat, voice/video calls (`?call=voice|video`) |
| `/developers/*` | developer portal and file-based API docs (`src/app/developers/docs`, nav in `src/lib/constants/docs-nav.ts`) |
| `/invite/[inviteCode]`, `/[inviteCode]` | invite landing (short links from `serika.cc` redirect to `/invite/<code>` in `server.ts`) |
| `/oauth2/*`, `/qr/[token]`, `/qr/scan`, `/forgetme`, `/widget/*`, `/widget-editor`, `/download` | misc |

The app shell is `/channels/*` (`ChannelsLayoutClient`) and `/dm/*`
(`DMLayoutClient`). Both layouts render `<BootPrefetch />` and both mount
`useAppHotkeys()`.

## Provider tree

`src/app/layout.tsx`:

```
GTProvider
  LocaleSync
  ThemeProvider            (src/contexts/ThemeContext.tsx — sets CSS variables)
    AuthProvider           (src/contexts/AuthContext.tsx — user, refresh, presence heartbeat)
      AppProviders         (src/components/boot/AppProviders.tsx)
        └─ on /channels/* and /dm/* only, lazy: AppShellProviders
             ServerProvider   (servers, channels, current server; ServerMembersContext for members)
               UnreadProvider (activity SSE, unread/mention counts, notifications)
                 {children}
      ChunkReloadGuard
```

`AppShellProviders` is mounted once above both shell layouts, so moving
between a DM and a server keeps server and unread state (no remount, no
refetch, no SSE reconnect). Don't add another `ServerProvider` or
`UnreadProvider` in a page or layout. It also warms the heavy dialog chunks
(`UserSettingsDialog`, `ServerSettingsDialog`, `FullProfileDialog`, ...) when
the browser is idle.

Hooks to read state: `useAuth()`, `useTheme()`, `useServer()`,
`useServerMembers()` (member list only; split out so the 30 s member poll
doesn't re-render every `useServer()` consumer), `useUnread()`.

## Startup data

`src/components/boot/BootPrefetch.tsx` emits `<link rel=preload as=fetch>` and
an inline script that starts these GETs while the HTML is still parsing:
`/api/users/@me`, `/api/users/@me/servers`, `/api/dms`,
`/api/users/me/settings`, `/api/users/@me/mentions`,
`/api/users/@me/read-states`, `/api/users/@me/channel-activity`, plus the
open channel's channel list, permissions and first 50 messages (or the open
DM's messages) unless the message cache already has them.

Consumers call `sharedGet(url)` (`src/lib/bootFetch.ts`), which reuses the
prefetched response for 4 s and dedupes identical in-flight GETs. A URL must
match exactly in both places. `clearBootData()` exists to drop prefetched
data (for logout or account switch) but nothing calls it yet; the 4 s TTL and
the "reuse only `res.ok`" rule are what keep stale data out today.

## Chat engine

Channels and DMs run on the same code:

- `src/hooks/useChatSession.ts`: message state, SSE (through
  `useChatStream`), optimistic sends with a send queue and rollback, edits,
  reactions, pins, pagination (`before=`, `after=`, `around=` for
  jump-to-message), typing, drafts. A module-level stale-while-revalidate
  cache (`messageCache`, 50 contexts) plus a localStorage tail
  (`sc:msgcache:*`) paint a conversation instantly; `prefetchChannelMessages`
  warms it on hover. At most 200 messages stay loaded.
- `src/hooks/useChatStream.ts`: EventSource lifecycle, backoff reconnect,
  `onReconnect` refetch, typing list.
- `src/lib/chat/messages.ts`: pure helpers (`normalizeIncomingMessage`,
  `groupMessages` with a 5-minute window, `applyReactionToMessages`,
  `formatMessageTimestamp`, `decodeHtmlEntities`). Covered by `tests/`.
- `src/lib/chat/markdown.ts`: the markdown parser (safe link schemes only).
- Components: `MessageList` (scroll management, `resetKey`, load older/newer),
  `MessageGroup` (memoized with a custom `arePropsEqual`; add new props to it),
  `MessageBar` (composer, `draftKey`), `MessageContextMenu`,
  `PinnedMessagesDialog`, `RichEmbed`, `LinkEmbed`.
- Containers: `src/components/chat/ChatArea.tsx` (channels, full mention
  engine) and `src/app/dm/[recipientId]/page.tsx` (DMs, lighter
  `useComposerSuggestions`). Container-level features need both.
- Chat translations go through `useChatGt()` (`ChatGtContext`, provided by
  `MessageList`); interpolated strings must be in its `map`.

## Performance patterns

- **Lazy dialogs**: heavy dialogs and mobile views are `next/dynamic`.
  Wrap them in `<MountWhenOpened open={...}>` so a closed dialog doesn't even
  fetch its chunk; it stays mounted after first open for close animations.
- **No per-message pollers**: `MemberProfilePopup` lazy-mounts its popover and
  `FullProfileDialog` only on first hover/focus/press; hooks like
  `useUserActivity` and `useCurrentTime` take an enabled/open gate. Never
  mount something that polls once per message row.
- **Viewport gating**: link and invite embeds fetch only when visible
  (`useInView`).
- **Memoized context values** (`useMemo`/`useCallback`) in every provider; the
  `ServerContext` members fetch only replaces state when a cheap `sig()`
  signature changes. Add new live member fields to that signature.
- **Code splitting**: the emoji/GIF picker and voice library (`simple-peer`)
  load on first use.
- **Deploys**: `ChunkReloadGuard` reloads once when a lazy chunk from an old
  build fails to load (`isChunkLoadError`, `reloadForNewBuild` in
  `src/lib/chunkReload.ts`).
- React Compiler rules: no setState in effects, correct `useMemo` deps, never
  shadow a prop with a same-named derived local (the compiler emits broken
  code even though tsc passes).

## Theme and styling

ThemeContext writes the theme to CSS variables on the document. Use them:
`--app-bg`, `--app-surface`, `--app-surface-alt`, `--app-text`,
`--app-muted`, `--app-border`, `--app-accent` and the shadcn tokens
(`--background`, `--foreground`, `--card`, `--muted`, `--border`, ...). Chat
layout variables: `--chat-gutter`, `--chat-row-gap`,
`--chat-media-max-inline`; chat media uses the `.chat-media` class. Never
hard-code hex colors for theme roles; `bun run check:theme` and `bun run
check:chat-media` guard the shell and chat files.

## Mobile

`ChannelsLayoutClient` switches to mobile views (`src/components/mobile/*`,
`BottomNavigation`) at mobile width (`useIsMobile`). Mobile views take handler
props such as `onBack` and `onAddFriend`; if the layout doesn't pass one, the
button silently does nothing. Bottom-nav badges read `totalDmUnreadCount` and
`totalMentionCount` from `UnreadContext`. Desktop (Qt, Tauri) and the
Capacitor app load the hosted site, so web changes ship to them without a
client release.

## Keyboard shortcuts

`src/lib/keybinds.ts` holds the `HOTKEYS` table and a small event bus
(`emitHotkey` / `onHotkey`). `useAppHotkeys` handles navigation; components
subscribe with `onHotkey(action, fn)`. Ctrl+/ shows the list
(`KeyboardShortcutsDialog`).
