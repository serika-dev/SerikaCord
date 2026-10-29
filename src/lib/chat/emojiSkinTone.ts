"use client";

/**
 * The emoji skin tone this device uses (0 = default yellow, 1-5 light → dark),
 * picked in the emoji picker and applied by the picker, the `:` autocomplete
 * and `:shortcode:` conversion. localStorage, shared across tabs.
 */

import { useSyncExternalStore } from "react";
import type { SkinTone } from "./emojiIndex";

const STORAGE_KEY = "serika-emoji-skin-tone";
const listeners = new Set<() => void>();
let tone: SkinTone | null = null;

function read(): SkinTone {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(n) && n >= 0 && n <= 5 ? (n as SkinTone) : 0;
  } catch {
    return 0;
  }
}

export function getSkinTone(): SkinTone {
  if (typeof window === "undefined") return 0;
  if (tone === null) tone = read();
  return tone;
}

export function setSkinTone(next: SkinTone): void {
  tone = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, String(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: kept for this session */
  }
  for (const l of listeners) l();
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return;
  tone = read();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useSkinTone(): SkinTone {
  return useSyncExternalStore(subscribe, getSkinTone, () => 0 as SkinTone);
}
