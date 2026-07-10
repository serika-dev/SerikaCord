"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, MessageCircle, Loader2, ArrowRight, Hash, Volume2, Menu, X, ChevronDown, Reply } from "lucide-react";
import { ServerBadge } from "@/components/ui/badges";
import { cn } from "@/lib/utils";
import { isImageLikeUrl, isGifUrl } from "@/lib/chat/media";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { useGT } from "gt-next";

interface WidgetCategory {
  id: string;
  name: string;
}

interface WidgetChannel {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  isWidgetChannel?: boolean;
}

interface WidgetMessageAuthor {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

interface WidgetAttachment {
  id: string;
  filename: string;
  contentType: string;
  url: string;
  width?: number;
  height?: number;
}

interface WidgetEmoji {
  id: string;
  name: string;
  url: string;
  animated?: boolean;
}

interface WidgetMessage {
  id: string;
  content: string;
  author: WidgetMessageAuthor;
  createdAt: string;
  attachments?: WidgetAttachment[];
  customEmojis?: WidgetEmoji[];
  mentionedUserIds?: string[];
  mentionedRoleIds?: string[];
  mentionEveryone?: boolean;
  sticker?: { id: string; name: string; imageUrl: string };
  referencedMessage?: {
    id: string;
    content: string;
    author?: WidgetMessageAuthor;
  };
}

interface WidgetMentions {
  users: Record<string, { username: string; displayName?: string }>;
  roles: Record<string, { name: string; color?: string }>;
}

interface ServerWidget {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  memberCount: number;
  onlineCount: number;
  isPartnered?: boolean;
  inviteCode?: string;
  currentChannelId: string | null;
  categories: WidgetCategory[];
  channels: WidgetChannel[];
  members: Array<{
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
    status: "online" | "idle" | "dnd" | "offline";
  }>;
  recentMessages: WidgetMessage[];
  mentions?: WidgetMentions;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const TOKEN_SOURCE = "<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|<@&([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|(?<!\\S)@(everyone|here)\\b|<(a)?:([a-zA-Z0-9_]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>|(https?:\\/\\/[^\\s]+)";

const VIDEO_URL_RE = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const AUDIO_URL_RE = /\.(mp3|ogg|wav|m4a|flac|opus)(?:$|[?#])/i;

/**
 * Lightweight, self-contained message renderer for the public widget: inline
 * images/GIFs, custom emojis, @user / @role / @everyone mentions and links.
 * Deliberately avoids the app's authenticated MessageContent (profile popups,
 * markdown context) so it works with zero session.
 */
function WidgetMessageBody({
  content,
  emojis,
  mentions,
}: {
  content: string;
  emojis?: WidgetEmoji[];
  mentions?: WidgetMentions;
}) {
  const gt = useGT();
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const tokenRe = new RegExp(TOKEN_SOURCE, "gi");

  const pushText = (text: string) => {
    if (text) nodes.push(text);
  };

  while ((match = tokenRe.exec(content)) !== null) {
    if (match.index > last) pushText(content.slice(last, match.index));
    const [full, userId, roleId, special, , emojiName, emojiId, url] = match;
    const key = `${match.index}`;

    if (userId) {
      const u = mentions?.users[userId];
      nodes.push(
        <span key={key} className="rounded px-1 font-medium bg-[var(--app-accent)]/20 text-[var(--app-accent)]">
          @{u?.displayName || u?.username || gt("user")}
        </span>
      );
    } else if (roleId) {
      const r = mentions?.roles[roleId];
      const color = r?.color && r.color.startsWith("#") ? r.color : undefined;
      nodes.push(
        <span
          key={key}
          className="rounded px-1 font-medium"
          style={{
            backgroundColor: color ? `${color}22` : "rgba(124,58,237,0.2)",
            color: color || "var(--app-accent)",
          }}
        >
          @{r?.name || gt("role")}
        </span>
      );
    } else if (special) {
      nodes.push(
        <span key={key} className="rounded px-1 font-medium bg-yellow-500/20 text-yellow-300">
          @{special}
        </span>
      );
    } else if (emojiId) {
      const found = emojis?.find((e) => e.id === emojiId || e.name === emojiName);
      const src = found?.url || `https://cdn.discordapp.com/emojis/${emojiId}.${match[4] ? "gif" : "png"}`;
      // eslint-disable-next-line @next/next/no-img-element
      nodes.push(<img key={key} src={src} alt={`:${emojiName}:`} title={`:${emojiName}:`} className="inline-block align-middle mx-0.5 w-5 h-5" loading="lazy" />);
    } else if (url) {
      if (VIDEO_URL_RE.test(url)) {
        nodes.push(
          <span key={key} className="block my-1.5">
            <VideoMediaPlayer src={url} className="max-w-[280px] rounded-lg overflow-hidden" />
          </span>
        );
      } else if (AUDIO_URL_RE.test(url)) {
        nodes.push(
          <span key={key} className="block my-1.5">
            <AudioMediaPlayer src={url} className="w-full max-w-sm" />
          </span>
        );
      } else if (isImageLikeUrl(url)) {
        nodes.push(
          <span key={key} className="block my-1.5">
            <img
              src={url}
              alt="attachment"
              className={cn("max-w-[280px] max-h-[240px] w-auto h-auto object-contain block", isGifUrl(url) && "rounded-lg")}
              loading="lazy"
            />
          </span>
        );
      } else {
        nodes.push(
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline break-all">
            {url}
          </a>
        );
      }
    }
    last = match.index + full.length;
  }
  if (last < content.length) pushText(content.slice(last));

  return <>{nodes}</>;
}

function WidgetAttachments({ attachments }: { attachments?: WidgetAttachment[] }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => a.contentType.startsWith("image/") || isImageLikeUrl(a.url));
  const videos = attachments.filter((a) => a.contentType.startsWith("video/"));
  const audios = attachments.filter((a) => a.contentType.startsWith("audio/"));
  const files = attachments.filter((a) => !images.includes(a) && !videos.includes(a) && !audios.includes(a));
  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className={cn("grid gap-1", images.length === 1 ? "grid-cols-1" : "grid-cols-2 max-w-md")}>
          {images.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.id}
              src={a.url}
              alt={a.filename}
              loading="lazy"
              className={cn(
                "rounded-md object-cover",
                images.length === 1 ? "max-w-[280px] max-h-[240px] w-auto h-auto object-contain" : "w-full h-24"
              )}
            />
          ))}
        </div>
      )}
      {videos.map((a) => (
        <VideoMediaPlayer
          key={a.id}
          src={a.url}
          filename={a.filename}
          contentType={a.contentType}
          className="max-w-[280px] rounded-lg overflow-hidden"
        />
      ))}
      {audios.map((a) => (
        <AudioMediaPlayer
          key={a.id}
          src={a.url}
          filename={a.filename}
          contentType={a.contentType}
          className="w-full max-w-sm"
        />
      ))}
      {files.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-2 max-w-sm rounded-md bg-[var(--app-surface-alt)] text-sm text-[var(--app-accent)] hover:underline"
        >
          {a.filename}
        </a>
      ))}
    </div>
  );
}

export default function WidgetPage() {
  const gt = useGT();
  const params = useParams();
  const serverId = params.serverId as string;
  const [widget, setWidget] = useState<ServerWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const fetchWidget = useCallback(async (channelId?: string) => {
    try {
      const qs = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
      const response = await fetch(`/api/servers/${serverId}/widget${qs}`);
      if (response.ok) {
        const data = await response.json();
        setWidget(data);
      } else if (response.status === 403) {
        setError(gt("Widget is disabled for this server"));
      } else if (response.status === 404) {
        setError(gt("Server not found"));
      } else {
        setError(gt("Failed to load widget"));
      }
    } catch {
      setError(gt("Failed to load widget"));
    }
  }, [serverId]);

  useEffect(() => {
    async function load() {
      await fetchWidget();
      setIsLoading(false);
    }
    load();
  }, [fetchWidget]);

  const handleSelectChannel = useCallback(async (channelId: string) => {
    if (!widget || channelId === widget.currentChannelId || isSwitching) return;
    setIsSwitching(true);
    setMobileNavOpen(false);
    await fetchWidget(channelId);
    setIsSwitching(false);
  }, [widget, isSwitching, fetchWidget]);

  const grouped = useMemo(() => {
    if (!widget) return { uncategorized: [] as WidgetChannel[], byCategory: new Map<string, WidgetChannel[]>() };
    const byCategory = new Map<string, WidgetChannel[]>();
    const uncategorized: WidgetChannel[] = [];
    for (const channel of widget.channels) {
      if (channel.parentId) {
        const list = byCategory.get(channel.parentId) || [];
        list.push(channel);
        byCategory.set(channel.parentId, list);
      } else {
        uncategorized.push(channel);
      }
    }
    return { uncategorized, byCategory };
  }, [widget]);

  const messageGroups = useMemo(() => {
    if (!widget) return [];
    const groups: WidgetMessage[][] = [];
    for (const msg of widget.recentMessages) {
      const last = groups[groups.length - 1];
      // A reply always starts a fresh group so its "replying to" header shows.
      if (last && last[0].author.id === msg.author.id && !msg.referencedMessage) {
        last.push(msg);
      } else {
        groups.push([msg]);
      }
    }
    return groups;
  }, [widget]);

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-[var(--app-bg)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[var(--accent-color)] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen bg-[var(--app-bg)] flex items-center justify-center p-4">
        <div className="text-center">
          <MessageCircle className="w-12 h-12 text-[var(--app-muted-2)] mx-auto mb-4" />
          <p className="text-[var(--app-muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!widget) return null;

  const currentChannel = widget.channels.find((c) => c.id === widget.currentChannelId);

  const ChannelRow = ({ channel }: { channel: WidgetChannel }) => {
    const active = channel.id === widget.currentChannelId;
    const clickable = channel.type === "text" || channel.type === "announcement";
    return (
      <button
        onClick={() => clickable && handleSelectChannel(channel.id)}
        disabled={!clickable}
        className={cn(
          "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm truncate transition-colors text-left",
          active
            ? "bg-[var(--app-surface-alt)] text-[var(--app-text)] font-medium"
            : clickable
            ? "text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-alt)]/60"
            : "text-[var(--app-muted-2)] cursor-default"
        )}
      >
        {channel.type === "voice" ? (
          <Volume2 className="w-4 h-4 shrink-0" />
        ) : (
          <Hash className="w-4 h-4 shrink-0" />
        )}
        <span className="truncate">{channel.name}</span>
      </button>
    );
  };

  const CategoryGroup = ({ category }: { category: WidgetCategory }) => {
    const channels = grouped.byCategory.get(category.id);
    if (!channels || channels.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="flex items-center gap-1 px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-muted-2)]">
          <ChevronDown className="w-3 h-3" />
          {category.name}
        </div>
        <div className="space-y-0.5">
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} />
          ))}
        </div>
      </div>
    );
  };

  const Sidebar = (
    <div className="flex flex-col h-full w-64 shrink-0 bg-[var(--app-surface)] border-r border-[var(--app-border)]">
      {/* Server header */}
      <div className="relative h-20 shrink-0 border-b border-[var(--app-border)]">
        {widget.banner ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${widget.banner})` }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 55%, transparent) 0%, color-mix(in srgb, var(--app-accent) 35%, transparent) 100%)",
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--app-surface)] via-[var(--app-surface)]/30 to-transparent" />
        <div className="absolute inset-x-3 bottom-2 flex items-center gap-2 min-w-0">
          <Avatar className="w-9 h-9 border-2 border-[var(--app-surface)] shrink-0">
            <AvatarImage src={widget.icon} />
            <AvatarFallback className="bg-[var(--accent-color)] text-white text-sm">
              {widget.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              {widget.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
              <h1 className="font-bold text-[var(--app-text)] text-sm truncate">{widget.name}</h1>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--app-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#23d160]" />
              {widget.onlineCount.toLocaleString()} {gt("online")}
            </div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="sm:hidden ml-auto p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-black/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto p-2">
        {grouped.uncategorized.length > 0 && (
          <div className="space-y-0.5 mb-3">
            {grouped.uncategorized.map((c) => (
              <ChannelRow key={c.id} channel={c} />
            ))}
          </div>
        )}
        {widget.categories.map((cat) => (
          <CategoryGroup key={cat.id} category={cat} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--app-bg)] overflow-hidden">
      {/* Top bar */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--app-border)] bg-[var(--app-surface)]">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="sm:hidden p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-alt)]"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-[var(--app-text)]">
          {currentChannel?.type === "voice" ? (
            <Volume2 className="w-4 h-4 text-[var(--app-muted-2)] shrink-0" />
          ) : (
            <Hash className="w-4 h-4 text-[var(--app-muted-2)] shrink-0" />
          )}
          <span className="truncate">{currentChannel?.name || widget.name}</span>
        </div>
        <span className="hidden sm:flex items-center gap-1 text-xs text-[var(--app-muted)] ml-2">
          <Users className="w-3.5 h-3.5" />
          {widget.memberCount.toLocaleString()}
        </span>
        <div className="flex-1" />
        {widget.inviteCode && (
          <a
            href={`https://serika.cc/${widget.inviteCode}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-color)] hover:brightness-110 text-white text-xs font-semibold transition-all"
          >
            {gt("Join Server")}
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop sidebar */}
        <div className="hidden sm:flex h-full">{Sidebar}</div>

        {/* Mobile slide-over sidebar */}
        <AnimatePresence>
          {mobileNavOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileNavOpen(false)}
                className="absolute inset-0 bg-black/50 z-20 sm:hidden"
              />
              <motion.div
                initial={{ x: -260 }}
                animate={{ x: 0 }}
                exit={{ x: -260 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-y-0 left-0 z-30 sm:hidden"
              >
                {Sidebar}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {isSwitching && (
            <div className="absolute inset-0 bg-[var(--app-bg)]/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-[var(--accent-color)] animate-spin" />
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messageGroups.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-[var(--app-muted)]">
                <MessageCircle className="w-10 h-10 text-[var(--app-muted-2)]" />
                <p className="text-sm">{gt("No messages yet in this channel")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messageGroups.map((group, gi) => {
                  const author = group[0].author;
                  const reply = group[0].referencedMessage;
                  return (
                    <motion.div
                      key={group[0].id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(gi, 6) * 0.02 }}
                      className="px-1.5 py-1 rounded-lg hover:bg-[var(--app-surface)]/60"
                    >
                      {/* Reply reference header */}
                      {reply && (
                        <div className="flex items-center gap-1.5 ml-12 mb-0.5 text-xs text-[var(--app-muted-2)] min-w-0">
                          <Reply className="w-3.5 h-3.5 shrink-0 -scale-x-100" />
                          <span className="font-medium text-[var(--app-muted)] shrink-0">
                            {reply.author?.displayName || reply.author?.username || gt("someone")}
                          </span>
                          <span className="truncate">
                            {reply.content || gt("(attachment)")}
                          </span>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <Avatar className="w-9 h-9 shrink-0 mt-0.5">
                          <AvatarImage src={author.avatar} />
                          <AvatarFallback className="bg-[var(--accent-color)] text-white text-sm">
                            {(author.displayName || author.username).charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-[var(--app-text)]">
                              {author.displayName || author.username}
                            </span>
                            <span className="text-[11px] text-[var(--app-muted-2)]">
                              {formatTime(group[0].createdAt)}
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {group.map((msg) => (
                              <div key={msg.id} className="text-sm text-[var(--app-muted)] break-words leading-relaxed">
                                {msg.content && (
                                  <WidgetMessageBody
                                    content={msg.content}
                                    emojis={msg.customEmojis}
                                    mentions={widget.mentions}
                                  />
                                )}
                                {msg.sticker && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={msg.sticker.imageUrl}
                                    alt={msg.sticker.name}
                                    title={msg.sticker.name}
                                    className="max-w-[140px] max-h-[140px] object-contain mt-1"
                                    loading="lazy"
                                  />
                                )}
                                <WidgetAttachments attachments={msg.attachments} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Join / login prompt bar */}
          {widget.inviteCode && (
            <a
              href={`https://serika.cc/${widget.inviteCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-4 mb-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-border)] hover:border-[var(--accent-color)]/60 text-sm text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors shrink-0"
            >
              {gt("Click here to join and participate in chat")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
