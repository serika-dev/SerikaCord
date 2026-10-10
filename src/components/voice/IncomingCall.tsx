"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { callConversationHref, onCallEvent, type CallMissed, type CallRing } from "@/lib/chat/dmCall";
import { onHotkey } from "@/lib/keybinds";
import { startRingtone, stopRingtone } from "@/lib/services/ringtone";
import { voiceService, type VoiceErrorCode } from "@/lib/services/voiceService";
import { answerDmCall, isInDmCall, onCallNotice } from "@/lib/services/dmCallController";
import { callAlertPlan, RING_TIMEOUT_MS } from "@/lib/voice/callState";
import {
  areToastsEnabled,
  isDesktopNotificationEnabled,
  isDndActive,
  startTitleFlash,
  stopTitleFlash,
} from "@/lib/services/notificationUX";
import { closeNotification, showNotification } from "@/lib/services/notificationService";
import { cdnImage } from "@/lib/utils";

type Gt = ReturnType<typeof useGT>;

/** Translated text for a voice error (falls back to the service's English text). */
export function voiceErrorText(gt: Gt, code: VoiceErrorCode | undefined, fallback: string): string {
  switch (code) {
    case "mic-denied": return gt("Microphone access is blocked. Allow it in your browser's site settings, then try again.");
    case "mic-missing": return gt("No microphone was found. Plug one in and try again.");
    case "mic-busy": return gt("Your microphone is being used by another app.");
    case "insecure": return gt("Voice needs a secure (https) connection.");
    case "camera-denied": return gt("Camera access is blocked. Allow it in your browser's site settings.");
    case "room-full": return gt("This voice channel is full.");
    case "call-blocked": return gt("You can't call this user.");
    case "join-failed": return gt("Could not connect to voice. Please try again.");
    case "disconnected": return gt("Disconnected from voice.");
    case "moved": return gt("You joined this call on another device.");
    case "screen-unsupported": return gt("Screen sharing isn't supported on this device or browser.");
    case "screen-failed": return gt("Could not start screen share.");
    default: return fallback;
  }
}

/** The user is looking at the app right now (tab shown and window focused). */
function isAppFocused(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

const callTag = (roomId: string) => `call-${roomId}`;

/**
 * Claim a missed call for this tab so only one of the user's open tabs
 * notifies about it (each device's tabs share localStorage).
 */
const MISSED_KEY = "sc:calls-missed";
function claimMissedCall(callId: string): boolean {
  try {
    const raw = localStorage.getItem(MISSED_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (seen.includes(callId)) return false;
    localStorage.setItem(MISSED_KEY, JSON.stringify([...seen.slice(-49), callId]));
    return true;
  } catch {
    return true;
  }
}

// Incoming DM / group call card + ringtone, missed-call notifications, plus
// the app-wide call/voice toasts. Mounted once in the DM and channels layouts
// next to VoiceAudioSink, so it rings wherever the user is in the app.
export function IncomingCall() {
  const gt = useGT();
  const router = useRouter();
  const { user } = useAuth();
  const [call, setCall] = useState<CallRing | null>(null);
  // Mirrors `call` for the event/hotkey handlers; only written alongside setCall.
  const callRef = useRef<CallRing | null>(null);

  const show = useCallback((next: CallRing | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const dismiss = useCallback((outro: boolean) => {
    stopRingtone(outro, "incoming");
    stopTitleFlash();
    const current = callRef.current;
    if (current) void closeNotification(callTag(current.roomId));
    show(null);
  }, [show]);

  /** Make sure an incoming call gets noticed, even when the ring can't be heard. */
  const alert = useCallback((ring: CallRing, soundBlocked: boolean) => {
    const name = ring.caller.displayName || ring.caller.username;
    const plan = callAlertPlan({
      dnd: isDndActive(),
      desktopEnabled: isDesktopNotificationEnabled(),
      toastsEnabled: false, // the card itself is the in-app alert
      focused: isAppFocused(),
      soundBlocked,
    });
    if (plan.flashTitle || soundBlocked) {
      startTitleFlash(ring.group
        ? gt("📞 {name} is calling {group}", { name, group: ring.group.name })
        : gt("📞 Incoming call from {name}", { name }));
    }
    if (!plan.desktop) return;
    const title = ring.group
      ? gt("{name} is calling {group}", { name, group: ring.group.name })
      : gt("Incoming call from {name}", { name });
    const body = ring.video ? gt("Incoming video call") : gt("Incoming voice call");
    const url = callConversationHref(ring);
    void showNotification(title, body, {
      tag: callTag(ring.roomId),
      icon: cdnImage(ring.caller.avatar) || undefined,
      requireInteraction: true,
      data: { url },
      onClick: () => {
        window.focus();
        router.push(url);
      },
    });
  }, [gt, router]);

  const notifyMissed = useCallback((missed: CallMissed) => {
    if (isDndActive()) return;
    if (!claimMissedCall(missed.callId)) return;
    const name = missed.caller.displayName || missed.caller.username;
    const focused = isAppFocused();
    const plan = callAlertPlan({
      dnd: false,
      desktopEnabled: isDesktopNotificationEnabled(),
      toastsEnabled: areToastsEnabled(),
      focused,
    });
    const url = callConversationHref(missed);
    const open = () => {
      window.focus();
      router.push(url);
    };
    const title = missed.group
      ? gt("Missed call from {name} in {group}", { name, group: missed.group.name })
      : gt("Missed call from {name}", { name });
    // The tab badge comes from the call message's DM unread count.
    if (plan.desktop) {
      void showNotification(title, gt("You missed a call."), {
        tag: `call-missed-${missed.callId}`,
        icon: cdnImage(missed.caller.avatar) || undefined,
        data: { url },
        onClick: open,
      });
    }
    if (plan.toast) {
      toast(title, {
        id: `call-missed-${missed.callId}`,
        duration: 8000,
        action: { label: gt("View"), onClick: open },
      });
    }
  }, [gt, router]);

  useEffect(() => onCallEvent((event) => {
    if (event.type === "call_ring") {
      // Already in (or joining) that call on this tab: nothing to ring for.
      if (isInDmCall(event.roomId)) return;
      const ringing = callRef.current?.roomId === event.roomId;
      const ring: CallRing = { roomId: event.roomId, video: event.video, caller: event.caller, group: event.group ?? null };
      show(ring);
      // A repeated ring for the same call (caller reconnected) keeps the
      // current ringtone instead of restarting it.
      if (ringing) return;
      void startRingtone("incoming").then((result) => {
        // Answered/declined while the ringtone was loading.
        if (callRef.current?.roomId !== ring.roomId) return;
        alert(ring, result === "blocked");
      });
    } else if (event.type === "call_missed") {
      if (callRef.current?.roomId === event.roomId) dismiss(true);
      notifyMissed(event);
    } else if (callRef.current?.roomId === event.roomId) {
      // Caller hung up → outro; answered/declined on another device → just stop.
      dismiss(event.reason === "ended");
    }
  }), [alert, dismiss, notifyMissed, show]);

  useEffect(() => {
    if (!call) return;
    // Missed: stop a little after the caller's own no-answer timeout.
    const timer = setTimeout(() => dismiss(true), RING_TIMEOUT_MS + 5_000);
    return () => clearTimeout(timer);
  }, [call, dismiss]);

  useEffect(() => () => {
    stopRingtone(false, "incoming");
    stopTitleFlash();
  }, []);

  const accept = useCallback((withVideo = false) => {
    const current = callRef.current;
    if (!current || !user) return;
    dismiss(false);
    voiceService.setUserId(user.id);
    void answerDmCall({
      roomId: current.roomId,
      caller: {
        id: current.caller.id,
        name: current.caller.displayName || current.caller.username,
        avatar: current.caller.avatar,
      },
      group: current.group ?? null,
      video: withVideo,
    });
    // Open the conversation, where the call panel lives (1:1 DM or group page).
    router.push(callConversationHref(current));
  }, [dismiss, router, user]);

  const decline = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    dismiss(false);
    void fetch("/api/voice/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: current.roomId }),
    }).catch(() => {});
  }, [dismiss]);

  useEffect(() => {
    if (!call) return;
    const offAnswer = onHotkey("answer-call", () => accept());
    const offDecline = onHotkey("decline-call", decline);
    // Plain Escape is also "mark channel as read", which the hotkey matcher
    // finds first; while a call is ringing, Escape must decline it instead.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      decline();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => {
      offAnswer();
      offDecline();
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [call, accept, decline]);

  // How a DM call ended, from the caller's side.
  useEffect(() => onCallNotice((notice) => {
    if (notice.group) {
      if (notice.reason === "no-answer") toast(gt("Nobody answered"));
      return;
    }
    const name = notice.peer?.name || gt("They");
    if (notice.reason === "declined") toast(gt("{name} declined the call", { name }));
    else if (notice.reason === "no-answer") toast(gt("{name} didn't answer", { name }));
    else if (notice.reason === "peer-left") toast(gt("Call ended"));
  }), [gt]);

  // Joined without a microphone: a heads-up, not an error (the call works).
  useEffect(() => voiceService.subscribe((event) => {
    if (event.type !== "listen_only") return;
    if (!event.enabled) {
      toast.dismiss("voice-listen-only");
      return;
    }
    const why = event.reason === "mic-denied"
      ? gt("Allow microphone access in your browser's site settings, then press the mic button.")
      : event.reason === "mic-busy"
        ? gt("Your microphone is being used by another app. Press the mic button to try again.")
        : gt("Plug in a microphone, then press the mic button.");
    toast.warning(gt("No microphone — you can listen but others can't hear you"), {
      id: "voice-listen-only",
      description: why,
    });
  }), [gt]);

  // Voice errors (mic blocked, join refused, moved to another device...) are
  // shown here once for every surface: DM calls, voice channels, the voice bar.
  useEffect(() => voiceService.subscribe((event) => {
    if (event.type !== "error") return;
    const text = voiceErrorText(gt, event.code, event.message);
    if (event.code === "moved") toast(text);
    else toast.error(text, { id: `voice-error-${event.code ?? "other"}` });
  }), [gt]);

  if (!call) return null;
  const name = call.caller.displayName || call.caller.username;
  const title = call.group ? call.group.name : name;
  const subtitle = call.group
    ? (call.video ? gt("{name} is starting a video call", { name }) : gt("{name} is starting a call", { name }))
    : (call.video ? gt("Incoming video call") : gt("Incoming voice call"));

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={call.video ? gt("Incoming video call") : gt("Incoming voice call")}
      className="fixed left-1/2 top-4 z-[200] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-2xl animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <span className="absolute inset-0 rounded-full bg-[#22c55e]/40 animate-ping" />
          <Avatar className="relative h-12 w-12">
            {call.group ? (
              <>
                {call.group.icon && <AvatarImage src={cdnImage(call.group.icon)} alt="" />}
                <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)]">
                  <Users className="h-5 w-5" aria-hidden />
                </AvatarFallback>
              </>
            ) : (
              <>
                <AvatarImage src={cdnImage(call.caller.avatar)} alt="" />
                <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </>
            )}
          </Avatar>
          {call.group && (
            <Avatar className="absolute -bottom-1 -right-1 h-6 w-6 border-2 border-[var(--bg-card)]">
              <AvatarImage src={cdnImage(call.caller.avatar)} alt="" />
              <AvatarFallback className="text-[10px]">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[var(--text-primary)]">{title}</div>
          <div className="truncate text-sm text-[var(--text-secondary)]">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={decline}
            title={gt("Decline")}
            aria-label={gt("Decline")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ef4444] text-white transition-transform hover:scale-105"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
          {call.video && (
            <button
              onClick={() => accept(true)}
              title={gt("Accept with video")}
              aria-label={gt("Accept with video")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22c55e] text-white transition-transform hover:scale-105"
            >
              <Video className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => accept()}
            title={gt("Accept")}
            aria-label={gt("Accept")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#22c55e] text-white transition-transform hover:scale-105"
          >
            <Phone className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
