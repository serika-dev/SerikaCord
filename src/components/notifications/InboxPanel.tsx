"use client";

/**
 * Inbox: recent mentions, unread conversations and missed calls. Used by the
 * desktop Inbox dialog (bell / Ctrl+I) and the mobile Notifications tab, so
 * both read the same unread and mention sources as the sidebar badges.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGT, useLocale } from "gt-next";
import { AtSign, Check, CheckCheck, Inbox, MessageSquare, PhoneMissed, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { isMentionCounted, useNotificationPrefs } from "@/lib/notifications/prefsStore";
import { useUnread } from "@/contexts/UnreadContext";
import { useMentions, type MentionData } from "@/hooks/useMentions";
import { formatMessageTimestamp } from "@/lib/chat/messages";
import { notificationPreview } from "@/lib/notifications/notify";
import type { MentionNames } from "@/lib/chat/mentionText";
import { navigateToMessage, type InboxTab } from "@/lib/notifications/events";
import {
  clearMissedCalls,
  markMissedCallsSeen,
  removeMissedCall,
  useMissedCalls,
} from "@/lib/notifications/missedCalls";
import { cdnImage, cn } from "@/lib/utils";

interface InboxPanelProps {
  initialTab?: InboxTab;
  /** Called after navigating somewhere (the dialog closes itself). */
  onNavigate?: () => void;
  className?: string;
}

export function InboxPanel({ initialTab = "mentions", onNavigate, className }: InboxPanelProps) {
  const gt = useGT();
  const locale = useLocale();
  const router = useRouter();
  const { servers } = useServer();
  const { unreadChannels, markChannelRead, markAllRead, getMentionCount } = useUnread();
  const { allMentions: rawMentions, mentions: rawUnreadMentions, mentionNames, loading } = useMentions();
  const missedCalls = useMissedCalls();
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const { user } = useAuth();
  const prefs = useNotificationPrefs();
  const muteEveryone = user?.settings?.notifications?.muteEveryone === true;

  // Same rules as the badges: per-server "Nothing" and @everyone / role
  // suppression hide a mention here too.
  const allMentions = useMemo(() => {
    void prefs; // re-filter when settings change
    return rawMentions.filter((m) =>
      isMentionCounted({ serverId: m.serverId || null, channelId: m.channelId, kind: m.kind, muteEveryoneGlobally: muteEveryone }),
    );
  }, [rawMentions, prefs, muteEveryone]);
  const unreadMentions = useMemo(() => {
    const visible = new Set(allMentions.map((m) => m.id));
    return rawUnreadMentions.filter((m) => visible.has(m.id));
  }, [allMentions, rawUnreadMentions]);

  const serverById = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const unreadMentionIds = useMemo(() => new Set(unreadMentions.map((m) => m.id)), [unreadMentions]);
  const unseenCalls = missedCalls.filter((c) => !c.seen).length;
  const mentionBadge = unreadMentions.length;

  const go = (url: string) => {
    navigateToMessage((u) => router.push(u), url);
    onNavigate?.();
  };

  const selectTab = (next: InboxTab) => {
    setTab(next);
    if (next === "calls") markMissedCallsSeen();
  };

  const tabs: Array<{ id: InboxTab; label: string; count: number; icon: typeof AtSign }> = [
    { id: "mentions", label: gt("Mentions"), count: mentionBadge, icon: AtSign },
    { id: "unreads", label: gt("Unreads"), count: unreadChannels.length, icon: MessageSquare },
    { id: "calls", label: gt("Missed calls"), count: unseenCalls, icon: PhoneMissed },
  ];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div role="tablist" className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-1 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {t.count > 0 && (
              <span className="min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                {t.count > 99 ? "99+" : t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-2" role="tabpanel">
        {tab === "mentions" && (
          <MentionsList
            mentions={allMentions}
            names={mentionNames}
            unreadIds={unreadMentionIds}
            loading={loading}
            serverName={(id) => serverById.get(id)?.name}
            formatTime={(iso) => formatMessageTimestamp(iso, gt, locale)}
            onOpen={(m) => go(`/channels/${m.serverId}/${m.channelId}?jump=${encodeURIComponent(m.id)}`)}
          />
        )}

        {tab === "unreads" && (
          <div className="space-y-1">
            {unreadChannels.length > 0 && (
              <div className="flex justify-end px-1 pb-1">
                <button
                  onClick={() => markAllRead()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {gt("Mark all as read")}
                </button>
              </div>
            )}
            {unreadChannels.length === 0 ? (
              <EmptyState text={gt("You're all caught up!")} />
            ) : (
              unreadChannels.map((c) => {
                const server = c.serverId ? serverById.get(c.serverId) : undefined;
                const mentions = getMentionCount(c.channelId);
                const title = c.isDM ? c.name || gt("Direct Message") : `#${c.name || gt("channel")}`;
                return (
                  <div
                    key={c.channelId}
                    className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]"
                  >
                    <button onClick={() => go(c.href)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={cdnImage(c.isDM ? c.avatar : server?.icon)} alt="" />
                        <AvatarFallback className="bg-[var(--app-accent)] text-xs text-[var(--text-on-accent)]">
                          {(c.isDM ? c.name : server?.name)?.charAt(0).toUpperCase() || "#"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</div>
                        <div className="truncate text-xs text-[var(--text-muted)]">
                          {c.isDM ? gt("Direct Message") : server?.name ?? ""}
                          {" · "}
                          {formatMessageTimestamp(c.lastMessageAt, gt, locale)}
                        </div>
                      </div>
                      {mentions > 0 && (
                        <span className="min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-bold leading-[18px] text-white">
                          {mentions > 99 ? "99+" : mentions}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => markChannelRead(c.channelId)}
                      title={gt("Mark as read")}
                      aria-label={gt("Mark as read")}
                      className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "calls" && (
          <div className="space-y-1">
            {missedCalls.length > 0 && (
              <div className="flex justify-end px-1 pb-1">
                <button
                  onClick={() => clearMissedCalls()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {gt("Clear all")}
                </button>
              </div>
            )}
            {missedCalls.length === 0 ? (
              <EmptyState text={gt("No missed calls.")} />
            ) : (
              missedCalls.map((call) => (
                <div key={call.callId} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]">
                  <button
                    onClick={() => {
                      removeMissedCall(call.callId);
                      go(call.href);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={cdnImage(call.callerAvatar)} alt="" />
                      <AvatarFallback className="bg-[var(--app-accent)] text-xs text-[var(--text-on-accent)]">
                        {call.callerName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {call.groupName
                          ? gt("Missed call from {name} in {group}", { name: call.callerName, group: call.groupName })
                          : gt("Missed call from {name}", { name: call.callerName })}
                      </div>
                      <div className="truncate text-xs text-[var(--text-muted)]">
                        {formatMessageTimestamp(call.endedAt, gt, locale)}
                      </div>
                    </div>
                    <PhoneMissed className="h-4 w-4 shrink-0 text-red-500" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Inbox className="mb-3 h-12 w-12 text-[var(--text-muted)]" />
      <p className="text-sm text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}

function MentionsList({
  mentions,
  names,
  unreadIds,
  loading,
  serverName,
  formatTime,
  onOpen,
}: {
  mentions: MentionData[];
  names: MentionNames;
  unreadIds: Set<string>;
  loading: boolean;
  serverName: (id: string) => string | undefined;
  formatTime: (iso: string) => string;
  onOpen: (m: MentionData) => void;
}) {
  const gt = useGT();
  if (mentions.length === 0) {
    return <EmptyState text={loading ? gt("Loading…") : gt("No recent mentions. You're all caught up!")} />;
  }
  return (
    <div className="space-y-1.5">
      {mentions.map((item) => {
        const unread = unreadIds.has(item.id);
        return (
          <button
            key={item.id}
            onClick={() => onOpen(item)}
            className={cn(
              "group w-full rounded-md p-3 text-left transition-colors hover:bg-[var(--bg-hover)]",
              unread ? "bg-[var(--bg-sidebar-elevated)] ring-1 ring-inset ring-red-500/40" : "bg-[var(--bg-sidebar-elevated)]/60",
            )}
          >
            <div className="mb-1 flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={cdnImage(item.author?.avatar)} alt="" />
                <AvatarFallback className="bg-[var(--app-accent)] text-[10px] text-[var(--text-on-accent)]">
                  {(item.author?.displayName || item.author?.username || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                {item.author?.displayName || item.author?.username || gt("Unknown")}
              </span>
              <span className="truncate text-xs text-[var(--app-accent)]">#{item.channelName}</span>
              {serverName(item.serverId) && (
                <span className="hidden truncate text-xs text-[var(--text-muted)] sm:inline">{serverName(item.serverId)}</span>
              )}
              <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)]">{formatTime(item.createdAt)}</span>
              {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-label={gt("Unread")} />}
            </div>
            <p className="line-clamp-2 text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
              {notificationPreview(item.content, 280, names)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
