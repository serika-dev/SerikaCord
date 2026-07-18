# AI-READ-THIS: Development Guide

## ⚠️ Fork Requirement

**You MUST have your own fork of this repository.** The git remote must NOT be set to `https://github.com/serika-dev/SerikaCord`.

Before doing anything:
1. Fork the repository on GitHub.
2. Update your remote to point to your fork:
   ```bash
   git remote set-url origin https://github.com/<YOUR_USERNAME>/SerikaCord.git
   ```
3. Verify:
   ```bash
   git remote -v
   ```
   The output must show your fork URL, not `serika-dev/SerikaCord`.

This is required because pushes to `serika-dev/SerikaCord` will be rejected. All work must be done on your own fork and submitted via pull requests.

---

## Changelog

The full project changelog lives in `CHANGELOG.md` at the repository root. It covers all releases from v0.0.1 to the current version, organized by release tag and categorized by type (Security, Features, Bug Fixes, Performance, etc.).

### When to update the changelog

- **After pushing a new release** — Add a new `## vX.Y.Z — YYYY-MM-DD` section at the top (below the header, above the previous release) with a summary of changes, then commit and push.
- **After significant unreleased changes** — Update the `## Unreleased` section with new entries grouped by category.

### Format

Each release section should include:
- **Tag and commit hash** (e.g. `**Tag:** v1.1.0 · **Commit:** fa0c0ce`)
- **Release notes** — Brief summary of what's in the release
- **Categorized changes** — Bullet points grouped by type (Security, Features, Bug Fixes, Performance, Documentation, etc.)
- **Commit hashes** in backticks for traceability (e.g. `fa0c0ce`)

### Releasing a new version

1. Bump version in all config files:
   - `package.json`
   - `desktop-tauri/package.json`
   - `desktop-tauri/src-tauri/tauri.conf.json`
   - `desktop-tauri/src-tauri/Cargo.toml`
   - `desktop-tauri/src-tauri/Cargo.lock` (the `serikacord-desktop` package entry)
   - `desktop/package.json`
   - `mobile/android/app/build.gradle` (`versionName` + increment `versionCode`)
   - Any UI files displaying the version (e.g. `MobileDrawer.tsx`, `MobileProfileView.tsx`)
2. Update `CHANGELOG.md` with the new release section.
3. Commit: `release: vX.Y.Z — <brief description>`
4. Push to `postgres` branch.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. The tag push triggers the GitHub Actions `Release Build` workflow which builds Tauri desktop (Windows/macOS/Linux) and Android APK, then creates a GitHub Release with all artifacts.

---

## Versioning Rules

### Every push MUST bump the patch version

**Rule:** Every time you push changes to the repository, you MUST bump the patch version (e.g. `v1.2.2` → `v1.2.3`). This applies to all pushes, not just releases.

**Steps before every push:**
1. Bump the patch version in all config files listed in "Releasing a new version" above.
2. Add a `## vX.Y.Z — YYYY-MM-DD` entry to `CHANGELOG.md` describing the changes.
3. Commit with message `release: vX.Y.Z — <brief description>`.
4. Push, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

**Minor/major version bumps** are reserved for significant feature additions or breaking changes, respectively. When in doubt, bump patch.

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
