# SerikaCord

A modern, Discord-compatible chat platform built with Next.js, Bun, and PostgreSQL.

![SerikaCord](https://img.shields.io/badge/SerikaCord-8b5cf6?style=for-the-badge&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4IiBmaWxsPSJub25lIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZmF2R3JhZGllbnQiIHgxPSI2IiB5MT0iNCIgeDI9IjQyIiB5Mj0iNDQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2E3OGJmYSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM4YjVjZjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgcng9IjEyIiBmaWxsPSIjMGEwYTBhIi8+CiAgPHJlY3QgeD0iMC43NSIgeT0iMC43NSIgd2lkdGg9IjQ2LjUiIGhlaWdodD0iNDYuNSIgcng9IjExLjI1IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YjVjZjYiIHN0cm9rZS13aWR0aD0iMC43NSIgb3BhY2l0eT0iMC4yNSIvPgogIDxwYXRoIGQ9Ik0xMS41IDMwIEM3IDMyIDYuNSAzOCA4LjIgNDEuNSBDOSA0MyAxMS4zIDQyLjggMTEuNyA0MSBDMTEgMzcgMTEuNSAzMyAxMy4yIDMxIFoiIGZpbGw9IiMyYTJhNDQiLz4KICA8cGF0aCBkPSJNMzYuNSAzMCBDNDEgMzIgNDEuNSAzOCAzOS44IDQxLjUgQzM5IDQzIDM2LjcgNDIuOCAzNi4zIDQxIEMzNyAzNyAzNi41IDMzIDM0LjggMzEgWiIgZmlsbD0iIzJhMmE0NCIvPgogIDxwYXRoIGQ9Ik04LjYgMzEgTDEwIDMyIEw4LjYgMzMgWiIgZmlsbD0iIzM4YmRmOCIvPjxwYXRoIGQ9Ik0xMS40IDMxIEwxMCAzMiBMMTEuNCAzMyBaIiBmaWxsPSIjMzhiZGY4Ii8+CiAgPHBhdGggZD0iTTM5LjQgMzEgTDM4IDMyIEwzOS40IDMzIFoiIGZpbGw9IiMzOGJkZjgiLz48cGF0aCBkPSJNMzYuNiAzMSBMMzggMzIgTDM2LjYgMzMgWiIgZmlsbD0iIzM4YmRmOCIvPgogIDxwYXRoIGQ9Ik0xMi41IDE4IFExMC41IDggMTIuNSA0IFExOSA4IDIzIDE1LjUgWiIgZmlsbD0idXJsKCNmYXZHcmFkaWVudCkiLz4KICA8cGF0aCBkPSJNMjUgMTUuNSBRMjkgOCAzNS41IDQgUTM3LjUgOCAzNS41IDE4IFoiIGZpbGw9InVybCgjZmF2R3JhZGllbnQpIi8+CiAgPHBhdGggZD0iTTE0LjUgMTUuNSBRMTMuMiA4LjUgMTQuNSA1LjUgTDIwLjggMTQuNSBaIiBmaWxsPSIjZjlhOGQ0IiBvcGFjaXR5PSIwLjkiLz4KICA8cGF0aCBkPSJNMjcgMTQuNSBMMzMuNSA1LjUgUTM0LjggOC41IDMzLjUgMTUuNSBaIiBmaWxsPSIjZjlhOGQ0IiBvcGFjaXR5PSIwLjkiLz4KICA8cGF0aCBkPSJNMjQgMTMgQzMyLjggMTMgMzguNSAxOC44IDM4LjUgMjcgQzM4LjUgMzUgMzIuOCA0MC41IDI0IDQwLjUgQzE1LjIgNDAuNSA5LjUgMzUgOS41IDI3IEM5LjUgMTguOCAxNS4yIDEzIDI0IDEzIFoiIGZpbGw9InVybCgjZmF2R3JhZGllbnQpIi8+CiAgPHBhdGggZD0iTTE1IDM5IEw5LjUgNDQgTDIwIDQwIFoiIGZpbGw9InVybCgjZmF2R3JhZGllbnQpIi8+CiAgPHBhdGggZD0iTTExIDMzIEM5LjUgMjUgOS4zIDE3IDE0IDE0IEMxNy41IDEyLjMgMzAuNSAxMi4zIDM0IDE0IEMzOC43IDE3IDM4LjUgMjUgMzcgMzMgTDM1LjUgMjYgTDM0IDIyIEwzMC41IDI2LjUgTDI3IDIxLjUgTDI0IDI2LjUgTDIxIDIxLjUgTDE3LjUgMjYuNSBMMTQgMjIgTDEyLjUgMjYgWiIgZmlsbD0iIzJhMmE0NCIvPgogIDxlbGxpcHNlIGN4PSIxNy44IiBjeT0iMzEiIHJ4PSIzLjEiIHJ5PSIzLjUiIGZpbGw9IiNmZmZmZmYiLz4KICA8ZWxsaXBzZSBjeD0iMzAuMiIgY3k9IjMxIiByeD0iMy4xIiByeT0iMy41IiBmaWxsPSIjZmZmZmZmIi8+CiAgPGVsbGlwc2UgY3g9IjE3LjkiIGN5PSIzMS40IiByeD0iMS42IiByeT0iMi4zIiBmaWxsPSIjZTExZDQ4Ii8+CiAgPGVsbGlwc2UgY3g9IjMwLjEiIGN5PSIzMS40IiByeD0iMS42IiByeT0iMi4zIiBmaWxsPSIjZTExZDQ4Ii8+CiAgPGNpcmNsZSBjeD0iMTcuOSIgY3k9IjMxLjYiIHI9IjAuOCIgZmlsbD0iIzdmMWQxZCIvPgogIDxjaXJjbGUgY3g9IjMwLjEiIGN5PSIzMS42IiByPSIwLjgiIGZpbGw9IiM3ZjFkMWQiLz4KICA8Y2lyY2xlIGN4PSIxNy4yIiBjeT0iMzAuMSIgcj0iMC45IiBmaWxsPSIjZmZmZmZmIi8+CiAgPGNpcmNsZSBjeD0iMjkuNCIgY3k9IjMwLjEiIHI9IjAuOSIgZmlsbD0iI2ZmZmZmZiIvPgogIDxlbGxpcHNlIGN4PSIxMi44IiBjeT0iMzQuNCIgcng9IjIuMyIgcnk9IjEuNCIgZmlsbD0iI2Y5YThkNCIgb3BhY2l0eT0iMC43Ii8+CiAgPGVsbGlwc2UgY3g9IjM1LjIiIGN5PSIzNC40IiByeD0iMi4zIiByeT0iMS40IiBmaWxsPSIjZjlhOGQ0IiBvcGFjaXR5PSIwLjciLz4KICA8cGF0aCBkPSJNMjEuOCAzNiBRMjMuMiAzNy40IDI0IDM2LjIgUTI0LjggMzcuNCAyNi4yIDM2IiBzdHJva2U9IiMzYjA3NjQiIHN0cm9rZS13aWR0aD0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+Cjwvc3ZnPgo=&logoColor=fff)
![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=next.js&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**Live:** [serika.chat](https://serika.chat) · **API:** [api.serika.chat](https://api.serika.chat)

## Features

### Communication
- **Real-time Messaging** — Server-Sent Events (SSE) streaming with sub-second delivery
- **Direct Messages** — 1:1 and group DMs with full media support
- **Voice & Video** — WebRTC-based voice channels, screen sharing, and video calls
- **Slash Commands** — Built-in and custom bot commands with autocomplete
- **Rich Embeds** — Link previews, oEmbed, image/video inline rendering
- **TTS** — AI-powered text-to-speech (Fish Audio integration)

### Servers & Communities
- **Server Management** — Create servers, channels, categories, and roles
- **Granular Permissions** — Role-based access control with channel overrides
- **Member Management** — Kicking, banning, timeouts, and role assignment
- **Server Mutes** — Per-server notification controls
- **Custom Emojis** — Upload and use custom emoji across servers

### Developer Platform
- **Bot Gateway** — Discord-compatible WebSocket gateway (`wss://api.serika.chat/api/v10/gateway`)
- **REST API** — Full bot API for messages, channels, servers, and interactions
- **OAuth2** — Discord and GitHub OAuth2 for third-party app authentication
- **Developer Portal** — Create and manage bot applications at [/developers](https://serika.chat/developers)
- **API Docs** — Built-in documentation at [/developers/docs](https://serika.chat/developers/docs/intro)
- **serika.js SDK** — Official TypeScript SDK (`packages-api/serika.js`)

### Presence & Activity
- **Rich Presence** — Live "now watching" streaming status via SerikaMoe
- **Last.fm Integration** — Display currently playing music
- **Game Detection** — IGDB-powered rich presence for desktop games
- **Custom Status** — Set custom status messages with expiry

### Media & Files
- **File Uploads** — Up to 500MB (free) / 2GB (Serika+) via Backblaze B2
- **Image Previews** — Inline rendering with lightbox viewer
- **GIF Search** — Integrated GIF picker (Serika GIFs API)
- **Markdown Rendering** — Full markdown support with sanitization

### Platform
- **Desktop App** — Tauri-based desktop client (see `desktop-tauri/`)
- **Mobile App** — Capacitor-based mobile client (see `mobile/`)
- **i18n** — Multi-language support via General Translation (100+ locales)
- **Premium** — Stripe-powered Serika+ subscription tier
- **Admin Panel** — Full administrative dashboard for staff

## Tech Stack

### Frontend
- **Next.js 16** — React framework with App Router (webpack build)
- **React 19** — UI library
- **Tailwind CSS v4** — Utility-first styling
- **shadcn/ui** — Accessible UI components (Radix primitives)
- **Lucide Icons** — Modern icon set
- **Framer Motion** — Animations

### Backend
- **Bun** — JavaScript runtime & package manager
- **Elysia** — Bun-native API framework (REST routes)
- **Next.js Server** — Custom server (`server.ts`) hosting app + gateway on one port
- **PostgreSQL** — Primary database via Drizzle ORM
- **Redis** — Pub/sub, session storage, caching, and SSE fan-out
- **Backblaze B2** — S3-compatible file storage

### Realtime
- **Server-Sent Events (SSE)** — Chat message streaming (raw socket fast-path)
- **WebSocket Gateway** — Bot gateway with heartbeats and resumable sessions
- **WebRTC** — Peer-to-peer voice/video via simple-peer
- **Redis Pub/Sub** — Cross-instance event fan-out for horizontal scaling

### Security
- **bcryptjs** — Password hashing
- **JWT** — Token-based authentication (30-day expiry, 90-day refresh)
- **Rate Limiting** — API abuse protection via rate-limiter-flexible
- **XSS Protection** — sanitize-html + xss for message content
- **Security Headers** — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **CORS** — Configurable allowed origins

### Infrastructure
- **Docker** — Full docker-compose stack with app, PostgreSQL, Redis, and nginx
- **Nginx** — Reverse proxy with SSE-aware compression
- **AWS SES** — Transactional email delivery
- **Stripe** — Payment processing for Serika+ subscriptions

## Project Structure

```
SerikaCord/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (auth)/                 # Login & register pages
│   │   ├── (legal)/                # Terms, privacy, community guidelines
│   │   ├── channels/               # Main chat interface
│   │   │   ├── me/                 # Direct messages
│   │   │   └── [serverId]/         # Server & channel views
│   │   ├── developers/             # Developer portal & API docs
│   │   ├── dm/                     # DM list
│   │   ├── oauth2/                 # OAuth2 authorization flow
│   │   ├── download/               # Desktop/mobile download page
│   │   ├── widget/                 # Server widgets
│   │   └── api/                    # API route handlers (Elysia)
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components
│   │   ├── chat/                   # Message rendering, input, embeds
│   │   ├── voice/                  # Voice/video UI
│   │   ├── settings/               # User settings panels
│   │   ├── mobile/                 # Mobile-specific components
│   │   └── dialogs/                # Modal dialogs
│   ├── contexts/                   # React contexts (Auth, Server, Theme)
│   ├── hooks/                      # Custom React hooks
│   ├── lib/
│   │   ├── api/                    # API route handlers (auth, channels, servers, etc.)
│   │   ├── services/               # Business logic (auth, voice, notifications, etc.)
│   │   ├── db/                     # Drizzle ORM schema & connection
│   │   ├── models/                 # Database models
│   │   ├── gateway/                # Bot WebSocket gateway
│   │   ├── discord/                # Discord bridge bot
│   │   ├── permissions/            # Permission system
│   │   └── config.ts               # Centralized configuration
│   └── server/                     # Server-side utilities
├── packages-api/
│   └── serika.js/                  # Official TypeScript bot SDK
├── desktop-tauri/                  # Tauri desktop app
├── mobile/                         # Capacitor mobile app (Android)
├── serika-accounts/                # External accounts auth service
├── drizzle/                        # Database migrations
├── public/                         # Static assets (icons, sounds, translations)
├── nginx/                          # Nginx reverse proxy config
├── server.ts                       # Custom production server (app + gateway + SSE)
├── docker-compose.yml              # Full stack deployment
└── Dockerfile                      # Container image
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- [PostgreSQL](https://www.postgresql.org/) 15+
- [Redis](https://redis.io/) 7+
- [Backblaze B2](https://www.backblaze.com/b2/) account (for file uploads)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/serika-dev/SerikaCord.git
   cd SerikaCord
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your PostgreSQL, Redis, B2, and OAuth credentials. See [`.env.example`](.env.example) for all options.

4. **Run database migrations**
   ```bash
   bunx drizzle-kit migrate
   ```

5. **Start the development server**
   ```bash
   bun dev
   ```

6. **Open the app**

   Navigate to [http://localhost:3000](http://localhost:3000)

### Building for Production

```bash
bun run build
bun start
```

The custom server (`server.ts`) hosts the Next.js app, bot gateway, and SSE streams on a single port.

## Docker

```bash
docker-compose up -d
```

This starts the app, PostgreSQL, Redis, and optionally nginx (production profile).

## Bot Development

SerikaCord provides a Discord-compatible bot gateway. Bots connect via WebSocket and interact through a REST API.

- **Gateway:** `wss://api.serika.chat/api/v10/gateway`
- **REST API base:** `https://api.serika.chat`
- **SDK:** `packages-api/serika.js`
- **Docs:** [serika.chat/developers/docs](https://serika.chat/developers/docs/intro)

See [`packages-api/serika.js`](packages-api/serika.js) for the official SDK, or check the `example-bot/` directory for a minimal bot example.

## Desktop & Mobile

- **Desktop:** The Tauri-based desktop client is in `desktop-tauri/`. See its [README](desktop-tauri/README.md) for build instructions.
- **Mobile:** The Capacitor-based Android app is in `mobile/`. See its [README](mobile/README.md) for setup.

## Contributing

Contributions are welcome! Please read the [Security Policy](SECURITY.md) before reporting vulnerabilities.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the **SerikaCord Source Available License** — see the [LICENSE](LICENSE) file for details.

**Key points:**
- View and study source code for personal education
- Fork for personal learning and experimentation
- Commercial use prohibited without written permission
- Creating competing products prohibited
- Redistribution prohibited

## Security

For security vulnerabilities, see [SECURITY.md](SECURITY.md). **We do not offer a bug bounty program.**

---

<p align="center">
  Made with care by the SerikaCord Team
</p>
