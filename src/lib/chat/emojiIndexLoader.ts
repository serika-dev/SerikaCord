/**
 * Lazy entry to the emoji index (emojiIndex.ts + its ~75 KB dataset): the
 * composer starts loading it when it gets focus or a `:` is typed, so the
 * chat bundle never carries the data.
 */
import type { EmojiIndex } from "./emojiIndex";

export type EmojiIndexModule = typeof import("./emojiIndex");
export interface EmojiEngine {
  mod: EmojiIndexModule;
  index: EmojiIndex;
}

let engine: EmojiEngine | null = null;
let pending: Promise<EmojiEngine> | null = null;

export function loadEmojiEngine(): Promise<EmojiEngine> {
  if (engine) return Promise.resolve(engine);
  pending ??= import("./emojiIndex").then((mod) => {
    engine = { mod, index: mod.getEmojiIndex() };
    return engine;
  }).catch((err: unknown) => {
    pending = null; // a failed chunk load can be retried
    throw err;
  });
  return pending;
}

/** The engine if it has loaded already. */
export function peekEmojiEngine(): EmojiEngine | null {
  return engine;
}
