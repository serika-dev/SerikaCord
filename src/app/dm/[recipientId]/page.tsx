"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Phone, Video, Pin, Users,  ArrowLeft, Shield, UserPlus, Clock } from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { getDisplayNameStyleClasses, getDisplayNameStyleInline, getProfileBackgroundStyle } from "@/lib/userDisplayNameStyle";
import Link from "next/link";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { InlineBadges } from "@/components/chat/InlineBadges";
import { StaffPill } from "@/components/chat/StaffPill";
import { SystemPill } from "@/components/chat/SystemPill";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Skeleton, UserProfileSkeleton } from "@/components/ui/skeleton";
import { voiceService } from "@/lib/services/voiceService";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { VideoGrid } from "@/components/voice/VideoGrid";
import { MessageList, type MessageListHandle } from "@/components/chat/MessageList";
import { MessageContextMenu } from "@/components/chat/MessageContextMenu";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { PinnedMessagesDialog } from "@/components/chat/PinnedMessagesDialog";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useChatSession } from "@/hooks/useChatSession";
import { useComposerSuggestions } from "@/hooks/useComposerSuggestions";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import { playTts } from "@/lib/chat/tts";
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ChatMessage, MessageAuthor } from "@/lib/chat/types";
import { ProfileCard, type ProfileCardUser } from "@/components/user/ProfileCard";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

const statusColors = {
  online: "#23A559",
  idle: "#F0B232",
  dnd: "#EF4444",
  offline: "#80848e",
};

interface Recipient extends MessageAuthor {
  customStatus?: string;
  bio?: string;
  createdAt?: string;
  isFriend?: boolean;
  friendRequestSent?: boolean;
  timezone?: string | null;
  showTimezone?: boolean;
  banner?: string | null;
  pronouns?: string;
}

export default function DMConversationPage() {
  const gt = useGT();
  const params = useParams();
  const router = useRouter();
  const recipientId = params.recipientId as string;
  const { user, isLoading: authLoading, refresh } = useAuth();
  const { clearContext } = useServer();
  const isMobile = useIsMobile();

  const [recipient, setRecipient] = useState<Recipient | null>(null);
  // Derived: loading until the fetched recipient matches the current route.
  const recipientLoading = !recipient || recipient.id !== recipientId;
  const [showUserProfile, setShowUserProfile] = useState(true);
  const [showPins, setShowPins] = useState(false);
  const messageBarRef = useRef<MessageBarHandle>(null);
  const messageListRef = useRef<MessageListHandle>(null);

  const [availableServerEmojis, setAvailableServerEmojis] = useState<
    Array<{ id: string; name: string; url: string; serverId?: string; serverName?: string; serverIcon?: string; animated?: boolean }>
  >([]);
  const [availableServerStickers, setAvailableServerStickers] = useState<
    Array<{ id: string; name: string; imageUrl: string; serverId?: string; serverName?: string }>
  >([]);

  const apiBase = recipientId ? `/api/dms/${recipientId}` : null;

  // The whole chat engine (messages, SSE, sends, pins, actions) is shared
  // with server channels via useChatSession.
  const chat = useChatSession<ChatMessage>({
    apiBase,
    contextId: recipientId ?? null,
    user,
    messageBarRef,
    emojiLookup: availableServerEmojis,
    onShouldScrollToBottom: () => {
      if (messageListRef.current?.isAtBottom()) {
        requestAnimationFrame(() => messageListRef.current?.scrollToBottom());
      }
    },
    onIncomingMessage: (message) => {
      // Auto TTS for DMs: speak when the listener has TTS enabled or the
      // message carries the /tts prefix (so both parties hear a /tts message).
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
  });

  const { setActiveChannel, markChannelRead } = useUnread();
  // The DM's channel id isn't in the route (which uses recipientId), so derive
  // it from loaded messages. Wire it into the unread engine so DM read state
  // persists to the DB and syncs across devices.
  const dmChannelId = useMemo(
    () => chat.messages.find((m) => m.channelId)?.channelId ?? null,
    [chat.messages]
  );
  const newestMessageId = chat.messages.length
    ? chat.messages[chat.messages.length - 1]?.id
    : null;
  useEffect(() => {
    if (!dmChannelId) return;
    setActiveChannel(dmChannelId);
    return () => setActiveChannel(null);
  }, [dmChannelId, setActiveChannel]);
  // Keep the read marker current as new messages arrive while the DM is open,
  // so another device opening the same DM sees it as read.
  useEffect(() => {
    if (dmChannelId && newestMessageId && document.visibilityState === "visible") {
      markChannelRead(dmChannelId);
    }
  }, [dmChannelId, newestMessageId, markChannelRead]);

  const { executeCommand } = useSlashCommands({});

  const handleSend = useCallback(async () => {
    const composer = messageBarRef.current?.getComposer();
    const rawContent = composer?.getText() ?? "";
    const trimmed = rawContent.trim();

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
                ? {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName || user.username,
                    avatar: user.avatar,
                  }
                : null,
              channelId: dmChannelId ?? undefined,
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
  }, [executeCommand, chat, user?.settings?.accessibility?.ttsRate, user?.settings?.accessibility?.ttsVoice]);

  const lightbox = useMediaLightbox(chat.mediaGallery);

  const mentionUsers = useMemo(() => {
    const entries: Array<{ id: string; username: string; displayName: string; avatar?: string }> = [];
    if (user?.id) {
      entries.push({
        id: user.id,
        username: user.username || user.displayName || "you",
        displayName: user.displayName || user.username || "You",
        avatar: user.avatar,
      });
    }
    if (recipient?.id) {
      entries.push({
        id: recipient.id,
        username: recipient.username,
        displayName: recipient.displayName || recipient.username,
        avatar: recipient.avatar,
      });
    }
    return entries;
  }, [recipient, user]);

  // Clear server context when entering a DM
  useEffect(() => {
    clearContext();
  }, [clearContext]);

  useEffect(() => {
    if (user?.id) {
      voiceService.setUserId(user.id);
    }
  }, [user?.id]);

  // Auto-start a call when arriving from a "Call"/"Video Call" menu action
  // (e.g. from the member list), via ?call=voice|video.
  useEffect(() => {
    if (!user?.id || !recipientId || typeof window === "undefined") return;
    const call = new URLSearchParams(window.location.search).get("call");
    if (call !== "voice" && call !== "video") return;
    voiceService.setUserId(user.id);
    void voiceService.joinChannel(`dm:${recipientId}`, call === "video");
    const url = new URL(window.location.href);
    url.searchParams.delete("call");
    window.history.replaceState(null, "", url.toString());
  }, [user?.id, recipientId]);

  // Cross-server emojis/stickers for the DM pickers (best-effort)
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

  // Redirect if not authenticated (with recheck to prevent loops)
  const dmRecheckRef = useRef(false);
  useEffect(() => {
    if (!authLoading && !user) {
      if (!dmRecheckRef.current) {
        dmRecheckRef.current = true;
        void refresh();
        return;
      }
      router.push("/login");
    }
  }, [user, authLoading, router, refresh]);

  // Fetch recipient info
  useEffect(() => {
    if (!recipientId) return;
    fetch(`/api/users/${recipientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setRecipient(data))
      .catch((error) => console.error("Failed to fetch recipient:", error));
  }, [recipientId]);

  const focusComposer = useCallback(() => {
    messageBarRef.current?.getComposer()?.focus();
  }, []);

  /** Begin editing the current user's most recent editable message. */
  const editLastOwnMessage = () => {
    if (!user) return false;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m.author?.id !== user.id) continue;
      if (m.pending || m.id.startsWith("temp-")) continue;
      chat.actions.startEditing(m);
      messageListRef.current?.scrollToMessage(m.id);
      return true;
    }
    return false;
  };

  /** Jump to a message, loading the surrounding window first if it isn't in view. */
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

  // Emoji `:` / slash `/` / `@user` autocomplete for the DM composer.
  const composerSuggestions = useComposerSuggestions({
    getComposer: () => messageBarRef.current?.getComposer() ?? null,
    isServer: false,
    customEmojis: availableServerEmojis,
    recipient: recipientId ? { id: recipientId, username: recipient?.username || "", displayName: recipient?.displayName } : null,
    onAfterInsert: (text) => chat.signalTyping(text),
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    // Let the autocomplete claim arrow/enter/tab/escape while open.
    if (composerSuggestions.handleKeyDown(e)) return;

    const composer = messageBarRef.current?.getComposer();
    const isComposerEmpty = (composer?.getText().trim().length ?? 0) === 0;

    // ArrowUp on an empty composer edits your last message (Discord parity).
    if (e.key === "ArrowUp" && isComposerEmpty && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (editLastOwnMessage()) {
        e.preventDefault();
        return;
      }
    }

    // Escape clears the active reply.
    if (e.key === "Escape" && chat.actions.replyToMessage) {
      e.preventDefault();
      chat.actions.setReplyToMessage(null);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleMessageInputChange = (value: string) => {
    chat.signalTyping(value);
  };

  const handleAddFriend = async () => {
    if (!recipient?.username) return;
    try {
      const response = await fetch(`/api/friends/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: recipient.username }),
      });
      if (response.ok) {
        setRecipient((prev) => prev ? { ...prev, friendRequestSent: true } : prev);
      } else {
        const data = await response.json().catch(() => null);
        console.error("Failed to send friend request:", data?.error);
      }
    } catch {
      console.error("Failed to send friend request");
    }
  };

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-app)]">
        <Loader size={32} />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const recipientName = recipient?.displayName || recipient?.username;

  const welcomeHeader = (
    <div className="flex flex-col items-start gap-2 mb-6 px-4 animate-fade-in-up">
      {recipientLoading ? (
        <>
          <Skeleton className="w-20 h-20 rounded-full" variant="circular" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-72" />
        </>
      ) : (
        <>
          <Avatar className="w-20 h-20">
            <AvatarImage src={cdnImage(recipient?.avatar)} />
            <AvatarFallback className="bg-[var(--accent-color)] text-white text-2xl">
              {(recipientName || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h2 className={cn("text-2xl font-bold text-[var(--text-primary)]", getDisplayNameStyleClasses(recipient?.customization?.displayNameStyle))} style={getDisplayNameStyleInline(recipient?.customization?.displayNameStyle)}>{recipientName}</h2>
          <p className="text-[var(--text-secondary)]">
            <T>This is the beginning of your direct message history with</T>{" "}
            <span className="font-semibold text-[var(--text-primary)]">{recipientName}</span>
          </p>
        </>
      )}
    </div>
  );

  return (
    <div className="chat-shell flex-1 flex bg-[var(--bg-app)] animate-fade-in overflow-hidden">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Header */}
        <div className="h-14 sm:h-16 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-app)] safe-area-top">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/channels/messages"
              className="p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors active:scale-95"
            >
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </Link>

            <div className="relative flex-shrink-0">
              <Avatar className="w-8 h-8">
                <AvatarImage src={cdnImage(recipient?.avatar)} />
                <AvatarFallback className="bg-[var(--accent-color)] text-white text-sm">
                  {(recipientName || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-app)]"
                style={{ backgroundColor: statusColors[recipient?.status || "offline"] }}
              />
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("font-semibold text-[var(--text-primary)] truncate self-center", getDisplayNameStyleClasses(recipient?.customization?.displayNameStyle))} style={getDisplayNameStyleInline(recipient?.customization?.displayNameStyle)}>
                {recipientName || gt("Loading...")}
              </span>
              <SystemPill isSystem={recipient?.isSystem} />
              <StaffPill badges={recipient?.badges} />
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-2">
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]"
              title={gt("Start Voice Call")}
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`, true)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)] hidden sm:block"
              title={gt("Start Video Call")}
            >
              <Video className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowPins(true)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]"
              title={gt("Pinned Messages")}
            >
              <Pin className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowUserProfile(!showUserProfile)}
              className={cn(
                "p-2 transition-colors rounded-md hover:bg-[var(--bg-hover)] hidden lg:block",
                showUserProfile
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <Users className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <MessageList
          ref={messageListRef}
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
          emptyText={`${gt("Say hi to")} ${recipientName || gt("your friend")}!`}
          resetKey={recipientId}
        />

        <TypingIndicator text={chat.typingStatusText} className="pb-1" />

        {/* Message input */}
        <div className="pt-0">
          {recipient?.isSystem ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-card)]/50 border border-[var(--border-subtle)] rounded-md text-[var(--text-secondary)] text-sm">
              <Shield className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span><T>This is an official Serika system account used to share important updates and announcements with the community.</T></span>
            </div>
          ) : (
            <MessageBar
              ref={messageBarRef}
              placeholder={`${gt("Message")} @${recipientName || "..."}`}
              ariaLabel={`${gt("Message")} @${recipientName || "..."}`}
              onSend={() => void handleSend()}
              onChange={handleMessageInputChange}
              onCaretMove={(text, caret) => composerSuggestions.onCaretMove(text, caret)}
              mentionSuggestions={composerSuggestions.mentionSuggestions}
              onMentionSelect={(s) => composerSuggestions.onMentionSelect(s as unknown as import("@/hooks/useComposerSuggestions").ComposerSuggestion)}
              activeMentionIndex={composerSuggestions.activeMentionIndex}
              onKeyDown={handleKeyPress}
              onEmojiSelect={chat.handleEmojiSelect}
              onGifSelect={chat.handleGifSelect}
              onStickerSelect={chat.handleStickerSelect}
              isSending={chat.isSending}
              availableServerEmojis={availableServerEmojis}
              availableServerStickers={availableServerStickers}
              replyTo={chat.actions.replyToMessage}
              onCancelReply={() => chat.actions.setReplyToMessage(null)}
              draftKey={recipientId ? `dm:${recipientId}` : undefined}
            />
          )}

          {/* Voice call UI for DM calls */}
          <VideoGrid />
          <VoiceBar channelName={recipientName || gt("DM Call")} />
        </div>
      </div>

      {/* User profile sidebar */}
      {showUserProfile && (
        <div className="w-[340px] shrink-0 bg-[var(--bg-app)] border-l border-[var(--border-subtle)] hidden lg:flex flex-col h-full overflow-hidden">
          {recipientLoading ? (
            <UserProfileSkeleton />
          ) : recipient ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
              <ProfileCard
                user={recipient as ProfileCardUser}
                isFriend={recipient.isFriend}
                hideMessageButton
                hideConnections
                noRoundedCorners
                className="w-full max-w-none flex-1 flex flex-col"
              />
            </div>
          ) : null}
        </div>
      )}

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
        contextLabel={recipientName ? `@${recipientName}` : undefined}
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
