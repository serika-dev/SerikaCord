"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Phone, Video, Pin, Users, Loader2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { MessageBar, type MessageBarHandle } from "@/components/chat/MessageBar";
import { InlineBadges } from "@/components/chat/InlineBadges";
import { StaffPill } from "@/components/chat/StaffPill";
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
import { useMediaLightbox } from "@/hooks/useMediaLightbox";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ChatMessage, MessageAuthor } from "@/lib/chat/types";

const statusColors = {
  online: "#8B5CF6",
  idle: "#A78BFA",
  dnd: "#EF4444",
  offline: "#555555",
};

interface Recipient extends MessageAuthor {
  customStatus?: string;
  bio?: string;
  createdAt?: string;
}

export default function DMConversationPage() {
  const params = useParams();
  const router = useRouter();
  const recipientId = params.recipientId as string;
  const { user, isLoading: authLoading } = useAuth();
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
    Array<{ id: string; name: string; url: string; serverId?: string; serverName?: string; animated?: boolean }>
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
        setTimeout(() => messageListRef.current?.scrollToBottom(), 50);
      }
    },
  });

  const lightbox = useMediaLightbox(chat.mediaGallery);

  const mentionUsers = useMemo(() => {
    const entries: Array<{ id: string; username: string; displayName: string }> = [];
    if (user?.id) {
      entries.push({
        id: user.id,
        username: user.username || user.displayName || "you",
        displayName: user.displayName || user.username || "You",
      });
    }
    if (recipient?.id) {
      entries.push({
        id: recipient.id,
        username: recipient.username,
        displayName: recipient.displayName || recipient.username,
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

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void chat.sendMessage();
    }
  };

  const handleMessageInputChange = (value: string) => {
    chat.signalTyping(value);
  };

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--bg-app)]">
        <Loader2 className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
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
            <AvatarImage src={recipient?.avatar} />
            <AvatarFallback className="bg-[var(--accent-primary)] text-white text-2xl">
              {(recipientName || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">{recipientName}</h2>
          <p className="text-[var(--text-secondary)]">
            This is the beginning of your direct message history with{" "}
            <span className="font-semibold text-[var(--text-primary)]">{recipientName}</span>
          </p>
        </>
      )}
    </div>
  );

  return (
    <div className="chat-shell flex-1 flex bg-[var(--bg-app)] animate-fade-in">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
                <AvatarImage src={recipient?.avatar} />
                <AvatarFallback className="bg-[var(--accent-primary)] text-white text-sm">
                  {(recipientName || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-app)]"
                style={{ backgroundColor: statusColors[recipient?.status || "offline"] }}
              />
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[var(--text-primary)] truncate">
                {recipientName || "Loading..."}
              </span>
              <StaffPill badges={recipient?.badges} />
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-2">
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]"
              title="Start Voice Call"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => void voiceService.joinChannel(`dm:${recipientId}`, true)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)] hidden sm:block"
              title="Start Video Call"
            >
              <Video className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowPins(true)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-md hover:bg-[var(--bg-hover)]"
              title="Pinned Messages"
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
          isLoadingMore={chat.isLoadingMore}
          loadOlderMessages={chat.loadOlderMessages}
          actions={chat.actions}
          currentUserId={user.id}
          swipeEnabled={isMobile}
          mentionUsers={mentionUsers}
          availableServerEmojis={availableServerEmojis}
          onMediaClick={lightbox.openMediaViewer}
          onReplyFocus={focusComposer}
          welcomeHeader={welcomeHeader}
          emptyText={`Say hi to ${recipientName || "your friend"}!`}
        />

        <TypingIndicator text={chat.typingStatusText} className="pb-1" />

        {/* Message input */}
        <div className="p-2 sm:p-4 pt-0 safe-area-bottom">
          <MessageBar
            ref={messageBarRef}
            placeholder={`Message @${recipientName || "..."}`}
            ariaLabel={`Message @${recipientName || "..."}`}
            onSend={() => void chat.sendMessage()}
            onChange={handleMessageInputChange}
            onKeyDown={handleKeyPress}
            onEmojiSelect={chat.handleEmojiSelect}
            onGifSelect={chat.handleGifSelect}
            onStickerSelect={chat.handleStickerSelect}
            isSending={chat.isSending}
            availableServerEmojis={availableServerEmojis}
            availableServerStickers={availableServerStickers}
            replyTo={chat.actions.replyToMessage}
            onCancelReply={() => chat.actions.setReplyToMessage(null)}
          />

          {/* Voice call UI for DM calls */}
          <VideoGrid />
          <VoiceBar channelName={recipientName || "DM Call"} />
        </div>
      </div>

      {/* User profile sidebar */}
      {showUserProfile && (
        <div className="w-[340px] bg-[var(--bg-app)] border-l border-[var(--border-subtle)] hidden lg:flex flex-col animate-slide-in-right">
          {recipientLoading ? (
            <UserProfileSkeleton />
          ) : recipient ? (
            <>
              <div className="h-[120px] bg-[var(--accent-primary)] relative">
                {recipient.isPremium && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-black/40 rounded-full flex items-center gap-1">
                    <span className="text-xs text-white font-medium">Serika+</span>
                  </div>
                )}
              </div>

              <div className="px-4 relative">
                <div className="absolute -top-16">
                  <div className="relative">
                    <Avatar className="w-24 h-24 border-[6px] border-[var(--bg-app)]">
                      <AvatarImage src={recipient.avatar} />
                      <AvatarFallback className="bg-[var(--accent-primary)] text-white text-2xl">
                        {(recipient.displayName || recipient.username).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div
                      className="absolute bottom-1 right-1 w-6 h-6 rounded-full border-4 border-[var(--bg-app)] transition-colors duration-200"
                      style={{ backgroundColor: statusColors[recipient.status || "offline"] }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-12 px-4">
                <div className="bg-[var(--bg-card)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-bold text-[var(--text-primary)]">
                      {recipient.displayName || recipient.username}
                    </h3>
                    <InlineBadges badges={recipient.badges} size="sm" />
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{recipient.username}</p>

                  {recipient.customStatus && (
                    <p className="text-sm text-[var(--text-secondary)] mt-2">{recipient.customStatus}</p>
                  )}

                  <div className="h-px bg-[var(--border-subtle)] my-4" />

                  {recipient.bio && (
                    <>
                      <h4 className="text-xs font-semibold uppercase text-[var(--text-secondary)] mb-2">
                        About Me
                      </h4>
                      <p className="text-sm text-[var(--text-primary)]">{recipient.bio}</p>
                      <div className="h-px bg-[var(--border-subtle)] my-4" />
                    </>
                  )}

                  <h4 className="text-xs font-semibold uppercase text-[var(--text-secondary)] mb-2">
                    SerikaCord Member Since
                  </h4>
                  <p className="text-sm text-[var(--text-primary)]">
                    {recipient.createdAt
                      ? new Date(recipient.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Unknown"}
                  </p>
                </div>
              </div>

              <div className="px-4 mt-4">
                <div className="bg-[var(--bg-card)] rounded-lg p-4">
                  <h4 className="text-xs font-semibold uppercase text-[var(--text-secondary)] mb-2">Note</h4>
                  <textarea
                    placeholder="Click to add a note"
                    className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none transition-colors duration-150"
                    rows={2}
                  />
                </div>
              </div>
            </>
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
        onJumpToMessage={(id) => messageListRef.current?.scrollToMessage(id)}
        onUnpin={(message) => void chat.actions.togglePin(message)}
      />

      <MessageContextMenu
        menu={chat.actions.contextMenu}
        isOwn={(message) => message.authorId === user.id}
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
