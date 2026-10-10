/**
 * Tokenizer for message search. Pure (no crypto, no DB) so the server index,
 * the server-side result verification and the client highlighter all agree on
 * what a "word" is.
 *
 * Message content is encrypted at rest, so the search index never stores
 * plaintext: the server keys each term below with an HMAC (see
 * src/lib/services/messageSearch.ts) and stores only those short hashes.
 *
 *   - words:    every normalized word (lowercase, accents folded). Runs of CJK
 *               characters become single characters + bigrams, since those
 *               scripts don't separate words with spaces.
 *   - prefixes: 2..MAX_PREFIX-character prefixes of longer words, so "depl"
 *               finds "deploy" like Discord's as-you-type search does.
 */

export const MAX_WORD_LENGTH = 40;
export const MAX_PREFIX_LENGTH = 16;
/** Cap on distinct terms per message so a pasted wall of text stays bounded. */
export const MAX_TERMS_PER_MESSAGE = 600;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MENTION_RE = new RegExp(`<(?:@[!&]?|#)${UUID}>`, "g");
const CUSTOM_EMOJI_RE = new RegExp(`<a?:([a-zA-Z0-9_]+):${UUID}>`, "g");
const TIMESTAMP_RE = /<t:-?\d{1,13}(?::[a-zA-Z])?>/g;
const WORD_RE = /[\p{L}\p{N}]+/gu;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Lowercase + fold accents (é → e) + drop zero-width characters. */
export function normalizeSearchText(input: string): string {
  return (input || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase();
}

/** Strip mention / timestamp tokens and reduce custom emoji to their names. */
export function stripMessageTokens(content: string): string {
  return (content || "")
    .replace(MENTION_RE, " ")
    .replace(TIMESTAMP_RE, " ")
    .replace(CUSTOM_EMOJI_RE, " $1 ");
}

/** Split normalized text into search words (CJK runs → chars + bigrams). */
export function searchWords(text: string): string[] {
  const out: string[] = [];
  const normalized = normalizeSearchText(stripMessageTokens(text));
  for (const match of normalized.matchAll(WORD_RE)) {
    const word = match[0];
    if (CJK_RE.test(word)) {
      // Split mixed runs into CJK chars and non-CJK sub-words.
      let latin = "";
      const chars = Array.from(word);
      const cjk: string[] = [];
      const flushCjk = () => {
        for (let i = 0; i < cjk.length; i++) {
          out.push(cjk[i]);
          if (i + 1 < cjk.length) out.push(cjk[i] + cjk[i + 1]);
        }
        cjk.length = 0;
      };
      for (const ch of chars) {
        if (CJK_RE.test(ch)) {
          if (latin) { out.push(latin.slice(0, MAX_WORD_LENGTH)); latin = ""; }
          cjk.push(ch);
        } else {
          flushCjk();
          latin += ch;
        }
      }
      flushCjk();
      if (latin) out.push(latin.slice(0, MAX_WORD_LENGTH));
      continue;
    }
    out.push(word.slice(0, MAX_WORD_LENGTH));
  }
  return out;
}

export interface SearchTerms {
  words: Set<string>;
  prefixes: Set<string>;
}

/** All index terms for a piece of text (content + embed text + file names). */
export function indexTerms(text: string): SearchTerms {
  const words = new Set<string>();
  const prefixes = new Set<string>();
  for (const w of searchWords(text)) {
    if (words.size + prefixes.size >= MAX_TERMS_PER_MESSAGE) break;
    words.add(w);
    const chars = Array.from(w);
    if (chars.length >= 3 && !CJK_RE.test(w)) {
      const top = Math.min(chars.length - 1, MAX_PREFIX_LENGTH);
      for (let n = 2; n <= top; n++) prefixes.add(chars.slice(0, n).join(""));
    }
  }
  return { words, prefixes };
}

/**
 * Query terms: each must match some word exactly or as a prefix. Duplicates
 * collapse; at most 12 terms are honoured.
 */
export function queryTerms(text: string): string[] {
  return Array.from(new Set(searchWords(text))).slice(0, 12);
}

/** Whether `terms` (from queryTerms) all occur in an indexed text. */
export function matchesAllTerms(indexed: SearchTerms, terms: string[]): boolean {
  return terms.every((t) => indexed.words.has(t) || indexed.prefixes.has(t));
}

/**
 * Relevance score for "Most Relevant" sorting: whole-word hits beat prefix
 * hits, every occurrence counts a little, the full query appearing as a
 * phrase gets a bonus, and shorter messages rank above walls of text.
 */
export function relevanceScore(text: string, terms: string[], rawQuery: string): number {
  if (terms.length === 0) return 0;
  const words = searchWords(text);
  let score = 0;
  for (const t of terms) {
    let exact = 0;
    let prefix = 0;
    for (const w of words) {
      if (w === t) exact++;
      else if (w.startsWith(t)) prefix++;
    }
    score += (exact > 0 ? 10 : prefix > 0 ? 4 : 0) + Math.min(exact, 5) + Math.min(prefix, 3) * 0.5;
  }
  const phrase = normalizeSearchText(rawQuery).trim();
  if (phrase.includes(" ") && normalizeSearchText(text).includes(phrase)) score += 15;
  score -= Math.min(words.length, 200) / 50;
  return score;
}

const LINK_RE = /https?:\/\/[^\s<>]+/i;
const IMAGE_URL_RE = /https?:\/\/[^\s<>]+\.(?:png|jpe?g|gif|webp|bmp|avif)(?:[?#][^\s<>]*)?(?=$|[\s<>])/i;
const VIDEO_URL_RE = /https?:\/\/[^\s<>]+\.(?:mp4|webm|mov|mkv|m4v)(?:[?#][^\s<>]*)?(?=$|[\s<>])/i;
const SOUND_URL_RE = /https?:\/\/[^\s<>]+\.(?:mp3|ogg|wav|flac|m4a|opus|aac)(?:[?#][^\s<>]*)?(?=$|[\s<>])/i;

/** Content-derived `has:` flags (bitmask) stored in the index. */
export const CONTENT_FLAG = {
  LINK: 1,
  IMAGE_URL: 2,
  VIDEO_URL: 4,
  SOUND_URL: 8,
} as const;

export function contentFlags(content: string): number {
  let flags = 0;
  if (!content) return 0;
  if (LINK_RE.test(content)) flags |= CONTENT_FLAG.LINK;
  if (IMAGE_URL_RE.test(content)) flags |= CONTENT_FLAG.IMAGE_URL;
  if (VIDEO_URL_RE.test(content)) flags |= CONTENT_FLAG.VIDEO_URL;
  if (SOUND_URL_RE.test(content)) flags |= CONTENT_FLAG.SOUND_URL;
  return flags;
}

type EmbedLike = {
  title?: unknown;
  description?: unknown;
  author?: { name?: unknown } | null;
  footer?: { text?: unknown } | null;
  fields?: Array<{ name?: unknown; value?: unknown }> | null;
};

/** The searchable text of a message beyond its content: embed text and file names. */
export function extraSearchText(embeds: unknown, attachments: unknown): string {
  const parts: string[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (Array.isArray(embeds)) {
    for (const raw of embeds.slice(0, 10)) {
      const e = (raw || {}) as EmbedLike;
      parts.push(str(e.title), str(e.description), str(e.author?.name), str(e.footer?.text));
      if (Array.isArray(e.fields)) for (const f of e.fields.slice(0, 25)) parts.push(str(f?.name), str(f?.value));
    }
  }
  if (Array.isArray(attachments)) {
    for (const a of attachments.slice(0, 20)) {
      if (a && typeof a === "object") parts.push(str((a as { filename?: unknown }).filename));
    }
  }
  return parts.filter(Boolean).join("\n").slice(0, 8000);
}
