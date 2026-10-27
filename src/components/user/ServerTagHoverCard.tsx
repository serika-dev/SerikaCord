"use client";

import { useEffect, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ArrowRight, Loader2, LogIn } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ServerTagPill } from "@/components/user/ServerTagPill";
import { useServerOptional } from "@/contexts/ServerContext";
import { BoundedMap } from "@/lib/utils/boundedMap";
import { cdnImage } from "@/lib/utils";
import type { ResolvedServerTag } from "@/lib/servers/serverProfile";

interface PublicServerInfo {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  onlineCount: number;
  joinMode: string;
}

// Servers you're not in: looked up once per server through the public
// discovery search, only when a card actually opens. null = not listed.
const discoverableCache = new BoundedMap<string, PublicServerInfo | null>(200);
const inFlight = new BoundedMap<string, Promise<PublicServerInfo | null>>(50);

function lookupDiscoverable(serverId: string, serverName: string): Promise<PublicServerInfo | null> {
  if (discoverableCache.has(serverId)) return Promise.resolve(discoverableCache.get(serverId) ?? null);
  const pending = inFlight.get(serverId);
  if (pending) return pending;
  const request = fetch(`/api/servers/discoverable?search=${encodeURIComponent(serverName.slice(0, 64))}&limit=10`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const list = (data?.servers ?? []) as PublicServerInfo[];
      const hit = list.find((s) => s.id === serverId) ?? null;
      discoverableCache.set(serverId, hit);
      return hit;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(serverId));
  inFlight.set(serverId, request);
  return request;
}

function ServerIcon({ name, icon }: { name: string; icon?: string | null }) {
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cdnImage(icon)} alt="" className="size-11 rounded-xl object-cover shrink-0 bg-[var(--bg-hover)]" />;
  }
  return (
    <div className="size-11 rounded-xl shrink-0 flex items-center justify-center bg-[var(--app-accent)] text-white font-bold">
      {(name || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function CardBody({ tag, onDone }: { tag: ResolvedServerTag; onDone: () => void }) {
  const gt = useGT();
  const router = useRouter();
  const serverCtx = useServerOptional();
  const own = serverCtx?.servers.find((s) => s.id === tag.serverId);
  const name = own?.name || tag.serverName || gt("Unknown server");
  const [publicInfo, setPublicInfo] = useState<PublicServerInfo | null | undefined>(() =>
    discoverableCache.has(tag.serverId) ? discoverableCache.get(tag.serverId) ?? null : undefined,
  );
  const [joining, setJoining] = useState(false);
  const needsLookup = !own && !!tag.serverName && publicInfo === undefined;

  useEffect(() => {
    if (!needsLookup || !tag.serverName) return;
    let active = true;
    void lookupDiscoverable(tag.serverId, tag.serverName).then((info) => {
      if (active) setPublicInfo(info);
    });
    return () => { active = false; };
  }, [needsLookup, tag.serverId, tag.serverName]);

  const memberCount = own?.memberCount ?? publicInfo?.memberCount;
  const onlineCount = own?.onlineCount ?? publicInfo?.onlineCount;
  const canJoin = !own && publicInfo?.joinMode === "discoverable";

  const join = async () => {
    setJoining(true);
    try {
      const res = await fetch(`/api/servers/${tag.serverId}/join`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        await serverCtx?.fetchServers();
        toast.success(gt("Joined {server}", { server: name }));
        onDone();
        router.push(`/channels/${tag.serverId}/onboarding`);
      } else if (data?.error === "application_required") {
        onDone();
        router.push("/channels/explore");
      } else {
        toast.error(data?.error || gt("Failed to join server"));
      }
    } catch {
      toast.error(gt("Failed to join server"));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="p-3">
      <div className="flex items-center gap-3 min-w-0">
        <ServerIcon name={name} icon={own?.icon ?? publicInfo?.icon} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate" title={name}>{name}</p>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <ServerTagPill tag={tag} interactive={false} />
            <span className="text-[11px] text-[var(--text-muted)] truncate">{gt("Server tag")}</span>
          </div>
        </div>
      </div>

      {(memberCount !== undefined || needsLookup) && (
        <div className="mt-2.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          {needsLookup ? (
            <span className="h-3 w-28 rounded bg-[var(--bg-hover)] animate-pulse" aria-hidden />
          ) : (
            <>
              {onlineCount !== undefined && onlineCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[var(--status-online)]" aria-hidden />
                  {gt("{count} Online", { count: onlineCount.toLocaleString() })}
                </span>
              )}
              {memberCount !== undefined && (
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[var(--text-muted)]" aria-hidden />
                  {gt("{count} Members", { count: memberCount.toLocaleString() })}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {own ? (
        <button
          type="button"
          onClick={() => { onDone(); router.push(`/channels/${tag.serverId}`); }}
          className="mt-3 w-full h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--app-accent)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
        >
          {gt("Go to Server")}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      ) : canJoin ? (
        <button
          type="button"
          disabled={joining}
          onClick={() => void join()}
          className="mt-3 w-full h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-[var(--app-accent)] text-[var(--text-on-accent,#fff)] hover:brightness-110 disabled:opacity-60 transition-[filter,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-surface)]"
        >
          {joining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
          {gt("Join Server")}
        </button>
      ) : !needsLookup ? (
        <p className="mt-2.5 text-[11px] leading-snug text-[var(--text-muted)]">
          {gt("Members of this server can wear its tag next to their name.")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Rich hover card for a server tag pill: server icon and name, the badge,
 * member/online counts and a Go to / Join button. Loaded (and positioned on
 * the pill through a virtual anchor) only once someone hovers a pill.
 */
export default function ServerTagHoverCard({
  tag,
  anchorRef,
  open,
  onOpenChange,
  onPointerEnter,
  onPointerLeave,
}: {
  tag: ResolvedServerTag;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={(e) => e.stopPropagation()}
        className="w-64 p-0 rounded-xl border-[var(--border-subtle)] bg-[var(--app-surface)] text-[var(--text-primary)] shadow-xl duration-150"
      >
        {open && <CardBody tag={tag} onDone={() => onOpenChange(false)} />}
      </PopoverContent>
    </Popover>
  );
}
