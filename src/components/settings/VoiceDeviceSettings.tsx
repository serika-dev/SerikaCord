"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGT } from "gt-next";
import { Mic2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { voiceService } from "@/lib/services/voiceService";
import {
  DEFAULT_DEVICE_ID,
  applySinkId,
  canPickOutputDevice,
  deviceChoices,
  deviceConstraint,
  getPreferredDevice,
  setPreferredDevice,
  subscribePreferredDevices,
  type DeviceChoice,
  type MediaDeviceRole,
} from "@/lib/voice/devices";
import {
  DEFAULT_SENSITIVITY_DB,
  SENSITIVITY_MAX_DB,
  SENSITIVITY_MIN_DB,
  amplitudeToDb,
  clampSensitivityDb,
  createVoiceGateState,
  dbToMeterPercent,
  rmsFromByteTimeDomain,
  stepVoiceGate,
} from "@/lib/voice/voiceActivity";

const KIND: Record<MediaDeviceRole, MediaDeviceKind> = {
  input: "audioinput",
  output: "audiooutput",
  video: "videoinput",
};

const subscribeConnected = (fn: () => void) => voiceService.subscribe((e) => {
  if (e.type === "connected" || e.type === "disconnected") fn();
});
const getConnected = () => voiceService.connected;
const getServerConnected = () => false;

/** The devices of one kind, kept fresh as things are plugged in or out. */
function useDeviceChoices(role: MediaDeviceRole): DeviceChoice[] {
  const gt = useGT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) return;
    let active = true;
    const load = () => {
      void md.enumerateDevices().then((list) => { if (active) setDevices(list); }).catch(() => {});
    };
    load();
    md.addEventListener?.("devicechange", load);
    return () => {
      active = false;
      md.removeEventListener?.("devicechange", load);
    };
  }, []);
  const kind = KIND[role];
  return deviceChoices(devices, kind, (n) =>
    kind === "audioinput" ? gt("Microphone {n}", { n }) : kind === "audiooutput" ? gt("Speaker {n}", { n }) : gt("Camera {n}", { n }),
  );
}

/**
 * Input / output / camera picker. The choice is per device (like Discord) and
 * switches a live call over at once.
 */
export function DeviceSelect({ role, label }: { role: MediaDeviceRole; label: string }) {
  const gt = useGT();
  const choices = useDeviceChoices(role);
  const selected = useSyncExternalStore(subscribePreferredDevices, () => getPreferredDevice(role), () => DEFAULT_DEVICE_ID);
  const unsupported = role === "output" && !canPickOutputDevice();

  const onChange = (deviceId: string) => {
    setPreferredDevice(role, deviceId);
    if (role === "input") void voiceService.switchInputDevice();
    if (role === "video") void voiceService.switchVideoDevice();
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</label>
      <select
        value={choices.some((c) => c.deviceId === selected) ? selected : DEFAULT_DEVICE_ID}
        onChange={(e) => onChange(e.target.value)}
        disabled={unsupported}
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)] disabled:opacity-60"
      >
        <option value={DEFAULT_DEVICE_ID}>{gt("Default")}</option>
        {choices.map((c) => (
          <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
        ))}
      </select>
      {unsupported && (
        <p className="text-xs text-[var(--text-muted)]">{gt("This browser always uses your system's default speaker.")}</p>
      )}
    </div>
  );
}

/**
 * Discord's Input Sensitivity: "Automatically determine input sensitivity",
 * or a manual threshold slider laid over a live level meter (green while your
 * voice is loud enough to transmit). The meter follows your call's mic while
 * connected; otherwise "Let's Check" opens the mic (and plays it back so you
 * hear yourself).
 */
export function InputSensitivity({
  auto,
  thresholdDb,
  pushToTalk,
  echoCancellation,
  noiseSuppression,
  autoGainControl,
  onAutoChange,
  onThresholdChange,
}: {
  auto: boolean;
  thresholdDb: number;
  pushToTalk: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  onAutoChange: (auto: boolean) => void;
  onThresholdChange: (db: number) => void;
}) {
  const gt = useGT();
  const inCall = useSyncExternalStore(subscribeConnected, getConnected, getServerConnected);
  const [testing, setTesting] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const testRef = useRef<{ stream: MediaStream; ctx: AudioContext; audio: HTMLAudioElement; raf: number } | null>(null);
  const settingsRef = useRef({ auto, thresholdDb });
  useEffect(() => {
    settingsRef.current = { auto, thresholdDb };
  }, [auto, thresholdDb]);

  // Paint the meter straight into the DOM (20–60 updates a second).
  const paint = useCallback((levelDb: number, gateThresholdDb: number, open: boolean) => {
    const fill = fillRef.current;
    if (fill) {
      fill.style.width = `${dbToMeterPercent(levelDb)}%`;
      fill.dataset.open = open ? "1" : "0";
    }
    const marker = markerRef.current;
    if (marker) marker.style.left = `${dbToMeterPercent(gateThresholdDb)}%`;
  }, []);

  // In a call: the voice service's own meter (the real gate).
  useEffect(() => {
    if (!inCall || testing) return;
    const off = voiceService.onInputLevel((l) => paint(l.levelDb, l.thresholdDb, l.gateOpen));
    return () => {
      off();
      paint(SENSITIVITY_MIN_DB, settingsRef.current.thresholdDb, false);
    };
  }, [inCall, testing, paint]);

  const stopTest = useCallback(() => {
    const t = testRef.current;
    testRef.current = null;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    t.stream.getTracks().forEach((tr) => tr.stop());
    t.audio.pause();
    t.audio.srcObject = null;
    void t.ctx.close().catch(() => {});
    paint(SENSITIVITY_MIN_DB, settingsRef.current.thresholdDb, false);
  }, [paint]);

  useEffect(() => stopTest, [stopTest]);

  const startTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation, noiseSuppression, autoGainControl, ...deviceConstraint(getPreferredDevice("input")) },
        video: false,
      });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      // Hear yourself through the chosen speaker, like Discord's mic test.
      const audio = new Audio();
      audio.srcObject = stream;
      applySinkId(audio, getPreferredDevice("output"));
      void audio.play().catch(() => {});
      const buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let gate = createVoiceGateState();
      const tick = () => {
        const t = testRef.current;
        if (!t) return;
        analyser.getByteTimeDomainData(buf);
        const levelDb = amplitudeToDb(rmsFromByteTimeDomain(buf));
        gate = stepVoiceGate(gate, {
          levelDb,
          now: performance.now(),
          auto: settingsRef.current.auto,
          manualThresholdDb: settingsRef.current.thresholdDb,
        });
        paint(levelDb, gate.thresholdDb, gate.open);
        t.raf = requestAnimationFrame(tick);
      };
      testRef.current = { stream, ctx, audio, raf: 0 };
      setTesting(true);
      testRef.current.raf = requestAnimationFrame(tick);
    } catch {
      toast.error(gt("Microphone access denied"));
    }
  };

  const toggleTest = () => {
    if (testing) {
      stopTest();
      setTesting(false);
    } else {
      void startTest();
    }
  };

  const threshold = clampSensitivityDb(thresholdDb);
  const live = inCall || testing;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-[var(--text-primary)]">{gt("Input Sensitivity")}</p>
          <p className="text-sm text-[var(--text-secondary)]">
            {pushToTalk
              ? gt("Push to Talk is on: your mic sends while you hold the key, if you're loud enough.")
              : gt("Your mic only sends while you're louder than this.")}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleTest}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            testing
              ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          )}
        >
          {testing ? (
            <><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> {gt("Stop Testing")}</>
          ) : (
            <><Mic2 className="h-3.5 w-3.5" /> {gt("Let's Check")}</>
          )}
        </button>
      </div>

      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-sm text-[var(--text-primary)]">{gt("Automatically determine input sensitivity")}</span>
        <ToggleSwitch size="sm" checked={auto} onCheckedChange={onAutoChange} />
      </label>

      <div className="relative">
        {/* Level meter: yellow below the threshold, green while you'd transmit. */}
        <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--bg-sidebar-elevated)]">
          <div
            ref={fillRef}
            data-open="0"
            className="h-full w-0 rounded-full bg-[#f0b232] transition-[width] duration-75 data-[open=1]:bg-[#23a55a]"
          />
        </div>
        <div
          ref={markerRef}
          aria-hidden
          className={cn("absolute -top-1 h-[18px] w-0.5 -translate-x-1/2 rounded bg-[var(--text-primary)]", auto && !live && "hidden")}
          style={{ left: `${dbToMeterPercent(threshold)}%` }}
        />
        {!auto && (
          <input
            type="range"
            min={SENSITIVITY_MIN_DB}
            max={SENSITIVITY_MAX_DB}
            step={1}
            value={threshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
            onDoubleClick={() => onThresholdChange(DEFAULT_SENSITIVITY_DB)}
            aria-label={gt("Input Sensitivity")}
            aria-valuetext={gt("{db} dB", { db: threshold })}
            className="absolute inset-x-0 -top-1.5 h-6 w-full cursor-pointer opacity-0"
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-[var(--text-muted)]">
        <span>{gt("{db} dB", { db: SENSITIVITY_MIN_DB })}</span>
        {!auto && <span className="text-[var(--text-secondary)]">{gt("{db} dB", { db: threshold })}</span>}
        <span>{gt("{db} dB", { db: SENSITIVITY_MAX_DB })}</span>
      </div>
      {!live && (
        <p className="text-xs text-[var(--text-muted)]">{gt("Press Let's Check or join a call to see your mic level.")}</p>
      )}
    </div>
  );
}
