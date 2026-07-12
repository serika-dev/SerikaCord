"use client";

import { memo, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { ServerBadge } from "@/components/ui/badges";
import { Loader } from "@/components/ui/Loader";

/** Serika domains whose root/`/invite` paths carry server invite codes. */
const INVITE_HOSTS = ["serika.cc", "serika.chat", "serika.dev"];

/** Root paths that are app routes, never invite codes. */
const RESERVED_CODES = new Set([
  "login",
  "register",
  "channels",
  "dm",
  "invite",
  "download",
  "terms",
  "privacy",
  "guidelines",
  "widget",
  "api",
  "settings",
  "explore",
  "me",
  "messages",
  "notifications",
  "profile",
]);

/**
 * Extracts an invite code from a URL if it points at a Serika invite.
 * Matches `https://serika.cc/{code}`, `.../invite/{code}`, and the app's own
 * origin. Returns null for anything else.
 */
export function parseInviteCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const isSerikaHost = INVITE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const isOwnOrigin =
    typeof window !== "undefined" && host === window.location.hostname.toLowerCase().replace(/^www\./, "");
  if (!isSerikaHost && !isOwnOrigin) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  let code: string | null = null;
  if (segments.length === 1) {
    code = segments[0];
  } else if (segments.length === 2 && segments[0] === "invite") {
    code = segments[1];
  }

  if (!code) return null;
  if (RESERVED_CODES.has(code.toLowerCase())) return null;
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(code)) return null;
  return code;
}

interface InviteData {
  code: string;
  server: {
    _id: string;
    name: string;
    icon?: string;
    memberCount?: number;
    onlineCount?: number;
    isPartnered?: boolean;
  };
}

interface InviteEmbedProps {
  code: string;
}

function formatCount(n?: number): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/**
 * Discord-style invite card rendered inline in chat: server icon, name,
 * online/member counts, and a context-aware Join / Joined button.
 */
export const InviteEmbed = memo(function InviteEmbed({ code }: InviteEmbedProps) {
  const gt = useGT();
  const router = useRouter();
  const [data, setData] = useState<InviteData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isJoining, setIsJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then(async (res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!active) return;
        if (payload?.server) {
          setData(payload);
          setStatus("ready");
        } else {
          setStatus("error");
        }
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [code]);

  const handleJoin = async () => {
    if (!data || isJoining) return;
    setIsJoining(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        setJoined(true);
        toast.success(gt("Joined {name}", { name: data.server.name }));
        router.push(`/channels/${data.server._id}`);
      } else if (res.status === 400 && /already a member/i.test(payload?.error || "")) {
        setJoined(true);
        router.push(`/channels/${data.server._id}`);
      } else {
        toast.error(payload?.error || gt("Failed to join server"));
      }
    } catch {
      toast.error(gt("Failed to join server. Check your connection."));
    } finally {
      setIsJoining(false);
    }
  };

  if (status === "error") return null;

  return (
    <div className="mt-2 w-full max-w-[420px] rounded-lg bg-[var(--app-surface-alt)] border border-[var(--app-border)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)] mb-3">
        {gt("You've been invited to join a server")}
      </p>

      {status === "loading" ? (
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--app-surface)] animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-[var(--app-surface)] animate-pulse" />
            <div className="h-3 w-24 rounded bg-[var(--app-surface)] animate-pulse" />
          </div>
          <div className="h-9 w-20 rounded-md bg-[var(--app-surface)] animate-pulse" />
        </div>
      ) : data ? (
        <div className="flex items-center gap-3">
          {/* Server icon */}
          <div className="w-12 h-12 rounded-2xl overflow-hidden bg-[var(--accent-color)] flex items-center justify-center flex-shrink-0">
            {data.server.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.server.icon}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="text-lg font-bold text-white">
                {data.server.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          {/* Name + counts */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {data.server.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
              <span className="font-semibold text-[var(--text-primary)] truncate">
                {data.server.name}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--app-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                {formatCount(data.server.onlineCount)} {gt("Online")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--app-muted)]" />
                {formatCount(data.server.memberCount)} {gt("Members")}
              </span>
            </div>
          </div>

          {/* Join button */}
          <button
            onClick={handleJoin}
            disabled={isJoining || joined}
            className={cn(
              "flex-shrink-0 px-4 h-9 rounded-md text-sm font-semibold transition-all flex items-center gap-1.5",
              joined
                ? "bg-[var(--app-surface)] text-[var(--app-muted)] cursor-default"
                : "bg-[var(--accent-color)] hover:brightness-110 text-white disabled:opacity-70"
            )}
          >
            {isJoining ? (
              <Loader size={16} />
            ) : joined ? (
              <>
                <Check className="w-4 h-4" />
                {gt("Joined")}
              </>
            ) : (
              gt("Join")
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
});
