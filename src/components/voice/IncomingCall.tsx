"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Video } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { onCallEvent, type CallRing } from "@/lib/chat/dmCall";
import { onHotkey } from "@/lib/keybinds";
import { startRingtone, stopRingtone } from "@/lib/services/ringtone";
import { voiceService } from "@/lib/services/voiceService";
import { cdnImage } from "@/lib/utils";

// Stop ringing (as a missed call) if nobody picks up.
const RING_TIMEOUT_MS = 45_000;

// Incoming DM call card + ringtone. Mounted in the DM and channels layouts next
// to VoiceAudioSink, so it rings wherever the user is in the app.
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
    stopRingtone(outro);
    show(null);
  }, [show]);

  useEffect(() => onCallEvent((event) => {
    if (event.type === "call_ring") {
      if (voiceService.isConnectedTo(event.roomId)) return;
      show({ roomId: event.roomId, video: event.video, caller: event.caller });
      void startRingtone();
    } else if (callRef.current?.roomId === event.roomId) {
      // Caller hung up → outro; answered/declined on another device → just stop.
      dismiss(event.reason === "ended");
    }
  }), [dismiss, show]);

  useEffect(() => {
    if (!call) return;
    const timer = setTimeout(() => dismiss(true), RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [call, dismiss]);

  useEffect(() => () => stopRingtone(), []);

  const accept = useCallback((withVideo = false) => {
    const current = callRef.current;
    if (!current || !user) return;
    dismiss(false);
    voiceService.setUserId(user.id);
    void voiceService.joinChannel(current.roomId, withVideo);
    router.push(`/dm/${current.caller.id}`);
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
    return () => {
      offAnswer();
      offDecline();
    };
  }, [call, accept, decline]);

  // Caller side: say so when the other person declines.
  useEffect(() => voiceService.subscribe((event) => {
    if (event.type === "call_declined") toast(gt("Call declined"));
  }), [gt]);

  if (!call) return null;
  const name = call.caller.displayName || call.caller.username;

  return (
    <div
      aria-live="assertive"
      className="fixed left-1/2 top-4 z-[200] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-[var(--border-subtle,#2a2a3a)] bg-[var(--bg-card,#14141f)] p-4 shadow-2xl animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <span className="absolute inset-0 rounded-full bg-[#22c55e]/40 animate-ping" />
          <Avatar className="relative h-12 w-12">
            <AvatarImage src={cdnImage(call.caller.avatar)} alt="" />
            <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[var(--text-primary)]">{name}</div>
          <div className="text-sm text-[var(--text-secondary)]">
            {call.video ? gt("Incoming video call") : gt("Incoming voice call")}
          </div>
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
