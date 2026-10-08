"use client";

import type { IUserSettings } from "@/lib/models/User";

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
  isMentioned: boolean;
  isDM: boolean;
  isEveryoneMention: boolean;
  channelId: string;
  isTabVisible: boolean;
}

export interface NotifyDecision {
  playSound: boolean;
  showDesktop: boolean;
  showToast: boolean;
  incrementBadge: boolean;
}

export function evaluateNotification(ctx: NotifyContext): NotifyDecision {
  const n = getNotifSettings();
  const dnd = isDndActive();
  const muted = isChannelMuted(ctx.channelId);

  // Hard suppress: channel mute or DND
  if (muted || dnd) {
    return { playSound: false, showDesktop: false, showToast: false, incrementBadge: false };
  }

  const focusMode = n?.focusMode === true;
  const soundsEnabled = n?.sounds !== false;
  const desktopEnabled = n?.desktop !== false;
  const suppressSoundWhenFocused = n?.suppressSoundWhenFocused !== false;
  const suppressToasts = n?.suppressToasts === true;
  const muteEveryone = n?.muteEveryone === true;
  const notifyAllMessages = n?.notifyAllMessages === true;

  // Per-kind switches in Notification settings ("Direct Messages", "Mentions").
  const kindEnabled = ctx.isDM
    ? n?.directMessages !== false
    : !ctx.isMentioned || n?.mentions !== false;

  // Focus mode: only direct mentions and DMs get through
  const passesFocusFilter = kindEnabled &&
    (!focusMode || (ctx.isMentioned && !ctx.isEveryoneMention) || ctx.isDM);

  // @everyone suppression
  const everyoneSuppressed = ctx.isEveryoneMention && muteEveryone && !ctx.isMentioned;
  // An un-muted @everyone/@here ping notifies like a mention.
  const effectiveMention = ctx.isMentioned || (ctx.isEveryoneMention && !muteEveryone);

  // Sound
  const playSound = soundsEnabled &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    !(suppressSoundWhenFocused && ctx.isTabVisible);

  // Desktop notification
  const showDesktop = desktopEnabled &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    (effectiveMention || notifyAllMessages || ctx.isDM) &&
    (!ctx.isTabVisible || effectiveMention);

  // Toast
  const showToast = !suppressToasts &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    (!ctx.isTabVisible || effectiveMention);

  // Badge
  const incrementBadge = passesFocusFilter && !everyoneSuppressed;

  return { playSound, showDesktop, showToast, incrementBadge };
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

// ── Tab badge ────────────────────────────────────────────────────────────

let unreadCount = 0;
const originalTitle = typeof document !== "undefined" ? document.title : "SerikaCord";
// While a call rings in a background tab the title alternates with this text.
let flashTimer: ReturnType<typeof setInterval> | null = null;

function updateTabBadge() {
  if (typeof document === "undefined") return;
  if (flashTimer) return; // the flash restores the title when it stops
  if (unreadCount > 0) {
    document.title = `(${unreadCount}) ${originalTitle.replace(/^\(\d+\)\s*/, "")}`;
  } else {
    document.title = originalTitle.replace(/^\(\d+\)\s*/, "");
  }
}

export function incrementUnread(by = 1) {
  unreadCount += by;
  updateTabBadge();
}

export function clearUnread() {
  unreadCount = 0;
  updateTabBadge();
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
  let on = false;
  const tick = () => {
    on = !on;
    document.title = on ? text : originalTitle.replace(/^\(\d+\)\s*/, "");
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

export function stopTitleFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
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
// Persisted locally (same `channel-muted:<id>` keys the chat header bell toggle
// uses); muted channels never badge, chime, or toast.
const muteListeners = new Set<(channelId: string, muted: boolean) => void>();

export function isChannelMuted(channelId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(`channel-muted:${channelId}`) === "1";
}

export function setChannelMuted(channelId: string, muted: boolean) {
  localStorage.setItem(`channel-muted:${channelId}`, muted ? "1" : "0");
  muteListeners.forEach((listener) => listener(channelId, muted));
}

export function toggleChannelMute(channelId: string): boolean {
  const nowMuted = !isChannelMuted(channelId);
  setChannelMuted(channelId, nowMuted);
  return nowMuted;
}

export function subscribeChannelMutes(listener: (channelId: string, muted: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}
