# Serika Social SDK, Profile Widgets, RPC & Developer API — Design Doc

Status: **Proposed** · Target: SerikaCord v1.2.0 · Owner: Pikachubolk

This covers all five requested features as one coherent system. The unifying idea:
**a user's profile is composed of "widgets"; widgets get their data from a Serika
application (native "Serika RPC" apps or third-party apps via the Social SDK); and
everything is reachable through a versioned public Native API.**

---

## 0. Existing building blocks (reused, not rebuilt)

| Concern | Existing | Reuse how |
|---|---|---|
| Rich presence live state | `rich_presence` table + `RichPresence` model (`src/lib/models/RichPresence.ts`) | Extend with `applicationId`, `assets`, `buttons`, `partyId`. |
| Recently-played log | `activity_history` table | Feeds "Games in rotation" auto-suggestions. |
| Game metadata | `igdbService.ts` (IGDB + Steam, English titles) | Game search for library widgets + widget images. |
| Applications / bots | `applications` table + `src/lib/api/developers.ts` | "Serika RPC" app = an `applications` row; widget configs attach here. |
| Profile render | `src/components/user/ProfileCard.tsx` | Add a widgets column; new `<ProfileWidget>` renderers. |
| Dev portal shell | `src/app/developers/` | Add Social SDK + Widget editor pages. |

---

## 1. Data model (new tables)

### 1.1 `user_games` — per-user game library
Backs Favorite / Games I Like / In rotation / Want to play.

```
user_games
  id            uuid pk
  userId        uuid  -> users.id, indexed
  igdbId        integer null        -- IGDB game id when resolved
  steamAppId    text null
  name          text notNull
  coverUrl      text null
  category      text notNull        -- 'favorite' | 'liked' | 'rotation' | 'wishlist'
  tags          jsonb default []    -- user chips e.g. "Love it","Obsessed"
  note          text null           -- "why this is your favorite"
  position      integer default 0   -- ordering within a category
  createdAt / updatedAt
  UNIQUE(userId, category, igdbId)  -- (null igdbId falls back to name)
```
Category limits enforced in service layer: favorite ≤ 1, liked ≤ 20, rotation ≤ 5, wishlist ≤ 20.

### 1.2 `widget_configs` — application-authored widget definition (Discord "widget config")
```
widget_configs
  id            uuid pk
  applicationId uuid -> applications.id, indexed, UNIQUE (one config per app)
  name          text notNull            -- shown on the widget header
  status        text 'draft'|'published'
  surfaces      jsonb                    -- see §3 surface schema
  sampleData    jsonb                    -- preview/sample user data
  version       integer default 1
  publishedAt   timestamp null
  createdAt / updatedAt
```

### 1.3 `widget_user_data` — per-user dynamic values for a widget (Discord "User Data")
```
widget_user_data
  id            uuid pk
  applicationId uuid indexed
  userId        uuid indexed
  data          jsonb                    -- { dynamic: [{type,name,value}] } (Discord shape)
  updatedAt
  UNIQUE(applicationId, userId)
```

### 1.4 `profile_widgets` — what a user placed on their profile & order
Stored as a jsonb column on `users` (mirrors Discord `/users/@me/widgets`) to avoid a join on every profile load:
```
users.profileWidgets jsonb default []
  [{ id, type: 'application'|'builtin',
     applicationId?, builtin?: 'favorite_game'|'games_i_like'|'games_rotation'|'want_to_play',
     position }]
```
Built-in widgets (the four game-library ones) need no application and render from `user_games`.

### 1.5 RPC extensions
Add to `rich_presence`: `applicationId uuid null`, `assets jsonb null`
(`{ large_image, large_text, small_image, small_text }`), `buttons jsonb null`
(`[{label,url}]`), `partyId text null`, `partySize jsonb null`. Keeps current
columns so the existing system keeps working unchanged.

"Serika RPC" apps: no new table — a Serika RPC connection is an `applications`
row the user configures with a bot ID; presence pushed to it is stamped with
`applicationId` so we can resolve widget assets/accessory text.

Migration: hand-written SQL in `drizzle/` (repo convention — see MEMORY read-states note about applying manual SQL).

---

## 2. Native Public API (`/api/v1/...`) — the "Social SDK" surface

New Elysia router `src/lib/api/social-sdk.ts`, mounted under `/api/v1`. Auth via
**application bearer token** (bot token or OAuth2 access token with scopes), rate-limited.
Designed so a native binary SDK can wrap these later.

### Scopes (new): `sdk.presence`, `sdk.relationships`, `sdk.widgets.write`, `sdk.games.read`, `sdk.games.write`

### Endpoints
```
# Identity / relationships
GET    /api/v1/users/@me                      -> current token user
GET    /api/v1/users/:id                      -> public profile
GET    /api/v1/users/@me/relationships        -> friends/blocked (Social SDK core)
GET    /api/v1/users/@me/presences            -> friends' live presence (for SDK feed)

# Rich presence (Serika RPC)
PUT    /api/v1/users/@me/rich-presence        -> set/replace live presence (assets, buttons)
DELETE /api/v1/users/@me/rich-presence

# Widget user-data (dynamic widget values)
GET    /api/v1/applications/:id/widget/config           -> published config (public)
PUT    /api/v1/applications/:id/users/@me/widget-data   -> push this user's dynamic data
GET    /api/v1/applications/:id/users/:uid/widget-data  -> read (owner/self)

# Profile widgets (mirror Discord)
GET    /api/v1/users/:id/profile              -> { widgets: [...] } resolved for render
PUT    /api/v1/users/@me/widgets              -> reorder/add/remove placed widgets

# Game library
GET    /api/v1/users/:id/games?category=      -> library
PUT    /api/v1/users/@me/games                -> add/update/remove entries
GET    /api/v1/games/search?q=                -> IGDB-backed search (for pickers)
```
Docs: new pages under `src/app/developers/docs/social-sdk/*` (overview, external-auth,
comms-access, relationships, presence, widgets, api-reference) + a "Getting Started"
mirror of Discord's Social SDK landing. Reuse `DocPage.tsx`.

---

## 3. Widget config schema & editor

### 3.1 Surface schema (stored in `widget_configs.surfaces`)
```jsonc
{
  "widget_top":    { "design": "image_title_subtitles",
                     "fields": [ { "slot":"image","valueType":"user_data|custom_string|app_asset","value":"TopShowImg" }, ... ] },
  "widget_bottom": { "design": "grid_6" | "progress_image" | "grid_4_images", "fields": [...] },
  "add_preview":   { ... },
  "mini_profile":  { ... },
  "activity_accessory": { "text": {...} }
}
```
Field component: `{ slot, valueType, presentationType: 'text'|'number'|'duration',
value, fallback }` — 1:1 with the Discord guide's semantics.

### 3.2 Editor UI (`src/app/developers/applications/[id]/widget/page.tsx`)
Recreate the polished editor from the screenshot:
- Left: surface selector + content-field list (Required badges).
- Center: **live preview** rendered by the same `<WidgetRenderer>` used on profiles.
- Right: per-field inspector (Value Type, Data Field/Content, Fallback, Presentation).
- Bottom: **Validation** tab + **Sample Data** tab with `Generate JSON` (emits the exact
  `{ data: { dynamic: [...] } }` shape from the prompt).
- Header: Save / Publish / Unpublish / Delete.
Built with existing `@dnd-kit` for field ordering, shadcn/ui, theme CSS vars (never hardcode — MEMORY: cdn-media/theme rules).

### 3.3 Shared renderer
`src/components/widgets/WidgetRenderer.tsx` — single component consuming
`(config, userData)` → renders each surface. Used in: editor preview, `ProfileCard`,
mini-profile popup, and the "Add Widget" modal. Guarantees WYSIWYG.

---

## 4. Profile widgets UX (the four built-ins + app widgets)

- **Add Widget modal** (`src/components/user/AddWidgetDialog.tsx`) — mirrors screenshot 3:
  lists built-ins + eligible published app widgets; "Link your account" CTA for app widgets.
- **Board tab** on own profile: edit favorite game (note + tags), Games I like (grid,
  show 8 → "Show more" = 2 rows of 4), Games in rotation (≤5), Want to play (grid w/ show more).
- Game picker: IGDB search (`/api/v1/games/search`), reuses game card visuals already
  present (screenshot 1). Drag to reorder via `@dnd-kit`.
- Renders on both own and others' profiles via `WidgetRenderer` + built-in game grids.

---

## 5. Serika RPC + images

- Keep current presence path untouched. Add an **"assets"** concept: `largeImageUrl`/
  `smallImageUrl` already exist; add structured `assets` + `buttons` and resolve
  `mediaproxy`/CDN URLs through existing `cdnImage()` (MEMORY: cdn-media).
- **Serika RPC app config**: in dev portal, an app gains an "RPC / Serika RPC" tab where
  the owner sets a bot ID + asset keys → uploaded images become named assets
  (`app_asset` value type reused by widgets). Presence reported with `applicationId`
  resolves asset keys → URLs, and shows the widget's `activity_accessory` text.
- Client: extend the desktop RPC reporter (`desktop/`, `desktop-tauri/`) to send
  `applicationId` + asset keys. (Separate follow-up per platform; API accepts it now.)

---

## 6. Developer dashboard polish

- Redesign `DevelopersLayoutClient.tsx` + application overview into a cleaner card/section
  layout matching the Discord portal screenshot (sidebar groups: Overview, Games [Claim,
  Social SDK, Widget], Activities, Premium). Pure UI/theme-var work, no data changes.
- New nav items: **Social SDK** (Overview / External Auth / Comms Access) and **Widget**
  under a "Games" group, gated to app owners/team.

---

## 7. Build order (phases, each independently shippable)

1. **Schema + migrations** (§1) — tables, `users.profileWidgets`, `rich_presence` cols.
2. **Game library** — `user_games`, service w/ limits, `/api/v1/.../games`, `games/search`.
3. **Profile game widgets** — built-in renderers, Board tab, Add Widget modal (screenshots 2–3).
4. **Widget config + editor** — `widget_configs`, `WidgetRenderer`, editor page (screenshot 4).
5. **Widget user-data + app widgets on profile** — `widget_user_data`, resolve+render.
6. **Serika RPC + images** — presence extensions, RPC app tab, asset resolution.
7. **Native Social SDK API + docs** — `/api/v1` router, scopes, doc pages (screenshot 5).
8. **Dashboard polish** — portal redesign + nav.

Each phase: schema note → model → Elysia routes wired in `src/lib/api/index.ts` /
`server.ts` → UI → theme/i18n check (`bun run check:theme`), dev restart for SSE/enum.

---

## 8. Open questions / decisions taken
- Social SDK fidelity: **native endpoints + docs now, binary later** (confirmed).
- `profile_widgets` as jsonb on `users` (fast profile load) vs table — chose jsonb.
- Widget images hosting: user-data images must be public URLs → route through Serika CDN.
- Rate limits & abuse: `/api/v1` reuses existing security/rate-limit middleware.
