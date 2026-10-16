/**
 * Static, server-rendered previews of the real SerikaCord UI for the homepage.
 *
 * Every piece copies the markup and Tailwind classes of the component it
 * shows, with the app's own theme tokens, so the previews look exactly like
 * the app in the visitor's theme. When those components change, update the
 * matching block here:
 *   ServerRail       ← src/components/layout/ServerSidebar.tsx
 *   ChannelList      ← src/components/layout/ChannelSidebar.tsx (+ voice/VoiceChannelMembers.tsx, user panel)
 *   ChatHeader       ← src/components/chat/ChatArea.tsx (header) + chat/search/MessageSearchBar.tsx
 *   MessageRow       ← src/components/chat/MessageGroup.tsx + MessageGroupHeader.tsx
 *   Reactions        ← src/components/chat/MessageReactions.tsx
 *   Poll             ← src/components/chat/PollCard.tsx (results view)
 *   ThreadChip       ← src/components/chat/ThreadRows.tsx
 *   Typing           ← src/components/chat/TypingIndicator.tsx
 *   Composer         ← src/components/chat/MessageBar.tsx + RichComposer.tsx
 *   MemberRow        ← src/components/chat/MemberSidebar.tsx (MemberItem)
 *   DmPreview        ← src/app/dm/[recipientId]/page.tsx (header) + e2ee/E2eeConversationLock.tsx (popover)
 *   PinDialogPreview ← e2ee/E2eePinDialog.tsx + PinFlows.tsx (unlock) + PinInput.tsx
 *   CallPreview      ← voice/CallStage.tsx (spotlight + strip) + channels/[serverId]/[channelId]/page.tsx (dock)
 * Names, messages and servers are examples; nothing here is interactive.
 */
import type { CSSProperties, ReactNode } from "react";
import { getGT, getLocale } from "gt-next/server";
import {
  ArrowLeft,
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
  ImagePlay,
  Lock,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Mic,
  MicOff,
  Monitor,
  Music,
  Music2,
  Phone,
  PhoneOff,
  Pin,
  Plus,
  PlusCircle,
  ScreenShare,
  Search,
  Settings,
  ShieldCheck,
  Smile,
  Sparkles,
  UserPlus,
  Users,
  Video,
  Volume2,
} from "lucide-react";
import { getNameplatePreset } from "@/lib/constants/nameplates";
import { cn } from "@/lib/utils";

type Gt = Awaited<ReturnType<typeof getGT>>;

const ONLINE = "#23A559";

function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/** ui/avatar.tsx (Avatar + AvatarFallback), no image. */
function Av({ name, className, fallbackClassName }: { name: string; className: string; fallbackClassName?: string }) {
  return (
    <span className={cn("relative flex shrink-0 overflow-hidden rounded-full", className)}>
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

/** "Today at 9:41 PM" in the visitor's language (formatMessageTimestamp). */
async function clock() {
  const [gt, locale] = await Promise.all([getGT(), getLocale()]);
  const time = (h: number, m: number) => {
    const d = new Date(Date.UTC(2026, 0, 1, h, m));
    try {
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    } catch {
      return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    }
  };
  return { gt, time, today: (h: number, m: number) => gt("Today at {time}", { time: time(h, m) }) };
}

// ─── Server rail ─────────────────────────────────────────────────────────────
function ServerRail() {
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
      {servers.map((s) => (
        <span
          key={s.name}
          className={cn(
            "relative flex items-center justify-center bg-[var(--bg-sidebar-elevated)] overflow-hidden w-12 h-12",
            s.active ? "rounded-[16px]" : "rounded-[24px]",
          )}
        >
          <span className="font-semibold text-[var(--text-primary)] text-lg">{s.name.charAt(0)}</span>
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
function ChannelRow({ icon: Icon, name, active, unread }: { icon: typeof Hash; name: string; active?: boolean; unread?: boolean }) {
  return (
    <div className="relative">
      {unread && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)] z-20" />}
      <div
        className={cn(
          "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-[var(--text-muted)] min-w-0 overflow-hidden",
          active && "bg-[var(--bg-active)] text-[var(--app-accent)]",
          !active && unread && "text-[var(--text-primary)] font-semibold",
        )}
        style={{ width: "calc(100% - 16px)" }}
      >
        <span className="flex-shrink-0">
          <Icon className="w-5 h-5 text-[var(--text-muted)]" />
        </span>
        <span className="truncate text-sm flex-1 text-left min-w-0">{name}</span>
      </div>
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
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-[var(--bg-sidebar)]" style={{ background: ONLINE }} />
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

function ChannelList({ gt }: { gt: Gt }) {
  const voice = [
    { name: "Mika", speaking: true },
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
          <Category name={gt("Information")}>
            <ChannelRow icon={Hash} name={gt("rules")} />
            <ChannelRow icon={Megaphone} name={gt("announcements")} />
          </Category>
          <Category name={gt("Text channels")}>
            <ChannelRow icon={Hash} name={gt("general")} active />
            <ChannelRow icon={Hash} name={gt("clips")} unread />
            <ChannelRow icon={MessagesSquare} name={gt("help-desk")} />
          </Category>
          <Category name={gt("Voice channels")}>
            <div className="mb-0.5 relative">
              <div
                className="w-full px-2 py-1 mx-2 rounded flex items-center gap-1.5 min-w-0 overflow-hidden text-[var(--text-muted)]"
                style={{ width: "calc(100% - 16px)" }}
              >
                <Volume2 className="w-4 h-4 flex-shrink-0 text-[var(--text-muted)]" />
                <span className="truncate text-sm flex-1 text-left min-w-0">{gt("Lounge")}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500/60" />
                  <span className="text-[10px] text-green-400/70">{voice.length}</span>
                </span>
              </div>
              <div className="ml-6 mr-2 space-y-0.5 mb-1">
                {voice.map((p) => (
                  <div key={p.name} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded">
                    <span
                      className={cn(
                        "shrink-0 rounded-full",
                        p.speaking && "ring-2 ring-[#23a55a] ring-offset-1 ring-offset-[var(--bg-sidebar)]",
                      )}
                    >
                      <Av name={p.name} className="w-5 h-5" fallbackClassName="text-[9px]" />
                    </span>
                    <span className={cn("text-xs truncate flex-1", p.speaking ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
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
function MessageRow({
  name,
  time,
  nameColor,
  owner,
  i,
  children,
}: {
  name: string;
  time: string;
  nameColor?: string;
  owner?: boolean;
  i: number;
  children: ReactNode;
}) {
  return (
    <div className="hm-arrive chat-message-row group py-0.5" style={stagger(i)}>
      <div className="flex gap-4 relative rounded -mx-1 px-1">
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

function Body({ children, e2ee, gt }: { children: ReactNode; e2ee?: boolean; gt?: Gt }) {
  return (
    <div className="chat-message-body text-[var(--app-text)]">
      {children}
      {e2ee && gt && (
        <span className="inline-flex items-center ml-1 align-middle text-[var(--app-muted)] opacity-60" title={gt("End-to-end encrypted")}>
          <Lock className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}

function Reactions({ items }: { items: { emoji: string; count: number; mine?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((r, i) => (
        <span
          key={r.emoji}
          className={cn(
            "hm-pop flex items-center gap-1 px-2 py-0.5 rounded-full text-sm border",
            r.mine
              ? "bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] border-[var(--app-accent)] text-[var(--text-primary)]"
              : "bg-[var(--app-surface-alt)] border-[var(--app-border)] text-[var(--app-muted)]",
          )}
          style={stagger(i * 0.4)}
        >
          <span className="leading-none">{r.emoji}</span>
          <span className={r.mine ? "text-[var(--text-primary)]" : "text-[var(--app-muted)]"}>{r.count}</span>
        </span>
      ))}
    </div>
  );
}

function Poll({ gt }: { gt: Gt }) {
  const answers = [
    { text: gt("Yes, I'm in"), count: 11, mine: true },
    { text: gt("Make it 10"), count: 3, mine: false },
  ];
  const total = 14;
  return (
    <div className="mt-1 w-full max-w-[min(100%,440px)] rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] p-4">
      <div className="break-words text-base font-semibold text-[var(--text-primary)]">{gt("Game night at 9?")}</div>
      <div className="mb-3 mt-0.5 text-xs text-[var(--app-muted)]">{gt("Select one answer")}</div>
      <div className="flex flex-col gap-2">
        {answers.map((a) => {
          const percent = Math.round((a.count / total) * 100);
          return (
            <div
              key={a.text}
              className={cn(
                "relative flex min-h-[44px] w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-2 text-left text-sm",
                a.mine ? "border-[var(--app-accent)]" : "border-[var(--app-border)]",
              )}
            >
              <span className="hm-grow absolute inset-y-0 left-0 bg-[var(--app-accent)] opacity-20" style={{ width: `${percent}%` }} />
              <span className="relative min-w-0 flex-1 break-words font-medium text-[var(--text-primary)]">{a.text}</span>
              {a.mine && <CircleCheck className="relative h-4 w-4 flex-shrink-0 text-[var(--app-accent)]" />}
              <span className="relative flex-shrink-0 text-xs text-[var(--app-muted)]">{gt("{count} votes", { count: a.count })}</span>
              <span className="relative w-10 flex-shrink-0 text-right text-sm font-semibold text-[var(--text-primary)]">{percent}%</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-[var(--app-muted)]">
        <span>{gt("{count} votes", { count: total })}</span>
        <span aria-hidden>·</span>
        <span>{gt("{count}h left", { count: 2 })}</span>
        <span className="font-medium text-[var(--app-accent)]">{gt("Remove Vote")}</span>
      </div>
    </div>
  );
}

function ThreadChip({ gt, time }: { gt: Gt; time: string }) {
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

function Typing({ text }: { text: string }) {
  return (
    <div className="px-4 h-5 flex items-center overflow-hidden">
      <span className="inline-flex items-center gap-2 text-xs text-[var(--app-muted)]">
        <span className="flex gap-0.5 items-center">
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
        </span>
        <span className="font-medium">{text}</span>
      </span>
    </div>
  );
}

function Composer({ placeholder, gif = true }: { placeholder: string; gif?: boolean }) {
  return (
    <div className="px-1 sm:px-2 pb-1 sm:pb-1.5 flex-shrink-0 relative">
      <div className="bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)] overflow-hidden">
        <div className="relative flex items-center">
          <span className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10">
            <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
          </span>
          <div className="w-full min-h-[44px] py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-36 text-sm sm:text-base text-[var(--app-muted-2)] truncate">
            {placeholder}
          </div>
          <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
            {gif && <ImagePlay className="w-6 h-6 hidden sm:block" />}
            <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatHeader({ gt }: { gt: Gt }) {
  return (
    <div className="h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
        <span className="font-semibold text-[var(--text-primary)] truncate text-sm sm:text-base">{gt("general")}</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 text-[var(--app-muted)]">
        <MessagesSquare className="w-5 h-5" />
        <Bell className="w-5 h-5 hidden sm:block" />
        <Pin className="w-5 h-5" />
        <Users className="w-5 h-5" />
        <div className="h-6 w-px bg-[var(--app-border)] hidden md:block" />
        <div className="relative hidden md:block">
          <div className="relative flex items-center rounded bg-[var(--app-surface-alt)] h-6 w-36">
            <span className="pl-2 pr-7 text-sm truncate text-[var(--app-muted)]">{gt("Search {server}", { server: "Night Owls" })}</span>
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)] pointer-events-none" />
          </div>
        </div>
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
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-[2.5px] border-[var(--app-bg)]" style={{ background: ONLINE }} />
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

function MemberHeader({ label, count, first }: { label: string; count: number; first?: boolean }) {
  return (
    <p className={cn("px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]", !first && "mt-4")}>
      {label} — {count}
    </p>
  );
}

function MemberList({ gt }: { gt: Gt }) {
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

/** The hero: a server's text channel, as the app draws it. */
export async function ChannelPreview() {
  const { gt, time, today } = await clock();
  return (
    <figure
      className="hm-frame m-0"
      role="img"
      aria-label={gt("Preview of the SerikaCord app: a server with text and voice channels, a chat with reactions, a poll and a thread, and friends talking in a voice channel")}
    >
      <div className="hm-app" aria-hidden="true">
        <ServerRail />
        <ChannelList gt={gt} />
        <div className="chat-shell flex-1 flex flex-col bg-[var(--app-bg)] min-w-0 min-h-0 overflow-hidden">
          <ChatHeader gt={gt} />
          <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden py-2">
            <MessageRow name="Rin" time={today(21, 32)} i={0}>
              <Body>{gt("anyone up for a match tonight?")}</Body>
              <Reactions items={[{ emoji: "🙋", count: 4, mine: true }, { emoji: "🔥", count: 2 }]} />
            </MessageRow>
            <MessageRow name="Theo" time={today(21, 34)} nameColor="#3BA55C" owner i={1}>
              <Body>{gt("after dinner. poll so we can pick a time")}</Body>
              <Poll gt={gt} />
            </MessageRow>
            <MessageRow name="Aya" time={today(21, 38)} i={2}>
              <Body>{gt("the patch notes thread is something else")}</Body>
              <ThreadChip gt={gt} time={time(21, 40)} />
            </MessageRow>
            <MessageRow name="Mika" time={today(21, 41)} i={3}>
              <Body>{gt("hopping in Lounge, come hang")}</Body>
            </MessageRow>
          </div>
          <Typing text={gt("{user} is typing...", { user: "Jun" })} />
          <Composer placeholder={`${gt("Message")} #${gt("general")}`} />
        </div>
        <MemberList gt={gt} />
      </div>
    </figure>
  );
}

// ─── Encrypted DM ────────────────────────────────────────────────────────────
export async function DmPreview() {
  const { gt, today } = await clock();
  return (
    <div className="hm-frame m-0" aria-hidden="true">
      <div className="chat-shell flex flex-col bg-[var(--bg-app)] overflow-hidden">
        <div className="relative h-14 sm:h-16 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="p-2 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-[var(--text-secondary)]" />
            </span>
            <div className="relative flex-shrink-0">
              <Av name="Aya" className="w-8 h-8" fallbackClassName="text-sm" />
              <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[var(--bg-app)]" style={{ backgroundColor: ONLINE }} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[var(--text-primary)] truncate self-center">Aya</span>
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--bg-hover)] text-[var(--text-primary)]">
                <Lock className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-2 text-[var(--text-secondary)]">
            <span className="p-2"><Phone className="w-5 h-5" /></span>
            <span className="p-2 hidden sm:block"><Video className="w-5 h-5" /></span>
            <span className="p-2"><UserPlus className="w-5 h-5" /></span>
            <span className="p-2"><Pin className="w-5 h-5" /></span>
          </div>

          {/* E2eeConversationLock popover, open */}
          <div className="absolute left-3 top-[calc(100%-6px)] z-10 w-80 max-w-[calc(100%-24px)] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-[var(--text-primary)] shadow-md sm:left-24">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4 shrink-0 text-green-500" />
              {gt("Messages and calls are end-to-end encrypted.")}
            </p>
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-xs text-[var(--text-secondary)]">
                {gt("Only the people in this conversation can read its messages and join its calls. Not even SerikaCord can.")}
              </p>
              <ul className="flex flex-col gap-1">
                <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                  <span className="truncate text-[var(--text-primary)]">Aya</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-[var(--app-accent)]">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {gt("Verify safety number")}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-end pt-[210px] pb-2">
          <MessageRow name="Aya" time={today(20, 12)} i={0}>
            <Body e2ee gt={gt}>{gt("sent you the birthday plan, don't tell Rin")}</Body>
          </MessageRow>
          <MessageRow name="Sora" time={today(20, 14)} i={1}>
            <Body e2ee gt={gt}>{gt("my lips are sealed. so is this chat")}</Body>
          </MessageRow>
        </div>
        <Composer placeholder={`${gt("Message")} @Aya`} gif={false} />
      </div>
    </div>
  );
}

/** The PIN unlock dialog (E2eePinDialog → PinUnlock → PinInput). */
export async function PinDialogPreview() {
  const gt = await getGT();
  const link = "text-sm font-medium text-[var(--app-accent)]";
  return (
    <div className="grid w-full gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 text-[var(--text-primary)] shadow-lg" aria-hidden="true">
      <div className="flex flex-col gap-4">
        <div className="space-y-1 text-center">
          <div className="text-lg font-semibold">{gt("Enter your PIN")}</div>
          <p className="text-sm text-[var(--text-secondary)]">{gt("Enter the 6-digit PIN you created to read your encrypted messages on this device.")}</p>
        </div>
        <div className="relative mx-auto flex w-fit justify-center gap-2 sm:gap-3" dir="ltr">
          {[0, 1, 2, 3, 4, 5].map((n) => {
            const filled = n < 4;
            const active = n === 4;
            return (
              <div
                key={n}
                className={cn(
                  "flex h-12 w-10 items-center justify-center rounded-lg border bg-[var(--app-surface-alt)] sm:h-14 sm:w-12",
                  active ? "border-[var(--app-accent)] ring-2 ring-[var(--app-accent)]/30" : filled ? "border-[var(--app-accent)]/50" : "border-[var(--app-border)]",
                )}
              >
                {filled ? (
                  <span className="h-3 w-3 rounded-full bg-[var(--app-text)]" />
                ) : active ? (
                  <span className="hm-caret h-6 w-0.5 rounded-full bg-[var(--app-accent)]" />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col items-center gap-2 pt-1">
          <span className={link}>{gt("Use another device instead")}</span>
          <span className={link}>{gt("Use recovery passphrase")}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Voice channel call ──────────────────────────────────────────────────────
export async function CallPreview() {
  const gt = await getGT();
  const dockBtn = "flex items-center justify-center rounded-full w-10 h-10";
  const idle = "bg-[var(--app-border)] text-[var(--app-muted)]";
  return (
    <div className="hm-frame m-0" aria-hidden="true">
      <div className="flex flex-col bg-[var(--bg-app)] min-w-0 overflow-hidden">
        <div className="h-12 px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--bg-app)]">
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 className="w-5 h-5 text-[#8B5CF6] flex-shrink-0" />
            <span className="font-semibold text-[var(--text-primary)] truncate">{gt("Lounge")}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--app-surface-alt)] text-xs text-[var(--app-muted)] ring-1 ring-white/5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />4 {gt("participants")}
          </div>
        </div>

        {/* CallStage, spotlight on a screen share with the others in the strip */}
        <div className="flex min-h-0 flex-col p-3 sm:p-4">
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="group relative aspect-video w-full overflow-hidden rounded-xl bg-[var(--bg-card)]">
              {/* The shared screen: someone's game. */}
              <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #0f172a 60%, #020617 100%)" }} />
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
                <circle cx="248" cy="46" r="18" fill="#c4b5fd" opacity="0.6" />
                <path d="M0 136 L60 96 L110 122 L170 80 L230 118 L280 92 L320 110 L320 180 L0 180 Z" fill="#312e81" />
                <path d="M0 156 L80 128 L150 148 L220 122 L320 144 L320 180 L0 180 Z" fill="#1e1b4b" />
                <rect x="140" y="126" width="10" height="16" rx="2" fill="#a78bfa" />
              </svg>
              <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white sm:bottom-2 sm:left-2 sm:text-xs">
                <Monitor className="h-3 w-3 shrink-0" />
                <span className="truncate">{gt("{name}'s screen", { name: "Theo" })}</span>
              </div>
            </div>
            {/* Phones: the screen share alone keeps the frame short. */}
            <div className="hidden shrink-0 gap-2 overflow-hidden pb-1 sm:flex">
              {[
                { name: "Mika", speaking: true },
                { name: "Aya" },
                { name: "Jun", muted: true },
              ].map((t) => (
                <div
                  key={t.name}
                  className={cn(
                    "group relative overflow-hidden rounded-xl bg-[var(--bg-card)] aspect-video h-24 shrink-0 sm:h-28",
                    t.speaking && "ring-2 ring-[#23a55a] ring-offset-0 shadow-[0_0_14px_rgba(35,165,90,0.35)]",
                  )}
                >
                  <div className="flex h-full w-full items-center justify-center bg-[var(--bg-sidebar-elevated)]">
                    <div className={cn("rounded-full", t.speaking && "ring-[3px] ring-[#23a55a] ring-offset-2 ring-offset-[var(--bg-sidebar-elevated)]")}>
                      <Av name={t.name} className="h-10 w-10" fallbackClassName="text-lg font-semibold" />
                    </div>
                  </div>
                  <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white sm:bottom-2 sm:left-2 sm:text-xs">
                    <span className="truncate">{t.name}</span>
                    {t.muted && <MicOff className="h-3 w-3 shrink-0 text-white/80" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Call controls dock */}
        <div className="bg-transparent px-3 sm:px-4 pb-3 sm:pb-5 pt-1">
          <div className="mx-auto w-fit flex items-center justify-center gap-1 sm:gap-1.5 rounded-2xl bg-[var(--app-surface-alt)]/90 px-2 py-1.5 sm:px-2.5 sm:py-2 shadow-[0_8px_30px_rgba(0,0,0,0.4)] ring-1 ring-white/5">
            <span className={cn(dockBtn, idle)}><Mic className="w-5 h-5" /></span>
            <span className={cn(dockBtn, idle)}><Headphones className="w-5 h-5" /></span>
            <span className={cn(dockBtn, idle)}><Video className="w-5 h-5" /></span>
            <span className={cn(dockBtn, "bg-[#8B5CF6]/20 text-[#8B5CF6]")}><Sparkles className="w-5 h-5" /></span>
            <span className={cn(dockBtn, idle)}><ScreenShare className="w-5 h-5" /></span>
            {/* Phones: one button fewer so the dock fits a 375px screen. */}
            <span className={cn(dockBtn, idle, "max-sm:hidden")}><Music className="w-5 h-5" /></span>
            <span className="w-px h-6 bg-white/10 mx-1" />
            <span className="flex items-center justify-center rounded-full bg-[#ef4444] text-white shadow-[0_2px_10px_rgba(239,68,68,0.4)] w-12 h-10">
              <PhoneOff className="w-5 h-5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
