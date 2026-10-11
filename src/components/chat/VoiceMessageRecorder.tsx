"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, SendHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/ui/Loader";
import { haptic } from "@/lib/native/bridge";
import {
  RECORDER_MAX_SECS,
  downsampleWaveform,
  encodeWaveform,
  formatVoiceDuration,
  pickRecorderFormat,
  recorderFormatForBlobType,
  waveformSampleCount,
  type RecorderFormat,
  type VoiceMessageAttachment,
} from "@/lib/chat/voiceMessage";

/** Where a press-and-hold started (touch/mouse on the mic button). */
export interface VoiceHoldStart {
  pointerId: number;
  x: number;
}

interface VoiceMessageRecorderProps {
  /** Set when recording began by holding the mic: release sends, sliding left cancels. */
  hold: VoiceHoldStart | null;
  channelId?: string;
  uploadEndpoint: string;
  onSend: (voice: VoiceMessageAttachment) => void;
  onClose: () => void;
}

const LEVEL_TICK_MS = 50;
const LIVE_BARS = 48;
/** A hold shorter than this becomes a tap: the recorder stays open (locked). */
const HOLD_MIN_MS = 350;
const CANCEL_SLIDE_PX = 110;
const MIN_DURATION_SECS = 0.6;

type Phase = "starting" | "recording" | "uploading";

/**
 * Discord-style voice message recorder, shown over the composer row.
 * Tap the mic → records until you press send (or X / Escape to discard).
 * Hold the mic → records while held; release to send, slide left to cancel.
 * Records with MediaRecorder (opus in ogg/webm, m4a on Safari), samples the
 * input level for the waveform, uploads through the normal attachment
 * endpoint and hands the attachment (+ duration and waveform) to `onSend`.
 */
export default function VoiceMessageRecorder({ hold, channelId, uploadEndpoint, onSend, onClose }: VoiceMessageRecorderProps) {
  const gt = useGT();
  const [phase, setPhase] = useState<Phase>("starting");
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [holding, setHolding] = useState(hold !== null);
  const [slide, setSlide] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const formatRef = useRef<RecorderFormat | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const levelsRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const holdStartedAtRef = useRef(0);
  const discardRef = useRef(false);
  const doneRef = useRef(false);
  const latest = useRef({ onSend, onClose, gt, channelId, uploadEndpoint });
  useEffect(() => {
    latest.current = { onSend, onClose, gt, channelId, uploadEndpoint };
  });

  /** Release the mic, analyser and timers. */
  const teardown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }, []);

  const upload = useCallback(async (blob: Blob, durationSecs: number) => {
    const { gt: t, channelId: cid, uploadEndpoint: endpoint } = latest.current;
    const format = recorderFormatForBlobType(blob.type, formatRef.current!);
    const file = new File([blob], `voice-message.${format.extension}`, { type: format.fileType });
    const form = new FormData();
    form.append("file", file);
    if (cid) form.append("channelId", cid);
    try {
      const res = await fetch(endpoint, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.attachment?.url) {
        toast.error(data?.error || t("Failed to send voice message"));
        return;
      }
      const samples = downsampleWaveform(levelsRef.current, waveformSampleCount(durationSecs));
      latest.current.onSend({
        id: data.attachment.id,
        url: data.attachment.url,
        filename: data.attachment.filename,
        contentType: data.attachment.contentType || format.fileType,
        size: data.attachment.size,
        durationSecs: Math.round(durationSecs * 100) / 100,
        waveform: encodeWaveform(samples),
      });
    } catch {
      toast.error(t("Failed to send voice message"));
    } finally {
      latest.current.onClose();
    }
  }, []);

  /** Stop recording; send (upload) or discard. */
  const finish = useCallback(
    (send: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const recorder = recorderRef.current;
      const durationSecs = startedAtRef.current ? (performance.now() - startedAtRef.current) / 1000 : 0;
      if (!send || !recorder || recorder.state === "inactive") {
        discardRef.current = true;
        try { recorder?.stop(); } catch { /* already stopped */ }
        teardown();
        latest.current.onClose();
        return;
      }
      if (durationSecs < MIN_DURATION_SECS) {
        discardRef.current = true;
        try { recorder.stop(); } catch { /* already stopped */ }
        teardown();
        toast(latest.current.gt("Hold to record, release to send"));
        latest.current.onClose();
        return;
      }
      setPhase("uploading");
      haptic("light");
      recorder.onstop = () => {
        teardown();
        const type = recorder.mimeType || formatRef.current?.mimeType || "";
        const blob = new Blob(chunksRef.current, { type });
        void upload(blob, durationSecs);
      };
      try {
        recorder.requestData();
      } catch { /* not recording */ }
      recorder.stop();
    },
    [teardown, upload],
  );

  // Start recording on mount; everything here runs in async callbacks.
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const t = latest.current.gt;
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        toast.error(t("Voice messages aren't supported in this browser"));
        latest.current.onClose();
        return;
      }
      const format = pickRecorderFormat((type) => MediaRecorder.isTypeSupported(type));
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        if (!cancelled) {
          toast.error(t("Allow microphone access to record voice messages"));
          latest.current.onClose();
        }
        return;
      }
      if (cancelled || doneRef.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      let recorder: MediaRecorder;
      try {
        recorder = format ? new MediaRecorder(stream, { mimeType: format.mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(stream);
      } catch {
        toast.error(t("Voice messages aren't supported in this browser"));
        teardown();
        latest.current.onClose();
        return;
      }
      formatRef.current = format ?? recorderFormatForBlobType(recorder.mimeType, { mimeType: "audio/webm", fileType: "audio/webm", extension: "webm" });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && !discardRef.current) chunksRef.current.push(e.data);
      };

      // Input level → waveform samples + the live bars.
      let analyser: AnalyserNode | null = null;
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(analyser);
        }
      } catch {
        analyser = null;
      }
      const buf = analyser ? new Float32Array(analyser.fftSize) : null;
      levelsRef.current = [];

      recorder.start(250);
      startedAtRef.current = performance.now();
      setPhase("recording");
      haptic("medium");
      tickRef.current = setInterval(() => {
        let level = 0;
        if (analyser && buf) {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          // RMS → a perceptual-ish 0..1 (speech RMS sits around 0.02-0.2).
          level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.6);
        }
        levelsRef.current.push(level);
        const secs = (performance.now() - startedAtRef.current) / 1000;
        setElapsed(secs);
        setLive((prev) => {
          const next = prev.length >= LIVE_BARS ? prev.slice(prev.length - LIVE_BARS + 1) : prev.slice();
          next.push(level);
          return next;
        });
        if (secs >= RECORDER_MAX_SECS) finish(true);
      }, LEVEL_TICK_MS);
    };
    void start();
    return () => {
      cancelled = true;
      if (!doneRef.current) {
        doneRef.current = true;
        discardRef.current = true;
        try { recorderRef.current?.stop(); } catch { /* inactive */ }
      }
      // An upload in flight keeps going; only the mic/analyser are released.
      teardown();
    };
  }, [finish, teardown]);

  // Press-and-hold: follow the pointer until it is released.
  useEffect(() => {
    if (!hold) return;
    holdStartedAtRef.current = performance.now();
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== hold.pointerId) return;
      const dx = Math.max(0, hold.x - e.clientX);
      setSlide(dx);
      if (dx >= CANCEL_SLIDE_PX) {
        haptic("light");
        finish(false);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== hold.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setHolding(false);
      setSlide(0);
      const heldMs = performance.now() - holdStartedAtRef.current;
      // A quick tap (or a release while the mic prompt was up) locks the
      // recorder open; a real hold sends on release.
      if (e.type === "pointerup" && heldMs >= HOLD_MIN_MS && startedAtRef.current > 0 && recorderRef.current?.state === "recording") {
        finish(true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [hold, finish]);

  // Escape discards, Enter sends (while locked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finish]);

  const bars = live.length < LIVE_BARS ? [...new Array(LIVE_BARS - live.length).fill(0), ...live] : live;
  const slideProgress = Math.min(1, slide / CANCEL_SLIDE_PX);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center gap-2 sm:gap-3 rounded-lg bg-[var(--app-surface)] border border-[var(--app-border)] px-2 sm:px-3"
      role="group"
      aria-label={gt("Recording voice message")}
    >
      {!holding && (
        <button
          type="button"
          onClick={() => finish(false)}
          disabled={phase === "uploading"}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[var(--app-muted)] hover:text-red-500 hover:bg-[var(--app-surface-alt)] transition-colors disabled:opacity-50"
          aria-label={gt("Discard voice message")}
          title={gt("Discard voice message")}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}

      <span className="flex-shrink-0 flex items-center gap-1.5 text-sm tabular-nums text-[var(--text-primary)]">
        <span
          className={cn("w-2.5 h-2.5 rounded-full bg-red-500", phase === "recording" && "animate-pulse")}
          aria-hidden="true"
        />
        {formatVoiceDuration(elapsed)}
      </span>

      {holding ? (
        <span
          className="flex-1 min-w-0 flex items-center justify-center gap-1 text-xs sm:text-sm text-[var(--app-muted)] truncate"
          style={{ opacity: 1 - slideProgress * 0.6, transform: `translateX(-${Math.round(slide / 3)}px)` }}
        >
          <ChevronLeft className="w-4 h-4 flex-shrink-0" />
          {gt("Slide to cancel")}
        </span>
      ) : (
        <div className="flex-1 min-w-0 h-8 flex items-center gap-[2px] overflow-hidden" aria-hidden="true">
          {bars.map((v, i) => (
            <span
              key={i}
              className="flex-1 min-w-[2px] max-w-[4px] rounded-full bg-[var(--app-accent)]"
              style={{ height: `${Math.max(8, Math.round(v * 100))}%`, opacity: v > 0 ? 1 : 0.35 }}
            />
          ))}
        </div>
      )}

      {phase === "starting" ? (
        <span className="flex-shrink-0 text-xs text-[var(--app-muted)]">{gt("Starting microphone...")}</span>
      ) : phase === "uploading" ? (
        <Loader size={20} className="flex-shrink-0" />
      ) : !holding ? (
        <button
          type="button"
          onClick={() => finish(true)}
          className="flex-shrink-0 w-9 h-9 rounded-full bg-[var(--app-accent)] text-white flex items-center justify-center hover:brightness-110 active:scale-95 transition"
          aria-label={gt("Send voice message")}
          title={gt("Send voice message")}
        >
          <SendHorizontal className="w-4 h-4" />
        </button>
      ) : null}
    </div>
  );
}
