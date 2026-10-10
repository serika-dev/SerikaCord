"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { outputVolumeLevels } from "@/lib/voice/settings";
import {
  effectivePlaybackPercent,
  getServerUserVoicePrefs,
  getUserVoicePref,
  getUserVoicePrefs,
  subscribeUserVoicePrefs,
} from "@/lib/voice/userVolume";
import { DEFAULT_DEVICE_ID, applySinkId, getPreferredDevice, subscribePreferredDevices } from "@/lib/voice/devices";

const getOutputDevice = () => getPreferredDevice("output");
const getServerOutputDevice = () => DEFAULT_DEVICE_ID;

// Global, invisible audio sink for the active voice call. Video tiles are
// rendered muted, so this is the single place remote audio is played — it
// keeps working while navigating between channels/DMs since it lives in the
// layout, matching the call's persistence.
export function VoiceAudioSink() {
  const [participants, setParticipants] = useState<VoiceParticipant[]>(
    () => voiceService.currentParticipants
  );
  // The user's Output Volume setting (0–200%).
  const [outputVolume, setOutputVolume] = useState(() => voiceService.outputVolume);
  // Per-user volume / local mute from the voice user menu.
  const prefs = useSyncExternalStore(subscribeUserVoicePrefs, getUserVoicePrefs, getServerUserVoicePrefs);
  // The speaker chosen in Voice & Video settings.
  const outputDevice = useSyncExternalStore(subscribePreferredDevices, getOutputDevice, getServerOutputDevice);

  useEffect(() => {
    return voiceService.subscribe((event) => {
      if (event.type === "participants_changed") {
        setParticipants(event.participants);
      } else if (event.type === "disconnected") {
        setParticipants([]);
      }
    });
  }, []);

  useEffect(() => voiceService.onOutputVolumeChange(setOutputVolume), []);

  const remote = participants.filter((p) => p.stream);

  return (
    <div hidden aria-hidden="true">
      {remote.map((p) => (
        <ParticipantAudio
          key={p.userId}
          stream={p.stream!}
          // A server-muted member is silenced here too, so a modified client
          // can't talk over a moderator's mute.
          volume={effectivePlaybackPercent(outputVolume, getUserVoicePref(prefs, p.userId), p.serverMute === true)}
          sinkId={outputDevice}
        />
      ))}
    </div>
  );
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

function ParticipantAudio({ stream, volume, sinkId }: { stream: MediaStream; volume: number; sinkId: string }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    void el.play().catch(() => {
      // Autoplay may require a gesture; retry on the next interaction.
      const resume = () => {
        void el.play().catch(() => {});
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
      window.addEventListener("pointerdown", resume);
      window.addEventListener("keydown", resume);
    });
  }, [stream]);

  useEffect(() => {
    const el = ref.current;
    if (el) applySinkId(el, sinkId);
  }, [sinkId]);

  // Up to 100% is plain element volume. Above that, play through a Web Audio
  // gain stage instead (the element stays attached but muted, which Chrome
  // needs for remote WebRTC audio to flow into Web Audio). Per-user volume
  // goes up to 200% and output volume to 200%, so the boost can reach 4x.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { elementVolume, boostGain } = outputVolumeLevels(Math.min(volume, 200));
    const gainValue = volume > 200 ? volume / 100 : boostGain;
    el.volume = elementVolume;
    if (gainValue === null) {
      el.muted = volume <= 0;
      return;
    }
    let ctx: SinkContext | null = null;
    try {
      ctx = new AudioContext() as SinkContext;
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      source.connect(gain);
      gain.connect(ctx.destination);
      if (sinkId !== DEFAULT_DEVICE_ID && typeof ctx.setSinkId === "function") {
        void ctx.setSinkId(sinkId).catch(() => {});
      }
      el.muted = true;
      void ctx.resume().catch(() => {});
    } catch {
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      el.muted = false;
    }
    return () => {
      el.muted = false;
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [stream, volume, sinkId]);

  return <audio ref={ref} autoPlay playsInline />;
}
