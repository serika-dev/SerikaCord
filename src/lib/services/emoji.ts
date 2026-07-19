import { ServerEmoji, type IServerEmoji } from '@/lib/models/ServerEmoji';
import { BoundedMap } from '@/lib/utils/boundedMap';

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export interface ParsedEmoji {
  name: string;
  id: string;
  animated: boolean;
  url: string;
  raw: string; // Original match string
}

export interface EmojiParseResult {
  content: string;
  emojis: ParsedEmoji[];
  invalidEmojis: string[]; // Emoji references that couldn't be resolved
}

// Regex for custom emoji format: <:name:id> or <a:name:id> for animated
// Also supports shorthand :name:id for backward compatibility
const CUSTOM_EMOJI_REGEX = /<?(a)?:([a-zA-Z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>?/gi;
// Non-global variant for parsing a SINGLE token. String.match() with a /g
// regex returns matched substrings, not capture groups — so single-token
// parsers must use this (or .exec) to read the name/id groups.
const CUSTOM_EMOJI_REGEX_SINGLE = /<?(a)?:([a-zA-Z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>?/i;

// Cache for emoji lookups - expires after 5 minutes
const emojiCache = new BoundedMap<string, { emoji: IServerEmoji | null; timestamp: number }>(5000);
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get emoji from cache or database
 */
async function getCachedEmoji(emojiId: string): Promise<IServerEmoji | null> {
  const cached = emojiCache.get(emojiId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.emoji;
  }

  try {
    const emoji = await ServerEmoji.findById(emojiId);
    emojiCache.set(emojiId, { emoji, timestamp: Date.now() });
    return emoji;
  } catch {
    return null;
  }
}

/**
 * Clear emoji cache for a specific emoji or all emojis
 */
export function clearEmojiCache(emojiId?: string): void {
  if (emojiId) {
    emojiCache.delete(emojiId);
  } else {
    emojiCache.clear();
  }
}

/**
 * Batch-parse custom emojis across multiple message contents in a single pass.
 * Collects all unique emoji IDs from all contents, does a single batch DB
 * lookup for cache misses, then processes each content with the shared emoji
 * map. This eliminates N separate parseCustomEmojis calls (each with its own
 * Promise.all overhead) when loading a page of 50 messages.
 *
 * No server-access restriction is applied (pass undefined for both server
 * params) — this matches the existing load-path behaviour where access was
 * validated at send time.
 */
export async function batchParseCustomEmojis(
  contents: string[],
  userServerId?: string,
  userServerIds?: string[]
): Promise<EmojiParseResult[]> {
  if (contents.length === 0) return [];

  // Phase 1: Scan all contents for emoji matches and collect unique IDs.
  const allMatches: { contentIdx: number; match: RegExpMatchArray }[] = [];
  const uniqueIds = new Set<string>();

  for (let i = 0; i < contents.length; i++) {
    const matches = [...contents[i].matchAll(CUSTOM_EMOJI_REGEX)];
    for (const match of matches) {
      const emojiId = match[3];
      allMatches.push({ contentIdx: i, match });
      if (isValidUUID(emojiId)) {
        uniqueIds.add(emojiId);
      }
    }
  }

  // Fast path: no emojis in any content
  if (uniqueIds.size === 0) {
    return contents.map(content => ({ content, emojis: [], invalidEmojis: [] }));
  }

  // Phase 2: Batch-fetch all unique emoji IDs.
  // Check in-memory cache first, collect cache misses for a single DB query.
  const emojiMap = new Map<string, IServerEmoji | null>();
  const uncachedIds: string[] = [];

  for (const id of uniqueIds) {
    const cached = emojiCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      emojiMap.set(id, cached.emoji);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length > 0) {
    const dbEmojis = await ServerEmoji.find({ id: { in: uncachedIds } });
    const dbMap = new Map<string, IServerEmoji>();
    for (const e of dbEmojis as any[]) {
      dbMap.set(e.id, e);
    }
    for (const id of uncachedIds) {
      const emoji = dbMap.get(id) ?? null;
      emojiMap.set(id, emoji);
      emojiCache.set(id, { emoji, timestamp: Date.now() });
    }
  }

  // Build accessible servers set
  const accessibleServers = new Set<string>();
  if (userServerId) accessibleServers.add(userServerId);
  if (userServerIds) for (const id of userServerIds) accessibleServers.add(id);

  // Phase 3: Process each content's matches using the shared emoji map.
  const results: EmojiParseResult[] = contents.map(content => ({
    content,
    emojis: [],
    invalidEmojis: [],
  }));

  // Track seen IDs per content to handle duplicates within a single message
  const seenPerContent: Map<number, Map<string, ParsedEmoji | null>> = new Map();

  for (const { contentIdx, match } of allMatches) {
    const [fullMatch, animated, name, emojiId] = match;
    const result = results[contentIdx];

    let seen = seenPerContent.get(contentIdx);
    if (!seen) {
      seen = new Map();
      seenPerContent.set(contentIdx, seen);
    }

    if (seen.has(emojiId)) {
      const cached = seen.get(emojiId);
      if (cached) {
        result.emojis.push({ ...cached, raw: fullMatch });
      } else {
        result.invalidEmojis.push(fullMatch);
      }
      continue;
    }

    if (!isValidUUID(emojiId)) {
      result.invalidEmojis.push(fullMatch);
      seen.set(emojiId, null);
      continue;
    }

    const emoji = emojiMap.get(emojiId);
    if (!emoji || !emoji.available) {
      result.invalidEmojis.push(fullMatch);
      seen.set(emojiId, null);
      continue;
    }

    if (accessibleServers.size > 0 && !accessibleServers.has(emoji.serverId)) {
      result.invalidEmojis.push(fullMatch);
      seen.set(emojiId, null);
      continue;
    }

    const parsedEmoji: ParsedEmoji = {
      name: emoji.name,
      id: emojiId,
      animated: emoji.animated ?? false,
      url: emoji.imageUrl,
      raw: fullMatch,
    };

    result.emojis.push(parsedEmoji);
    seen.set(emojiId, parsedEmoji);
  }

  return results;
}

/**
 * Parse custom emojis from message content
 * Validates emoji IDs and resolves them to actual emoji data
 * Handles multiple occurrences of the same emoji efficiently
 */
export async function parseCustomEmojis(
  content: string,
  userServerId?: string,
  userServerIds?: string[]
): Promise<EmojiParseResult> {
  const emojis: ParsedEmoji[] = [];
  const invalidEmojis: string[] = [];
  const seenIds = new Map<string, ParsedEmoji | null>(); // Track duplicates

  // Find all emoji matches
  const matches = [...content.matchAll(CUSTOM_EMOJI_REGEX)];
  
  if (matches.length === 0) {
    return { content, emojis: [], invalidEmojis: [] };
  }

  // Collect unique emoji IDs to batch lookup
  const uniqueIds = new Set<string>();
  for (const match of matches) {
    const emojiId = match[3];
    if (isValidUUID(emojiId)) {
      uniqueIds.add(emojiId);
    }
  }

  // Batch fetch emojis
  const emojiPromises = Array.from(uniqueIds).map(async (id) => {
    const emoji = await getCachedEmoji(id);
    return { id, emoji };
  });

  const results = await Promise.all(emojiPromises);
  const emojiMap = new Map<string, IServerEmoji | null>();
  for (const { id, emoji } of results) {
    emojiMap.set(id, emoji);
  }

  // Convert user server IDs to string set for comparison
  const accessibleServers = new Set<string>();
  if (userServerId) {
    accessibleServers.add(userServerId);
  }
  if (userServerIds) {
    for (const id of userServerIds) {
      accessibleServers.add(id);
    }
  }

  // Process each match
  for (const match of matches) {
    const [fullMatch, animated, name, emojiId] = match;
    
    // Skip if already processed this ID
    if (seenIds.has(emojiId)) {
      const cached = seenIds.get(emojiId);
      if (cached) {
        emojis.push({ ...cached, raw: fullMatch });
      } else {
        invalidEmojis.push(fullMatch);
      }
      continue;
    }

    if (!isValidUUID(emojiId)) {
      invalidEmojis.push(fullMatch);
      seenIds.set(emojiId, null);
      continue;
    }

    const emoji = emojiMap.get(emojiId);
    
    if (!emoji) {
      invalidEmojis.push(fullMatch);
      seenIds.set(emojiId, null);
      continue;
    }

    // Check if emoji is available
    if (!emoji.available) {
      invalidEmojis.push(fullMatch);
      seenIds.set(emojiId, null);
      continue;
    }

    // Validate server access if provided
    if (accessibleServers.size > 0 && !accessibleServers.has(emoji.serverId)) {
      invalidEmojis.push(fullMatch);
      seenIds.set(emojiId, null);
      continue;
    }

    const parsedEmoji: ParsedEmoji = {
      name: emoji.name,
      id: emojiId,
      animated: emoji.animated ?? false,
      url: emoji.imageUrl,
      raw: fullMatch,
    };

    emojis.push(parsedEmoji);
    seenIds.set(emojiId, parsedEmoji);
  }

  return { content, emojis, invalidEmojis };
}

/**
 * Format emoji for storage - ensures consistent format
 * Returns the canonical format: <:name:id> or <a:name:id>
 */
export function formatEmoji(name: string, id: string, animated = false): string {
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

/**
 * Convert shorthand emoji format to full format
 * :simp:123456789012345678901234 -> <:simp:123456789012345678901234>
 */
export function normalizeEmojiFormat(content: string): string {
  // Match :name:id format without angle brackets
  return content.replace(/:([a-zA-Z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!>)/gi, '<:$1:$2>');
}

/**
 * Extract emoji IDs from content for reactions or other uses
 */
export function extractEmojiIds(content: string): string[] {
  const ids: string[] = [];
  const matches = content.matchAll(CUSTOM_EMOJI_REGEX);
  
  for (const match of matches) {
    const emojiId = match[3];
    if (isValidUUID(emojiId) && !ids.includes(emojiId)) {
      ids.push(emojiId);
    }
  }
  
  return ids;
}

/**
 * Check if a string is a valid custom emoji reference
 */
export function isCustomEmoji(str: string): boolean {
  return CUSTOM_EMOJI_REGEX_SINGLE.test(str);
}

/**
 * Get emoji data for a reaction
 */
export async function getReactionEmoji(emojiStr: string): Promise<{
  name: string;
  id?: string;
  animated?: boolean;
  url?: string;
} | null> {
  // Check if it's a custom emoji (non-global regex so capture groups resolve)
  const match = CUSTOM_EMOJI_REGEX_SINGLE.exec(emojiStr);

  if (match) {
    const [, animated, name, id] = match;
    
    if (!isValidUUID(id)) {
      return null;
    }

    const emoji = await getCachedEmoji(id);
    if (!emoji || !emoji.available) {
      return null;
    }

    return {
      name: emoji.name,
      id,
      animated: emoji.animated ?? false,
      url: emoji.imageUrl,
    };
  }

  // It's a unicode emoji
  return {
    name: emojiStr,
  };
}

/**
 * Validate that all custom emojis in content are accessible
 */
export async function validateEmojisInContent(
  content: string,
  userServerIds: string[]
): Promise<{ valid: boolean; invalidEmojis: string[] }> {
  const result = await parseCustomEmojis(content, undefined, userServerIds);
  return {
    valid: result.invalidEmojis.length === 0,
    invalidEmojis: result.invalidEmojis,
  };
}

/**
 * Replace invalid emojis with their name only (fallback display)
 */
export function replaceInvalidEmojis(content: string, invalidEmojis: string[]): string {
  let result = content;
  
  for (const invalid of invalidEmojis) {
    const match = invalid.match(CUSTOM_EMOJI_REGEX);
    if (match) {
      const name = match[2];
      result = result.replace(invalid, `:${name}:`);
    }
  }
  
  return result;
}
