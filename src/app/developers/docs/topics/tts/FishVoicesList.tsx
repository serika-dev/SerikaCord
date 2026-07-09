"use client";

import { useEffect, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";

interface TtsVoice {
  name: string;
  provider: string;
  referenceId: string;
  isDefault: boolean;
}

export function FishVoicesList() {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tts-voices");
        if (res.ok) {
          const data = await res.json();
          const fish = (data.voices || []).filter(
            (v: TtsVoice) => v.provider === "fish"
          );
          setVoices(fish);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#949ba4] text-sm my-4">
        <Loader2 className="size-4 animate-spin" /> Loading FishAudio voices...
      </div>
    );
  }

  if (voices.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 my-4 text-[13px] text-[#949ba4]">
        No FishAudio voices are currently configured. An admin can add voices in the
        Admin Panel → TTS Voices.
      </div>
    );
  }

  return (
    <div className="my-4 rounded-lg border border-white/[0.08] overflow-hidden">
      <div className="flex items-center gap-2 bg-white/[0.02] px-4 py-2.5 border-b border-white/[0.06]">
        <Volume2 className="size-4 text-[#a78bfa]" />
        <span className="text-sm font-semibold text-white">
          Available FishAudio Voices ({voices.length})
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {voices.map((v) => (
          <div
            key={v.referenceId}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
          >
            <code className="text-[13px] font-mono text-[#a78bfa] shrink-0">
              [fish:{v.name}]
            </code>
            <span className="text-[13px] text-[#949ba4] truncate">
              {v.referenceId}
            </span>
            {v.isDefault && (
              <span className="ml-auto text-[10px] bg-[#8B5CF6]/15 text-[#a78bfa] px-1.5 py-0.5 rounded font-medium shrink-0">
                Default
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
