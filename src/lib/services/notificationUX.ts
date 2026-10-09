"use client";

import type { IUserSettings } from "@/lib/models/User";
import { MUTE_FOREVER, decideMessageAlert } from "@/lib/notifications/levels";
import {
  isChannelMutedNow,
  resolveConversation,
  updateNotificationOverride,
} from "@/lib/notifications/prefsStore";

// Notification UX service – tab badge, sound, unread tracking, DND

// ── User settings cache ──────────────────────────────────────────────────
// The notification system needs synchronous access to user settings. We cache
// them here so playNotificationSound() and shouldNotify() can check DND / sound
// settings without async fetches. ThemeContext calls setUserSettings() whenever
// settings change.
let cachedSettings: IUserSettings['notifications'] | null = null;

export function setUserNotificationSettings(n: IUserSettings['notifications'] | undefined) {
  cachedSettings = n || null;
  // Keep localStorage in sync for legacy code paths
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("serika-notif-sound", n?.sounds ? "true" : "false");
  }
}

/** True when the user turned off "Mentions only" (notify on every message). */
export function isNotifyAllMessages(): boolean {
  return getNotifSettings()?.notifyAllMessages === true;
}

function getNotifSettings(): IUserSettings['notifications'] | null {
  if (cachedSettings) return cachedSettings;
  // Fallback: read from localStorage (legacy)
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("serika-user-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.notifications || null;
    }
  } catch { /* ignore */ }
  return null;
}

// ── DND / Quiet Hours ────────────────────────────────────────────────────

function isWithinQuietHours(start: string, end: string, days: number[] | undefined): boolean {
  const now = new Date();
  const day = now.getDay();
  if (days && days.length > 0 && !days.includes(day)) return false;

  const currentMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Overnight range (e.g. 22:00 → 08:00)
  return currentMin >= startMin || currentMin < endMin;
}

export function isDndActive(): boolean {
  const n = getNotifSettings();
  if (!n) return false;
  if (n.dnd) return true;
  if (n.dndSchedule?.enabled && n.dndSchedule.start && n.dndSchedule.end) {
    return isWithinQuietHours(n.dndSchedule.start, n.dndSchedule.end, n.dndSchedule.days);
  }
  return false;
}

// ── Central notification decision helper ─────────────────────────────────

export interface NotifyContext {
  /** Direct (@you) or role mention. */
  isMentioned: boolean;
  isDM: boolean;
  isEveryoneMention: boolean;
  channelId: string;
  isTabVisible: boolean;
  /** Server channel: enables the per-server/per-channel levels. */
  serverId?: string | null;
  /** Category / forum chain, nearest first. */
  ancestorIds?: Array<string | null | undefined>;
  /** True when `isMentioned` came from a role ping (subject to "Suppress role mentions"). */
  isRoleMention?: boolean;
}

export interface NotifyDecision {
  playSound: boolean;
  showDesktop: boolean;
  showToast: boolean;
  incrementBadge: boolean;
}

const SILENT: NotifyDecision = { playSound: false, showDesktop: false, showToast: false, incrementBadge: false };

export function evaluateNotification(ctx: NotifyContext): NotifyDecision {
  const n = getNotifSettings();
  if (isDndActive()) return SILENT;

  // Per-server / per-channel levels, mutes and suppression (server-side
  // settings, synced across devices).
  const resolved = resolveConversation({
    serverId: ctx.isDM ? null : ctx.serverId,
    isDM: ctx.isDM,
    channelId: ctx.channelId,
    ancestorIds: ctx.ancestorIds,
    globalAllMessages: n?.notifyAllMessages === true,
  });
  const muteEveryone = n?.muteEveryone === true || resolved.suppressEveryone;
  const alert = decideMessageAlert({
    resolved: { ...resolved, suppressEveryone: muteEveryone },
    isDM: ctx.isDM,
    mentionedDirectly: ctx.isMentioned && !ctx.isRoleMention,
    mentionedRole: ctx.isMentioned && ctx.isRoleMention === true,
    mentionedEveryone: ctx.isEveryoneMention,
  });
  if (!alert.notify) return SILENT;

  const focusMode = n?.focusMode === true;
  const soundsEnabled = n?.sounds !== false;
  const desktopEnabled = n?.desktop !== false;
  const suppressSoundWhenFocused = n?.suppressSoundWhenFocused !== false;
  const suppressToasts = n?.suppressToasts === true;

  // Per-kind switches in Notification settings ("Direct Messages", "Mentions").
  const kindEnabled = ctx.isDM
    ? n?.directMessages !== false
    : !alert.mention || n?.mentions !== false;

  // Focus mode: only direct mentions and DMs get through
  const passesFocusFilter = kindEnabled &&
    (!focusMode || (ctx.isMentioned && !ctx.isRoleMention && !ctx.isEveryoneMention) || ctx.isDM);
  if (!passesFocusFilter) return SILENT;

  const effectiveMention = alert.mention;

  const playSound = soundsEnabled && !(suppressSoundWhenFocused && ctx.isTabVisible);
  const showDesktop = desktopEnabled && (!ctx.isTabVisible || effectiveMention);
  const showToast = !suppressToasts && (!ctx.isTabVisible || effectiveMention);
  return { playSound, showDesktop, showToast, incrementBadge: true };
}

// ── Call alerts (settings the ringtone and call notifications follow) ────

/** "Incoming call ringtone" (Notifications settings). Default on, independent of message sounds. */
export function isCallRingtoneEnabled(): boolean {
  return getNotifSettings()?.callRingtone !== false;
}

/** The "Desktop notifications" switch. Default on. */
export function isDesktopNotificationEnabled(): boolean {
  return getNotifSettings()?.desktop !== false;
}

/** In-app toasts aren't turned off ("Suppress in-app toast notifications"). */
export function areToastsEnabled(): boolean {
  return getNotifSettings()?.suppressToasts !== true;
}

// ── Tab / app badge ──────────────────────────────────────────────────────
// "(n)" in the tab title, a red dot on the favicon, the PWA app badge and the
// desktop shell's taskbar badge all show the same number: unread mentions plus
// unread DM messages (UnreadContext computes it and calls setUnreadBadge), so
// it clears as soon as those are read, on this or any other device.

let unreadCount = 0;
const TITLE_PREFIX_RE = /^\(\d+\+?\)\s*/;
// While a call rings in a background tab the title alternates with this text.
let flashTimer: ReturnType<typeof setInterval> | null = null;

function baseTitle(): string {
  if (typeof document === "undefined") return "SerikaCord";
  return document.title.replace(TITLE_PREFIX_RE, "");
}

function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function updateTabBadge() {
  if (typeof document === "undefined") return;
  if (flashTimer) return; // the flash restores the title when it stops
  const title = baseTitle();
  const next = unreadCount > 0 ? `(${badgeLabel(unreadCount)}) ${title}` : title;
  if (document.title !== next) document.title = next;
}

// Next.js rewrites <title> on navigation; re-apply the prefix when it does.
let titleObserver: MutationObserver | null = null;
function watchTitle() {
  if (titleObserver || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  titleObserver = new MutationObserver(() => {
    if (unreadCount > 0 && !flashTimer && !TITLE_PREFIX_RE.test(document.title)) updateTabBadge();
  });
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
}

// ── Favicon dot ──
let originalFavicon: string | null = null;
let faviconDotted = false;
let faviconJob = 0;

function faviconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"));
}

function updateFavicon(show: boolean) {
  if (typeof document === "undefined") return;
  if (show === faviconDotted) return;
  faviconDotted = show;
  const links = faviconLinks();
  if (!originalFavicon) originalFavicon = links[0]?.href || "/favicon.ico";
  const job = ++faviconJob;
  if (!show) {
    links.forEach((l) => { if (l.dataset.serikaBadge) { l.href = l.dataset.serikaBadge; delete l.dataset.serikaBadge; } });
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (job !== faviconJob) return;
    try {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      // Red dot, bottom-right, with a cut-out ring so it reads on any icon.
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(size * 0.76, size * 0.76, size * 0.26, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(size * 0.76, size * 0.76, size * 0.2, 0, 2 * Math.PI);
      ctx.fillStyle = "#f23f43";
      ctx.fill();
      const url = canvas.toDataURL("image/png");
      faviconLinks().forEach((l) => {
        if (!l.dataset.serikaBadge) l.dataset.serikaBadge = l.href;
        l.href = url;
      });
    } catch {
      /* tainted canvas (cross-origin icon): title count still shows */
    }
  };
  img.src = originalFavicon;
}

/** Set the unread badge everywhere (title, favicon, app badge, desktop shell). */
export function setUnreadBadge(count: number) {
  const next = Math.max(0, Math.floor(count));
  if (next === unreadCount) return;
  unreadCount = next;
  watchTitle();
  updateTabBadge();
  updateFavicon(next > 0);
  if (typeof window !== "undefined") {
    const w = window as Window & { __serikaSetBadge?: (n: number) => void };
    try { w.__serikaSetBadge?.(next); } catch { /* shell bridge missing */ }
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (next > 0) void nav.setAppBadge?.(next)?.catch?.(() => {});
      else void nav.clearAppBadge?.()?.catch?.(() => {});
    } catch { /* unsupported */ }
  }
}

export function getUnreadCount() {
  return unreadCount;
}

/**
 * Alternate the tab title with `text` (an incoming call) so it's noticed in a
 * background tab. Stops by itself once the tab is looked at.
 */
export function startTitleFlash(text: string) {
  if (typeof document === "undefined") return;
  stopTitleFlash();
  const restore = baseTitle();
  flashRestore = restore;
  let on = false;
  const tick = () => {
    on = !on;
    document.title = on ? text : restore;
  };
  tick();
  flashTimer = setInterval(() => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      stopTitleFlash();
      return;
    }
    tick();
  }, 1000);
}

let flashRestore = "";

export function stopTitleFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
  if (flashRestore) document.title = flashRestore;
  flashRestore = "";
  updateTabBadge();
}

// ── Sound engine ─────────────────────────────────────────────────────────

// One AudioContext for every app sound (notification chimes and the call
// ringtone): browsers only let a context play after a user gesture on the
// page, so sharing it means one click anywhere unlocks both.
let audioCtx: AudioContext | null = null;
const unlockListeners = new Set<() => void>();

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
    audioCtx.addEventListener("statechange", () => {
      if (audioCtx?.state !== "running") return;
      const listeners = [...unlockListeners];
      unlockListeners.clear();
      listeners.forEach((fn) => fn());
    });
  }
  // A context created before any click starts suspended and stays silent.
  if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** The shared app AudioContext (created on demand; null during SSR). */
export function getAudioContext(): AudioContext | null {
  return getAudioCtx();
}

/** Whether the browser currently lets the app play sound. */
export function isAudioUnlocked(): boolean {
  return audioCtx?.state === "running";
}

/** Run `fn` once audio becomes playable (the next click/key press). */
export function onAudioUnlocked(fn: () => void): () => void {
  if (isAudioUnlocked()) {
    fn();
    return () => {};
  }
  unlockListeners.add(fn);
  return () => { unlockListeners.delete(fn); };
}

// Unlock audio on interaction so a later background notification or incoming
// call (no gesture of its own) can actually be heard. Kept until the context
// really runs: some browsers ignore the first resume().
if (typeof window !== "undefined") {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const done = () => {
      if (ctx.state !== "running") return;
      events.forEach((e) => window.removeEventListener(e, unlock, true));
    };
    if (ctx.state === "running") done();
    else void ctx.resume().then(done).catch(() => {});
  };
  events.forEach((e) => window.addEventListener(e, unlock, true));
}

type SoundPreset = 'chime' | 'ding' | 'pop' | 'coin' | 'none';

function playChime(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1100, now + 0.12);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.5);
}

function playDing(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1320, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.3);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.8);
}

function playPop(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.8, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playCoin(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const notes = [988, 1319];
  notes.forEach((freq, i) => {
    const t = now + i * 0.08;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

export function playNotificationSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const n = getNotifSettings();
  if (n?.sounds === false) return;
  if (isDndActive()) return;

  const volume = Math.min(1, Math.max(0, (n?.soundVolume ?? 50) / 100)) * 0.3;
  const preset: SoundPreset = n?.soundType ?? 'chime';

  if (preset === 'none') return;
  switch (preset) {
    case 'ding': playDing(ctx, volume); break;
    case 'pop': playPop(ctx, volume); break;
    case 'coin': playCoin(ctx, volume); break;
    case 'chime':
    default: playChime(ctx, volume); break;
  }
}

/** Notification volume (0–1) from the user's settings; the ringtone scales from it. */
export function getNotificationVolume(): number {
  return Math.min(1, Math.max(0, (getNotifSettings()?.soundVolume ?? 50) / 100));
}

export function isNotificationSoundEnabled(): boolean {
  const n = getNotifSettings();
  if (n) return n.sounds !== false;
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem("serika-notif-sound") !== "false";
}

export function setNotificationSoundEnabled(enabled: boolean) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("serika-notif-sound", enabled ? "true" : "false");
  }
}

// ── Channel mutes ────────────────────────────────────────────────────────
// Server-side per-user settings (src/lib/notifications/prefsStore.ts), synced
// across devices. Muted channels never chime, pop or glow.

export function isChannelMuted(channelId: string): boolean {
  return isChannelMutedNow(channelId);
}

/** Mute (until turned back on) or unmute a channel, category or DM. */
export function setChannelMuted(channelId: string, muted: boolean) {
  void updateNotificationOverride("channel", channelId, { muteUntil: muted ? MUTE_FOREVER : null });
}

export function toggleChannelMute(channelId: string): boolean {
  const nowMuted = !isChannelMuted(channelId);
  setChannelMuted(channelId, nowMuted);
  return nowMuted;
}
