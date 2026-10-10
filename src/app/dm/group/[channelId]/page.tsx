"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { ArrowLeft, Bell, BellOff, Inbox as InboxIcon, Phone, Pin, Search, UserPlus, Users, Video } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sharedGet } from "@/lib/bootFetch";
import { useServer } from "@/contexts/ServerContext";
import { useUnread, type ReadMarkerSnapshot } from "@/contexts/UnreadContext";
import { readMarkerMs } from "@/lib/chat/unreadMarker";
import { onJumpToMessage, openInbox, openNotificationSettings } from "@/lib/notifications/events";
import { emitHotkey, onHotkey } from "@/lib/keybinds";
import { cn } from "@/lib/utils";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { MessageList, type MessageListHandle } from "@/components/chat/MessageList";
import { MessageContextMenu } from "@/components/chat/MessageContextMenu";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { PinnedMessagesDialog } from "@/components/chat/PinnedMessagesDialog";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader } from "@/components/ui/Loader";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { DmCallPanel } from "@/components/voice/DmCallPanel";
import { GroupDmIcon } from "@/components/dm/GroupDmIcon";
import { GroupDmMembersPanel } from "@/components/dm/GroupDmMembersPanel";
import { voiceService } from "@/lib/services/voiceService";
import { startGroupCall } from "@/lib/services/dmCallController";
import { groupCallRoomId } from "@/lib/voice/rooms";
import type { CallGroup } from "@/lib/chat/dmCall";
import { GROUP_DM_MAX_MEMBERS, groupDmApiBase } from "@/lib/chat/groupDm";
import {
  cacheGroup,
  getCachedGroup,
  groupTitle,
  isGroupMember,
  type GroupInfo,
  type GroupMember,
} from "@/lib/chat/groupDmClient";
import { useChatSession } from "@/hooks/useChatSession";
import { useComposerSuggestions, type ComposerSuggestion } from "@/hooks/useComposerSuggestions";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import { playTts } from "@/lib/chat/tts";
import type { ChatMessage } from "@/lib/chat/types";
import { useMessageSearch, type SearchHit } from "@/hooks/useMessageSearch";
import { MessageSearchBar, type MessageSearchBarHandle } from "@/components/chat/search/MessageSearchBar";

const MessageSearchPanel = dynamic(() => import("@/components/chat/search/MessageSearchPanel").then((m) => m.MessageSearchPanel), { ssr: false });
const GroupDmPickerDialog = dynamic(() => import("@/components/dm/GroupDmPickerDialog").then((m) => m.GroupDmPickerDialog), { ssr: false });
const EditGroupDmDialog = dynamic(() => import("@/components/dm/EditGroupDmDialog").then((m) => m.EditGroupDmDialog), { ssr: false });

/**
 * A group DM conversation (/dm/group/<channelId>): the same chat engine as
 * channels and 1:1 DMs, a header with the group's icon/name and call buttons,
 * the Discord-style call panel, and a member list on the right.
 */
export default function GroupDMPage() {
  const gt = useGT();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelId = params.channelId as string;
  const { user, isLoading: authLoading, refresh } = useAuth();
  const { clearContext } = useServer();
  const isMobile = useIsMobile();
  const confirm = useConfirm();

  const [groupState, setGroup] = useState<GroupInfo | null>(() => getCachedGroup(channelId));
  // Switching groups doesn't remount the page: paint the cached copy of the
  // new group (if any) until its fetch lands.
  const group = groupState && groupState.id === channelId ? groupState : getCachedGroup(channelId);
  const groupLoading = !group;
  const [showMembers, setShowMembers] = useState(true);
  const [showPins, setShowPins] = useState(false);
  const [showAddFriends, setShowAddFriends] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const messageBarRef = useRef<MessageBarHandle>(null);
  const messageListRef = useRef<MessageListHandle>(null);

  const [availableServerEmojis, setAvailableServerEmojis] = useState<
    Array<{ id: string; name: string; url: string; serverId?: string; serverName?: string; serverIcon?: string; animated?: boolean }>
  >([]);
  const [availableServerStickers, setAvailableServerStickers] = useState<
    Array<{ id: string; name: string; imageUrl: string; serverId?: string; serverName?: string }>
  >([]);

  const applyGroup = useCallback((next: GroupInfo) => {
    cacheGroup(next);
    setGroup(next);
  }, []);

  // We were removed / left on another device: get out of here.
  const leaveNotices = {
    removed: gt("You are no longer in this group."),
    missing: gt("That group doesn't exist or you're not in it."),
  };
  const noticesRef = useRef(leaveNotices);
  useEffect(() => {
    noticesRef.current = leaveNotices;
  });
  const kickedRef = useRef<string | null>(null);
  const leaveRoute = useCallback((notice?: "removed" | "missing") => {
    if (kickedRef.current === channelId) return;
    kickedRef.current = channelId;
    if (notice) toast(noticesRef.current[notice]);
    router.replace("/channels/me");
  }, [router, channelId]);

  const apiBase = channelId ? groupDmApiBase(channelId) : null;

  const chat = useChatSession<ChatMessage>({
    apiBase,
    contextId: channelId ?? null,
    user,
    messageBarRef,
    emojiLookup: availableServerEmojis,
    onShouldScrollToBottom: () => {
      if (messageListRef.current?.isAtBottom()) {
        requestAnimationFrame(() => messageListRef.current?.scrollToBottom());
      }
    },
    onIncomingMessage: (message) => {
      const ttsEnabled = user?.settings?.accessibility?.tts === true;
      const hasTtsPrefix = typeof message.content === "string" && message.content.startsWith("/tts ");
      if ((ttsEnabled || hasTtsPrefix) && message.content) {
        const authorName = message.author?.displayName || message.author?.username || gt("Someone");
        void playTts({
          content: message.content,
          authorName,
          rate: user?.settings?.accessibility?.ttsRate,
          voiceGender: user?.settings?.accessibility?.ttsVoice,
        });
      }
    },
    onOtherEvent: (event) => {
      if (event.type !== "group_update" || !event.group) return;
      const next = event.group as GroupInfo;
      if (next.id !== channelId) return;
      if (user?.id && !isGroupMember(next, user.id)) {
        leaveRoute("removed");
        return;
      }
      applyGroup(next);
    },
  });

  // Group info (members, owner, name, icon). Cached copy paints first.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    // sharedGet picks up the boot prefetch (BootPrefetch) on a cold load.
    sharedGet(`/api/group-dms/${channelId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404 || res.status === 403) {
          leaveRoute("missing");
          return;
        }
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.group) applyGroup(data.group as GroupInfo);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [channelId, applyGroup, leaveRoute]);

  const { setActiveChannel, markChannelRead, markChannelUnread, getReadMarker, isChannelMuted } = useUnread();
  useEffect(() => {
    if (!channelId) return;
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  // Read marker as of opening (red "NEW" line); acked once actually seen.
  const [openMarker, setOpenMarker] = useState<{ channelId: string | null; marker: ReadMarkerSnapshot | null; acked: boolean }>({
    channelId: null,
    marker: null,
    acked: false,
  });
  const liveMarker = channelId ? getReadMarker(channelId) : null;
  if (
    openMarker.channelId !== channelId ||
    (!openMarker.acked && readMarkerMs(liveMarker) > readMarkerMs(openMarker.marker))
  ) {
    setOpenMarker({ channelId, marker: liveMarker, acked: false });
  }
  const handleReadUpTo = useCallback(
    (message: { id: string; createdAt: string }) => {
      setOpenMarker((prev) => (prev.acked ? prev : { ...prev, acked: true }));
      markChannelRead(channelId, message);
    },
    [channelId, markChannelRead],
  );
  const handleMarkRead = useCallback(() => {
    setOpenMarker((prev) => (prev.acked ? prev : { ...prev, acked: true }));
    markChannelRead(channelId);
  }, [channelId, markChannelRead]);
  const muted = channelId ? isChannelMuted(channelId) : false;

  const { executeCommand } = useSlashCommands({});

  const handleSend = useCallback(async () => {
    const composer = messageBarRef.current?.getComposer();
    const trimmed = (composer?.getText() ?? "").trim();
    if (trimmed.startsWith("/")) {
      const result = await executeCommand(trimmed);
      if (result.handled) {
        if (result.ttsText) {
          composer?.clear();
          void playTts({
            content: result.ttsText,
            rate: user?.settings?.accessibility?.ttsRate,
            voiceGender: user?.settings?.accessibility?.ttsVoice,
          });
          await chat.sendMessage({ contentOverride: `/tts ${result.ttsText}` });
        } else if (result.sendAsMessage) {
          composer?.clear();
          if (result.ephemeral) {
            chat.resetTyping();
            chat.addEphemeralMessage({
              id: `eph-local-${Date.now()}`,
              content: result.sendAsMessage,
              authorId: user?.id,
              author: user
                ? { id: user.id, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar }
                : null,
              channelId,
              createdAt: new Date().toISOString(),
              ephemeral: true,
              type: "default",
            });
          } else {
            await chat.sendMessage({ contentOverride: result.sendAsMessage });
          }
        } else {
          composer?.clear();
          chat.resetTyping();
        }
        return;
      }
    }
    void chat.sendMessage();
  }, [executeCommand, chat, user, channelId]);

  const lightbox = useMediaLightbox(chat.mediaGallery);

  const members = useMemo(() => (group && group.id === channelId ? group.members : []), [group, channelId]);
  const others = useMemo(
    () => members.filter((m) => m.id.toLowerCase() !== (user?.id ?? "").toLowerCase()),
    [members, user?.id],
  );
  const title = group && group.id === channelId ? groupTitle(group, user?.id) : "";

  // Message search in this group (same engine as server search).
  const searchScope = useMemo(() => (channelId ? { kind: "dm" as const, channelId } : null), [channelId]);
  const search = useMessageSearch({ scope: searchScope, users: members });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Ctrl+F / Ctrl+Shift+F focus this conversation's search (Discord).
  const searchBarRef = useRef<MessageSearchBarHandle>(null);
  useEffect(() => {
    const focusSearch = () => {
      if (isMobile) setMobileSearchOpen(true);
      else searchBarRef.current?.focus();
    };
    const unsubs = [onHotkey("search-channel", focusSearch), onHotkey("search-all", focusSearch)];
    return () => unsubs.forEach((u) => u());
  }, [isMobile]);

  const mentionUsers = useMemo(
    () => members.map((m) => ({ id: m.id, username: m.username, displayName: m.displayName || m.username, avatar: m.avatar ?? undefined })),
    [members],
  );
  const suggestionRecipients = useMemo(
    () => others.map((m) => ({ id: m.id, username: m.username, displayName: m.displayName ?? undefined })),
    [others],
  );

  useEffect(() => {
    clearContext();
  }, [clearContext]);

  useEffect(() => {
    if (user?.id) voiceService.setUserId(user.id);
  }, [user?.id]);

  // ── Calls ────────────────────────────────────────────────────────────────
  const callRoomId = channelId ? groupCallRoomId(channelId) : null;
  const groupIcon = group?.icon ?? null;
  const callGroup = useMemo<CallGroup | undefined>(
    () => (channelId ? { channelId, name: title || gt("Group"), icon: groupIcon, memberCount: members.length } : undefined),
    [channelId, title, groupIcon, members.length, gt],
  );
  const callPeers = useMemo(
    () => others.map((m) => ({ id: m.id, name: m.displayName || m.username, avatar: m.avatar ?? null })),
    [others],
  );
  const startCall = useCallback((video: boolean) => {
    if (!user?.id || !callGroup) return;
    voiceService.setUserId(user.id);
    void startGroupCall({ group: callGroup, video });
  }, [user?.id, callGroup]);

  // ?call=voice|video (from a menu action): start the call once.
  const callParam = searchParams.get("call");
  useEffect(() => {
    if (callParam !== "voice" && callParam !== "video") return;
    if (!user?.id || groupLoading) return;
    startCall(callParam === "video");
    const url = new URL(window.location.href);
    url.searchParams.delete("call");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [callParam, user?.id, groupLoading, startCall, router]);

  // Cross-server emojis/stickers for the pickers (best-effort)
  useEffect(() => {
    fetch("/api/users/@me/emojis")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setAvailableServerEmojis(data.emojis || []))
      .catch(() => {});
    fetch("/api/users/@me/stickers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setAvailableServerStickers(data.stickers || []))
      .catch(() => {});
  }, []);

  // Redirect if not authenticated (with one recheck to prevent loops)
  const recheckRef = useRef(false);
  useEffect(() => {
    if (!authLoading && !user) {
      if (!recheckRef.current) {
        recheckRef.current = true;
        void refresh();
        return;
      }
      router.push("/login");
    }
  }, [user, authLoading, router, refresh]);

  const focusComposer = useCallback(() => {
    messageBarRef.current?.getComposer()?.focus();
  }, []);

  const editLastOwnMessage = () => {
    if (!user) return false;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.author?.id !== user.id) continue;
      if (m.pending || m.id.startsWith("temp-")) continue;
      if (m.type && m.type !== "default" && m.type !== "reply") continue;
      // Polls and forwards have no text of their own to edit.
      if (m.poll || m.forward) continue;
      chat.actions.startEditing(m);
      messageListRef.current?.scrollToMessage(m.id);
      return true;
    }
    return false;
  };

  const jumpToMessage = useCallback(async (id: string) => {
    if (!id) return;
    const highlight = () => {
      messageListRef.current?.scrollToMessage(id);
      const el = document.getElementById(`message-${id}`);
      if (el) {
        el.classList.add("message-jump-highlight");
        setTimeout(() => el.classList.remove("message-jump-highlight"), 1600);
      }
    };
    if (document.getElementById(`message-${id}`)) { highlight(); return; }
    const ok = await chat.jumpToMessage(id);
    if (!ok) return;
    requestAnimationFrame(() => requestAnimationFrame(highlight));
  }, [chat]);

  const handleSearchJump = useCallback((hit: SearchHit) => {
    setMobileSearchOpen(false);
    void jumpToMessage(hit.id);
  }, [jumpToMessage]);

  // ?jump=<messageId> (copied link / notification click)
  useEffect(() => {
    if (!channelId || typeof window === "undefined") return;
    const jid = new URLSearchParams(window.location.search).get("jump");
    if (!jid) return;
    const t = setTimeout(() => {
      void jumpToMessage(jid);
      const url = new URL(window.location.href);
      url.searchParams.delete("jump");
      window.history.replaceState(null, "", url.toString());
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Inbox / notification click aimed at this (already open) group.
  useEffect(() => {
    if (!channelId) return;
    return onJumpToMessage(`/dm/group/${channelId}`, (id) => {
      void jumpToMessage(id);
      const url = new URL(window.location.href);
      if (url.searchParams.has("jump")) {
        url.searchParams.delete("jump");
        window.history.replaceState(null, "", url.toString());
      }
    });
  }, [channelId, jumpToMessage]);

  const composerSuggestions = useComposerSuggestions({
    getComposer: () => messageBarRef.current?.getComposer() ?? null,
    isServer: false,
    customEmojis: availableServerEmojis,
    recipients: suggestionRecipients,
    onAfterInsert: (text) => chat.signalTyping(text),
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (composerSuggestions.handleKeyDown(e)) return;
    const composer = messageBarRef.current?.getComposer();
    const isComposerEmpty = (composer?.getText().trim().length ?? 0) === 0;
    if (e.key === "ArrowUp" && isComposerEmpty && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (editLastOwnMessage()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Escape") {
      if (chat.actions.replyToMessage) {
        e.preventDefault();
        chat.actions.setReplyToMessage(null);
        return;
      }
      emitHotkey("mark-channel-read");
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Member management ────────────────────────────────────────────────────
  const removeMember = useCallback(async (member: GroupMember) => {
    const name = member.displayName || member.username;
    const ok = await confirm({
      title: gt("Remove {name}?", { name }),
      description: gt("They won't be able to see this group's messages any more."),
      confirmLabel: gt("Remove"),
    });
    if (!ok) return;
    const res = await fetch(`/api/group-dms/${channelId}/recipients/${member.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error || gt("Couldn't remove them from the group"));
    }
  }, [channelId, confirm, gt]);

  const leaveGroup = useCallback(async () => {
    const ok = await confirm({
      title: gt("Leave '{name}'", { name: title || gt("Group") }),
      description: gt("Are you sure you want to leave this group? You won't be able to rejoin unless someone adds you back."),
      confirmLabel: gt("Leave Group"),
    });
    if (!ok) return;
    const res = await fetch(`/api/group-dms/${channelId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error || gt("Couldn't leave the group"));
      return;
    }
    leaveRoute();
  }, [channelId, confirm, gt, leaveRoute, title]);

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-app)]">
        <Loader size={32} />
      </div>
    );
  }
  if (!user) return null;

  const canAddMore = members.length < GROUP_DM_MAX_MEMBERS;
  const memberIds = members.map((m) => m.id);

  const welcomeHeader = (
    <div className="flex flex-col items-start gap-2 mb-6 px-4 animate-fade-in-up">
      {groupLoading ? (
        <>
          <Skeleton className="w-20 h-20 rounded-full" variant="circular" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-72" />
        </>
      ) : (
        <>
          <GroupDmIcon icon={group?.icon} members={others} size={80} />
          <h2 className="text-2xl font-bold text-[var(--text-primary)] break-words">{title}</h2>
          <p className="text-[var(--text-secondary)]">
            <T>Welcome to the beginning of the</T>{" "}
            <span className="font-semibold text-[var(--text-primary)]">{title}</span>{" "}
            <T>group.</T>
          </p>
          {canAddMore && (
            <button
              type="button"
              onClick={() => setShowAddFriends(true)}
              className="mt-1 inline-flex items-center gap-2 rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-on-accent)] hover:opacity-90"
            >
              <UserPlus className="h-4 w-4" />
              {gt("Add Friends to DM")}
            </button>
          )}
        </>
      )}
    </div>
  );

  const headerButton = "p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]";

  return (
    <div className="chat-shell flex-1 flex bg-[var(--bg-app)] animate-fade-in overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Header */}
        <div className="h-14 sm:h-16 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-app)] safe-area-top">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/channels/messages"
              className="p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors active:scale-95 md:hidden"
              aria-label={gt("Back")}
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </Link>
            {groupLoading ? (
              <>
                <Skeleton className="w-8 h-8 rounded-full" variant="circular" />
                <Skeleton className="h-5 w-32" />
              </>
            ) : (
              <>
                <GroupDmIcon icon={group?.icon} members={others} size={32} />
                <button
                  type="button"
                  onClick={() => setShowEdit(true)}
                  className="min-w-0 truncate rounded px-1 font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  title={gt("Edit Group")}
                >
                  {title}
                </button>
                <span className="hidden sm:inline shrink-0 text-xs text-[var(--text-muted)]">
                  {gt("{count} Members", { count: members.length })}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-0.5 sm:gap-2">
            <button onClick={() => startCall(false)} className={headerButton} title={gt("Start Voice Call")} aria-label={gt("Start Voice Call")}>
              <Phone className="w-5 h-5" />
            </button>
            <button onClick={() => startCall(true)} className={cn(headerButton, "hidden sm:block")} title={gt("Start Video Call")} aria-label={gt("Start Video Call")}>
              <Video className="w-5 h-5" />
            </button>
            <button onClick={() => setShowPins(true)} className={headerButton} title={gt("Pinned Messages")} aria-label={gt("Pinned Messages")}>
              <Pin className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => setMobileSearchOpen(true)} className={cn(headerButton, "md:hidden")} title={gt("Search")} aria-label={gt("Search")}>
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowAddFriends(true)}
              disabled={!canAddMore}
              className={cn(headerButton, "disabled:opacity-40")}
              title={gt("Add Friends to DM")}
              aria-label={gt("Add Friends to DM")}
            >
              <UserPlus className="w-5 h-5" />
            </button>
            <button
              onClick={() => openNotificationSettings({ scope: "channel", id: channelId, name: title || gt("Group"), kind: "dm" })}
              className={cn(headerButton, "hidden sm:block")}
              title={gt("Notification Settings")}
              aria-label={gt("Notification Settings")}
            >
              {muted ? <BellOff className="w-5 h-5 text-red-400" /> : <Bell className="w-5 h-5" />}
            </button>
            <button onClick={() => openInbox()} className={cn(headerButton, "hidden sm:block")} title={gt("Inbox")} aria-label={gt("Inbox")}>
              <InboxIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowMembers((v) => !v)}
              className={cn(
                "p-2 transition-colors rounded-md hover:bg-[var(--bg-hover)] hidden lg:block",
                showMembers ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
              title={showMembers ? gt("Hide Member List") : gt("Show Member List")}
              aria-label={showMembers ? gt("Hide Member List") : gt("Show Member List")}
              aria-pressed={showMembers}
            >
              <Users className="w-5 h-5" />
            </button>
            <MessageSearchBar
              ref={searchBarRef}
              search={search}
              placeholder={title ? gt("Search {name}", { name: title }) : gt("Search")}
              className="hidden md:block ml-1"
            />
          </div>
        </div>

        {/* Discord-style call area while this group's call is up */}
        {callRoomId && (
          <DmCallPanel
            roomId={callRoomId}
            me={{ id: user.id, name: user.displayName || user.username, avatar: user.avatar }}
            peers={callPeers}
            groupName={title || gt("Group")}
          />
        )}

        <MessageList
          ref={messageListRef}
          onJumpToMessage={jumpToMessage}
          onAtBottomChange={chat.handleAtBottomChange}
          groups={chat.groupedMessages}
          isLoading={chat.isLoading}
          hasMoreOlder={chat.hasMoreOlder}
          hasMoreNewer={chat.hasMoreNewer}
          isLoadingMore={chat.isLoadingMore}
          loadOlderMessages={chat.loadOlderMessages}
          loadNewerMessages={chat.loadNewerMessages}
          actions={chat.actions}
          currentUserId={user.id}
          canPin
          swipeEnabled={isMobile}
          mentionUsers={mentionUsers}
          serverEmojis={availableServerEmojis}
          availableServerEmojis={availableServerEmojis}
          onMediaClick={lightbox.openMediaViewer}
          onSuppressEmbeds={chat.actions.suppressEmbeds}
          onReplyFocus={focusComposer}
          welcomeHeader={welcomeHeader}
          emptyText={gt("Say hi to the group!")}
          resetKey={channelId}
          callGroup={callGroup}
          unreadMarker={openMarker.marker}
          onReadUpTo={handleReadUpTo}
          onMarkRead={handleMarkRead}
          onMarkUnread={(plan) => {
            if (channelId) markChannelUnread(channelId, plan);
          }}
          onJumpToPresent={chat.returnToPresent}
        />

        <TypingIndicator text={chat.typingStatusText} className="pb-1" />

        <div className="pt-0">
          <MessageBar
            ref={messageBarRef}
            placeholder={`${gt("Message")} ${title || "..."}`}
            ariaLabel={`${gt("Message")} ${title || "..."}`}
            onSend={() => void handleSend()}
            onChange={(value) => chat.signalTyping(value)}
            onCaretMove={(text, caret) => composerSuggestions.onCaretMove(text, caret)}
            mentionSuggestions={composerSuggestions.mentionSuggestions}
            onMentionSelect={(s) => composerSuggestions.onMentionSelect(s as unknown as ComposerSuggestion)}
            activeMentionIndex={composerSuggestions.activeMentionIndex}
            onKeyDown={handleKeyPress}
            onEmojiSelect={chat.handleEmojiSelect}
            onGifSelect={chat.handleGifSelect}
            onStickerSelect={chat.handleStickerSelect}
            isSending={chat.isSending}
            availableServerEmojis={availableServerEmojis}
            availableServerStickers={availableServerStickers}
            replyTo={chat.actions.replyToMessage}
            replyMention={chat.actions.replyMention}
            onToggleReplyMention={chat.actions.toggleReplyMention}
            onCancelReply={() => chat.actions.setReplyToMessage(null)}
            pollApiBase={channelId ? `/api/group-dms/${channelId}` : undefined}
            draftKey={channelId ? `gdm:${channelId}` : undefined}
          />
          <VoiceBar className="md:hidden" hideForRoomId={callRoomId} />
        </div>
      </div>

      {/* Search results replace the member list while open (Discord). */}
      <MountWhenOpened open={search.open && !isMobile}>
        {search.open && !isMobile && (
          <MessageSearchPanel
            search={search}
            onJump={handleSearchJump}
            onClose={search.close}
            serverEmojis={availableServerEmojis}
          />
        )}
      </MountWhenOpened>
      <MountWhenOpened open={isMobile && mobileSearchOpen}>
        {isMobile && mobileSearchOpen && (
          <MessageSearchPanel
            mobile
            search={search}
            onJump={handleSearchJump}
            onClose={() => {
              setMobileSearchOpen(false);
              search.close();
            }}
            serverEmojis={availableServerEmojis}
            searchBar={
              <MessageSearchBar
                search={search}
                expanded
                autoFocus={!search.submitted}
                placeholder={title ? gt("Search {name}", { name: title }) : gt("Search")}
              />
            }
          />
        )}
      </MountWhenOpened>

      {showMembers && !groupLoading && !(search.open && !isMobile) && (
        <div className="hidden lg:flex h-full">
          <GroupDmMembersPanel
            members={members}
            ownerId={group?.ownerId ?? null}
            currentUserId={user.id}
            onAddFriends={() => setShowAddFriends(true)}
            onRemove={(m) => void removeMember(m)}
            onLeave={() => void leaveGroup()}
            canAddMore={canAddMore}
          />
        </div>
      )}

      <MountWhenOpened open={showAddFriends}>
        <GroupDmPickerDialog
          open={showAddFriends}
          onOpenChange={setShowAddFriends}
          mode="add"
          channelId={channelId}
          existingIds={memberIds}
        />
      </MountWhenOpened>

      <MountWhenOpened open={showEdit}>
        <EditGroupDmDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          channelId={channelId}
          name={group?.name ?? null}
          icon={group?.icon ?? null}
          members={others}
          placeholderName={groupTitle({ name: null, members }, user.id)}
        />
      </MountWhenOpened>

      <DeleteMessageDialog
        message={chat.actions.deleteConfirmMessage}
        onCancel={() => chat.actions.setDeleteConfirmMessage(null)}
        onConfirm={() => void chat.actions.confirmDelete()}
      />

      <PinnedMessagesDialog
        open={showPins}
        onOpenChange={setShowPins}
        messages={chat.pinnedMessages}
        isLoading={chat.isLoadingPins}
        contextLabel={title || undefined}
        onJumpToMessage={(id) => void jumpToMessage(id)}
        onUnpin={(message) => void chat.actions.togglePin(message)}
      />

      <MessageContextMenu
        menu={chat.actions.contextMenu}
        isOwn={(message) => message.authorId === user.id}
        canPin
        onClose={() => chat.actions.setContextMenu(null)}
        onReply={(message) => {
          chat.actions.setReplyToMessage(message);
          focusComposer();
        }}
        onAddReaction={(message) => chat.actions.setReactionPickerMessage(message.id)}
        onCopy={chat.actions.copyMessage}
        onPinToggle={(message) => void chat.actions.togglePin(message)}
        onEdit={chat.actions.startEditing}
        onDelete={chat.actions.setDeleteConfirmMessage}
        onDeleteNow={(message) => void chat.actions.deleteMessageNow(message)}
        onMarkUnread={(message) => messageListRef.current?.markUnreadFrom(message.id)}
        onViewReactions={(message) => chat.actions.setReactionsViewer({ message })}
        onReport={chat.actions.setReportMessage}
        onToggleReaction={(message, emoji, hasReacted) => chat.actions.toggleReaction(message.id, emoji, hasReacted)}
        currentUserId={user.id}
      />

      <ImageLightbox
        items={lightbox.lightboxItems}
        currentIndex={lightbox.lightboxCurrentIndex}
        isOpen={lightbox.isLightboxOpen}
        onNavigate={lightbox.standaloneMedia ? undefined : lightbox.setLightboxIndex}
        onClose={lightbox.closeMediaViewer}
      />
    </div>
  );
}
