"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGT } from "gt-next";
import { Check, CornerUpRight, Hash, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { cdnImage, cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { MAX_FORWARD_TARGETS, rankForwardTargets, type ForwardTarget } from "@/lib/chat/forward";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import type { ChatMessage } from "@/lib/chat/types";

// Tab-lifetime cache so reopening the dialog paints the list instantly.
const TARGETS_TTL_MS = 60_000;
let cachedTargets: { at: number; targets: ForwardTarget[] } | null = null;

interface ForwardDialogProps {
  message: ChatMessage | null;
  onClose: () => void;
}

/**
 * Discord's Forward dialog: pick up to 5 conversations (recent DMs and group
 * DMs first, then channels you can post in), search them, add an optional
 * message, send. The forward appears as a quoted "Forwarded" card in each.
 */
export function ForwardDialog({ message, onClose }: ForwardDialogProps) {
  const gt = useGT();
  const [targets, setTargets] = useState<ForwardTarget[] | null>(() =>
    cachedTargets && Date.now() - cachedTargets.at < TARGETS_TTL_MS ? cachedTargets.targets : null,
  );
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ messageId: string | null; ids: string[] }>({ messageId: null, ids: [] });
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const open = message !== null;
  // A new message starts with nothing picked.
  const selected = selection.messageId === message?.id ? selection.ids : [];

  useEffect(() => {
    if (!open || targets) return;
    let cancelled = false;
    void fetch("/api/users/@me/forward-targets")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { targets?: ForwardTarget[] }) => {
        if (cancelled) return;
        const list = data.targets ?? [];
        cachedTargets = { at: Date.now(), targets: list };
        setTargets(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targets]);

  const ranked = useMemo(() => rankForwardTargets(targets ?? [], query), [targets, query]);
  const byId = useMemo(() => new Map((targets ?? []).map((t) => [t.id, t])), [targets]);

  const toggle = (id: string) => {
    const has = selected.includes(id);
    if (!has && selected.length >= MAX_FORWARD_TARGETS) {
      toast.error(gt("You can forward to at most {count} places at once.", { count: MAX_FORWARD_TARGETS }));
      return;
    }
    setSelection({ messageId: message?.id ?? null, ids: has ? selected.filter((x) => x !== id) : [...selected, id] });
  };

  const close = () => {
    setQuery("");
    setNote("");
    setSelection({ messageId: null, ids: [] });
    onClose();
  };

  const send = async () => {
    if (!message || selected.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/${message.id}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: selected, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Couldn't forward the message."));
        return;
      }
      const failed = Array.isArray(data?.failed) ? data.failed.length : 0;
      if (failed > 0) {
        toast.warning(gt("Forwarded, but {count} destination(s) couldn't receive it.", { count: failed }));
      } else {
        toast.success(selected.length === 1 ? gt("Message forwarded") : gt("Message forwarded to {count} places", { count: selected.length }));
      }
      close();
    } catch {
      toast.error(gt("Couldn't forward the message."));
    } finally {
      setSending(false);
    }
  };

  // Forwarding a forward passes the original along, so preview that.
  const source = message?.forward ?? message;
  const preview = !source
    ? ""
    : source.content
      ? decodeHtmlEntities(source.content).slice(0, 200)
      : source.attachments?.length
        ? gt("Attachment")
        : source.sticker
          ? gt("Sticker")
          : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="flex max-h-[85vh] max-w-lg flex-col gap-3 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{gt("Forward To")}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Select where you want to share this message.")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-muted)]" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ranked[0]) {
                e.preventDefault();
                toggle(ranked[0].id);
              }
            }}
            placeholder={gt("Search")}
            aria-label={gt("Search")}
            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)]"
          />
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto scrollbar-thin -mx-2 px-2" role="listbox" aria-multiselectable>
          {targets === null && !loadError ? (
            <div className="flex items-center justify-center py-10"><Loader size={20} /></div>
          ) : loadError && targets === null ? (
            <div className="py-10 text-center text-sm text-[var(--text-secondary)]">{gt("Couldn't load your conversations.")}</div>
          ) : ranked.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--text-secondary)]">{gt("No results")}</div>
          ) : (
            ranked.map((t) => {
              const isSel = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => toggle(t.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--app-surface-alt)]",
                    isSel && "bg-[var(--app-surface-alt)]",
                  )}
                >
                  {t.kind === "channel" ? (
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--app-surface-alt)]">
                      <Hash className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />
                    </span>
                  ) : (
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      {t.icon && <AvatarImage src={cdnImage(t.icon)} alt="" />}
                      <AvatarFallback>
                        {t.kind === "group_dm" ? <Users className="h-4 w-4" aria-hidden /> : (t.name || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{t.name}</span>
                    <span className="block truncate text-xs text-[var(--app-muted)]">
                      {t.kind === "channel" ? t.serverName : t.kind === "group_dm" ? gt("Group DM") : t.username}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2",
                      isSel ? "border-[var(--app-accent)] bg-[var(--app-accent)]" : "border-[var(--app-muted)]",
                    )}
                  >
                    {isSel && <Check className="h-3 w-3 text-[var(--text-on-accent,#fff)]" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {message && (
          <div className="flex items-start gap-2 rounded-md border-l-4 border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 py-2 text-xs">
            <CornerUpRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--app-muted)]" aria-hidden />
            <div className="min-w-0">
              <div className="truncate font-semibold text-[var(--text-primary)]">
                {message.forward?.author?.displayName || message.author?.displayName || message.author?.username}
              </div>
              {preview && <div className="line-clamp-2 break-words text-[var(--text-secondary)]">{preview}</div>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={2000}
            placeholder={gt("Add an optional message...")}
            aria-label={gt("Add an optional message...")}
            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={selected.length === 0 || sending}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent,#fff)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending && <Loader size={14} />}
            {selected.length > 1 ? gt("Send ({count})", { count: selected.length }) : gt("Send")}
          </button>
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 text-xs text-[var(--app-muted)]">
            {selected.map((id) => byId.get(id)?.name).filter(Boolean).join(", ")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
