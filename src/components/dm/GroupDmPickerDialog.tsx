"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Check, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { cn, cdnImage } from "@/lib/utils";
import { GROUP_DM_MAX_MEMBERS, groupDmHref } from "@/lib/chat/groupDm";

interface Friend {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
}

/**
 * Discord's "Select Friends" picker.
 *
 * - `mode="create"` (the "+" next to Direct Messages, or "Add friends to DM"
 *   in a 1:1 DM with `lockedIds` = the other person): one friend opens the
 *   1:1 DM, two or more create a new group.
 * - `mode="add"` (inside a group): adds the picked friends to `channelId`.
 *   `existingIds` are already in the group and aren't offered.
 */
export function GroupDmPickerDialog({
  open,
  onOpenChange,
  mode,
  channelId,
  existingIds = [],
  lockedIds = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "add";
  channelId?: string;
  existingIds?: string[];
  lockedIds?: string[];
}) {
  const gt = useGT();
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reload friends and reset the picker each time it opens (async setState only).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/friends")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setFriends((data?.friends || []) as Friend[]);
        setSelected([]);
        setQuery("");
      })
      .catch(() => { if (!cancelled) setFriends([]); });
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  const hidden = useMemo(() => new Set([...existingIds, ...lockedIds].map((id) => id.toLowerCase())), [existingIds, lockedIds]);
  // Room left in the group: everyone already in it (you included) counts.
  const baseCount = mode === "add" ? Math.max(existingIds.length, 1) : 1 + lockedIds.length;
  const remaining = Math.max(0, GROUP_DM_MAX_MEMBERS - baseCount - selected.length);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (friends || [])
      .filter((f) => !hidden.has(f.id.toLowerCase()))
      .filter((f) => !q || f.username.toLowerCase().includes(q) || (f.displayName || "").toLowerCase().includes(q))
      .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));
  }, [friends, hidden, query]);

  const byId = useMemo(() => new Map((friends || []).map((f) => [f.id, f])), [friends]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (remaining <= 0) return prev;
      return [...prev, id];
    });
  };

  const submit = async () => {
    if (submitting) return;
    if (mode === "add") {
      if (!channelId || selected.length === 0) return;
      setSubmitting(true);
      try {
        const res = await fetch(`/api/group-dms/${channelId}/recipients`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: selected }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(data?.error || gt("Couldn't add friends to the group"));
          return;
        }
        onOpenChange(false);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const picked = [...lockedIds, ...selected];
    if (picked.length === 0) return;
    // One person is a 1:1 DM, like on Discord.
    if (picked.length === 1) {
      onOpenChange(false);
      router.push(`/dm/${picked[0]}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/group-dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientIds: picked }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.group?.id) {
        toast.error(data?.error || gt("Couldn't create the group"));
        return;
      }
      onOpenChange(false);
      router.push(groupDmHref(data.group.id));
    } finally {
      setSubmitting(false);
    }
  };

  const total = lockedIds.length + selected.length;
  const actionLabel = mode === "add"
    ? gt("Add")
    : total <= 1 ? gt("Create DM") : gt("Create Group DM");
  const disabled = submitting || (mode === "add" || lockedIds.length > 0 ? selected.length === 0 : total === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 sm:max-w-[440px] overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>{gt("Select Friends")}</DialogTitle>
          <DialogDescription className="text-[var(--text-muted)]">
            {remaining > 0
              ? gt("You can add {count} more friends.", { count: remaining })
              : gt("This group has reached its limit of {max} members.", { max: GROUP_DM_MAX_MEMBERS })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-app)] border border-[var(--border-subtle)] px-2 py-1.5 focus-within:border-[var(--app-accent)]">
            {selected.map((id) => {
              const f = byId.get(id);
              if (!f) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="inline-flex items-center gap-1 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
                  aria-label={gt("Remove {name}", { name: f.displayName || f.username })}
                >
                  {f.displayName || f.username}
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            <div className="flex flex-1 min-w-[120px] items-center gap-1">
              <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !query && selected.length) {
                    setSelected((prev) => prev.slice(0, -1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (visible.length === 1 && !selected.includes(visible[0].id)) toggle(visible[0].id);
                    else void submit();
                  }
                }}
                placeholder={gt("Type the username of a friend")}
                aria-label={gt("Search friends")}
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none py-0.5"
              />
            </div>
          </div>
        </div>

        <div className="max-h-[min(50vh,360px)] overflow-y-auto px-2 pb-2" role="listbox" aria-multiselectable>
          {friends === null ? (
            <div className="flex justify-center py-8"><Loader size={24} /></div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-2 py-8 text-center text-sm text-[var(--text-muted)]">
              <p>{friends.length === 0 ? gt("You don't have any friends to add yet.") : gt("No friends found.")}</p>
              {friends.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    router.push("/channels/me?tab=add");
                    window.dispatchEvent(new CustomEvent("openFriendsTab", { detail: { tab: "add" } }));
                  }}
                  className="rounded-md bg-[var(--app-accent)] px-3 py-1.5 font-medium text-[var(--text-on-accent)] hover:opacity-90"
                >
                  {gt("Add Friend")}
                </button>
              )}
            </div>
          ) : (
            visible.map((f) => {
              const isSelected = selected.includes(f.id);
              const full = !isSelected && remaining <= 0;
              const name = f.displayName || f.username;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={full}
                  onClick={() => toggle(f.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
                    isSelected ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]",
                    full && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={cdnImage(f.avatar)} alt="" />
                    <AvatarFallback className="bg-[var(--app-accent)] text-[var(--text-on-accent)] text-xs">
                      {name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{name}</span>
                    <span className="truncate text-xs text-[var(--text-muted)]">{f.username}</span>
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      isSelected ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--text-on-accent)]" : "border-[var(--border-subtle)]",
                    )}
                    aria-hidden
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)] p-3 flex justify-end gap-2 bg-[var(--bg-app)]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-4 py-2 text-sm text-[var(--text-primary)] hover:underline"
          >
            {gt("Cancel")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void submit()}
            className="rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader size={16} /> : actionLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default GroupDmPickerDialog;
