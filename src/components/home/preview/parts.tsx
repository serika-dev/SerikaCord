/**
 * Presentational pieces of the homepage app previews (see AppPreview.tsx for
 * which app component each one copies). No "use client" and no server-only
 * imports: the static previews render them on the server, and the live hero
 * (LiveChannelPreview) renders them on the client with handlers attached.
 * Without handlers every piece renders exactly as the static preview did.
 */
import type { CSSProperties, FormEvent, MouseEvent, ReactNode } from "react";
import type { useGT } from "gt-next";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Compass,
  Crown,
  Download,
  Gamepad2,
  Hash,
  Headphones,
  HelpCircle,
  ImagePlay,
  Inbox,
  Lock,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Mic,
  MicOff,
  Music2,
  Pin,
  Plus,
  PlusCircle,
  Search,
  Settings,
  Smile,
  Sticker,
  Users,
  Volume2,
} from "lucide-react";
import { getNameplatePreset } from "@/lib/constants/nameplates";
import { cn } from "@/lib/utils";
import { twemojiSvgUrl } from "@/lib/twemoji-helpers";
import { StatusBadge } from "@/components/user/StatusBadge";

export type Gt = ReturnType<typeof useGT>;

export function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/**
 * Sample people and servers have pictures in public/home (generated once from
 * DiceBear: "lorelei" avatars and "shapes" server icons, both CC0), served
 * from the site itself so the previews never depend on the CDN.
 */
const SAMPLE_AVATARS = new Set(["theo", "aya", "rin", "mika", "jun", "sora", "kai", "nova", "leo"]);
const SAMPLE_SERVER_ICONS = new Set(["night-owls", "pixel-club", "art-corner", "lofi-lounge"]);

export function sampleAvatar(name: string): string | null {
  const key = name.toLowerCase();
  return SAMPLE_AVATARS.has(key) ? `/home/avatars/${key}.webp` : null;
}

function sampleServerIcon(name: string): string | null {
  const key = name.toLowerCase().replace(/\s+/g, "-");
  return SAMPLE_SERVER_ICONS.has(key) ? `/home/servers/${key}.webp` : null;
}

/** ui/avatar.tsx (Avatar + AvatarImage over AvatarFallback). */
export function Av({ name, className, fallbackClassName }: { name: string; className: string; fallbackClassName?: string }) {
  const src = sampleAvatar(name);
  return (
    <span className={cn("relative isolate flex shrink-0 overflow-hidden rounded-full", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- static 128px sample avatar
        <img
          src={src}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 z-[1] block aspect-square size-full shrink-0 object-cover"
        />
      ) : null}
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent)]",
          fallbackClassName,
        )}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}


// ─── Server rail ─────────────────────────────────────────────────────────────
export function ServerRail() {
  const servers = [
    { name: "Night Owls", active: true },
    { name: "Pixel Club", unread: true },
    { name: "Art Corner", mention: 3 },
    { name: "Lofi Lounge" },
  ];
  const tile = "flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)]";
  return (
    <div className="hm-app-rail flex flex-col items-center w-[72px] h-full bg-[var(--app-bg)] py-3 gap-2 border-r border-[var(--app-border)]">
      <span className={cn("relative", tile)}>
        <MessageSquare className="w-7 h-7 text-[var(--text-secondary)]" />
      </span>
      <span className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />
      <div className="flex-1 w-full overflow-hidden py-0.5">
      <div className="flex flex-col items-center gap-2">
      {servers.map((s) => (
        <span
          key={s.name}
          className={cn(
            "relative flex items-center justify-center bg-[var(--bg-sidebar-elevated)] overflow-hidden w-12 h-12",
            s.active ? "rounded-[16px]" : "rounded-[24px]",
          )}
        >
          {sampleServerIcon(s.name) ? (
            // eslint-disable-next-line @next/next/no-img-element -- static 128px sample server icon
            <img
              src={sampleServerIcon(s.name)!}
              alt=""
              width={128}
              height={128}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="w-12 h-12 object-cover"
            />
          ) : (
            <span className="font-semibold text-[var(--text-primary)] text-lg">{s.name.charAt(0)}</span>
          )}
          {(s.active || s.unread) && (
            <span
              className={cn(
                "absolute left-0 w-1 h-10 bg-[var(--text-primary)] rounded-r-full origin-center",
                s.active ? "scale-y-100" : "scale-y-[0.2]",
              )}
            />
          )}
          {s.mention && (
            <span className="absolute bottom-0 right-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--app-accent)] border-[3px] border-[var(--app-bg)] text-[10px] font-bold text-white leading-none">
              {s.mention}
            </span>
          )}
        </span>
      ))}
      </div>
      </div>
      <span className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />
      <span className={tile}>
        <Plus className="w-6 h-6 text-[var(--app-accent)]" />
      </span>
      <span className={tile}>
        <Compass className="w-6 h-6 text-[var(--app-accent)]" />
      </span>
      <span className={tile}>
        <Download className="w-6 h-6 text-[var(--app-accent)]" />
      </span>
    </div>
  );
}

// ─── Channel list ────────────────────────────────────────────────────────────
function ChannelRow({
  icon: Icon,
  name,
  active,
  unread,
  onClick,
}: {
  icon: typeof Hash;
  name: string;
  active?: boolean;
  unread?: boolean;
  onClick?: () => void;
}) {
  const Row = onClick ? "button" : "div";
  return (
    <div className="relative">
      {unread && <div className="hm-unread-pill absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)] z-20" />}
      <Row
        {...(onClick ? { type: "button" as const, onClick, tabIndex: -1 } : {})}
        className={cn(
          "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] min-w-0 overflow-hidden",
          onClick && "cursor-pointer text-left transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          active && "bg-[var(--bg-active)] text-[var(--app-accent)] hover:bg-[var(--bg-active)] hover:text-[var(--app-accent)]",
          !active && unread && "text-[var(--text-primary)] font-semibold",
        )}
        style={{ width: "calc(100% - 16px)" }}
      >
        <span className="flex-shrink-0">
          <Icon className="w-5 h-5 text-[var(--text-muted)]" />
        </span>
        <span className="truncate text-sm flex-1 text-left min-w-0">{name}</span>
      </Row>
    </div>
  );
}

function Category({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="mb-4 rounded">
      <div className="px-2 mb-1 relative">
        <div className="w-full px-1 flex items-center justify-between">
          <div className="flex items-center gap-0.5 min-w-0">
            <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0 rotate-90" />
            <span className="text-xs font-bold uppercase text-[var(--text-muted)] truncate min-w-0">{name}</span>
          </div>
        </div>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/** User panel at the bottom of the channel list, with a nameplate. */
export function UserPanel({ name, nameplate }: { name: string; nameplate?: string }) {
  const bg = nameplate ? getNameplatePreset(nameplate)?.css : null;
  return (
    <div className="relative overflow-hidden h-[52px] px-2 flex items-center bg-[var(--bg-sidebar)] border-t border-[var(--border-subtle)]">
      {bg && (
        <span
          className="absolute inset-0 pointer-events-none"
          style={{
            background: bg,
            opacity: 0.55,
            WebkitMaskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
            maskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
          }}
        />
      )}
      <div className="relative z-10 flex items-center gap-2 flex-1 min-w-0 p-1 rounded">
        <div className="relative shrink-0">
          <Av name={name} className="w-8 h-8" fallbackClassName="text-sm" />
          <StatusBadge status="online" size={10} ring={3} ringColor="var(--bg-sidebar-solid)" corner decorative />
        </div>
        <div className="relative flex-1 min-w-0 text-left">
          <div className="text-sm font-bold truncate text-[var(--text-primary)]">{name}</div>
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-0.5">
        <span className="p-1.5 rounded text-[var(--text-secondary)]"><Mic className="w-5 h-5" /></span>
        <span className="p-1.5 rounded text-[var(--text-secondary)]"><Headphones className="w-5 h-5" /></span>
        <span className="p-1.5 rounded text-[var(--text-secondary)]"><Settings className="w-5 h-5" /></span>
      </div>
    </div>
  );
}

export type PreviewChannel = "rules" | "announcements" | "general" | "clips" | "help-desk";

export function ChannelList({
  gt,
  active = "general",
  unread = { clips: true },
  onSelect,
}: {
  gt: Gt;
  active?: PreviewChannel;
  unread?: Partial<Record<PreviewChannel, boolean>>;
  onSelect?: (channel: PreviewChannel) => void;
}) {
  const row = (key: PreviewChannel, icon: typeof Hash, name: string, selectable = true) => (
    <ChannelRow
      icon={icon}
      name={name}
      active={active === key}
      unread={active !== key && !!unread[key]}
      onClick={onSelect && selectable ? () => onSelect(key) : undefined}
    />
  );
  const voice = [
    { name: "Mika" },
    { name: "Aya" },
    { name: "Jun", muted: true },
  ];
  return (
    <div className="hm-app-side flex flex-col w-64 h-full min-h-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
      <div className="relative flex items-center justify-between border-b border-[var(--border-subtle)] shrink-0 h-12 px-4">
        <span className="font-semibold truncate text-[var(--text-primary)]">Night Owls</span>
        <ChevronDown className="relative w-5 h-5 shrink-0 text-[var(--text-primary)]" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="py-3">
          <div className="mb-4 min-h-[8px] rounded" />
          <Category name={gt("Information")}>
            {row("rules", Hash, gt("rules"))}
            {row("announcements", Megaphone, gt("announcements"))}
          </Category>
          <Category name={gt("Text channels")}>
            {row("general", Hash, gt("general"))}
            {row("clips", Hash, gt("clips"))}
            {/* A forum: the app opens a post list there, which the preview doesn't draw. */}
            {row("help-desk", MessagesSquare, gt("help-desk"), false)}
          </Category>
          <Category name={gt("Voice channels")}>
            <div className="mb-0.5 relative">
              <div
                className="w-full px-2 py-1 mx-2 rounded flex items-center gap-1.5 min-w-0 overflow-hidden text-[var(--text-muted)]"
                style={{ width: "calc(100% - 16px)" }}
              >
                <Volume2 className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
                <span className="truncate text-sm flex-1 text-left min-w-0">{gt("Lounge")}</span>
              </div>
              <div className="ml-6 mr-2 space-y-0.5 mb-1">
                {voice.map((p) => (
                  <div key={p.name} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded">
                    <span className="shrink-0 rounded-full">
                      <Av name={p.name} className="w-5 h-5" fallbackClassName="text-[9px]" />
                    </span>
                    <span className="text-xs truncate flex-1 text-[var(--text-secondary)]">
                      {p.name}
                    </span>
                    {p.muted && <MicOff className="w-3 h-3 shrink-0 text-[var(--text-muted)]" />}
                  </div>
                ))}
              </div>
            </div>
          </Category>
        </div>
      </div>
      <UserPanel name="Sora" nameplate="grape" />
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────────────────────
export function MessageRow({
  name,
  time,
  nameColor,
  owner,
  i = 0,
  live,
  fresh,
  children,
}: {
  name: string;
  time: string;
  nameColor?: string;
  owner?: boolean;
  /** Intro order: the static hero plays its messages in one by one. */
  i?: number;
  /** Arrived after the intro: slides in at once instead of on the intro clock. */
  live?: boolean;
  /** Just arrived: a soft highlight that fades out. */
  fresh?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn(live ? "hm-live-in" : "hm-arrive", "chat-message-row group py-0.5")} style={live ? undefined : stagger(i)}>
      <div className={cn("flex gap-4 relative rounded -mx-1 px-1", fresh && "hm-fresh")}>
        <div className="w-10 flex-shrink-0">
          <Av name={name} className="w-10 h-10 mt-0.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="!text-[0.8rem] font-medium leading-tight whitespace-nowrap rounded flex items-center gap-1 text-[var(--text-primary)]"
              style={nameColor ? { color: nameColor } : undefined}
            >
              <span>{name}</span>
              {owner && <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />}
            </span>
            <span className="text-[10px] leading-none text-[var(--text-muted)] whitespace-nowrap">{time}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Body({ children, e2ee, gt }: { children: ReactNode; e2ee?: boolean; gt?: Gt }) {
  return (
    <div>
      <span className="twemoji whitespace-pre-wrap break-words chat-message-body text-[var(--app-text)]">{children}</span>
      {e2ee && gt && (
        <span className="inline-flex items-center ml-1 align-middle text-[var(--app-muted)] opacity-60" title={gt("End-to-end encrypted")}>
          <Lock className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}

export interface PreviewReaction {
  emoji: string;
  count: number;
  mine?: boolean;
  /** Added after the intro: pops in at once. */
  fresh?: boolean;
}

export function Reactions({ items, onToggle, onAdd }: { items: PreviewReaction[]; onToggle?: (emoji: string) => void; onAdd?: (e: MouseEvent<HTMLButtonElement>) => void }) {
  if (!items.length) return null;
  const Chip = onToggle ? "button" : "span";
  return (
    <div className="flex flex-wrap gap-1 max-sm:gap-1.5 mt-1">
      {items.map((r, i) => (
        <Chip
          key={r.emoji}
          {...(onToggle ? { type: "button" as const, tabIndex: -1, onClick: () => onToggle(r.emoji) } : {})}
          className={cn(
            r.fresh ? "hm-pop-live" : "hm-pop",
            "flex items-center gap-1 px-2 py-0.5 rounded-full text-sm border",
            onToggle && "cursor-pointer transition-colors hover:border-[var(--app-accent)]",
            r.mine
              ? "bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] border-[var(--app-accent)] text-[var(--text-primary)]"
              : "bg-[var(--app-surface-alt)] border-[var(--app-border)] text-[var(--app-muted)]",
          )}
          style={r.fresh ? undefined : stagger(i * 0.4)}
        >
          <span className="twemoji inline-flex items-center text-base leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element -- Twemoji SVG, same source as the app */}
            <img className="emoji" src={twemojiSvgUrl(r.emoji)} alt={r.emoji} draggable={false} loading="lazy" />
          </span>
          <span className={r.mine ? "text-[var(--text-primary)]" : "text-[var(--app-muted)]"}>{r.count}</span>
        </Chip>
      ))}
      {onAdd ? (
        <button
          type="button"
          tabIndex={-1}
          data-pop-trigger
          onClick={onAdd}
          aria-label="+"
          className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-[var(--app-muted)] transition-colors hover:border-[var(--app-accent)] hover:text-[var(--text-primary)]"
        >
          <Plus className="w-4 h-4" />
        </button>
      ) : (
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-[var(--app-muted)]">
          <Plus className="w-4 h-4" />
        </span>
      )}
    </div>
  );
}

export function Poll({ gt, vote = 0, onVote }: { gt: Gt; vote?: number | null; onVote?: (answer: number | null) => void }) {
  // Votes without the visitor's, plus theirs.
  const base = [10, 3];
  const answers = [
    { text: gt("Yes, I'm in"), count: base[0] + (vote === 0 ? 1 : 0), mine: vote === 0 },
    { text: gt("Make it 10"), count: base[1] + (vote === 1 ? 1 : 0), mine: vote === 1 },
  ];
  const total = answers[0].count + answers[1].count;
  const Answer = onVote ? "button" : "div";
  return (
    <div className="mt-1 w-full max-w-[min(100%,440px)] rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] p-4">
      <div className="break-words text-base font-semibold text-[var(--text-primary)]">{gt("Game night at 9?")}</div>
      <div className="mb-3 mt-0.5 text-xs text-[var(--app-muted)]">{gt("Select one answer")}</div>
      <div className="flex flex-col gap-2">
        {answers.map((a, idx) => {
          const percent = Math.round((a.count / total) * 100);
          return (
            <Answer
              key={a.text}
              {...(onVote ? { type: "button" as const, tabIndex: -1, onClick: () => onVote(a.mine ? null : idx) } : {})}
              className={cn(
                "relative flex min-h-[44px] w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-2 text-left text-sm",
                a.mine ? "border-[var(--app-accent)]" : "border-[var(--app-border)]",
                onVote && "cursor-pointer transition-colors hover:border-[var(--app-accent)]",
              )}
            >
              <span
                className="hm-grow absolute inset-y-0 left-0 bg-[var(--app-accent)] opacity-20 transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
              <span className="relative min-w-0 flex-1 break-words font-medium text-[var(--text-primary)]">{a.text}</span>
              {a.mine && <CircleCheck className="relative h-4 w-4 flex-shrink-0 text-[var(--app-accent)]" />}
              <span className="relative flex-shrink-0 text-xs text-[var(--app-muted)]">{gt("{count} votes", { count: a.count })}</span>
              <span className="relative w-10 flex-shrink-0 text-right text-sm font-semibold text-[var(--text-primary)]">{percent}%</span>
            </Answer>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-[var(--app-muted)]">
        <span>{gt("{count} votes", { count: total })}</span>
        <span aria-hidden>·</span>
        <span>{gt("{count}h left", { count: 2 })}</span>
        {vote !== null && <span className="font-medium text-[var(--app-accent)]">{gt("Remove Vote")}</span>}
      </div>
    </div>
  );
}

export function ThreadChip({ gt, time }: { gt: Gt; time: string }) {
  return (
    <div className="mt-1.5 flex w-full max-w-[min(32rem,100%)] flex-col gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 py-2 text-left">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate font-semibold text-[var(--text-primary)]">{gt("Patch notes megathread")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[var(--app-accent)]">
          {gt("{count} Messages", { count: 12 })}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--app-muted)]">
        <Av name="Jun" className="h-4 w-4" fallbackClassName="text-[8px]" />
        <span className="shrink-0 font-medium text-[var(--text-primary)]">Jun</span>
        <span className="min-w-0 truncate">{gt("the new map is so much better")}</span>
        <span className="ml-auto shrink-0 opacity-80">{time}</span>
      </span>
    </div>
  );
}

export function Typing({ text }: { text: string | null }) {
  return (
    <div className="px-4 h-5 flex items-center overflow-hidden">
      {text && <span className="inline-flex items-center gap-2 text-xs text-[var(--app-muted)]">
        <span className="flex gap-0.5 items-center">
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
        </span>
        <span className="font-medium">{text}</span>
      </span>}
    </div>
  );
}

export function Composer({
  placeholder,
  mic = true,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string;
  mic?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}) {
  const field = "w-full min-h-[44px] py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 text-base";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <div className="px-1 sm:px-2 pb-1 sm:pb-1.5 flex-shrink-0 relative">
      <div className="bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)] overflow-hidden">
        <div className="relative flex items-center">
          <span className="absolute left-0 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10">
            <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
          </span>
          {onSubmit ? (
            <form onSubmit={submit} className="w-full">
              <input
                value={value ?? ""}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                maxLength={200}
                autoComplete="off"
                enterKeyHint="send"
                className={cn(field, "block bg-transparent text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted-2)]")}
              />
            </form>
          ) : (
            <div className={cn(field, "text-[var(--app-muted-2)] truncate")}>{placeholder}</div>
          )}
          <div className="absolute right-0 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-0 sm:gap-4 text-[var(--app-muted)]">
            <ImagePlay className="w-6 h-6 hidden sm:block" />
            <Sticker className="w-6 h-6 hidden sm:block" />
            <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
            {mic && <Mic className="w-5 sm:w-6 h-5 sm:h-6" />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatHeader({
  gt,
  name,
  icon: Icon = Hash,
  membersOpen = true,
  onToggleMembers,
}: {
  gt: Gt;
  name?: string;
  icon?: typeof Hash;
  membersOpen?: boolean;
  onToggleMembers?: () => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] flex-shrink-0">
      <div className="chat-header-main flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
        <Icon className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
        <span className="min-w-0 shrink truncate font-semibold text-[var(--text-primary)] text-sm sm:text-base">{name ?? gt("general")}</span>
      </div>
      <div className="relative flex shrink-0 items-center gap-2 sm:gap-4 pl-2 text-[var(--app-muted)]">
        <MessagesSquare className="w-5 h-5" />
        <Bell className="w-5 h-5 hidden md:block" />
        <Pin className="max-md:hidden w-5 h-5" />
        {onToggleMembers ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={onToggleMembers}
            aria-pressed={membersOpen}
            aria-label={gt("Member list")}
            className={cn("flex cursor-pointer items-center justify-center rounded-lg transition-colors hover:text-[var(--text-primary)]", membersOpen && "text-[var(--text-primary)]")}
          >
            <Users className="w-5 h-5" />
          </button>
        ) : (
          <Users className={cn("w-5 h-5", membersOpen && "text-[var(--text-primary)]")} />
        )}
        <div className="h-6 w-px bg-[var(--app-border)] hidden lg:block" />
        <div className="relative hidden lg:block">
          <div className="relative flex items-center rounded bg-[var(--app-surface-alt)] h-6 w-36">
            <span className="pl-2 pr-7 text-sm truncate text-[var(--app-muted)]">{gt("Search {server}", { server: "Night Owls" })}</span>
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)] pointer-events-none" />
          </div>
        </div>
        <span className="relative hidden shrink-0 md:inline-flex"><Inbox className="w-5 h-5" /></span>
        <span className="hidden lg:block"><HelpCircle className="w-5 h-5" /></span>
      </div>
    </div>
  );
}

// ─── Member list ─────────────────────────────────────────────────────────────
export function MemberRow({
  name,
  nameplate,
  roleColor,
  owner,
  activity,
}: {
  name: string;
  nameplate?: string;
  roleColor?: string;
  owner?: boolean;
  activity?: { kind: "game" | "music"; text: string };
}) {
  const bg = nameplate ? getNameplatePreset(nameplate)?.css : null;
  return (
    <div className="relative mt-1">
      <div
        className="relative overflow-hidden px-2 py-1.5 mx-2 rounded-lg flex items-center gap-3 bg-white/[0.02]"
        style={{ width: "calc(100% - 16px)" }}
      >
        {bg && (
          <span
            className="absolute inset-0 pointer-events-none"
            style={{ background: bg, opacity: 0.5, WebkitMaskImage: "linear-gradient(90deg, #000 60%, transparent 100%)", maskImage: "linear-gradient(90deg, #000 60%, transparent 100%)" }}
          />
        )}
        <div className="relative flex-shrink-0">
          <Av name={name} className="w-8 h-8" fallbackClassName="bg-[#8B5CF6] text-white text-xs" />
          <StatusBadge status="online" size={10} ring={3} ringColor="var(--app-bg-solid)" corner decorative />
        </div>
        <div className="relative flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)]" style={roleColor ? { color: roleColor } : undefined}>
            <span className="truncate">{name}</span>
            {owner && <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />}
          </div>
          {activity && (
            <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] min-w-0">
              {activity.kind === "game" ? <Gamepad2 className="w-2.5 h-2.5 shrink-0" /> : <Music2 className="w-2.5 h-2.5 shrink-0 fill-current" />}
              <span className="truncate min-w-0">{activity.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MemberHeader({ label, count, first }: { label: string; count: number; first?: boolean }) {
  return (
    <p className={cn("px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]", !first && "mt-4")}>
      {label} — {count}
    </p>
  );
}

export function MemberList({ gt }: { gt: Gt }) {
  return (
    <div className="hm-app-members w-56 shrink-0 h-full bg-[var(--app-bg)] border-l border-[var(--app-border)] overflow-hidden">
      <div className="py-4">
        <MemberHeader label={gt("Moderators")} count={1} first />
        <MemberRow name="Theo" roleColor="#3BA55C" owner nameplate="ocean" activity={{ kind: "game", text: "Minecraft" }} />
        <MemberHeader label={gt("Online")} count={4} />
        <MemberRow name="Aya" nameplate="sakura" />
        <MemberRow name="Rin" activity={{ kind: "music", text: "Lo-fi Beats — Chillhop" }} />
        <MemberRow name="Mika" />
        <MemberRow name="Jun" />
      </div>
    </div>
  );
}

