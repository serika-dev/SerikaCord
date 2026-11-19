/**
 * Shapes and fixed data for the live homepage preview (LivePreview.tsx).
 * Anything a visitor reads is translated in useLiveStrings(); this file only
 * holds structure, names (which are never translated) and colors.
 */
import type { PreviewReaction } from "../preview/parts";

export type Person = "Sora" | "Theo" | "Aya" | "Rin" | "Mika" | "Jun" | "Kai" | "Nova" | "Leo";
export type ServerId = "night-owls" | "pixel-club" | "art-corner" | "lofi-lounge";
export type ChannelKind = "text" | "announcement" | "forum" | "voice";

/** `${server}:${channel}` for server channels, `dm:${person}` for DMs. */
export type RoomKey = string;

export interface Msg {
  id: string;
  author: Person;
  time: string;
  text: string;
  kind?: "poll" | "thread" | "image" | "sticker" | "join";
  /** Image or sticker source. */
  src?: string;
  reactions: PreviewReaction[];
  replyTo?: { author: Person; text: string };
  /** Mentions the visitor (Sora): highlighted like the app does. */
  mention?: boolean;
  pinned?: boolean;
  /** Arrived after the intro (slides in on mount). */
  live?: boolean;
  /** Just arrived (highlight that fades). */
  fresh?: boolean;
}

export const PEOPLE: Record<Person, { color?: string; owner?: boolean; nameplate?: string; username: string }> = {
  Sora: { nameplate: "grape", username: "sora" },
  Theo: { color: "#3BA55C", owner: true, nameplate: "ocean", username: "theo.gg" },
  Aya: { nameplate: "sakura", username: "aya.draws" },
  Rin: { nameplate: "aurora", username: "rin_lofi" },
  Mika: { nameplate: "mint", username: "mika" },
  Jun: { nameplate: "ember", username: "jun.exe" },
  Kai: { color: "#f59e0b", owner: true, username: "kai" },
  Nova: { color: "#ec4899", nameplate: "neon", username: "nova" },
  Leo: { username: "leo.png" },
};

export const ACCENTS = ["#8b5cf6", "#ec4899", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444"];

export const QUICK_REACTIONS = ["👍", "❤️", "😂"];
export const EMOJI = ["😀", "😂", "🥹", "😍", "🤔", "😎", "🥳", "😭", "👀", "🔥", "✨", "💜", "❤️", "👍", "👏", "🙌", "🎉", "🎮", "🎧", "🍕", "🍿", "☕", "🐱", "🦉"];
export const STICKERS = ["/logo-icon.svg", "🐱", "🦉", "🎉", "💜", "👋"];
export const REACTION_POOL = ["❤️", "😂", "🔥", "👀", "🎉", "✨", "💜"];

export const SCREENSHOT = "/home/screenshare-palworld.webp";
/** Sample game screenshots people post (and you "upload"). */
export const SHOTS = {
  snowyCliff: "/home/shot-snowy-cliff.webp",
  coaster: "/home/shot-coaster.webp",
  castle: "/home/shot-castle.webp",
} as const;
export const SHOT_POOL = [SCREENSHOT, SHOTS.snowyCliff, SHOTS.coaster, SHOTS.castle];
