"use client";

/**
 * The emoji button used by the onboarding, Server Guide and welcome screen
 * editors (CORD-71): opens the chat emoji picker (with this server's custom
 * emojis) in a popover and stores a unicode emoji or `<:name:id>`. A separate
 * button clears it. The picker chunk loads on first open.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { SmilePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiOrIcon } from "@/components/server/community/serverProfileBits";
import {
  communityEmojiViews,
  formatCustomEmoji,
  validUnicodeEmoji,
  type CommunityEmojiView,
} from "@/lib/servers/communityEmoji";
import { cn } from "@/lib/utils";

const CustomEmojiPicker = dynamic(
  () => import("@/components/chat/CustomEmojiPicker").then((m) => m.CustomEmojiPicker),
  { ssr: false, loading: () => <div className="w-[440px] max-w-[calc(100vw-1rem)] h-[420px]" /> },
);

const NO_EMOJIS: CommunityEmojiView[] = [];

type ApiEmoji = { id?: string; _id?: string; name?: string; imageUrl?: string; url?: string; animated?: boolean; available?: boolean };

/** This server's custom emojis (GET /api/servers/:id/emojis) for the editors' pickers and previews. */
export function useServerCommunityEmojis(serverId: string): CommunityEmojiView[] {
  const [loaded, setLoaded] = useState<{ serverId: string; emojis: CommunityEmojiView[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/emojis`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { emojis?: ApiEmoji[] } | null) => {
        if (!active) return;
        const rows = (data?.emojis ?? [])
          .map((e) => ({ id: String(e.id || e._id || ""), name: String(e.name || ""), imageUrl: e.imageUrl || e.url || "", animated: e.animated, available: e.available }))
          .filter((e) => e.id && e.name);
        setLoaded({ serverId, emojis: communityEmojiViews(rows) });
      })
      .catch(() => active && setLoaded({ serverId, emojis: [] }));
    return () => {
      active = false;
    };
  }, [serverId]);
  return loaded && loaded.serverId === serverId ? loaded.emojis : NO_EMOJIS;
}

export function CommunityEmojiField({
  value,
  onChange,
  emojis,
  serverName,
  label,
  fallback,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** This server's custom emojis (useServerCommunityEmojis). */
  emojis: readonly CommunityEmojiView[];
  serverName?: string;
  /** What the emoji is for, e.g. "Option emoji". */
  label: string;
  /** Shown in the button when no emoji is set. */
  fallback?: ReactNode;
  className?: string;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const pickerEmojis = useMemo(
    () => emojis.map((e) => ({ id: e.id, name: e.name, url: e.url, animated: e.animated, serverName })),
    [emojis, serverName],
  );

  const select = (emoji: string, isCustom?: boolean, data?: { id: string; name: string; animated?: boolean }) => {
    if (isCustom) {
      const own = data ? emojis.find((e) => e.id === String(data.id).toLowerCase()) : undefined;
      if (!own) {
        toast.error(gt("Only this server's custom emojis can be used here."));
        return;
      }
      onChange(formatCustomEmoji(own));
    } else {
      const unicode = validUnicodeEmoji(emoji);
      if (!unicode) {
        toast.error(gt("Pick a single emoji."));
        return;
      }
      onChange(unicode);
    }
    setOpen(false);
  };

  return (
    <div className={cn("relative shrink-0", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            className="w-12 h-10 flex items-center justify-center rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)] focus:outline-none focus-visible:border-[var(--app-accent)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40"
          >
            <EmojiOrIcon emoji={value} emojis={emojis} fallback={fallback ?? <SmilePlus className="w-4 h-4" />} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[440px] max-w-[calc(100vw-1rem)] p-0 border-none" side="bottom" align="start" collisionPadding={8}>
          {open && (
            <CustomEmojiPicker
              onEmojiSelect={select}
              serverEmojis={pickerEmojis}
              serverName={serverName}
              initialTab="emoji"
            />
          )}
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={gt("Remove emoji")}
          title={gt("Remove emoji")}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40 after:absolute after:-inset-2 after:content-['']"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default CommunityEmojiField;
