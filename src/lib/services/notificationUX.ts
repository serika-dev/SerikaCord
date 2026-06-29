"use client";

// Notification UX service – tab badge, sound, unread tracking

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

// Sound – tiny base64-encoded notification chime (generated inline via AudioContext)
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
  return audioCtx;
}

export function playNotificationSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const enabled = localStorage.getItem("serika-notif-sound") !== "false";
  if (!enabled) return;

  // Simple two-tone chime
  const now = ctx.currentTime;
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1100, now + 0.12);
  osc.connect(gainNode);
  osc.start(now);
  osc.stop(now + 0.5);
}

export function isNotificationSoundEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem("serika-notif-sound") !== "false";
}

export function setNotificationSoundEnabled(enabled: boolean) {
  localStorage.setItem("serika-notif-sound", enabled ? "true" : "false");
}
