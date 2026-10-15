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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageContent } from "@/components/chat/MessageContent";
import { useChatGt, type ChatGt } from "./ChatGtContext";
import { useServer } from "@/contexts/ServerContext";
import { claimInteraction, onInteractionEvent, postInteraction, recentOutcome } from "@/lib/chat/interactionEvents";
import type { MessageComponent, SelectOption } from "@/lib/botapi/components";
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

function colorHex(n: number | null | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return `#${Math.max(0, Math.min(0xffffff, Math.floor(n))).toString(16).padStart(6, "0")}`;
}

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

/** Media from a component (http(s) only, no referrer; blurred when a spoiler). */
function Media({ url, alt, spoiler, className, onOpen }: { url?: string; alt?: string; spoiler?: boolean; className?: string; onOpen?: () => void }) {
  const gt = useChatGt();
  const [revealed, setRevealed] = useState(!spoiler);
  if (!isHttpUrl(url)) return null;
  return (
    <button
      type="button"
      className={cn("relative block overflow-hidden rounded-md bg-[var(--app-surface)]", className)}
      onClick={() => (revealed ? onOpen?.() : setRevealed(true))}
      aria-label={revealed ? alt || gt("Image") : gt("Click to reveal")}
    >
      <img src={url} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" className={cn("block w-full h-full object-cover", !revealed && "blur-xl scale-110")} />
      {!revealed && (
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-[var(--app-text)] bg-[var(--app-bg)]/40">
          {gt("Spoiler")}
        </span>
      )}
    </button>
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

  const text = (content: string | undefined, key: string | number) => (
    <div key={key} className="chat-message-body text-[var(--app-text)]" style={{ whiteSpace: "pre-wrap" }}>
      <MessageContent
        content={content ?? ""}
        serverEmojis={serverEmojis}
        mentionUsers={mentionUsers}
        mentionRoles={mentionRoles}
        currentUserId={currentUserId}
        serverId={serverId}
        onImageClick={(src, alt) => onMediaClick?.(src, alt, messageId)}
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
            <div className="flex-1 min-w-0 space-y-1">{(c.components ?? []).map((t, i) => text(t.content, i))}</div>
            {c.accessory && (c.accessory.type === T.THUMBNAIL
              ? <Media url={c.accessory.media?.url} alt={c.accessory.description} spoiler={c.accessory.spoiler} className="w-20 h-20 shrink-0" onOpen={() => c.accessory?.media?.url && onMediaClick?.(c.accessory.media.url, c.accessory.description, messageId)} />
              : <div className="shrink-0">{renderButton(c.accessory, "acc")}</div>)}
          </div>
        );
      case T.THUMBNAIL:
        return <Media key={key} url={c.media?.url} alt={c.description} spoiler={c.spoiler} className="w-20 h-20" />;
      case T.MEDIA_GALLERY: {
        const items = (c.items ?? []).filter((it) => isHttpUrl(it.media?.url));
        return (
          <div key={key} className={cn("grid gap-1 max-w-[var(--chat-media-max-inline)]", items.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {items.map((it, i) => (
              <Media
                key={i}
                url={it.media.url}
                alt={it.description}
                spoiler={it.spoiler}
                className={cn("w-full", items.length > 1 ? "aspect-square" : "max-h-[22rem]")}
                onOpen={() => onMediaClick?.(it.media.url, it.description, messageId)}
              />
            ))}
          </div>
        );
      }
      case T.FILE: {
        const att = attachments?.find((a) => a.id === c.file?.attachment_id || a.url === c.file?.url);
        const url = att?.url ?? c.file?.url;
        if (!isHttpUrl(url)) return null;
        const name = att?.filename ?? url.split("/").pop()?.split("?")[0] ?? gt("File");
        return (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 max-w-[25rem] rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 hover:bg-[var(--app-surface-alt)]">
            <FileText className="w-6 h-6 shrink-0 text-[var(--app-accent)]" />
            <span className="truncate text-sm text-[var(--app-accent)]">{name}</span>
          </a>
        );
      }
      case T.SEPARATOR:
        return <div key={key} role="separator" className={cn(c.spacing === 2 ? "my-3" : "my-1.5", c.divider !== false && "border-t border-[var(--app-border)]")} />;
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
  const gt = useChatGt();
  const [revealed, setRevealed] = useState(!component.spoiler);
  const accent = colorHex(component.accent_color);
  return (
    <div
      className="chat-ccontainer relative max-w-[40rem]"
      style={accent ? ({ "--chat-ccontainer-accent": accent } as React.CSSProperties) : undefined}
    >
      <div className={cn("flex flex-col gap-2", !revealed && "blur-md select-none pointer-events-none")}>
        {(component.components ?? []).map((c, i) => render(c, i))}
      </div>
      {!revealed && (
        <button type="button" onClick={() => setRevealed(true)} className="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-[var(--app-text)]">
          {gt("Spoiler")}
        </button>
      )}
    </div>
  );
}
