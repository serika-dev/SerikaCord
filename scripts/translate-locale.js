#!/usr/bin/env node
/**
 * Translate all strings in en.json to a target locale using Google Translate.
 * Preserves {variable} placeholders, HTML entities, and complex JSON structures.
 *
 * Usage:
 *   node scripts/translate-locale.js nl    # Dutch → writes public/_gt/nl-NL.json
 *   node scripts/translate-locale.js ja    # Japanese → writes public/_gt/ja.json
 */

const fs = require("fs");
const path = require("path");

const GT_DIR = path.resolve(__dirname, "..", "public", "_gt");
const EN_PATH = path.join(GT_DIR, "en.json");

const LOCALE_MAP = {
  nl: { gt: "nl-NL", google: "nl" },
  ja: { gt: "ja", google: "ja" },
};

// Google Translate free API
async function googleTranslate(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Translate API returned ${res.status}`);
  const data = await res.json();
  // Response format: [[["translated","original",null,null],...],...]
  if (!data || !data[0]) return text;
  return data[0].map((seg) => seg[0]).join("");
}

// Preserve {variables} by replacing with placeholders before translation
const VAR_REGEX = /\{[^}]+\}/g;
function protectVars(text) {
  const vars = [];
  let protected = text.replace(VAR_REGEX, (match) => {
    vars.push(match);
    return `__VAR${vars.length - 1}__`;
  });
  return { protected, vars };
}

function restoreVars(translated, vars) {
  return translated.replace(/__VAR(\d+)__/g, (_, i) => vars[parseInt(i)]);
}

// Protect HTML entities like &apos; &amp; etc.
const ENTITY_REGEX = /&[a-z]+;/g;
function protectEntities(text) {
  const entities = [];
  let protected = text.replace(ENTITY_REGEX, (match) => {
    entities.push(match);
    return `__ENT${entities.length - 1}__`;
  });
  return { protected, entities };
}

function restoreEntities(translated, entities) {
  return translated.replace(/__ENT(\d+)__/g, (_, i) => entities[parseInt(i)]);
}

async function translateString(text, targetLang) {
  if (typeof text !== "string") return text;
  if (!text || text.trim() === "") return text;

  // Don't translate URLs, pure numbers, or very short technical strings
  if (/^https?:\/\//.test(text)) return text;
  if (/^\d+$/.test(text)) return text;

  // Protect variables and entities
  const { protected: vProtected, vars } = protectVars(text);
  const { protected: eProtected, entities } = protectEntities(vProtected);

  // Translate
  let translated = await googleTranslate(eProtected, targetLang);

  // Restore
  translated = restoreEntities(translated, entities);
  translated = restoreVars(translated, vars);

  return translated;
}

// Handle complex array values (GT format with nested objects)
async function translateComplexValue(value, targetLang) {
  if (typeof value === "string") {
    return await translateString(value, targetLang);
  }
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) {
      if (typeof item === "object" && item !== null) {
        const newItem = { ...item };
        if (typeof item.c === "string") {
          newItem.c = await translateString(item.c, targetLang);
        } else if (Array.isArray(item.c)) {
          newItem.c = [];
          for (const child of item.c) {
            newItem.c.push(await translateComplexValue(child, targetLang));
          }
        }
        result.push(newItem);
      } else {
        result.push(item);
      }
    }
    return result;
  }
  return value;
}

async function main() {
  const targetLocale = process.argv[2];
  if (!targetLocale || !LOCALE_MAP[targetLocale]) {
    console.error("Usage: node scripts/translate-locale.js <nl|ja>");
    process.exit(1);
  }

  const { gt: gtLocale, google: googleLang } = LOCALE_MAP[targetLocale];
  const outputPath = path.join(GT_DIR, `${gtLocale}.json`);

  console.log(`\n🌐 Translating en.json → ${gtLocale} (Google Translate: ${googleLang})\n`);

  const enData = JSON.parse(fs.readFileSync(EN_PATH, "utf8"));
  const keys = Object.keys(enData);
  const total = keys.length;

  console.log(`   ${total} strings to translate\n`);

  const result = {};
  let batch = [];
  let batchKeys = [];
  const BATCH_SIZE = 50;
  let translated = 0;
  let errors = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = enData[key];

    try {
      const translatedValue = await translateComplexValue(value, googleLang);
      result[key] = translatedValue;
      translated++;

      if (translated % 100 === 0 || translated === total) {
        const pct = Math.round((translated / total) * 100);
        process.stdout.write(`\r   Progress: ${translated}/${total} (${pct}%)`);
      }

      // Small delay to avoid rate limiting
      if (translated % 200 === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      result[key] = value; // Fall back to English
      errors++;
      if (errors <= 5) {
        console.error(`\n   ⚠️  Error translating key ${key}: ${err.message}`);
      }
    }
  }

  console.log(`\n\n   ✅ Translated: ${translated}`);
  console.log(`   ⚠️  Errors (fell back to English): ${errors}`);

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n   📝 Written to: ${outputPath}`);
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  process.exit(1);
});
