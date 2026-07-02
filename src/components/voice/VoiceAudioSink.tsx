"use client";

import { useEffect, useRef, useState } from "react";
import { voiceService, type VoiceParticipant } from "@/lib/services/voiceService";

// Global, invisible audio sink for the active voice call. Video tiles are
// rendered muted, so this is the single place remote audio is played — it
// keeps working while navigating between channels/DMs since it lives in the
// layout, matching the call's persistence.
export function VoiceAudioSink() {
  const [participants, setParticipants] = useState<VoiceParticipant[]>(
    () => voiceService.currentParticipants
  );

  useEffect(() => {
    return voiceService.subscribe((event) => {
      if (event.type === "participants_changed") {
        setParticipants(event.participants);
      } else if (event.type === "disconnected") {
        setParticipants([]);
      }
    });
  }, []);

  const remote = participants.filter((p) => p.stream);

  return (
    <div hidden aria-hidden="true">
      {remote.map((p) => (
        <ParticipantAudio key={p.userId} stream={p.stream!} />
      ))}
    </div>
  );
}

function ParticipantAudio({ stream }: { stream: MediaStream }) {
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

  return <audio ref={ref} autoPlay playsInline />;
}
