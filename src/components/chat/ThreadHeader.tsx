"use client";

import { Archive, ArchiveRestore, ChevronRight, Copy, Hash, Link2, Lock, LockOpen, LogIn, LogOut, Maximize2, MessagesSquare, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AUTO_ARCHIVE_DURATIONS, normalizeAutoArchiveDuration } from "@/lib/chat/threads";
import type { ThreadInfoState } from "@/hooks/useThreadInfo";

interface ThreadHeaderTitleProps {
  name: string;
  parentName?: string | null;
  /** Full view: "# parent › thread", the parent opens the channel. */
  onOpenParent?: () => void;
  isPrivate?: boolean;
}

/** Left side of a thread's header: thread icon and name (with the parent in full view). */
export function ThreadHeaderTitle({ name, parentName, onOpenParent, isPrivate }: ThreadHeaderTitleProps) {
  const gt = useGT();
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {onOpenParent && parentName && (
        <>
          <button
            type="button"
            onClick={onOpenParent}
            className="hidden min-w-0 items-center gap-1 text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)] sm:flex"
            title={gt("Back to #{channel}", { channel: parentName })}
          >
            <Hash className="h-5 w-5 shrink-0 text-[var(--app-muted-2)]" />
            <span className="truncate font-semibold">{parentName}</span>
          </button>
          <ChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--app-muted)] sm:block" aria-hidden />
        </>
      )}
      <MessagesSquare className="h-5 w-5 shrink-0 text-[var(--app-muted-2)]" aria-label={isPrivate ? gt("Private thread") : gt("Thread")} />
      <span className="truncate text-sm font-semibold text-[var(--text-primary)] sm:text-base">{name}</span>
      {isPrivate && <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" aria-label={gt("Private thread")} />}
    </div>
  );
}

interface ThreadHeaderActionsProps {
  threadId: string;
  serverId?: string | null;
  state: ThreadInfoState;
  /** MANAGE_THREADS (lock / unlock any thread). */
  canModerateThreads: boolean;
  /** Side panel: open the thread full size. */
  onExpand?: () => void;
  /** Side panel: close it. */
  onClose?: () => void;
}

/** Right side of a thread's header: Join, the thread menu, expand and close (panel). */
export function ThreadHeaderActions({ threadId, serverId, state, canModerateThreads, onExpand, onClose }: ThreadHeaderActionsProps) {
  const gt = useGT();
  const { info } = state;
  const thread = info?.thread ?? null;
  const canManage = Boolean(info?.canManageThread) || canModerateThreads;
  const duration = normalizeAutoArchiveDuration(thread?.autoArchiveDuration);
  const durationLabel = (minutes: number) =>
    minutes === 60 ? gt("1 Hour") : minutes === 1440 ? gt("24 Hours") : minutes === 4320 ? gt("3 Days") : gt("1 Week");

  const fail = () => toast.error(gt("Something went wrong. Try again."));
  const threadUrl = () => `${window.location.origin}/channels/${serverId ?? "me"}/${threadId}`;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {info && !info.joined && (
        <button
          type="button"
          onClick={() => void state.join().then((ok) => (ok ? undefined : fail()))}
          className="flex items-center gap-1 rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--text-on-accent)] transition-opacity hover:opacity-90"
        >
          <LogIn className="h-3.5 w-3.5" />
          {gt("Join Thread")}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-md p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)]"
            title={gt("Thread options")}
            aria-label={gt("Thread options")}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px] border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)]">
          {info && (info.joined ? (
            <DropdownMenuItem onClick={() => void state.leave().then((ok) => (ok ? undefined : fail()))} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> {gt("Leave Thread")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => void state.join().then((ok) => (ok ? undefined : fail()))} className="cursor-pointer">
              <LogIn className="mr-2 h-4 w-4" /> {gt("Join Thread")}
            </DropdownMenuItem>
          ))}
          {canManage && thread && !thread.locked && (
            <DropdownMenuItem
              onClick={() => void state.update({ archived: !thread.archived }).then((ok) => (ok ? undefined : fail()))}
              className="cursor-pointer"
            >
              {thread.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {thread.archived ? gt("Open Thread") : gt("Close Thread")}
            </DropdownMenuItem>
          )}
          {canModerateThreads && thread && (
            <DropdownMenuItem
              onClick={() =>
                void state
                  .update(thread.locked ? { locked: false, archived: false } : { locked: true })
                  .then((ok) => (ok ? undefined : fail()))
              }
              className="cursor-pointer"
            >
              {thread.locked ? <LockOpen className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              {thread.locked ? gt("Unlock Thread") : gt("Lock Thread")}
            </DropdownMenuItem>
          )}
          {canManage && thread && (
            <>
              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
              <DropdownMenuLabel className="text-xs uppercase tracking-wide text-[var(--app-muted)]">
                {gt("Hide After Inactivity")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(duration)}
                onValueChange={(v) => void state.update({ autoArchiveDuration: Number(v) }).then((ok) => (ok ? undefined : fail()))}
              >
                {AUTO_ARCHIVE_DURATIONS.map((m) => (
                  <DropdownMenuRadioItem key={m} value={String(m)} className="cursor-pointer">
                    {durationLabel(m)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard?.writeText(threadUrl());
              toast.success(gt("Link copied"));
            }}
            className="cursor-pointer"
          >
            <Link2 className="mr-2 h-4 w-4" /> {gt("Copy Link")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard?.writeText(threadId);
              toast.success(gt("Thread ID copied"));
            }}
            className="cursor-pointer"
          >
            <Copy className="mr-2 h-4 w-4" /> {gt("Copy Thread ID")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className={cn("hidden rounded-md p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)] sm:block")}
          title={gt("Open in full view")}
          aria-label={gt("Open in full view")}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--app-muted)] transition-colors hover:text-[var(--text-primary)]"
          title={gt("Close thread")}
          aria-label={gt("Close thread")}
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
