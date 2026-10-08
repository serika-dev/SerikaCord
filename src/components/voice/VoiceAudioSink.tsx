"use client";

import { useEffect, useRef, useState } from "react";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";
import { outputVolumeLevels } from "@/lib/voice/settings";

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
        <ParticipantAudio key={p.userId} stream={p.stream!} volume={outputVolume} />
      ))}
    </div>
  );
}

function ParticipantAudio({ stream, volume }: { stream: MediaStream; volume: number }) {
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

  // Up to 100% is plain element volume. Above that, play through a Web Audio
  // gain stage instead (the element stays attached but muted, which Chrome
  // needs for remote WebRTC audio to flow into Web Audio).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { elementVolume, boostGain } = outputVolumeLevels(volume);
    el.volume = elementVolume;
    if (boostGain === null) {
      el.muted = false;
      return;
    }
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = boostGain;
      source.connect(gain);
      gain.connect(ctx.destination);
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
  }, [stream, volume]);

  return <audio ref={ref} autoPlay playsInline />;
}
