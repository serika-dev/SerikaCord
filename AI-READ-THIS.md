# AI-READ-THIS: Translation String Implementation Guide

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
