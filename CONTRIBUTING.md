# Contributing to SerikaCord

First off — thank you for taking the time to contribute! SerikaCord is built by a small team and we genuinely appreciate every bug report, feature idea, translation, and pull request.

This document covers everything you need to know to get your first PR merged.

---

## Table of Contents

- [Branch Structure](#branch-structure)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Project Structure](#project-structure)
- [What You Can Contribute](#what-you-can-contribute)
- [PR Checklist](#pr-checklist)
- [Security](#security)
- [License](#license)

---

## Branch Structure

| Branch   | Purpose                                         | Who merges into it         |
|----------|-------------------------------------------------|----------------------------|
| `main`   | Stable production — what runs on serika.chat    | Maintainers only           |
| `canary` | Active development — **all PRs target this**    | Contributors & maintainers |

> **PRs targeting `main` will be closed without review.** Always open your PR against `canary`.
>
> `main` is the default branch on GitHub, but it is protected. `canary` is where the action happens — it gets merged into `main` on releases.

---

## Getting Started

### Prerequisites

| Tool       | Version  | Notes                                              |
|------------|----------|----------------------------------------------------|
| [Bun](https://bun.sh) | 1.3+   | Package manager & runtime                          |
| Node.js    | 22+      | Required by Next.js                                |
| PostgreSQL | 15+      | Primary database                                   |
| Redis      | 6+       | Caching, rate limiting, presence                   |
| Git        | 2.30+    |                                                    |

### Fork & Clone

```sh
# 1. Fork on GitHub, then:
git clone https://github.com/<your-username>/SerikaCord.git
cd SerikaCord

# 2. Add upstream remote
git remote add upstream https://github.com/serika-dev/SerikaCord.git

# 3. Fetch and switch to canary
git fetch upstream
git checkout canary
git pull upstream canary
```

---

## Development Setup

### 1. Install dependencies

```sh
bun install
```

### 2. Configure environment

```sh
cp .env.example .env
```

Edit `.env` with your local database, Redis, and OAuth credentials. Not all keys are required for local development — see the comments in `.env.example` for what's optional.

### 3. Start the stack

The easiest way to get Postgres + Redis running locally:

```sh
docker compose up -d
```

Or use your own local instances.

### 4. Run database migrations

```sh
bun run db:migrate
```

### 5. Start the dev server

```sh
bun run dev
```

The app will be available at `http://localhost:3000`.

### Other dev commands

| Command                    | Description                          |
|----------------------------|--------------------------------------|
| `bun run dev`              | Full dev server (Bun + Next.js)      |
| `bun run dev:next`         | Next.js only (faster HMR)            |
| `bun run lint`             | Run ESLint                           |
| `bun run build`            | Production build                     |
| `bun run check:theme`      | Check for hardcoded theme colors     |
| `bun run check:chat-media` | Check for hardcoded chat media URLs  |

### Desktop development (Qt)

```sh
cd desktop-QT
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --parallel
./SerikaCord
```

### Desktop development (Tauri)

```sh
cd desktop-tauri
bun install
bun run tauri dev
```

---

## Pull Request Process

### 1. Create a feature branch

Always branch off `canary`:

```sh
git checkout canary
git pull upstream canary
git checkout -b feature/your-feature-name
```

Use a descriptive branch name:
- `feature/voice-channel-reconnect`
- `fix/message-bar-paste-image`
- `docs/api-endpoints`

### 2. Make your changes

- Keep commits focused — one logical change per commit
- Write clear, conventional commit messages (see below)
- Test your changes locally

### 3. Commit message conventions

We use a lightweight conventional commit style:

```
<area>: <description>
```

**Examples:**
```
chat: fix image paste on desktop client
desktop: add hardware acceleration flags
api: add rate limiting to message endpoints
ui: fix sidebar scrollbar on small screens
db: add index on messages.channelId
```

### 4. Push and open a PR

```sh
git push origin feature/your-feature-name
```

Open a PR on GitHub targeting **`canary`**. Include:

- **Clear title** — `fix: message bar crashes on empty paste`
- **Description** — What does this change? Why is it needed?
- **Screenshots/Videos** — For UI changes, always include before/after
- **Related issues** — `Fixes #123` or `Relates to #456`

### 5. Review process

- A maintainer will review your PR
- Address feedback by pushing new commits (don't force-push during review)
- Once approved, a maintainer will squash-merge into `canary`
- Your change will ship to `main` on the next release

---

## Code Style

### TypeScript / React

- **Types over `any`** — If you don't know the type, use `unknown` and narrow it
- **Functional components** with hooks — no class components
- **Tailwind CSS** — Use utility classes, avoid custom CSS unless necessary
- **shadcn/ui** — Use existing components from `src/components/ui/`
- **Early returns** — Guard clauses over deep nesting
- **Named exports** preferred over default exports for utilities
- **No `console.log`** in production code — use the logger if needed

### C++ (Qt Desktop)

- **snake_case** for files and functions
- **PascalCase** for classes and structs
- **4-space indentation**, no tabs
- **RAII** — Prefer stack-allocated objects and smart pointers
- **Qt signal/slot** connections for event handling
- **No raw `new`** without a parent or smart pointer

### General

- **No emojis** in code, comments, or commit messages
- **No commented-out code** — delete it, git remembers
- **No `TODO` without context** — use `TODO(username): description`
- **Tests** — If you add a feature, add or update tests

---

## Project Structure

```
SerikaCord/
├── src/                    # Next.js web app
│   ├── app/               # App router pages & layouts
│   ├── components/         # React components
│   │   ├── chat/          # Chat UI (messages, input, channels)
│   │   ├── dialogs/       # Modal dialogs
│   │   ├── home/          # Home/landing page widgets
│   │   └── ui/            # shadcn/ui primitives
│   ├── contexts/          # React contexts (Auth, Server, Theme)
│   ├── hooks/             # Custom React hooks
│   └── lib/               # Core libraries (API, DB, utils)
├── drizzle/               # Database migrations
├── scripts/               # Utility scripts
├── public/                # Static assets (icons, sounds, translations)
├── desktop-QT/            # Qt6 native desktop client
├── desktop-tauri/         # Tauri desktop client (alternative)
├── desktop/               # Legacy Electron desktop (deprecated)
├── mobile/                # Capacitor mobile app (Android)
├── serika-accounts/       # Account service (microservice)
├── docs/                  # Documentation
├── nginx/                 # Nginx config
└── .github/workflows/     # CI/CD pipelines
```

---

## What You Can Contribute

### Bug Fixes

1. Check existing [issues](https://github.com/serika-dev/SerikaCord/issues) to avoid duplicates
2. If no issue exists, open one describing the bug with reproduction steps
3. Submit a PR with the fix targeting `canary`

### Features

1. **Discuss first** — Open an issue with the `enhancement` label to get feedback
2. Large features may need maintainer approval before you start coding
3. Small improvements (UX tweaks, performance, polish) can go straight to a PR

### Translations

We use [General Translation](https://generaltranslation.com) for i18n. Head over to [translate.serika.dev](https://translate.serika.dev) to contribute translations — no PR needed.

### Desktop Clients

- **Qt6 client** (`desktop-QT/`) — Native C++ app, the primary desktop target
- **Tauri client** (`desktop-tauri/`) — Alternative desktop client
- Both load the hosted web app and add native integrations (tray, clipboard, presence, deep links)

### Documentation

- Fixes and improvements to README, CONTRIBUTING, or inline docs are always welcome
- For API docs, see `src/app/developers/docs/`

---

## PR Checklist

Before opening a PR, make sure:

- [ ] Your code **builds without errors** (`bun run build`)
- [ ] You've **tested manually** — does the feature work as expected?
- [ ] Your PR targets the **`canary`** branch
- [ ] Commit messages are **clear and descriptive**
- [ ] No **secrets, API keys, or credentials** in your code
- [ ] No **console.log** or debug code left behind
- [ ] **Linting passes** (`bun run lint`)
- [ ] For UI changes: **screenshots or videos** included in the PR description
- [ ] For new features: **issue was discussed** and approved

---

## Security

**Do NOT open public PRs for security vulnerabilities.**

See [SECURITY.md](SECURITY.md) for responsible disclosure. Report vulnerabilities privately to **security@serika.dev**.

---

## License

By contributing to SerikaCord, you agree that your contributions will be licensed under the **SerikaCord Source Available License**. See [LICENSE](LICENSE) for the full text.

**Key points:**
- You retain copyright to your contributions
- Contributions are licensed under the same terms as the project
- Commercial use and redistribution are restricted — see LICENSE for details

---

<p align="center">
  Thank you for making SerikaCord better!
</p>
