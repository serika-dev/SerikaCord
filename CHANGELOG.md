# SerikaCord — Full Changelog

**294 commits** · Jan 22 – Jul 17, 2026 · v0.0.1 → v1.1.2.

---

## v1.1.2 — 2026-07-17

**Tag:** `v1.1.2` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Point all client apps at the primary domain `https://serika.chat`.

### Changes
- **App domain → `serika.chat`** — Updated the base/start URL in every client shell: Tauri desktop (`main.rs` `APP_URL`, `tauri.conf.json` `frontendDist`), Electron desktop (`main.js` `APP_URL`), and mobile (`capacitor.config.json` server URL, both root and Android assets copy). Previously `waifu.ws`.
- **Version bumps** — All platforms to 1.1.2; Android `versionName` → 1.1.2, `versionCode` → 11.

---

## v1.1.1 — 2026-07-17

**Tag:** `v1.1.1` · **Commit:** `9cb76fa` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Greatly improved desktop game detection (Linux/Proton/Wine), a persistent recent-activity history surfaced on the full profile, and soundboard volume moved to a personal Voice & Video preference.

### Features — Desktop game detection
- **Steam-first resolution** — Reads the `SteamAppId`/`SteamGameId`/`STEAM_COMPAT_APP_ID` env var and the reaper `AppId=` argv, then resolves the real title from local `appmanifest_*.acf` files. Fixes mangled Proton/Wine titles for every Steam game with no per-game table.
- **Robust process inspection** — Uses the real exe path / argv0 instead of the 15-byte-truncated Linux `comm` name; discovers Steam libraries across native, Flatpak, and Snap layouts (cached, auto-refreshed).
- **Noise filtering** — Wine/Steam plumbing (`services.exe`, `winedevice`, `reaper`, `steamwebhelper`, anticheat, …) is never mistaken for a game; a game's child processes collapse into one activity.

### Features — Recent activity
- **`activity_history` store** — New table/model logging games & apps with cumulative playtime and session counts (migration `drizzle/manual_activity_history.sql`).
- **Full profile "Recently Played"** — Persistent history rendered on the profile Activity tab, privacy-gated by "show activity".
- **Opt-out** — "Store recent activity" toggle + "Clear activity history" button in Data & Privacy (`privacy.storeActivityHistory`).

### Changes
- **Soundboard volume moved** — Now a personal `voiceVideo.soundboardVolume` preference in User Settings → Voice & Video (removed from Server Settings); local playback multiplies server × personal volume.
- **Version bumps** — All platforms to 1.1.1; Android `versionName` → 1.1.1, `versionCode` → 10.

---

## v1.1.0 — 2026-07-16

**Tag:** `v1.1.0` · **Commit:** `fa0c0ce` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Version bump to 1.1.0 across all platforms (web, Tauri desktop, Electron desktop, Android). GitHub Actions release build triggered via `v1.1.0` tag — produces signed Tauri desktop builds (Windows .exe/.msi, macOS .dmg, Linux .AppImage/.deb/.rpm) and signed Android APK.

### Changes

- **Version bumps** — `package.json`, `desktop-tauri/package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `desktop/package.json` all updated to 1.1.0.
- **Android version** — `versionName` → `1.1.0`, `versionCode` → 9.
- **Mobile UI** — Version strings updated in `MobileDrawer.tsx` and `MobileProfileView.tsx`.
- **AI-READ-THIS.md** — Added fork requirement warning: users must have their own fork, remote must not point to `serika-dev/SerikaCord`.
- **Settings/UX improvements** — MemberSidebar, MessageList, UserSettingsDialog, MemberProfilePopup, ProfileCard, ServerContext, useChatSession updates (voice/video/accessibility/text-images settings tabs, live previews, toggle controls).

---

## Unreleased (postgres branch) — Jul 8–16, 2026

~93 commits on the `postgres` branch after v1.0.5.

### Security
- **XSS sanitization** (`876357a`) — `svgSanitizer.ts`; sanitized MarkdownRenderer, MessageContent, twemoji, image-cropper. 30 files (+1289/−324).
- **Internal-route auth bypass** (`7bff928`) — Patched auth bypass + stale channel-fetch race.
- **Internal request validation** (`4a6d52c`) — `/internal/*` bodies validated with Elysia schemas.
- **Cross-account cache leakage** (`f11b45f`) — Message cache cleared on account switch/logout.
- **Duplicate-spam detection** (`3c89f69`) — Blocks after 4 consecutive duplicates (HTTP 429). Normalizes diacritics, repeated chars, whitespace, punctuation.
- **SEND_MESSAGES enforcement** (`a023658`) — Backend + frontend overwrite enforcement (403). Admin/Manage Channels bypass.

### Features — Bug Report & Feedback
- **Bug report system** (`fa7d97a`) — BugReport model, user panel, admin panel, API, migration. 13 files (+1867).
- **Feedback & Bugs rebrand** (`a203261`) — `kind` field (`"bug"|"feedback"`), distinct categories, kind switcher.
- **Panel redesign** (`be72d0d`) — Hero header, drag-and-drop uploads, search, filter tabs. (+431/−276).
- **Modal overlay** (`ba3889f`) — Fixed overlay, focus management, Escape key, sticky footer.

### Features — Emoji & Stickers
- **Favorites system** (`32c1fdf`) — Database-backed `useEmojiFavorites` hook; context menus; star icon. 29 files (+6040).
- **Unified favorites** (`95379fb`) — Unicode + custom emojis in same data structure.
- **Unicode context menus** (`11c342e`) — Portal-based positioning prevents clipping.
- **Server icons in picker** (`dfcd60d`, `454e7de`, `f961aa6`) — Server icons in sidebar; standard categories to top; `shrink-0`.
- **Picker height fix** (`3d49b50`) — `h-[440px]` with `max-h-[60dvh]`.
- **Sticker upload** (`c1af0ff`) — Enabled in migration script.
- **Bulk upload script** (`dc1cfa2`) — Upload from filesystem.
- **Rename UI** (`c795229`) — Admin rename + statistics dashboard.
- **@twemoji/api** (`5a06db1`) — Migrated; bot slash commands in DMs.

### Features — Chat & Messaging
- **Auto-pagination fix** (`dfd3cfc`) — `readyForPaginationRef` gates pagination; scroll-room check; synchronous SWR swap eliminates channel-switch flash.
- **ANSI code blocks** (`fa7d97a`) — Full parser: colors (16/bright/256/truecolor), styles (bold/dim/italic/underline/strikethrough).
- **Shift hover actions** (`d298c70`) — Inline buttons (copy, pin, delete) when Shift held. Resets on blur.
- **Keyboard shortcuts** (`dadc0bc`, `32c1fdf`) — Focus composer, search-channel/all, edit-last-message (ArrowUp), prevent duplicate sends.
- **QuickSwitcher** (`c1af0ff`) — Quick channel/server switcher.
- **Timeout system** (`40938b9`, `95b0639`, `a023658`) — Indicator, mod view, block sends, live countdown via `useTimeoutRemaining`.
- **Rich server tooltips** (`b33e287`) — Online/member counts, partnered badge.
- **Active Now sidebar** (`e3a9ae2`, `589b584`) — Friends' activities; new message separator.
- **Server folders** (`9d2c133`) — Folders with lazy-loading emoji picker, DM unread rail.
- **dnd-kit DnD** (`03ee664`) — Friend/member context menus, improved discovery join.
- **Native DnD server folders** (`c169ffe`) — Tightened spacing, larger emoji/sticker limits.
- **Auto-hiding scrollbar** (`8a1ae34`) — Server rail; fixed role color handling.
- **Member sidebar spacing** (`98cdd77`) — `space-y-1` → direct `mt-1`.

### Features — CDN & Infrastructure
- **CDN URL normalization** (`f964947`) — `cdnImage()` across 40+ files.
- **Bun.serve** (`67688bb`) — From node:http + ws to Bun.serve with native WebSocket.
- **Next.js proxy fix** (`9207032`) — Preserve Host header, handle redirects.
- **PostgreSQL migration** (`250ab14`) — MongoDB → PostgreSQL with Drizzle ORM.
- **Real-time unread stream** (`e76afe2`) — Sidebar glow, mention badges.
- **Internal sync endpoints** (`5b90dd2`) — Service fallback for account connections.
- **Profile update endpoint** (`20e8d0c`) — Optimized UI state transitions.

### Features — Bot & Developer Platform
- **serika.js SDK rebrand** (`45c60ad`) — All docs: discord.js → @serikadev/serika.js.
- **Bot slash commands** (`4b9a4bb`, `113ae8e`, `d291848`, `075e882`, `19ee32d`) — Invoke, server-side dispatch, gateway dispatch, multi-bot, interaction persistence, public /me + /shrug.
- **Bot gateway reliability** (`690fddd`, `a82d0e5`, `7c2e9cb`, `5f8cfe5`) — Hardened gateway, identify crash fix, Invalid Date, ephemeral messages, callback endpoint, nginx route.
- **Bot settings redesign** (`5fce84a`) — Card-based layout.
- **Bot API validation** (`5b565df`) — Validate message belongs to channel.
- **Bot presence** (`735f932`) — Mark bots online via gateway.
- **Discord bot bridge** (`e0d5881`) — Bridge, Fish Audio TTS, premium file limits.
- **isBot/isVerified** (`1dc2b32`) — Badge display in DM sidebar.
- **Developer portal redesign** (`37ef759`) — Glassmorphic UI, DiceBear avatars.
- **OAuth2 flow** (`1d80911`) — New pages, middleware, API.
- **Automatic bot provisioning** (`3533010`) — DiceBear avatars, blockquote/small text.
- **Per-user experiment management** (`dacc470`) — Include/exclude controls, API, admin UI.
- **Fast native-glyph emoji picker** (`97d7ea6`) — Deferred search filtering experiment.

### Features — i18n
- **gt-next i18n** (`a164d92`) — Translated strings across auth, legal, home.
- **Translation management UI** (`a57ff60`) — Crowd-sourcing, npm scripts.
- **LocaleSync** (`19d4981`) — Automatic locale sync in root layout.
- **Locale reconfiguration** (`3c668ca`, `a664210`) — Removed then re-added 11 locales.
- **gt-next server-side fix** (`177c678`) — Compile-time transform eliminates runtime hashing.
- **Domain redirect** (`435e7c3`) — serika.cc → FRONTEND_URL.

### Features — UI/UX
- **Explore page theming** (`f645426`) — Single `ACCENT` variable; ServerCard CSS custom properties; mobile underline tabs.
- **Theme-aware text selection** (`dbbb4ad`).
- **ChannelSettingsDialog redesign** (`e32a82f`) — Improved navigation, Escape handling.
- **Logo redesign** (`9c6e3ff`) — Custom mascot, reusable Logo/Loader.
- **MessageGroup optimization** (`c1273ce`) — Custom memo equality + pre-computed timestamps.
- **Chat translations hoisted** (`8a62490`) — Single provider fixes long-history lag.
- **Invite error detection** (`ba3889f`) — Better server API error parsing.
- **isMember check on invites** (`d5b240c`) — Live DM list updates.
- **Context menu positioning** (`cb20b88`) — Fixed with useLayoutEffect.
- **Mobile scroll gesture fix** (`6d83b78`) — Prevent popup during scroll.
- **Drag event bubbling fix** (`3814737`) — Prevent nested folder drag conflicts.

### Performance
- **Message cache persistence** (`873d569`) — Broaden preload, prefetch on server hover.
- **Stale-channel race** (`80af6a9`) — Eliminate duplicate member fetches on server switch.
- **Delta fetch** (`790b6aa`) — Revalidate with delta instead of full page.
- **SSE no-transform** (`7e7460b`) — Stop proxy buffering.
- **Scroll-up pagination** (`44012e6`) — Fix when painting from short cached tail.

### Bug Fixes (Critical)
- **12 silent filter-drop bugs** (`0046f4d`) — Patched findOne/find whitelists across models.
- **DMs crash** (`87ba08d`) — ChannelSidebar used useUnread outside UnreadProvider.
- **Message.findOne filters ignored** (`c68ff7a`) — id/isDeleted dropped, breaking delete/edit/pin/reactions.
- **Deployment OOM** (`8ff56c2`) — Ignore build errors in Next.js config.
- **User staff status** (`b10446e`) — Standardized ID field, corrected auth verification.
- **TypeScript build errors** (`3702bb2`) — isBot/isSystem types, settings spread, blockDuration.
- **Custom emoji sizing** (`35d1ee2`) — Fixed sizing/detection, GIF wrapper constraints.
- **GIF favorite button** (`009e35d`) — Position fix.
- **Experiment identifiers** (`d5c93bc`) — `id` instead of `_id`.
- **sysinfo 0.30** (`448389b`) — Removed deprecated trait imports.
- **serika.moe lookup** (`91d3de9`) — Use accounts service ID.

### Documentation
- **README rewrite** (`e72b574`) — Full feature docs and deployment guide.
- **Security contact** (`582af5d`) — serika.chat → serika.dev.
- **Canary gateway** (`03509bf`) — Documented capi.serika.dev.

### Other
- 2 TTS sounds (`5097abf`). AuthProvider to root layout (`3c0da7d`). Legal pages refactor (`f01ae80`). PR review fixes (`20cfc0c`). Unused file cleanup (`fdbf06a`).

---

## v1.0.5 — 2026-07-07

**Tag:** `7c33663` — Server discovery, member applications, screen-share fix, cross-instance voice, Cloudflare TURN.

- Server discovery explore page with cards, category filtering, join flow.
- Member applications — submission and review system.
- Screen-share fix for voice channels.
- Cross-instance voice support.
- Cloudflare TURN relay for NAT traversal.
- Mobile voice UI optimizations, noise suppression toggle (`3555f09`).
- SSE fast-path to bypass Next.js buffering (`1c4c60a`).

---

## v1.0.4 — 2026-07-07

**Tag:** `d5b9420` — Tauri auto-updater, signed desktop builds.

- Tauri auto-updater for desktop app.
- Signed desktop builds (exe/msi/dmg/AppImage).
- Version bumps across desktop and mobile.

---

## v1.0.3 — 2026-07-07

**Tag:** `02910f2` — File picker uses platform allowlist/default.

- File picker now uses platform-specific allowlist/default extensions.
- Version bumps.

---

## v1.0.2 — 2026-07-07

**Tag:** `d5b7381` — Multi-status rich presence, more detected apps, profile card fixes.

- Multi-status rich presence display.
- More detected desktop apps for activity.
- Profile card layout fixes.
- British English "colour" standardization, HTML entity decoding (`692c860`).
- Auth context refresh on mobile settings load (`d54ac49`).
- Member status indicator colors matching Discord palette (`802b506`).
- Invite page redesign with full-bleed banner (`97ba47e`).
- SEO metadata on auth/legal pages (`4b0dc26`).
- Mobile profile view overflow fix, full-height member popups (`cfc5432`).
- IGDB rich-presence proxy, desktop process detection (`fec8a89`).
- GPG signing for Linux AppImage builds (`5fb5af0`).
- Mobile member list drawer, nameplate customization (`4b33a0b`).
- Gradient color picker UI redesign (`c2f4fb8`).
- sysinfo 0.30 trait import fix (`448389b`).

---

## v1.0.1 — 2026-07-07

**Tag:** `fec8a89` — IGDB rich-presence proxy, desktop process detection.

- IGDB rich-presence proxy for game activity.
- Desktop process detection for activity status.
- Version bump to 1.0.1.

---

## v1.0.0 — 2026-07-05

**Tag:** `8e6641c` — First major release. Desktop via Tauri, signed Android APK, mobile static export.

### Features

- **Desktop app** — Tauri build (exe/msi/dmg/AppImage) with GPG signing.
- **Android APK** — Signed Android build via GitHub Actions.
- **Mobile static export** — Static export build for mobile.
- **P2P voice channels** (`42a260c`, `1112c69`) — Full WebRTC voice with video grid, screen sharing, speaking indicators, persistent connection state.
- **Soundboard** (`1112c69`) — Server-specific sounds, voice UI with participant previews, fullscreen screen sharing.
- **File uploads** — 500MB limit, Permissions-Policy for camera/display-capture.
- **DM features** (`9ca0537`) — Reactions, editing, deletion, pinning, reply, swipeable actions, context menus, emoji picker, real-time SSE.
- **Role colors** (`c95b80c`) — Role colors, DM sorting, mention fixes, profile widget improvements.
- **System users** (`9cb4593`, `08ebb2a`, `81af23b`, `306bebe`) — SystemPill component, isSystem field, Serika broadcast user, disabled message input for system users.
- **Global announcement banner** (`31bfafe`) — Admin management UI, improved admin panels.
- **Owner crown icon** (`2ca2bc1`) — Redesigned admin user management with badge toggle UI.
- **Server badges** (`cb721f1`) — iconOnly prop, displayed across invite/explore/widgets/embeds/sidebar/profiles.
- **GIF picker redesign** (`2c854f5`) — Tag-first UI, hover previews, removed HypeSquad badges.
- **DM chat refactor** (`43b4b38`) — Shared useChatSession hook, improved channel switching, mobile layout fix.
- **serika.moe presence** (`285445b`) — Live "now watching on serika.moe" in profiles and member list.
- **Display name customization** (`438738a`) — Member list, DM pages, message headers.
- **Fade-in animations** (`b618fc4`) — GIF picker items, initial chat message batch.
- **MessageList scroll optimization** (`1bc0c01`) — Collection endpoint for GIF picker.
- **GIF favorites** (`bd2eeb4`) — Rich metadata objects with backend sync.
- **GIF picker tag loading** (`fd56723`) — Client-side pagination, lazy preview fetching.
- **Display name style redesign** (`fda8b25`) — Visual color picker UI.
- **Profile images/video grids** (`3eb53b8`) — Markdown rendering in profiles, inline status editor.
- **Friends page redesign** (`51b653d`) — Modern card layout, hide members sidebar on mobile.
- **Self-describing API** (`b1c014f`, `4652e15`) — Helpful 404s, friendly API index at /api/v10.
- **Bot gateway** (`4711609`) — Discord-compatible bot gateway, interactions, docs overhaul.
- **Slash command autocomplete** (`c23f746`) — NSFW gate persistence, font rendering improvements.
- **NSFW channel gate** (`ad95f48`) — Interactive audio trimmer, optimized channel/member loading.
- **Countdown timestamps** (`97b84e5`) — Customizable end text and color options.
- **Real-time analytics** (`9f28be7`) — Bot enablement flow to developer dashboard.
- **Forum channels** (`d0348ac`) — Posts/tickets mode, thread support, full UI integration.
- **Mobile settings** (`7e8d5bd`) — Profile and Connections pages with full customization.
- **OAuth consolidation** (`7d7a378`) — Unified /:provider/initiate and /:provider/callback.
- **Last.fm integration** (`af0e3a4`, `a12cdf0`) — OAuth, redesigned Connections tab, provider icons.
- **TTS messages** (`542057d`) — Announcement channel UI, friends list redesign, emoji autocomplete, desktop notifications.
- **Channel settings** (`2122da0`, `5d48281`, `e207078`) — Integrations, invites, advanced permissions, fullscreen, GIF banner support, file type safety.
- **File type whitelist** (`3db653d`) — Admin controls with custom MIME type management.
- **Channel count limits** (`49a2180`).
- **Channel DnD reordering** (`4d3875c`).
- **Timezone display** (`10b1f18`) — Privacy toggle.
- **Music activity** (`7c1a5c8`) — Last.fm cover art fallback, custom status clearing fix.
- **Nameplate decorations** (`7766b42`, `8be3a0e`, `459eb06`, `988bea9`) — Segmented type selector, custom gradient pickers, enhanced profile accent styling.
- **Channel sidebar** (`cdf3d34`) — Widened, fixed text overflow, prevented profile dialog unmount.
- **Admin toggle for connections** (`e15e7b2`) — Auto-format text channel names, category name truncation.
- **Message header refinements** (`1c03575`, `25a1e59`, `f3bcb40`) — Font size, weight, truncation.
- **Channel permissions UI** (`6d83b69`).
- **DM profile sidebar** (`e9918c3`) — Server nicknames in chat, broadcast fix.
- **SWR message cache** (`bf23528`) — Instant chat via SWR, faster app-shell first paint.
- **Custom emoji in messages** (`8f52d5e`) — Parse and include in channel/pinned/DM responses.
- **Auth UI** (`21413a2`) — Glassmorphic design, notification system with unread badges and toasts.
- **Custom emoji parsing** (`00a966d`) — Backend and frontend.
- **Twemoji picker** (`def417f`) — Custom emoji picker with server emoji support.
- **YouTube embeds** (`dcbe8ea`).
- **Virtualized message list** (`4844053`) — react-virtuoso for performance.
- **Skeleton loading** (`c19af42`) — Chat and sidebar areas.
- **GIF picker** (`d9d0f55`) — Component and image lightbox; DM channel deduplication.
- **Mobile header/drawer** (`f98cd52`) — Account settings page, notification service.
- **Real-time messaging** (`105a1ff`) — SSE, improved user profile UI.
- **Server dropdown** (`cbd0a38`) — Wired up buttons, channel context menu.

### Bug Fixes
- **isIOS hook** (`d9a9efc`) — Moved above early return in ChannelSidebar (React #310).
- **Guest favorites loading** (`5f94cc5`) — Deferred to avoid synchronous setState.
- **Mobile messages JSX** (`000ad28`) — Parse error for production build.
- **DM duplicate key warnings** (`725c769`) — Improved auto-scroll.
- **.equals() errors** (`7529c2f`) — When user data from cache.
- **Broadcast DM sending** (`fe21764`) — Convert system user ID to ObjectId.
- **DM button** (`256e903`) — Use userId instead of membership ID.
- **Docker build** (`23a1b35`) — Replace @emoji-mart/react with emoji-picker-react for React 19.
- **MongoDB displayName conflict** (`d8bdbfa`) — Email-only login fix.
- **Session deletion** (`4a3222f`) — Optional chaining.
- **Missing member id/displayName** (`d024e71`) — In MemberSidebar.
- **Build errors/route conflicts** (`59556f7`).
- **Android build** (`32a646d`) — Project config, GitHub Actions.
- **TypeScript build** (`a1b6637`) — Exclude mobile/desktop folders.
- **Desktop build** (`06c33c9`, `5bd14da`, `21f5c79`) — Repository field, icon requirements, npm cache.
- **Icon files** (`33fc3db`, `a77d583`) — Proper ICO/PNG with Serika branding.

### Infrastructure
- **Android Gradle/Java fixes** (`faaa30c`, `1803ef1`, `a76fdf1`, `9af59b1`, `c1cecd0`, `469f4a0`, `5ee11c5`, `570c0f2`, `4ef8861`, `eeef064`, `fe8b48c`, `f0f21a0`, `8c2c1ab`) — Java 17/21 compatibility, Gradle 8.7/8.11.1, AGP 8.9.1, compileSdk 35/36, minSdkVersion 23, Node.js 22.
- **Tauri serde_json** (`3194348`) — Added required dependency.
- **Domain redirect** (`cefee13`) — Non-serika.chat domains redirected.
- **serika-accounts bumps** (`0a49269`, `18e1a67`, `7a0ff30`, `8c4812a`, `7186306`) — OAuth consent, profile-picker, /me link fields.

### Performance
- **Instant chat** (`bf23528`) — SWR message cache, faster first paint.
- **MessageList scroll** (`1bc0c01`).
- **Member list re-rendering** (`988bea9`).

---

## Pre-v1.0.0 — Feb 2026

**Commits:** Feb 10 – Feb 13, 2026 · Between v0.0.3 and v1.0.0 development.

### Features
- **Role permission system** (`5d716f5`) — Bitfield-based permissions, user and role mentions in chat.
- **Image gallery lightbox** (`bcda23f`) — Navigation, centralized chat media handling.
- **Dynamic theming** (`926e025`) — CSS variables, theme setting validation, hardcoded token check script.
- **Theme context** (`539dce3`) — Apply user settings patches for appearance/accessibility.
- **GIF service** (`01b0968`, `526ddb9`, `1d2180b`, `b7e155f`) — Serika GIF service replacing Tenor, dedicated GifPicker component, oEmbed optimization, pagination for collections/tags.
- **Voice chat API** (`91151ae`) — Server stickers, advanced server settings, new user/server models.
- **Realtime chat UX** (`71c0cf3`, `cc175df`) — Upgraded UX, stabilized channel navigation, improved loading states.
- **Virtualized message list** (`4844053`) — react-virtuoso.
- **Mobile experience** (`f98cd52`) — New header, drawer, account settings, notification service.
- **Skeleton loading** (`c19af42`).
- **GIF picker + lightbox** (`d9d0f55`) — DM channel deduplication.
- **Custom emoji parsing** (`00a966d`) — Backend and frontend.
- **Twemoji picker** (`def417f`) — Server emoji support.
- **YouTube embeds** (`dcbe8ea`).

### Bug Fixes
- **MemberProfilePopup nullability** (`467e9f1`) — TypeScript typing fix.
- **Referenced message type** (`604de53`) — Type narrowing in channel API.
- **TypeScript target** (`14e1a5b`) — ES2020 for bigint permissions.
- **Mention suggestion logic** (`84f60f6`) — Separated static definition from filtering.
- **Mobile messages JSX** (`000ad28`) — Production build parse error.
- **DM duplicate key warnings** (`725c769`).
- **.equals() errors** (`7529c2f`) — Cache user data.
- **Broadcast DM sending** (`fe21764`) — ObjectId conversion.
- **DM button** (`256e903`) — userId vs membership ID.
- **Docker build** (`23a1b35`) — React 19 compatibility.
- **Emoji sizing** (`dcbe8ea`) — React key warning.

### Chores
- **Bun migration** (`900a971`) — Package management + core dependency updates.

---

## v0.0.3 — 2026-01-23

**Tag:** `b1c5cb0`

### Features
- Server dropdown buttons wired up, channel context menu (`cbd0a38`).
- Real-time messaging via SSE, improved user profile UI (`105a1ff`).
- Android APK build configuration (`9475485`).

### Bug Fixes
- Missing API endpoints, mobile UI improvements (`a37f8eb`).
- Android project config, GitHub Actions build (`32a646d`).
- Exclude mobile/desktop from TypeScript build (`a1b6637`).

---

## v0.0.2 — 2026-01-23

**Tag:** `9410958` — Server settings, member profiles, status fix, UI improvements.

### Features
- Discord-style mobile UI with bottom navigation (`e6f7f70`).
- Mobile/desktop app pages, member sidebar fix (`8ed2464`).
- Major UI improvements and bug fixes (`470b9a7`).

### Bug Fixes
- Channel creation API route (NOT_FOUND error) (`413fe3e`).
- Voice channels category and general voice on server creation (`413fe3e`).
- Settings scrollbar (`413fe3e`).
- Desktop build: repository field, disable publish/updates (`06c33c9`).
- Icon.ico multi-size ICO with 256x256 (`33fc3db`).
- Icon.png proper PNG with Serika branding (`a77d583`).
- serika.dev favicon as app icons (`2cd45ef`).
- Desktop build: remove icon requirements, disable auto-publish (`5bd14da`).
- GitHub Actions: remove npm cache dependency (`21f5c79`).
- Missing member id/displayName in MemberSidebar (`d024e71`).
- Build errors and route conflicts (`59556f7`).

### Other
- SerikaCord Developer badge (highest priority) (`413fe3e`).
- Admin panel in settings for staff users (`413fe3e`).
- Desktop/mobile apps skip homepage, go to /channels/me (`413fe3e`).
- Desktop app: improved update checking from GitHub releases (`413fe3e`).
- Native desktop (Electron) and mobile (Capacitor) apps with GitHub Actions (`b5fc733`).

---

## v0.0.1 — 2026-01-22

**Tag:** `413fe3e` — Initial release.

### Features
- **Standalone SerikaCord** (`7a9a08c`) — Integrated authentication.
- **Discord-like frontend UI** (`ffbb4e4`) — Built with shadcn.
- **Discord-style @me URL** (`f063374`) — URL with rewrite.
- **Pfp/banner upload** (`ccacb7f`) — Upload endpoints to accounts.
- **Black/purple theme** (`8192a1d`) — Theme overhaul + accounts API auth proxy.
- **Mobile responsiveness** (`990b3bb`) — User profile popup, settings, DM support.
- **Comprehensive README** (`1a41091`).
- **serika-accounts** (`03ca353`) — Preserved with enhanced security.

### Bug Fixes
- **MongoDB displayName conflict** (`d8bdbfa`) — Email-only login.
- **Session deletion** (`4a3222f`) — Optional chaining.

### Chores
- serika-accounts submodule updates (`b020d01`, `bb58318`, `bdb184f`).

---

## Initial Commit

`477a2e7` — 2026-01-22 10:37:42 +0100 — Initial commit.

---

## Bug Issues Fixed (Complete Index)

| # | Bug | Commit | Severity |
|---|---|---|---|
| 1 | XSS vulnerability — user content not sanitized | `876357a` | Critical |
| 2 | Internal-route auth bypass | `7bff928` | Critical |
| 3 | Cross-account message cache leakage | `f11b45f` | High |
| 4 | Message.findOne ignored id/isDeleted filters | `c68ff7a` | High |
| 5 | 12 silent filter-drop bugs across models | `0046f4d` | High |
| 6 | SEND_MESSAGES overwrites not enforced | `a023658` | High |
| 7 | No spam protection (duplicate messages) | `3c89f69` | High |
| 8 | Auto-pagination on channel open | `dfd3cfc` | High |
| 9 | Deployment OOM crash | `8ff56c2` | High |
| 10 | Gateway identify crash on Postgres DM lookup | `a82d0e5` | High |
| 11 | DMs crash — useUnread outside UnreadProvider | `87ba08d` | High |
| 12 | Bot Invalid Date / ephemeral messages | `7c2e9cb` | Medium |
| 13 | Channel-switch flash of previous messages | `dfd3cfc` | Medium |
| 14 | Inconsistent CDN URL handling (broken images) | `f964947` | Medium |
| 15 | Bug report form buttons disappeared when open | `ba3889f` | Medium |
| 16 | No keyboard Escape for bug report form | `ba3889f` | Medium |
| 17 | Invite dialog failed to surface errors | `ba3889f` | Medium |
| 18 | Only bug reports, no feedback submission | `a203261` | Medium |
| 19 | Emoji favorites only for custom emojis | `95379fb` | Medium |
| 20 | Context menus clipped by parent containers | `11c342e` | Medium |
| 21 | Custom status not displaying in sidebar | `32c1fdf` | Medium |
| 22 | Explore page hardcoded colors vs theme | `f645426` | Medium |
| 23 | No per-user experiment management UI | `dacc470` | Medium |
| 24 | Emoji upload script wrong server ID | `f961aa6` | Medium |
| 25 | Emoji picker sidebar overflow | `3d49b50` | Medium |
| 26 | Timeout countdown static, not live | `a023658` | Medium |
| 27 | ANSI code blocks as plain text | `fa7d97a` | Medium |
| 28 | No bug report system existed | `fa7d97a` | Medium |
| 29 | File uploads click-only (no drag-and-drop) | `be72d0d` | Medium |
| 30 | No search/filter for bug reports | `be72d0d` | Medium |
| 31 | Stale-channel race on server switch | `80af6a9` | Medium |
| 32 | Profile update serialization field loss | `d54ac49` | Medium |
| 33 | Mobile profile view overflow | `cfc5432` | Medium |
| 34 | Member sidebar overflow | `988bea9` | Medium |
| 35 | Custom emoji sizing/detection | `35d1ee2` | Medium |
| 36 | User staff status logic / auth verification | `b10446e` | Medium |
| 37 | isIOS hook below early return (React #310) | `d9a9efc` | Medium |
| 38 | Guest favorites synchronous setState | `5f94cc5` | Medium |
| 39 | MongoDB displayName conflict + email-only login | `d8bdbfa` | Medium |
| 40 | Broadcast DM sending — ObjectId conversion | `fe21764` | Medium |
| 41 | DM button used membership ID instead of userId | `256e903` | Medium |
| 42 | Docker build — React 19 compatibility | `23a1b35` | Medium |
| 43 | sysinfo 0.30 deprecated trait imports | `448389b` | Medium |
| 44 | TypeScript build errors (isBot/isSystem) | `3702bb2` | Medium |
| 45 | Next.js proxy Host header not preserved | `9207032` | Medium |
| 46 | Bot API edit/delete — message not validated to channel | `5b565df` | Medium |
| 47 | Experiment identifiers used _id instead of id | `d5c93bc` | Medium |
| 48 | Scroll-up pagination from short cached tail | `44012e6` | Medium |
| 49 | Member sidebar spacing — nested space-y conflicts | `98cdd77` | Low |
| 50 | Shift key state stuck on window blur | `d298c70` | Low |
| 51 | ChannelSettingsDialog lacked Escape | `e32a82f` | Low |
| 52 | Standard Unicode emojis had no context menu | `11c342e` | Low |
| 53 | Standard emoji categories below server categories | `f961aa6` | Low |
| 54 | Category icon buttons compressed by flex | `f961aa6` | Low |
| 55 | Mobile category pills inconsistent with desktop | `f645426` | Low |
| 56 | Advanced bug fields always visible | `be72d0d` | Low |
| 57 | Developer docs referenced discord.js | `45c60ad` | Low |
| 58 | Message actions required multiple clicks | `d298c70` | Low |
| 59 | No keyboard shortcuts for search/edit | `32c1fdf` | Low |
| 60 | Short channels triggered unnecessary pagination | `dfd3cfc` | Low |
| 61 | GIF favorite button positioning | `009e35d` | Low |
| 62 | serika.moe lookup used username instead of ID | `91d3de9` | Low |
| 63 | Mobile scroll gesture opens profile popup | `6d83b78` | Low |
| 64 | Drag event bubbling in server sidebar | `3814737` | Low |
| 65 | SSE proxy buffering | `7e7460b` | Low |
| 66 | Mobile messages JSX parse error (prod build) | `000ad28` | Low |
| 67 | DM duplicate key warnings | `725c769` | Low |
| 68 | .equals() errors from cached user data | `7529c2f` | Low |
| 69 | Session deletion optional chaining | `4a3222f` | Low |
| 70 | Missing member id/displayName in MemberSidebar | `d024e71` | Low |
| 71 | Build errors and route conflicts | `59556f7` | Low |
| 72 | Android project config / GitHub Actions | `32a646d` | Low |
| 73 | TypeScript build — mobile/desktop folders | `a1b6637` | Low |
| 74 | Desktop build — repository field | `06c33c9` | Low |
| 75 | Desktop build — icon requirements | `5bd14da` | Low |
| 76 | GitHub Actions — npm cache dependency | `21f5c79` | Low |
| 77 | Icon.ico not multi-size | `33fc3db` | Low |
| 78 | Icon.png not proper PNG | `a77d583` | Low |
| 79 | MemberProfilePopup member nullability typing | `467e9f1` | Low |
| 80 | Referenced message type narrowing | `604de53` | Low |
| 81 | TypeScript target ES2020 for bigint | `14e1a5b` | Low |
| 82 | Mention suggestion logic separation | `84f60f6` | Low |
| 83 | Emoji sizing / React key warning | `dcbe8ea` | Low |
| 84 | Unused file and references | `fdbf06a` | Low |
| 85 | PR review issues | `20cfc0c` | Low |
| 86 | Bot slash commands client-side interception | `d291848` | Low |
| 87 | Gateway drop troubleshooting | `5f8cfe5` | Low |
| 88 | Non-serika.chat domain redirect | `cefee13` | Low |
| 89 | Tauri missing serde_json dependency | `3194348` | Low |
| 90 | Java/Gradle/Android SDK compatibility (multiple) | `faaa30c`–`f0f21a0` | Low |

---

## Statistics

- **Total commits:** 293
- **Date range:** Jan 22 – Jul 16, 2026
- **Releases:** v0.0.1, v0.0.2, v0.0.3, v1.0.0, v1.0.1, v1.0.2, v1.0.3, v1.0.4, v1.0.5 + unreleased
- **Critical bugs fixed:** 2 (XSS, auth bypass)
- **High-severity bugs fixed:** 9
- **Medium-severity bugs fixed:** 33
- **Low-severity bugs fixed:** 46
- **Total bugs catalogued:** 90
