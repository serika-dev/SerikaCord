"use client";

import { useEffect, useState } from "react";
import { cdnImage } from "@/lib/utils";
import { Gamepad2, Code2, Music, Layers, Terminal, Bot, Wind } from "lucide-react";
import type { GameActivity } from "@/hooks/useMoeActivity";
import { useGT } from "gt-next";

function formatElapsed(startedAt: string | null, gt: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return gt("{h}h {m}m elapsed", { h, m });
  if (m > 0) return gt("{m}m elapsed", { m });
  return gt("just started");
}

const typeConfig: Record<string, { label: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }> = {
  game:    { label: "Playing a Game",      Icon: Gamepad2, color: "#22c55e" },
  vscode:  { label: "Working in VS Code:", Icon: Code2,    color: "#0ea5e9" },
  music:   { label: "Listening to Music",    Icon: Music,    color: "#e4335a" },
  windsurf:{ label: "Coding in Windsurf",  Icon: Wind,     color: "#38bdf8" },
  devin:   { label: "Coding in Devin Desktop", Icon: Wind, color: "#0bb39a" },
  cursor:  { label: "Coding in Cursor",    Icon: Code2,    color: "#a855f7" },
  zed:     { label: "Coding in Zed",       Icon: Terminal, color: "#facc15" },
  claude:  { label: "Working with Claude",  Icon: Bot,      color: "#f97316" },
  other:   { label: "Using an App",         Icon: Layers,   color: "#8B5CF6" },
};

function gameTypeLabel(type: string, gt: ReturnType<typeof useGT>): string {
  switch (type) {
    case 'game': return gt('Playing a Game');
    case 'vscode': return gt('Working in VS Code:');
    case 'music': return gt('Listening to Music');
    case 'windsurf': return gt('Coding in Windsurf');
    case 'devin': return gt('Coding in Devin Desktop');
    case 'cursor': return gt('Coding in Cursor');
    case 'zed': return gt('Coding in Zed');
    case 'claude': return gt('Working with Claude');
    case 'other': return gt('Using an App');
    default: return gt('Using an App');
  }
}

export function GameActivityCard({ game }: { game: GameActivity }) {
  const gt = useGT();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!game.startedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [game.startedAt]);

  const cfg = typeConfig[game.type] ?? typeConfig.other;
  const { Icon } = cfg;

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.05] to-white/[0.02]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#9a9aad] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
          {gameTypeLabel(game.type, gt)}
        </h4>
      </div>

      {/* Content row */}
      <div className="flex items-center gap-3 px-3 pb-3">
        {game.largeImageUrl ? (
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cdnImage(game.largeImageUrl)}
              alt={game.largeImageText ?? game.name}
              className="w-14 h-14 rounded-xl object-cover shadow-md"
            />
            {game.smallImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cdnImage(game.smallImageUrl)}
                alt={game.smallImageText ?? ""}
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-[var(--bg-card)] object-cover"
              />
            )}
          </div>
        ) : (
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${cfg.color}20` }}
          >
            <Icon className="w-6 h-6" style={{ color: cfg.color }} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{game.name}</p>
          {game.details && (
            <p className="text-xs text-[#c8c8d8] truncate mt-0.5">{game.details}</p>
          )}
          {game.state && (
            <p className="text-xs text-[#9a9aad] truncate mt-0.5">{game.state}</p>
          )}
          {game.startedAt && (
            <p className="text-[10px] text-[#9a9aad]/70 mt-1">{formatElapsed(game.startedAt, gt)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
