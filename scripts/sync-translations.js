#!/usr/bin/env node
/**
 * Serika Translate Sync Script
 * -----------------------------
 * Bidirectional sync between local GT translation files (public/_gt/*.json)
 * and the Serika Translate platform (translate.serika.dev).
 *
 * Modes:
 *   push   — Upload source strings (en.json) to Serika Translate
 *   pull   — Download all approved translations → public/_gt/*.json (non-destructive)
 *   sync   — Push then pull (full round-trip)
 *   status — Show locale completion stats from the API
 *   keys   — List/search translation keys on the platform
 *
 * Usage:
 *   node scripts/sync-translations.js push
 *   node scripts/sync-translations.js pull
 *   node scripts/sync-translations.js sync
 *   node scripts/sync-translations.js status
 *   node scripts/sync-translations.js keys [search term]
 *
 * Env vars (read from .env or environment):
 *   SERIKA_TRANSLATE_KEY    — API key (stk_...) with write scope
 *   SERIKA_TRANSLATE_SLUG   — Project slug (default: serikacord)
 *
 * Pull policy:
 *   - NEVER overrides keys that already have a manual (non-English) translation locally.
 *   - Only fills in missing translations or updates keys that still match the English source.
 *   - New locale files from the platform are created automatically.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://translate.serika.dev/api/v1";
const GT_DIR = path.resolve(__dirname, "..", "public", "_gt");
const ENV_FILE = path.resolve(__dirname, "..", ".env");

// ─── Env loading ─────────────────────────────────────────────────────────────

function loadEnv() {
  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
}

loadEnv();

const API_KEY = process.env.SERIKA_TRANSLATE_KEY;
const PROJECT_SLUG = process.env.SERIKA_TRANSLATE_SLUG || "serikacord";

if (!API_KEY) {
  console.error("\x1b[31m\u274c SERIKA_TRANSLATE_KEY is not set.\x1b[0m");
  console.error("   Add it to .env or export it. Get your key from https://translate.serika.dev");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function apiFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${url}\n  ${body}`);
  }
  return res.json();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function getLocalLocales() {
  if (!fs.existsSync(GT_DIR)) return [];
  return fs
    .readdirSync(GT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

function log(icon, msg) {
  console.log(`${icon}  ${msg}`);
}

function logDim(msg) {
  console.log(`   ${msg}`);
}

function logBright(msg) {
  console.log(`\x1b[1m${msg}\x1b[0m`);
}

function logGreen(msg) {
  console.log(`\x1b[32m${msg}\x1b[0m`);
}

function logYellow(msg) {
  console.log(`\x1b[33m${msg}\x1b[0m`);
}

function logRed(msg) {
  console.log(`\x1b[31m${msg}\x1b[0m`);
}

// ─── Push: upload source strings ─────────────────────────────────────────────

async function pushSource() {
  log("\u23eb", "Pushing source strings to Serika Translate...");

  const enPath = path.join(GT_DIR, "en.json");
  if (!fs.existsSync(enPath)) {
    log("\u26a0\ufe0f", "en.json not found. Run `npx gt generate` first.");
    process.exit(1);
  }

  const enData = readJson(enPath);
  const entries = Object.entries(enData).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));

  logDim(`Found ${entries.length} source strings in en.json`);

  // Push in batches of 200 to keep requests reasonable
  const batchSize = 200;
  let pushed = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await apiFetch(`/projects/${PROJECT_SLUG}/translations`, {
      method: "POST",
      body: JSON.stringify({ entries: batch }),
    });
    pushed += batch.length;
    process.stdout.write(`\r   Pushed ${pushed}/${entries.length} strings...`);
  }
  console.log();
  logGreen(` \u2705 Pushed ${pushed} source strings to "${PROJECT_SLUG}" on Serika Translate`);
}

// ─── Push-translations: upload manual translations for a locale ──────────────

async function pushTranslations(locale, includeIdentical = false) {
  if (!locale) {
    logRed(" \u274c Usage: node scripts/sync-translations.js push-translations <locale> [--include-identical]");
    process.exit(1);
  }

  const localePath = path.join(GT_DIR, `${locale}.json`);
  if (!fs.existsSync(localePath)) {
    logRed(` \u274c ${locale}.json not found.`);
    process.exit(1);
  }

  const localeData = readJson(localePath);
  const enPath = path.join(GT_DIR, "en.json");
  const enData = fs.existsSync(enPath) ? readJson(enPath) : {};

  // Push keys that differ from English, or all keys if --include-identical
  const entries = [];
  for (const [key, value] of Object.entries(localeData)) {
    if (value && (value !== enData[key] || includeIdentical)) {
      entries.push({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
        locale,
        status: "approved",
      });
    }
  }

  if (entries.length === 0) {
    logYellow(` \u26a0\ufe0f No translated strings found for "${locale}" (all match English source).`);
    return;
  }

  log(`\u23eb`, `Pushing ${entries.length} translations for "${locale}" to Serika Translate...`);

  const batchSize = 200;
  let pushed = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await apiFetch(`/projects/${PROJECT_SLUG}/translations`, {
      method: "POST",
      body: JSON.stringify({ entries: batch, locale }),
    });
    pushed += batch.length;
    process.stdout.write(`\r   Pushed ${pushed}/${entries.length} translations...`);
  }
  console.log();
  logGreen(` \u2705 Pushed ${pushed} translations for "${locale}" to "${PROJECT_SLUG}"`);
}

// ─── Pull: download translations (non-destructive) ───────────────────────────

async function pullTranslations() {
  log("\u23eb", "Pulling translations from Serika Translate...");

  const localLocales = getLocalLocales();
  const targetLocales = localLocales.filter((l) => l !== "en");
  logDim(`Found ${targetLocales.length} target locales locally`);

  // Read English source for comparison
  const enPath = path.join(GT_DIR, "en.json");
  if (!fs.existsSync(enPath)) {
    log("\u26a0\ufe0f", "en.json not found. Run `npx gt generate` first.");
    process.exit(1);
  }
  const enData = readJson(enPath);

  // Fetch the full bundle — all locales at once
  let bundle;
  try {
    bundle = await apiFetch(`/projects/${PROJECT_SLUG}/bundle?status=approved`);
  } catch (err) {
    logRed(` \u274c Failed to fetch bundle: ${err.message}`);
    process.exit(1);
  }

  const remoteLocales = bundle.locales || {};
  let updated = 0;
  let skipped = 0;
  let newLocales = 0;
  let totalStrings = 0;

  for (const locale of targetLocales) {
    const remoteData = remoteLocales[locale];
    const localPath = path.join(GT_DIR, `${locale}.json`);

    let localData = {};
    if (fs.existsSync(localPath)) {
      localData = readJson(localPath);
    }

    if (!remoteData || Object.keys(remoteData).length === 0) {
      skipped++;
      continue;
    }

    // Merge: only update keys that are missing locally or still match English source
    let changed = 0;
    for (const [key, remoteValue] of Object.entries(remoteData)) {
      if (!remoteValue) continue;

      const localValue = localData[key];
      const enValue = enData[key];

      // Skip if local already has a manual translation that differs from both English and remote
      if (localValue && localValue !== enValue && localValue !== remoteValue) {
        continue;
      }

      // Only write if remote value differs from what we have
      if (localValue !== remoteValue) {
        localData[key] = remoteValue;
        changed++;
      }
    }

    if (changed > 0) {
      writeJson(localPath, localData);
      updated++;
      totalStrings += changed;
      logDim(`  ${locale}: ${changed} strings updated`);
    } else {
      skipped++;
    }
  }

  // Create files for remote locales we don't have locally
  for (const [remoteLocale, remoteData] of Object.entries(remoteLocales)) {
    if (remoteLocale === "en") continue;
    const localPath = path.join(GT_DIR, `${remoteLocale}.json`);
    if (!fs.existsSync(localPath) && remoteData && Object.keys(remoteData).length > 0) {
      writeJson(localPath, remoteData);
      newLocales++;
      logDim(`  ${remoteLocale}: new locale file created (${Object.keys(remoteData).length} strings)`);
    }
  }

  logGreen(` \u2705 Pull complete: ${updated} locales updated (${totalStrings} strings), ${skipped} unchanged, ${newLocales} new`);

  // Refresh GT templates
  log("\u21bb", "Running `npx gt generate` to refresh merged templates...");
  try {
    execSync("npx gt generate", { stdio: "pipe", cwd: path.resolve(__dirname, "..") });
    logGreen(" \u2705 GT templates refreshed");
  } catch {
    logYellow(" \u26a0\ufe0f gt generate failed — you may need to run it manually");
  }
}

// ─── Sync: push then pull ────────────────────────────────────────────────────

async function syncAll() {
  logBright("\n=== Full Sync ===\n");
  await pushSource();
  console.log();
  await pullTranslations();
  logBright("\n=== Sync Complete ===\n");
}

// ─── Status: locale completion stats ─────────────────────────────────────────

async function showStatus() {
  log("\u{1f4ca}", "Fetching locale stats from Serika Translate...\n");

  let stats;
  try {
    stats = await apiFetch(`/projects/${PROJECT_SLUG}/locales`);
  } catch (err) {
    logRed(` \u274c Failed to fetch stats: ${err.message}`);
    process.exit(1);
  }

  const locales = Array.isArray(stats) ? stats : stats.locales || [];
  if (locales.length === 0) {
    logDim("No locale stats available yet. Push source strings first.");
    return;
  }

  // Sort by completion descending
  locales.sort((a, b) => (b.completion || b.percent || 0) - (a.completion || a.percent || 0));

  const colWidth = 14;
  console.log(
    `  ${"Locale".padEnd(colWidth)}${"Strings".padEnd(12)}${"Translated".padEnd(14)}${"Completion".padEnd(14)}`
  );
  console.log(`  ${"\u2500".repeat(colWidth + 12 + 14 + 14)}`);

  for (const loc of locales) {
    const code = loc.locale || loc.code || loc.localeCode || "?";
    const total = loc.total || loc.totalKeys || 0;
    const translated = loc.translated || loc.translatedCount || 0;
    const pct = loc.completion || loc.percent || (total > 0 ? Math.round((translated / total) * 100) : 0);

    const bar = renderBar(pct);
    console.log(`  ${code.padEnd(colWidth)}${String(total).padEnd(12)}${String(translated).padEnd(14)}${bar} ${pct}%`);
  }

  console.log(`\n  Project: ${PROJECT_SLUG}`);
  console.log(`  Platform: https://translate.serika.dev`);
}

function renderBar(pct) {
  const filled = Math.round(pct / 10);
  return "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
}

// ─── Keys: list/search translation keys ──────────────────────────────────────

async function listKeys(searchTerm) {
  log("\u{1f511}", searchTerm ? `Searching keys for "${searchTerm}"...` : "Listing translation keys...");

  let page = 1;
  let allKeys = [];
  let totalPages = 1;

  while (page <= totalPages) {
    const params = new URLSearchParams({ page: String(page), limit: "100" });
    if (searchTerm) params.set("search", searchTerm);

    const data = await apiFetch(`/projects/${PROJECT_SLUG}/keys?${params}`);
    allKeys.push(...(data.keys || []));
    totalPages = data.pagination?.totalPages || 1;
    page++;
  }

  if (allKeys.length === 0) {
    logDim("No keys found. Push source strings first with `node scripts/sync-translations.js push`");
    return;
  }

  logDim(`Found ${allKeys.length} keys\n`);

  for (const key of allKeys.slice(0, 50)) {
    const sourceText = key.sourceText || key.source_text || "";
    const preview = sourceText.length > 60 ? sourceText.slice(0, 57) + "..." : sourceText;
    console.log(`  ${key.key.padEnd(20)} ${preview}`);
  }

  if (allKeys.length > 50) {
    logDim(`\n  ... and ${allKeys.length - 50} more (showing first 50)`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] || "sync";

  console.log();
  logBright("Serika Translate Sync");
  logDim(`Project: ${PROJECT_SLUG}`);
  logDim(`API: ${BASE_URL.replace("/api/v1", "")}`);
  console.log();

  switch (mode) {
    case "push":
      await pushSource();
      break;
    case "pull":
      await pullTranslations();
      break;
    case "sync":
      await syncAll();
      break;
    case "status":
      await showStatus();
      break;
    case "push-translations":
      await pushTranslations(process.argv[3], process.argv.includes("--include-identical"));
      break;
    case "keys":
      await listKeys(process.argv[3]);
      break;
    default:
      console.log(`Usage: node scripts/sync-translations.js [push|push-translations|pull|sync|status|keys] [search|locale]`);
      console.log();
      console.log("  push                Upload source strings (en.json) to Serika Translate");
      console.log("  push-translations   Upload manual translations for a locale <locale>");
      console.log("  pull                Download approved translations (non-destructive merge)");
      console.log("  sync                Push then pull (full round-trip)");
      console.log("  status              Show locale completion percentages");
      console.log("  keys                List/search translation keys [optional search term]");
      process.exit(0);
  }
}

main().catch((err) => {
  logRed(` \u274c Error: ${err.message}`);
  process.exit(1);
});
