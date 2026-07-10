"use client";

import { Music2, ExternalLink } from "lucide-react";
import type { MusicActivity } from "@/hooks/useMoeActivity";
import { useGT } from "gt-next";

export function MusicActivityCard({ music }: { music: MusicActivity }) {
  const gt = useGT();
  return (
    <a
      href={music.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.05] to-white/[0.02] hover:border-[#e4335a]/30 transition-colors"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#9a9aad] flex items-center gap-1.5">
          <Music2 className="w-3 h-3" />
          {gt("Listening on Last.fm")}
        </h4>
        <ExternalLink className="w-3 h-3 text-[#9a9aad] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Track info row */}
      <div className="flex items-center gap-3 px-3 pb-3">
        {music.albumArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={music.albumArt}
            alt={music.album ?? music.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-12 h-12 rounded-lg object-cover shrink-0 shadow-md"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#e4335a] to-[#9b1735] flex items-center justify-center shrink-0">
            <Music2 className="w-5 h-5 text-white/70" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate" title={music.name}>
            {music.name}
          </p>
          <p className="text-xs text-[#9a9aad] truncate" title={music.artist}>
            {music.artist}
          </p>
          {music.album && (
            <p className="text-[10px] text-[#9a9aad]/70 truncate mt-0.5" title={music.album}>
              {music.album}
            </p>
          )}
        </div>
        {/* Animated equalizer bars */}
        <div className="flex items-end gap-[2px] h-4 shrink-0">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-[#e4335a]"
              style={{
                height: `${[60, 100, 75][i - 1]}%`,
                animation: `equalize${i} 0.8s ease-in-out infinite alternate`,
                animationDelay: `${(i - 1) * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes equalize1 { from { height: 30% } to { height: 90% } }
        @keyframes equalize2 { from { height: 60% } to { height: 30% } }
        @keyframes equalize3 { from { height: 80% } to { height: 50% } }
      `}</style>
    </a>
  );
}
