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

  // Sound
  const playSound = soundsEnabled &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    !(suppressSoundWhenFocused && ctx.isTabVisible);

  // Desktop notification
  const showDesktop = desktopEnabled &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    (ctx.isMentioned || notifyAllMessages || ctx.isDM) &&
    (!ctx.isTabVisible || ctx.isMentioned);

  // Toast
  const showToast = !suppressToasts &&
    passesFocusFilter &&
    !everyoneSuppressed &&
    (!ctx.isTabVisible || ctx.isMentioned);

  // Badge
  const incrementBadge = passesFocusFilter && !everyoneSuppressed;

  return { playSound, showDesktop, showToast, incrementBadge };
}

// ── Tab badge ────────────────────────────────────────────────────────────

let unreadCount = 0;
const originalTitle = typeof document !== "undefined" ? document.title : "SerikaCord";

function updateTabBadge() {
  if (typeof document === "undefined") return;
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

// ── Sound engine ─────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  // A context created before any click starts suspended and stays silent.
  if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Unlock audio on the first interaction so a later background notification
// (no gesture of its own) can actually be heard.
if (typeof window !== "undefined") {
  const unlock = () => {
    getAudioCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
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
