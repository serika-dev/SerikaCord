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

The app shell (`ChannelsLayoutClient`: auth gate, server rail, channel/DM
sidebar, voice audio, dialogs, `useAppHotkeys()`) serves both `/channels/*`
and `/dm/*`. It is mounted once in `AppShellProviders`, above both route
segments, so switching between a DM and a server only swaps the page; the
`channels` and `dm` layouts carry metadata only. Conversations have
`loading.tsx` skeletons, and `experimental.staleTimes` in `next.config.ts`
keeps recently visited routes in the client router cache.

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

`src/components/boot/BootPrefetch.tsx` is an inline script in the root
layout's `<head>` (it returns at once outside `/channels` and `/dm`) that
starts these GETs while the HTML is still parsing:
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
- Mentions: `src/lib/chat/mentionResolver.ts` is the one resolver for
  `<@id>` / `<@&id>` / `<#id>` (container users, then server members incl.
  bots, message/reply authors and `referencedMessage.mentions`, then the
  cached one-time lookup in `mentionUserLookup.ts`). `MessageContent` falls
  back to it for any unknown user; plain-text previews use `<MentionText>`
  (`useMentionNames`). Don't call `renderMentionText` without names in UI.
- Components: `MessageList` (scroll management, `resetKey`, load older/newer),
  `MessageGroup` (memoized with a custom `arePropsEqual`; add new props to it),
  `MessageBar` (composer, `draftKey`), `MessageContextMenu`,
  `PinnedMessagesDialog`, `RichEmbed`, `LinkEmbed`.
- Containers: `src/components/chat/ChatArea.tsx` (channels, full mention
  engine) and `src/app/dm/[recipientId]/page.tsx` (DMs, lighter
  `useComposerSuggestions`). Container-level features need both.
- Slash commands live in `MessageBar` for every surface: the `/` palette
  (`components/chat/commands/CommandPalette`), the command composer with one
  chip per option (`CommandComposer`) and ↑ re-run history. Pure model in
  `lib/chat/commandComposer.ts` (specs, ranking, Enter rules, readiness) and
  `lib/chat/commandHistory.ts`; containers pass `onRunCommand` from
  `useCommandRunner` plus `appLeaves` / `commandPickers`.
- Chat translations go through `useChatGt()` (`ChatGtContext`, provided by
  `MessageList`); interpolated strings must be in its `map`.

## Performance patterns

- **Lazy dialogs**: heavy dialogs and mobile views are `next/dynamic`.
  Wrap them in `<MountWhenOpened open={...}>` so a closed dialog doesn't even
  fetch its chunk; it stays mounted after first open for close animations.
- **Image picker**: every avatar / banner / icon change opens
  `SelectImageDialog` through `useSelectImage()` (Upload Image, Choose GIF,
  recent avatars / banners + the linked Discord image); profile surfaces go
  through `useProfileMediaUpload()`, which adds the crop + upload. GIFs and
  Discord images are fetched by the server and uploaded like any file.
- **No per-message pollers**: `MemberProfilePopup` lazy-mounts its popover and
  `FullProfileDialog` only on first hover/focus/press; hooks like
  `useUserActivity` and `useCurrentTime` take an enabled/open gate. Never
  mount something that polls once per message row.
- **Viewport gating**: link and invite embeds fetch only when visible
  (`useInView`).
- **Memoized context values** (`useMemo`/`useCallback`) in every provider; the
  `ServerContext` members fetch only replaces state when a cheap `sig()`
  signature changes. Add new live member fields to that signature.
- **Unread state, narrowly**: `useUnread()` re-renders on every unread change,
  which is every message in any channel the user can see. Big components read
  it narrowly instead: `useUnreadSelector(u => primitive)` (re-renders only
  when that value changes), `useUnreadGetter()` (read in handlers and effects,
  never re-renders) and `useUnreadLive(open)` (live only while a dialog is
  open). `ChatArea`, the DM page, `QuickSwitcher` and `useAppHotkeys` use them;
  the channel and server sidebars subscribe to `unreadBadgeKey` / their rail
  badges and read the functions with `useUnreadGetter()`.
- **Per-message toolbars stay light**: `MessageHoverActions` renders plain
  buttons and mounts its Radix popover and menu only after a pointer move or
  focus on that message (or a click on the plain button). `LinkEmbed`
  (`LinkEmbedSlot.tsx`) stops at once for messages without a link and loads
  the preview components on the first link.
- **Opening a conversation mounts the newest groups first**: `MessageList`
  mounts the newest 12 groups (or from the unread divider) in the first
  commit and the rest right after that paint (`initialMountStart`);
  pagination waits for the full mount.
- **Group keys and rows stay stable**: a long run from one person is one
  group, so `MessageList` keys groups with `assignGroupKeys` (a group keeps
  the key one of its messages had, so prepending older history or appending
  a live message never remounts it) and `MessageGroup` renders each message
  as a memoized `MessageRow` (`rowPropsEqual`; add new row props there).
- **Message revalidation keeps objects**: refetched pages go through
  `reuseUnchanged`, so a revalidation that finds nothing new re-renders no
  `MessageGroup` (they compare message references).
- **Route warm-up on hover**: sidebar rows call `prefetchRoute()`
  (`src/lib/navigation/prefetchRoute.ts`), a full prefetch that includes the
  page segment. A plain `router.prefetch()` stops at `loading.tsx`, so the
  click still showed the skeleton and waited for the server.
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

Gradient and background-image themes make the surface tokens (`--app-bg`,
`--bg-app`, `--app-surface`, `--bg-card`, ...) see-through so the backdrop
shows behind the shell. Anything that floats over other content must stay
opaque: dialogs, menus, popovers, listboxes, Radix popper content, `.ctx-menu`,
`[data-message-sheet]` and toasts swap the surface tokens for their opaque
copies (`--app-bg-solid`, `--app-surface-solid`, `--app-surface-alt-solid`,
`--bg-card-solid`, `--bg-sidebar-solid`) automatically (globals.css). A custom
popup, sticky header or floating bar without one of those roles needs the
`theme-solid` class, and should not add an opacity modifier
(`bg-[var(--bg-card)]/90`) on top. Full-screen panels use `theme-backdrop`
instead, which repaints the gradient underneath.

## Mobile

`ChannelsLayoutClient` switches to mobile views (`src/components/mobile/*`,
`BottomNavigation`) at mobile width (`useIsMobile`).

Servers and DMs on phones are one persistent page, `MobileShell`
(`src/components/mobile/`): a `MobilePager` with three panels, [channel or
DM list | chat | members], all mounted. The shell renders the conversation
pages itself (`ConversationParamsContext`; pages read params with
`useConversationParams()` / `useConversationSearchParams()`, never
`useParams()` directly) and updates the URL with `history.pushState` /
`replaceState` after the motion, so nothing loads a route. Navigate inside it
with `useMobileShell()` (`open(href)`, `showList()`, `showMembers()`) rather
than `router.push`. The strip only carries a transform while moving (a
transformed ancestor would capture `position: fixed` children). Route and
gesture math is pure in `src/lib/mobile/pager.ts`. Every phone bottom sheet
closes through `useDragToDismiss` (`src/hooks/useDragToDismiss.ts`), which
`MobileSheet` and the shared `DialogContent` already use.

Mobile views take handler
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
