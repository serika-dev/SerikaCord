"use client";

/**
 * Bot message components, rendered in the shared chat engine (channels and
 * DMs): action rows of buttons and select menus, and the components v2
 * layouts (container, section, text display, thumbnail, media gallery, file,
 * separator). Loaded with next/dynamic only for messages that have
 * components.
 *
 * Clicking a button or choosing in a select posts to /api/interactions/
 * components, which checks the component really exists on the message and
 * isn't disabled before the app gets a MESSAGE_COMPONENT interaction. The
 * button spins until the app acknowledges (or fails to) on the user's
 * activity stream. Link buttons are plain links (new tab, noopener).
 *
 * Media (thumbnails, galleries, files) follows lib/chat/componentsV2: uploads
 * and our CDN load directly, other images go through the image proxy, and
 * external videos fetch nothing until played.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageContent } from "@/components/chat/MessageContent";
import { useChatGt, type ChatGt } from "./ChatGtContext";
import { useServer } from "@/contexts/ServerContext";
import { claimInteraction, onInteractionEvent, postInteraction, recentOutcome } from "@/lib/chat/interactionEvents";
import { accentHex, componentImageSrc, componentVideoSrc, galleryLayout, isTrustedMedia, isVideoMedia } from "@/lib/chat/componentsV2";
import { formatFileSize } from "@/lib/chat/messages";
import type { MessageComponent, SelectOption, UnfurledMedia } from "@/lib/botapi/components";
import type { MessageAttachment } from "@/lib/chat/types";

const T = {
  ACTION_ROW: 1, BUTTON: 2, STRING_SELECT: 3, USER_SELECT: 5, ROLE_SELECT: 6, MENTIONABLE_SELECT: 7, CHANNEL_SELECT: 8,
  SECTION: 9, TEXT_DISPLAY: 10, THUMBNAIL: 11, MEDIA_GALLERY: 12, FILE: 13, SEPARATOR: 14, CONTAINER: 17,
} as const;

const BUTTON_CLASS: Record<number, string> = {
  1: "chat-cbtn-primary",
  2: "chat-cbtn-secondary",
  3: "chat-cbtn-success",
  4: "chat-cbtn-danger",
  5: "chat-cbtn-secondary",
};

interface MentionUser { id: string; username?: string; displayName?: string; avatar?: string }
interface MentionRole { id: string; name: string; color?: string }
interface PickerEmoji { id: string; name: string; url: string; animated?: boolean }

export interface MessageComponentsProps {
  messageId: string;
  channelId: string;
  components: MessageComponent[];
  attachments?: MessageAttachment[];
  serverId?: string;
  currentUserId?: string;
  mentionUsers?: MentionUser[];
  mentionRoles?: MentionRole[];
  serverEmojis?: PickerEmoji[];
  onMediaClick?: (src: string, alt: string | undefined, messageId: string) => void;
}

const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

function failureText(gt: ChatGt, code: string | undefined): string {
  switch (code) {
    case "rate_limited":
      return gt("You are doing that too fast.");
    case "component_unknown":
    case "component_disabled":
    case "component_type":
    case "unknown_message":
      return gt("This component is no longer available.");
    case "unknown_application":
      return gt("This app is no longer in this conversation.");
    default:
      return gt("This interaction failed.");
  }
}

function Emoji({ emoji, emojis }: { emoji?: { id?: string; name?: string }; emojis?: PickerEmoji[] }) {
  if (!emoji) return null;
  if (emoji.id) {
    const found = emojis?.find((e) => e.id === emoji.id);
    if (found && isHttpUrl(found.url)) return <img src={found.url} alt={`:${found.name}:`} className="w-[1.1em] h-[1.1em] object-contain" />;
    return emoji.name ? <span>:{emoji.name}:</span> : null;
  }
  return emoji.name ? <span aria-hidden>{emoji.name}</span> : null;
}

type MediaClick = (src: string, alt: string | undefined) => void;

/** Attachment a component's media points at (by attachment_id, else by URL). */
function attachmentFor(media: UnfurledMedia | undefined, attachments?: MessageAttachment[]): MessageAttachment | undefined {
  if (!media || !attachments?.length) return undefined;
  return attachments.find((a) => (media.attachment_id && a.id === media.attachment_id) || a.url === media.url);
}

/** Spoiler veil shared by media tiles, file cards and containers. */
function SpoilerVeil({ onReveal }: { onReveal: () => void }) {
  const gt = useChatGt();
  return (
    <button
      type="button"
      onClick={onReveal}
      aria-label={gt("Click to reveal")}
      className="absolute inset-0 z-[1] flex items-center justify-center bg-[var(--app-bg)]/40 text-xs font-semibold uppercase tracking-wide text-[var(--app-text)]"
    >
      <span className="rounded-full bg-[var(--app-bg)]/80 px-3 py-1">{gt("Spoiler")}</span>
    </button>
  );
}

/**
 * One image / video of a thumbnail or gallery tile: http(s) only, external
 * images through the proxy, no referrer, blurred while a spoiler.
 */
function Media({
  media, alt, spoiler, className, fit = "cover", natural = false, tileWidth, onOpen,
}: {
  media?: UnfurledMedia;
  alt?: string;
  spoiler?: boolean;
  className?: string;
  fit?: "cover" | "contain";
  /** Natural size within the shared chat media bounds (.chat-media), for a lone gallery item. */
  natural?: boolean;
  /** Rendered width in CSS px, to ask for a smaller rendition. */
  tileWidth?: number;
  onOpen?: MediaClick;
}) {
  const gt = useChatGt();
  const [revealed, setRevealed] = useState(!spoiler);
  const [failed, setFailed] = useState(false);
  const video = isVideoMedia(media);
  const src = video ? componentVideoSrc(media) : componentImageSrc(media, { width: tileWidth ? tileWidth * 2 : undefined });
  if (!src) return null;
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-[var(--app-surface)]", className)}>
      {video ? (
        <video
          src={src}
          controls={revealed}
          playsInline
          // External videos can't be proxied: fetch nothing until played.
          preload={isTrustedMedia(media) ? "metadata" : "none"}
          {...({ referrerPolicy: "no-referrer" } as unknown as React.VideoHTMLAttributes<HTMLVideoElement>)}
          aria-label={alt || undefined}
          className={cn(natural ? "chat-media" : "block w-full h-full", "bg-[var(--app-bg)]", fit === "cover" ? "object-cover" : "object-contain", !revealed && "blur-xl scale-110")}
        />
      ) : failed ? (
        <div className="flex h-full min-h-16 w-full items-center justify-center p-2 text-center text-xs text-[var(--app-muted)]">
          {gt("Image")}
        </div>
      ) : (
        <button
          type="button"
          className={natural ? "block" : "block w-full h-full"}
          onClick={() => revealed && onOpen?.(componentImageSrc(media) ?? src, alt)}
          aria-label={alt || gt("Image")}
          tabIndex={revealed ? 0 : -1}
        >
          <img
            src={src}
            alt={alt || ""}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className={cn(natural ? "chat-media" : "block w-full h-full", fit === "cover" ? "object-cover" : "object-contain", !revealed && "blur-xl scale-110")}
          />
        </button>
      )}
      {!revealed && <SpoilerVeil onReveal={() => setRevealed(true)} />}
    </div>
  );
}

type GalleryItem = NonNullable<MessageComponent["items"]>[number];

/** Media gallery (12) in Discord's layouts: 1, 2, 1 big + 2, 2x2, then rows of three. */
function MediaGallery({ items, attachments, onOpen }: { items: GalleryItem[]; attachments?: MessageAttachment[]; onOpen?: MediaClick }) {
  const shown = items.filter((it) => componentImageSrc(it?.media) || componentVideoSrc(it?.media)).slice(0, 10);
  const layout = galleryLayout(shown.length);
  if (shown.length === 0) return null;
  const tile = (it: GalleryItem, i: number, className: string, tileWidth: number, natural = false) => {
    const att = attachmentFor(it.media, attachments);
    return (
      <Media
        key={i}
        media={it.media}
        alt={it.description}
        spoiler={Boolean(it.spoiler || att?.spoiler || att?.sensitive)}
        className={className}
        fit={natural ? "contain" : "cover"}
        natural={natural}
        tileWidth={tileWidth}
        onOpen={onOpen}
      />
    );
  };
  if (shown.length === 1) {
    return (
      <div className="max-w-full">
        {tile(shown[0], 0, "w-fit max-w-full", 520, true)}
      </div>
    );
  }
  if (layout.feature) {
    return (
      <div className="chat-cgallery grid grid-cols-2 grid-rows-2 gap-1 aspect-[3/2]">
        {tile(shown[0], 0, "row-span-2 h-full", 340)}
        {tile(shown[1], 1, "h-full", 260)}
        {tile(shown[2], 2, "h-full", 260)}
      </div>
    );
  }
  const starts = layout.rows.map((_, r) => layout.rows.slice(0, r).reduce((a, b) => a + b, 0));
  return (
    <div className="chat-cgallery flex flex-col gap-1">
      {layout.rows.map((count, r) => (
        <div key={r} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {shown.slice(starts[r], starts[r] + count).map((it, i) => tile(
            it,
            starts[r] + i,
            count === 1 ? "aspect-video" : count === 2 ? "aspect-[4/3]" : "aspect-square",
            Math.round(520 / count),
          ))}
        </div>
      ))}
    </div>
  );
}

/** File (13): a card for the uploaded attachment it references, spoiler-veiled if asked. */
function FileCard({ component, attachments }: { component: MessageComponent; attachments?: MessageAttachment[] }) {
  const gt = useChatGt();
  const att = attachmentFor(component.file, attachments);
  const [revealed, setRevealed] = useState(!(component.spoiler || att?.spoiler));
  const url = att?.url ?? component.file?.url;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const name = component.name || att?.filename || url.split("/").pop()?.split("?")[0] || gt("File");
  const size = formatFileSize(component.size ?? att?.size);
  return (
    <div className="relative w-full max-w-[26rem] overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className={cn("flex items-center gap-3 px-3 py-2.5", !revealed && "blur-md select-none")}>
        <FileText className="w-8 h-8 shrink-0 text-[var(--app-accent)]" />
        <div className="min-w-0 flex-1">
          <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-[var(--app-accent)] hover:underline" tabIndex={revealed ? 0 : -1}>
            {name}
          </a>
          {size && <div className="text-xs text-[var(--app-muted)]">{size}</div>}
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" download className="shrink-0 rounded p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-surface-alt)] hover:text-[var(--app-text)]" aria-label={gt("Download")} tabIndex={revealed ? 0 : -1}>
          <Download className="w-5 h-5" />
        </a>
      </div>
      {!revealed && <SpoilerVeil onReveal={() => setRevealed(true)} />}
    </div>
  );
}

interface SelectItem { value: string; label: string; description?: string; emoji?: { id?: string; name?: string }; color?: string }

function SelectMenu({
  component, disabled, pending, onSubmit, items, emojis,
}: {
  component: MessageComponent;
  disabled: boolean;
  pending: boolean;
  onSubmit: (values: string[]) => void;
  items: SelectItem[];
  emojis?: PickerEmoji[];
}) {
  const gt = useChatGt();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const defaults = useMemo(() => {
    if (component.options) return component.options.filter((o) => o.default).map((o) => o.value);
    return (component.default_values ?? []).map((d) => d.id);
  }, [component]);
  const [chosen, setChosen] = useState<string[]>(defaults);
  const min = component.min_values ?? 1;
  const max = component.max_values ?? 1;
  const multi = max > 1;
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q)) : items;
  const label = chosen.length
    ? items.filter((i) => chosen.includes(i.value)).map((i) => i.label).join(", ")
    : component.placeholder || gt("Make a selection");
  const toggle = (value: string) => {
    if (!multi) {
      setChosen([value]);
      setOpen(false);
      onSubmit([value]);
      return;
    }
    setChosen((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : prev.length >= max ? prev : [...prev, value]));
  };
  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="chat-cselect"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={cn("truncate text-left flex-1", !chosen.length && "text-[var(--app-muted)]")}>{label}</span>
          {pending ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-1 bg-[var(--app-surface)] border-[var(--app-border)] text-[var(--app-text)]">
        {items.length > 8 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full mb-1 px-2 py-1.5 rounded bg-[var(--app-surface-alt)] text-sm outline-none"
            placeholder={gt("Search")}
            aria-label={gt("Search")}
          />
        )}
        <div role="listbox" aria-multiselectable={multi} className="max-h-72 overflow-y-auto">
          {shown.length === 0 && <div className="px-2 py-3 text-sm text-[var(--app-muted)]">{gt("No results")}</div>}
          {shown.map((item) => {
            const selected = chosen.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => toggle(item.value)}
                className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-[var(--app-surface-alt)]", selected && "bg-[var(--bg-active)]")}
              >
                {item.emoji && <Emoji emoji={item.emoji} emojis={emojis} />}
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={item.color ? { color: item.color } : undefined}>{item.label}</span>
                  {item.description && <span className="block truncate text-xs text-[var(--app-muted)]">{item.description}</span>}
                </span>
                {selected && <Check className="w-4 h-4 shrink-0 text-[var(--app-accent)]" />}
              </button>
            );
          })}
        </div>
        {multi && (
          <div className="flex justify-end pt-1 border-t border-[var(--app-border)] mt-1">
            <button
              type="button"
              className="chat-cbtn chat-cbtn-primary"
              disabled={chosen.length < min || chosen.length > max}
              onClick={() => { setOpen(false); onSubmit(chosen); }}
            >
              {gt("Apply")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Options for user / role / mentionable / channel selects, from what the client already knows. */
function useEntityItems(component: MessageComponent, mentionUsers?: MentionUser[], mentionRoles?: MentionRole[]): SelectItem[] {
  const { channels } = useServer();
  return useMemo(() => {
    const users = (mentionUsers ?? []).map((u) => ({ value: u.id, label: u.displayName || u.username || u.id, description: u.username }));
    const roles = (mentionRoles ?? []).map((r) => ({ value: r.id, label: `@${r.name}`, color: r.color }));
    switch (component.type) {
      case T.USER_SELECT: return users;
      case T.ROLE_SELECT: return roles;
      case T.MENTIONABLE_SELECT: return [...users, ...roles];
      case T.CHANNEL_SELECT: {
        const allowed = component.channel_types;
        const typeNum: Record<string, number> = { text: 0, voice: 2, category: 4, announcement: 5, stage_voice: 13, forum: 15, media: 16 };
        return channels
          .filter((c) => !allowed?.length || allowed.includes(typeNum[String(c.type)] ?? 0))
          .map((c) => ({ value: c.id, label: `#${c.name}` }));
      }
      default: return [];
    }
  }, [component, mentionUsers, mentionRoles, channels]);
}

function EntitySelect(props: { component: MessageComponent; disabled: boolean; pending: boolean; onSubmit: (values: string[]) => void; mentionUsers?: MentionUser[]; mentionRoles?: MentionRole[] }) {
  const items = useEntityItems(props.component, props.mentionUsers, props.mentionRoles);
  return <SelectMenu component={props.component} disabled={props.disabled} pending={props.pending} onSubmit={props.onSubmit} items={items} />;
}

export default function MessageComponents({
  messageId,
  channelId,
  components,
  attachments,
  serverId,
  currentUserId,
  mentionUsers,
  mentionRoles,
  serverEmojis,
  onMediaClick,
}: MessageComponentsProps) {
  const gt = useChatGt();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingIxRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onInteractionEvent((e) => {
    if ((e.event !== "ack" && e.event !== "failed") || !e.interactionId || e.interactionId !== pendingIxRef.current) return;
    pendingIxRef.current = null;
    setPending(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (e.event === "failed") setError(failureText(gt, e.reason));
  }), [gt]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const fire = async (component: MessageComponent, values?: string[]) => {
    if (!component.custom_id || pending) return;
    setError(null);
    setPending(component.custom_id);
    const r = await postInteraction<{ interactionId?: string }>("components", {
      channelId,
      messageId,
      customId: component.custom_id,
      componentType: component.type,
      ...(values ? { values } : {}),
    });
    if (!r.ok) {
      setPending(null);
      setError(failureText(gt, r.code));
      return;
    }
    const ixId = r.data?.interactionId ?? null;
    if (ixId) {
      claimInteraction(ixId);
      const done = recentOutcome(ixId);
      if (done) {
        setPending(null);
        if (done.event === "failed") setError(failureText(gt, done.reason));
        return;
      }
    }
    pendingIxRef.current = ixId;
    // The ack / failure notice normally arrives well within this.
    timerRef.current = setTimeout(() => {
      pendingIxRef.current = null;
      setPending(null);
    }, 5000);
  };

  const renderButton = (c: MessageComponent, key: string | number) => {
    const style = BUTTON_CLASS[c.style ?? 2] ?? "chat-cbtn-secondary";
    const content = (
      <>
        {pending && pending === c.custom_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Emoji emoji={c.emoji} emojis={serverEmojis} />}
        {c.label && <span className="truncate">{c.label}</span>}
      </>
    );
    if (c.style === 5) {
      if (!isHttpUrl(c.url) || c.disabled) {
        return <span key={key} className={cn("chat-cbtn", style, "opacity-50 cursor-not-allowed")}>{content}</span>;
      }
      return (
        <a key={key} href={c.url} target="_blank" rel="noopener noreferrer nofollow" className={cn("chat-cbtn", style)} title={c.url}>
          {content}
          <ExternalLink className="w-3.5 h-3.5 opacity-70" />
        </a>
      );
    }
    return (
      <button
        key={key}
        type="button"
        className={cn("chat-cbtn", style)}
        disabled={Boolean(c.disabled) || Boolean(pending)}
        aria-busy={pending === c.custom_id}
        onClick={() => void fire(c)}
      >
        {content}
      </button>
    );
  };

  const renderSelect = (c: MessageComponent, key: string | number) => {
    const disabled = Boolean(c.disabled) || Boolean(pending);
    const busy = pending === c.custom_id;
    if (c.type === T.STRING_SELECT) {
      const items: SelectItem[] = (c.options ?? []).map((o: SelectOption) => ({ value: o.value, label: o.label, description: o.description, emoji: o.emoji }));
      return <div key={key} className="w-full max-w-[25rem]"><SelectMenu component={c} disabled={disabled} pending={busy} onSubmit={(v) => void fire(c, v)} items={items} emojis={serverEmojis} /></div>;
    }
    return (
      <div key={key} className="w-full max-w-[25rem]">
        <EntitySelect component={c} disabled={disabled} pending={busy} onSubmit={(v) => void fire(c, v)} mentionUsers={mentionUsers} mentionRoles={mentionRoles} />
      </div>
    );
  };

  const openMedia: MediaClick = (src, alt) => onMediaClick?.(src, alt, messageId);

  const text = (content: string | undefined, key: string | number) => (
    <div key={key} className="chat-message-body text-[var(--app-text)]" style={{ whiteSpace: "pre-wrap" }}>
      <MessageContent
        content={content ?? ""}
        serverEmojis={serverEmojis}
        mentionUsers={mentionUsers}
        mentionRoles={mentionRoles}
        currentUserId={currentUserId}
        serverId={serverId}
        onImageClick={openMedia}
      />
    </div>
  );

  const render = (c: MessageComponent, key: string | number): React.ReactNode => {
    switch (c.type) {
      case T.ACTION_ROW:
        return (
          <div key={key} className="flex flex-wrap gap-2">
            {(c.components ?? []).map((child, i) => (child.type === T.BUTTON ? renderButton(child, i) : renderSelect(child, i)))}
          </div>
        );
      case T.BUTTON:
        return renderButton(c, key);
      case T.TEXT_DISPLAY:
        return text(c.content, key);
      case T.SECTION:
        return (
          <div key={key} className="flex gap-3 items-start">
            <div className="flex-1 min-w-0 flex flex-col gap-1">{(c.components ?? []).map((t, i) => text(t.content, i))}</div>
            {c.accessory && (c.accessory.type === T.THUMBNAIL
              ? (
                <Media
                  media={c.accessory.media}
                  alt={c.accessory.description}
                  spoiler={c.accessory.spoiler || attachmentFor(c.accessory.media, attachments)?.sensitive}
                  className="w-[5.25rem] h-[5.25rem] shrink-0"
                  tileWidth={84}
                  onOpen={openMedia}
                />
              )
              : <div className="shrink-0 self-center">{renderButton(c.accessory, "acc")}</div>)}
          </div>
        );
      case T.THUMBNAIL:
        return <Media key={key} media={c.media} alt={c.description} spoiler={c.spoiler} className="w-[5.25rem] h-[5.25rem]" tileWidth={84} onOpen={openMedia} />;
      case T.MEDIA_GALLERY:
        return <MediaGallery key={key} items={c.items ?? []} attachments={attachments} onOpen={openMedia} />;
      case T.FILE:
        return <FileCard key={key} component={c} attachments={attachments} />;
      case T.SEPARATOR:
        return (
          <div key={key} role="separator" aria-hidden={c.divider === false || undefined} className={cn("w-full", c.spacing === 2 ? "py-2" : "py-0.5")}>
            {c.divider !== false && <div className="border-t border-[var(--app-border)]" />}
          </div>
        );
      case T.CONTAINER:
        return <Container key={key} component={c} render={render} />;
      default:
        return null;
    }
  };

  return (
    <div className="mt-1.5 flex flex-col gap-2 min-w-0" data-components>
      {components.map((c, i) => render(c, i))}
      {error && <div role="alert" className="text-xs text-[var(--destructive)]">{error}</div>}
    </div>
  );
}

function Container({ component, render }: { component: MessageComponent; render: (c: MessageComponent, key: string | number) => React.ReactNode }) {
  const [revealed, setRevealed] = useState(!component.spoiler);
  const accent = accentHex(component.accent_color);
  return (
    <div
      className="chat-ccontainer relative overflow-hidden"
      data-accent={accent ? "" : undefined}
      style={accent ? ({ "--chat-ccontainer-accent": accent } as React.CSSProperties) : undefined}
    >
      <div className={cn("flex flex-col gap-2 min-w-0", !revealed && "blur-md select-none pointer-events-none")} aria-hidden={!revealed || undefined}>
        {(component.components ?? []).map((c, i) => render(c, i))}
      </div>
      {!revealed && <SpoilerVeil onReveal={() => setRevealed(true)} />}
    </div>
  );
}
