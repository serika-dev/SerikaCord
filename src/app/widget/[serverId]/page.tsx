"use client";

import { isInlineVideo } from "@/lib/chat/uploadPolicy";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, MessageCircle, ArrowRight, Hash, Volume2, Menu, X, ChevronDown, Reply, RefreshCw } from "lucide-react";
import { ServerBadge } from "@/components/ui/badges";
import { cn, cdnImage } from "@/lib/utils";
import { isImageLikeUrl, isGifUrl } from "@/lib/chat/media";
import { VideoMediaPlayer, AudioMediaPlayer } from "@/components/chat/MediaPlayer";
import { useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";

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

function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time;
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} · ${time}`;
}

const STATUS_DOT: Record<string, string> = {
  online: "#23A559",
  idle: "#F0B232",
  dnd: "#EF4444",
  offline: "#80848E",
};

/** Placeholder shaped like the loaded widget, so nothing jumps when data lands. */
function WidgetPageSkeleton({ label }: { label: string }) {
  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--app-bg)] overflow-hidden" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="h-12 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--app-border)] bg-[var(--app-surface)]">
        <div className="h-4 w-32 rounded skeleton-shimmer" />
        <div className="ml-auto h-7 w-24 rounded-lg skeleton-shimmer" />
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="hidden sm:flex flex-col w-64 shrink-0 border-r border-[var(--app-border)] bg-[var(--app-surface)]">
          <div className="h-24 skeleton-shimmer" />
          <div className="p-3 space-y-2">
            {[70, 55, 80, 60, 45].map((w, i) => <div key={i} className="h-6 rounded-md skeleton-shimmer" style={{ width: `${w}%` }} />)}
          </div>
        </div>
        <div className="flex-1 p-4 space-y-5">
          {[[30, 70], [22, 50], [35, 80], [26, 45]].map(([a, b], i) => (
            <div key={i} className="flex gap-3">
              <div className="size-9 rounded-full skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3.5 rounded skeleton-shimmer" style={{ width: `${a}%` }} />
                <div className="h-3.5 rounded skeleton-shimmer" style={{ width: `${b}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
  const videos = attachments.filter((a) => isInlineVideo(a.contentType, a.filename));
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
  const locale = useLocale();
  const params = useParams();
  const serverId = params.serverId as string;
  const [widget, setWidget] = useState<ServerWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; retry: boolean } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const fetchWidget = useCallback(async (channelId?: string) => {
    try {
      const qs = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
      const response = await fetch(`/api/servers/${serverId}/widget${qs}`);
      if (response.ok) {
        const data = await response.json();
        setWidget(data);
        setError(null);
      } else if (response.status === 403) {
        setError({ title: gt("Widget is disabled for this server"), message: gt("A server admin can turn it on in Server Settings."), retry: false });
      } else if (response.status === 404) {
        setError({ title: gt("Server not found"), message: gt("This server may have been deleted or the link is wrong."), retry: false });
      } else {
        setError({ title: gt("Failed to load widget"), message: gt("Something went wrong on our side. Try again in a moment."), retry: true });
      }
    } catch {
      setError({ title: gt("Failed to load widget"), message: gt("Check your connection and try again."), retry: true });
    }
  }, [serverId, gt]);

  useEffect(() => {
    let active = true;
    async function load() {
      await fetchWidget();
      if (active) setIsLoading(false);
    }
    load();
    return () => { active = false; };
  }, [fetchWidget]);

  const handleSelectChannel = useCallback(async (channelId: string) => {
    if (!widget || channelId === widget.currentChannelId || isSwitching) return;
    setIsSwitching(true);
    setMobileNavOpen(false);
    await fetchWidget(channelId);
    setIsSwitching(false);
  }, [widget, isSwitching, fetchWidget]);

  const retry = useCallback(async () => {
    setIsLoading(true);
    await fetchWidget();
    setIsLoading(false);
  }, [fetchWidget]);

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

  const onlineMembers = useMemo(
    () => (widget?.members ?? []).filter((m) => m.status !== "offline").slice(0, 30),
    [widget]
  );

  if (isLoading && !widget) {
    return <WidgetPageSkeleton label={gt("Loading widget")} />;
  }

  if (error && !widget) {
    return (
      <div className="h-screen w-screen bg-[var(--app-bg)] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-8 shadow-[0_24px_60px_-30px_color-mix(in_srgb,var(--app-accent)_60%,transparent)]">
          <span className="mx-auto mb-4 grid place-items-center size-12 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--app-accent)_30%,transparent)]">
            <MessageCircle className="size-6 text-[var(--app-accent)]" aria-hidden />
          </span>
          <h1 className="font-display text-lg font-semibold text-[var(--app-text)]">{error.title}</h1>
          <p className="mt-1.5 text-sm text-[var(--app-muted)]">{error.message}</p>
          {error.retry && (
            <button
              type="button"
              onClick={retry}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
            >
              <RefreshCw className="size-4" aria-hidden /> {gt("Try Again")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!widget) return null;

  const currentChannel = widget.channels.find((c) => c.id === widget.currentChannelId);
  const inviteUrl = widget.inviteCode ? `https://serika.cc/${widget.inviteCode}` : null;

  const ChannelRow = ({ channel }: { channel: WidgetChannel }) => {
    const active = channel.id === widget.currentChannelId;
    const clickable = channel.type === "text" || channel.type === "announcement";
    return (
      <button
        type="button"
        onClick={() => clickable && handleSelectChannel(channel.id)}
        disabled={!clickable}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/ch relative w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm truncate transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--app-accent)]",
          active
            ? "bg-[var(--app-surface-alt)] text-[var(--app-text)] font-medium"
            : clickable
            ? "text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-alt)]/60"
            : "text-[var(--app-muted-2)] cursor-default"
        )}
      >
        {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[var(--app-accent)]" />}
        {channel.type === "voice" ? (
          <Volume2 className="w-4 h-4 shrink-0 opacity-70" aria-hidden />
        ) : (
          <Hash className="w-4 h-4 shrink-0 opacity-70" aria-hidden />
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
        <div className="flex items-center gap-1 px-2 mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--app-muted-2)]">
          <ChevronDown className="w-3 h-3" aria-hidden />
          <span className="truncate">{category.name}</span>
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
    <nav aria-label={gt("Channels")} className="flex flex-col h-full w-64 shrink-0 bg-[var(--app-surface)] border-r border-[var(--app-border)]">
      {/* Server header */}
      <div className="relative h-24 shrink-0 border-b border-[var(--app-border)] overflow-hidden">
        {widget.banner ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${cdnImage(widget.banner)})` }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--app-accent) 55%, transparent) 0%, transparent 60%), linear-gradient(135deg, color-mix(in srgb, var(--app-accent) 30%, transparent), transparent)",
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--app-surface)] via-[var(--app-surface)]/40 to-transparent" />
        <div className="absolute inset-x-3 bottom-2.5 flex items-center gap-2.5 min-w-0">
          <Avatar className="w-10 h-10 rounded-xl border-2 border-[var(--app-surface)] shrink-0 shadow-lg">
            <AvatarImage src={cdnImage(widget.icon)} alt="" className="rounded-xl" />
            <AvatarFallback className="rounded-xl bg-[var(--app-accent)] text-white text-sm font-semibold">
              {widget.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              {widget.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
              <h1 className="font-display font-semibold tracking-[-0.01em] text-[var(--app-text)] text-[15px] truncate">{widget.name}</h1>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--app-muted)]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="relative flex size-1.5">
                  <span className="absolute inset-0 rounded-full bg-[#23A559] animate-ping opacity-60 motion-reduce:animate-none" />
                  <span className="relative size-1.5 rounded-full bg-[#23A559]" />
                </span>
                {gt("{count} online", { count: widget.onlineCount.toLocaleString(locale) })}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" aria-hidden />
                {widget.memberCount.toLocaleString(locale)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label={gt("Close channel list")}
            className="sm:hidden ml-auto p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-black/20"
          >
            <X className="w-4 h-4" aria-hidden />
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

        {/* Online members */}
        {onlineMembers.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--app-border)]">
            <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--app-muted-2)]">
              {gt("Online — {count}", { count: widget.onlineCount.toLocaleString(locale) })}
            </p>
            <ul className="space-y-0.5">
              {onlineMembers.map((m) => (
                <li key={m.id} className="flex items-center gap-2 px-2 py-1 rounded-md min-w-0">
                  <span className="relative shrink-0">
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={cdnImage(m.avatar)} alt="" />
                      <AvatarFallback className="bg-[var(--app-accent)] text-white text-[10px]">
                        {(m.displayName || m.username).charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      aria-hidden
                      className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--app-surface)]"
                      style={{ backgroundColor: STATUS_DOT[m.status] ?? STATUS_DOT.offline }}
                    />
                  </span>
                  <span className="text-[13px] text-[var(--app-muted)] truncate">{m.displayName || m.username}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <a
        href="https://serika.chat"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 px-3 py-2 border-t border-[var(--app-border)] text-[11px] text-[var(--app-muted-2)] hover:text-[var(--app-text)] transition-colors"
      >
        {gt("Powered by SerikaCord")}
      </a>
    </nav>
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--app-bg)] overflow-hidden">
      {/* Top bar */}
      <header className="h-12 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--app-border)] bg-[var(--app-surface)]">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label={gt("Open channel list")}
          aria-expanded={mobileNavOpen}
          className="sm:hidden p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-alt)]"
        >
          <Menu className="w-4 h-4" aria-hidden />
        </button>
        <div className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-[var(--app-text)]">
          {currentChannel?.type === "voice" ? (
            <Volume2 className="w-4 h-4 text-[var(--app-muted-2)] shrink-0" aria-hidden />
          ) : (
            <Hash className="w-4 h-4 text-[var(--app-muted-2)] shrink-0" aria-hidden />
          )}
          <span className="truncate">{currentChannel?.name || widget.name}</span>
        </div>
        <div className="flex-1" />
        {inviteUrl && (
          <a
            href={inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group/join flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--app-accent)] text-white text-xs font-semibold shadow-[0_6px_20px_-8px_var(--app-accent)] hover:brightness-110 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
          >
            {gt("Join Server")}
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover/join:translate-x-0.5" aria-hidden />
          </a>
        )}
      </header>

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
        <main className="flex-1 flex flex-col min-w-0 relative" aria-busy={isSwitching}>
          {isSwitching && (
            <div className="absolute inset-0 bg-[var(--app-bg)]/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <Loader size={24} />
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3" aria-live="polite">
            {messageGroups.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-[var(--app-muted)]">
                <span className="grid place-items-center size-12 rounded-xl bg-[var(--app-surface)] border border-[var(--app-border)]">
                  <MessageCircle className="w-6 h-6 text-[var(--app-muted-2)]" aria-hidden />
                </span>
                <p className="text-sm">{gt("No messages yet in this channel")}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {messageGroups.map((group, gi) => {
                  const author = group[0].author;
                  const reply = group[0].referencedMessage;
                  return (
                    <motion.article
                      key={group[0].id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(gi, 6) * 0.02 }}
                      className="px-2 py-1.5 rounded-lg hover:bg-[var(--app-surface)]/60 transition-colors"
                    >
                      {/* Reply reference header */}
                      {reply && (
                        <div className="flex items-center gap-1.5 ml-12 mb-0.5 text-xs text-[var(--app-muted-2)] min-w-0">
                          <Reply className="w-3.5 h-3.5 shrink-0 -scale-x-100" aria-hidden />
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
                          <AvatarImage src={cdnImage(author.avatar)} alt="" />
                          <AvatarFallback className="bg-[var(--app-accent)] text-white text-sm">
                            {(author.displayName || author.username).charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-sm font-semibold text-[var(--app-text)] truncate">
                              {author.displayName || author.username}
                            </span>
                            <time dateTime={group[0].createdAt} className="text-[11px] text-[var(--app-muted-2)] shrink-0">
                              {formatTime(group[0].createdAt, locale)}
                            </time>
                          </div>
                          <div className="space-y-0.5">
                            {group.map((msg) => (
                              <div key={msg.id} className="text-sm text-[var(--app-text)]/85 break-words leading-relaxed">
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
                                    src={cdnImage(msg.sticker.imageUrl)}
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
                    </motion.article>
                  );
                })}
              </div>
            )}
          </div>

          {/* Join prompt */}
          {inviteUrl && (
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group/cta mx-3 sm:mx-4 mb-3 sm:mb-4 flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--app-surface)] border border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_60%,transparent)] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
            >
              <Avatar className="w-8 h-8 rounded-lg shrink-0">
                <AvatarImage src={cdnImage(widget.icon)} alt="" className="rounded-lg" />
                <AvatarFallback className="rounded-lg bg-[var(--app-accent)] text-white text-xs font-semibold">{widget.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0 text-sm text-[var(--app-muted)] group-hover/cta:text-[var(--app-text)] transition-colors truncate">
                {gt("Click here to join and participate in chat")}
              </span>
              <ArrowRight className="w-4 h-4 text-[var(--app-accent)] shrink-0 transition-transform group-hover/cta:translate-x-0.5" aria-hidden />
            </a>
          )}
        </main>
      </div>
    </div>
  );
}
