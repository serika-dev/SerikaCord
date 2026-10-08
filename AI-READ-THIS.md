# AI-READ-THIS: Development Guide

> **Start with [`CLAUDE.md`](CLAUDE.md)** (architecture, commands, conventions,
> safety rules, verification checklist) and [`AGENTS.md`](AGENTS.md). Deep
> dives are in [`docs/architecture/`](docs/architecture/). This file covers
> forks, the changelog and releases, and the full i18n guide.

## Safety first

- The Postgres and Redis behind canary are **production data shared with
  prod**. No destructive SQL, no `drizzle-kit push`/`migrate`. Schema changes
  are additive and idempotent (`drizzle/manual_*.sql`), see
  `docs/architecture/data-model.md`.
- Never test in public servers or with real users.
- The owner may have uncommitted work in the tree: never stash, reset or
  commit it.

## Forks and branches

External contributors work from their own fork:

1. Fork the repository on GitHub.
2. Point `origin` at your fork:
   ```bash
   git remote set-url origin https://github.com/<YOUR_USERNAME>/SerikaCord.git
   git remote -v   # must show your fork, not serika-dev/SerikaCord
   ```
3. Open pull requests against **`canary`** (see `CONTRIBUTING.md`).

`canary` is the development branch and deploys automatically (Coolify);
`main` is production and only receives release merges. Agents never push,
tag or force-push unless the owner explicitly asks.

---

## Changelog

The project changelog is `CHANGELOG.md` at the repository root, organized by
release with an `## Unreleased` section at the top.

### Canary changes

Every user-visible change pushed to `canary` adds a bullet under
`## Unreleased`, in the matching category (`### Features`, `### Bug Fixes`,
`### Performance`, `### Security`):

```md
- **Short bold summary** — what the user notices now, in plain words. (CORD-12)
```

Each release section should include:
- **Tag and commit hash** (e.g. `**Tag:** v1.1.0 · **Commit:** fa0c0ce`)
- **Release notes** — Brief summary of what's in the release
- **Categorized changes** — Bullet points grouped by type (Security, Features, Bug Fixes, Performance, Documentation, etc.)
- **Commit hashes** in backticks for traceability (e.g. `fa0c0ce`)

### Adding changelog entries

```bash
bun run changelog <Added|Changed|Fixed|Performance|Security|Removed> "**Short title** — what changed for users."
```

Appends a bullet to `## Unreleased` under the matching heading (Added → Features, Changed → Changes, Fixed → Bug Fixes, Performance, Security, Removed), creating the heading if needed. Editing `CHANGELOG.md` by hand is fine too; keep the same headings. The in-app `/changelog` page ("What's new" under the version in User Settings and the mobile profile) renders Unreleased plus the last few releases from `CHANGELOG.md`, inlined at build time.

### Releasing a new version

Use `scripts/release.ts`; don't bump versions by hand:

```bash
bun run release:dry [patch|minor|major]   # preview the full diff, writes nothing (default: patch)
bun run release patch --commit --tag      # bump, commit "release: vX.Y.Z", annotated tag vX.Y.Z
git push && git push origin vX.Y.Z        # the script never pushes
```

`bun scripts/release.ts <patch|minor|major|x.y.z> [--dry-run] [--commit] [--tag] [--allow-empty]`:
1. Refuses to run with staged changes, a non-increasing version, or an existing tag.
2. Bumps every version-bearing file that exists (missing ones are skipped with a warning):
   - `package.json`
   - `desktop-tauri/package.json`, `desktop-tauri/src-tauri/tauri.conf.json`, `desktop-tauri/src-tauri/Cargo.toml`, `desktop-tauri/src-tauri/Cargo.lock` (the `serikacord-desktop` entry)
   - `desktop/package.json` (legacy Electron shell, currently absent)
   - `desktop-QT/CMakeLists.txt` (`project(... VERSION)`) and `desktop-QT/Info.plist`
   - `mobile/android/app/build.gradle` (`versionName`, and `versionCode` + 1)
3. Moves the `## Unreleased` body into `## vX.Y.Z — YYYY-MM-DD` with a `**Tag:** ... · **Commit:** <short sha>` line (the HEAD the release was cut from) and leaves a fresh Unreleased with the standard headings. Refuses an empty Unreleased unless `--allow-empty`.
4. `--commit` commits only the files it touched; `--tag` (needs `--commit`) creates the annotated tag.

The tag push triggers the GitHub Actions `Release Build` workflow (Tauri desktop + Android APK) and `build-qt.yml`; both take the version from the tag.

**The UI never hard-codes a version.** Import `APP_VERSION` / `VERSION_LABEL` / `BUILD_SHA` from `src/lib/version.ts`. `next.config.ts` inlines the version from `package.json` and the commit from `SOURCE_COMMIT` / `COOLIFY_GIT_COMMIT_SHA` / `GIT_COMMIT` / `VERCEL_GIT_COMMIT_SHA` (else `git rev-parse HEAD`, else `dev`). `GET /api/version` returns `{ version, commit, builtAt, environment }` for the running deployment.

Internal refactors, docs and tests don't need an entry. Pushes do **not** bump
the version. The `/changelog` slash command (`.claude/commands/changelog.md`)
writes an entry for you.

### Releases

Releases are cut by the maintainer (not by agents) with the release script described
under "Releasing a new version" above: `bun run release:dry`, then
`bun run release <patch|minor|major> --commit --tag`, merge `canary` into `main`,
and push the tag. Tags matching `v*` trigger the GitHub Actions `Release Build`
(Tauri + Android) and `Release Build (Qt)` workflows.

---

## Translation String Implementation Guide

## Overview

SerikaCord uses [gt-next](https://www.generaltranslation.com/) for internationalization. Translation files live in `public/_gt/[locale].json`. The source locale is `en` (English). The config is in `gt.config.json`.

## How to Add New Strings

### Rule 1: Never hardcode user-facing English text

Every string visible to users MUST go through `gt()` or `<T>`.

### Server Components (RSC)

Use `getGT()` from `gt-next/server`:

```tsx
import { getGT } from "gt-next/server";

export default async function Page() {
  const gt = await getGT();
  return <h1>{gt("Hello world")}</h1>;
}
```

### Client Components

Use `useGT()` from `gt-next`:

```tsx
"use client";
import { useGT } from "gt-next";

export function MyComponent() {
  const gt = useGT();
  return <p>{gt("Hello world")}</p>;
}
```

### JSX Blocks with Mixed Elements

Use `<T>` for blocks with nested HTML elements that should be translated as a unit:

```tsx
import { T } from "gt-next";

<T>
  <h2>Everything you need</h2>
  <p>From casual conversations to large community hubs.</p>
</T>
```

**IMPORTANT**: Do NOT use `<T>` for text split across styled spans — the GT service may not translate individual spans. Instead, use `gt()` for each text segment:

```tsx
// BAD - spans inside <T> may not get translated
<T>
  <h1>
    <span>Your place to </span>
    <span>talk & hang out</span>
  </h1>
</T>

// GOOD - each text is a separate gt() call
<h1>
  <span>{gt("Your place to")} </span>
  <span>{gt("talk & hang out")}</span>
</h1>
```

### Variable Interpolation

Use `{variableName}` syntax inside gt() calls:

```tsx
gt("Today at {time}", { time: "3:41 PM" })
gt("Welcome, {name}", { name: userName })
gt("{count} messages", { count: 5 })
```

### Pluralization

Use the `<Plural>` component or gt() with count:

```tsx
import { Plural } from "gt-next";

<Plural count={count} one="1 message" other="{count} messages" />
```

### Dates and Times

Always pass the current locale to `toLocaleTimeString` / `toLocaleDateString`:

```tsx
const locale = useLocale(); // client
// or
const locale = await getLocale(); // server

date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
```

For formatted timestamps like "Today at 3:41 PM", use `formatMessageTimestamp` from `@/lib/chat/messages` which accepts `gt` and `locale` parameters.

## After Adding New Strings

### 1. Sync with General Translations (GT)

```bash
# Scan project and send new/changed strings to GT API for translation
npx gt translate

# Download completed translations
npx gt download
```

### 2. Sync with Serika Translate

```bash
# Push source strings (en.json) to Serika Translate, then pull all translations
bun run translate:sync

# Or step by step:
bun run translate:push   # Push en.json source strings
bun run translate:pull   # Pull approved translations into public/_gt/*.json
bun run translate:status # Check completion stats
```

### 3. Verify

- Start the dev server: `bun dev`
- Set the locale cookie: `generaltranslation.locale=ja`
- Load a page and confirm the new string appears translated
- Check server logs for any `loadTranslations` errors

## Locale Configuration

- Config file: `gt.config.json`
- Default locale: `en`
- Translation output: `public/_gt/[locale].json`
- Custom loaders: `src/loadTranslations.ts` (translations), `getLocale.ts` (locale detection)
- Runtime shim: `gt-preload.ts` (patches Module._resolveFilename for Bun compatibility)

## Common Pitfalls

1. **Don't use `&amp;` in gt() strings** — use `&` directly: `gt("talk & hang out")`
2. **Don't split translatable sentences across multiple gt() calls** — keep a sentence as one string so the translator sees full context
3. **Don't forget to pass `locale` to date/time formatting** — otherwise dates render in the browser's default locale
4. **Don't use `<T>` for text in styled spans** — use `gt()` for each segment instead
5. **Always run `npx gt translate` after adding strings** — otherwise they won't appear in translation files
6. **The `gt-preload.ts` import MUST be first in `server.ts`** — it patches module resolution before gt-next loads
7. **`gt()` takes a string literal only** — `gt(label)` or `gt(cond ? "a" : "b")` fails `next build` (the compile-time plugin rejects it). Map dynamic values to separate literal `gt()` calls
8. **Interpolated strings inside chat components** go through `useChatGt()` and must be listed in the `map` in `src/components/chat/ChatGtContext.tsx`
9. **Never build with Turbopack** — gt-next's compile-time hashing only runs under webpack; without it every `gt()` re-hashes on each render for non-English locales (`--webpack` in `package.json`, `webpack: true` in `server.ts`)
10. **`getLocale.ts` must stay at the repository root** — gt-next only looks there; it reads the `generaltranslation.locale` cookie

## File Reference

| File | Purpose |
|------|---------|
| `gt.config.json` | GT configuration (locales, output path) |
| `src/loadTranslations.ts` | Loads translation JSON from `public/_gt/` at runtime |
| `getLocale.ts` | Resolves locale from `generaltranslation.locale` cookie |
| `getRegion.ts` | Returns region (currently unused, returns undefined) |
| `gt-preload.ts` | Runtime shim for Bun + webpack module resolution |
| `next.config.ts` | Webpack config with gt-next aliases and `.mjs` fix |
| `scripts/sync-translations.js` | Serika Translate sync script |
| `public/_gt/[locale].json` | Translation files (one per locale) |
