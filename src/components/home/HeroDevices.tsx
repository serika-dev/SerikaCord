import type { CSSProperties, ReactNode } from "react";
import { getGT } from "gt-next/server";
import { ArrowDown, ChevronLeft, Headphones, Mic, Monitor, PhoneOff, ScreenShare, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { Av, ChannelList, ChatHeader, Composer, MemberHeader, MemberRow, Reactions, ServerRail } from "./preview/parts";
import { SHOTS } from "./live/model";
import { IosStatus } from "./IosStatus";

/**
 * The hero's computer and phone. Both screens are the real app UI (the same
 * pieces as the playable preview, see preview/parts.tsx) drawn at a real
 * desktop / phone size and scaled down to fit with CSS only (.hm-fit), so
 * nothing moves when the page loads. The computer opens the playable app
 * below the hero; the phone jumps to the voice section.
 */

type Gt = Awaited<ReturnType<typeof getGT>>;

/** A screen drawn at `w`×`h` CSS pixels and scaled to the box's width. */
export function Fit({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div className="hm-fit" style={{ aspectRatio: `${w} / ${h}`, "--fit-w": `${w}px` } as CSSProperties}>
      <div className="hm-fit-inner" style={{ width: w, height: h }}>
        {children}
      </div>
    </div>
  );
}

/** A chat message with an attachment and a reply, as MessageGroup draws them. */
function Message({
  name,
  time,
  color,
  reply,
  image,
  reactions,
  children,
}: {
  name: string;
  time: string;
  color?: string;
  reply?: { name: string; text: string };
  image?: string;
  reactions?: { emoji: string; count: number; mine?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="chat-message-row py-1">
      {reply && (
        <div className="mb-1 ml-[52px] flex min-w-0 items-center gap-1.5 text-xs text-[var(--app-muted)]">
          <span className="h-2.5 w-6 shrink-0 rounded-tl-md border-l-2 border-t-2 border-[var(--app-border)]" />
          <Av name={reply.name} className="h-4 w-4" fallbackClassName="text-[8px]" />
          <span className="shrink-0 font-medium text-[var(--text-primary)]">{reply.name}</span>
          <span className="truncate">{reply.text}</span>
        </div>
      )}
      <div className="flex gap-4">
        <Av name={name} className="mt-0.5 h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="!text-[0.8rem] font-medium leading-tight text-[var(--text-primary)]" style={color ? { color } : undefined}>
              {name}
            </span>
            <span className="text-[10px] leading-none text-[var(--text-muted)]">{time}</span>
          </div>
          <span className="twemoji chat-message-body break-words text-[var(--app-text)]">{children}</span>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element -- static sample screenshot
            <img src={image} alt="" width={1280} height={720} loading="lazy" className="mt-1 block max-h-[200px] w-auto max-w-[360px] rounded-lg object-cover" />
          )}
          {reactions && <Reactions items={reactions} />}
        </div>
      </div>
    </div>
  );
}

/** The desktop app on #clips: server rail, channels, chat, members. */
export function DesktopScreen({ gt, today }: { gt: Gt; today: (h: number, m: number) => string }) {
  const octopath = gt("Octopath Traveler at night, look at this snowy cliff 😍");
  const coaster = gt("finally finished my Planet Coaster forest ride 🎢");
  return (
    <div className="flex h-full bg-[var(--app-bg)] text-[var(--text-primary)]">
      <ServerRail />
      <ChannelList gt={gt} active="clips" unread={{ general: true }} />
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--app-surface)]">
        <ChatHeader gt={gt} name={gt("clips")} />
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-4 pb-3">
          <Message name="Jun" time={today(20, 48)} image={SHOTS.snowyCliff} reactions={[{ emoji: "🔥", count: 5 }, { emoji: "😍", count: 2, mine: true }]}>
            {octopath}
          </Message>
          <Message name="Rin" time={today(20, 51)} reply={{ name: "Jun", text: octopath }}>
            {gt("how is that pixel art?? the light rays 😭")}
          </Message>
          <Message name="Mika" time={today(21, 5)} image={SHOTS.coaster} reactions={[{ emoji: "🎢", count: 3 }]}>
            {coaster}
          </Message>
          <Message name="Theo" time={today(21, 12)} color="#3BA55C" reply={{ name: "Mika", text: coaster }}>
            {gt("the track diving through the trees is genius")}
          </Message>
        </div>
        <Composer placeholder={`${gt("Message")} #${gt("clips")}`} />
      </div>
      <div className="hm-app-members w-56 shrink-0 overflow-hidden border-l border-[var(--app-border)] bg-[var(--app-bg)]">
        <div className="py-4">
          <MemberHeader label={gt("Moderators")} count={1} first />
          <MemberRow name="Theo" roleColor="#3BA55C" owner nameplate="ocean" activity={{ kind: "game", text: "Final Fantasy XVI" }} />
          <MemberHeader label={gt("Online")} count={5} />
          <MemberRow name="Aya" nameplate="sakura" activity={{ kind: "game", text: "Octopath Traveler" }} />
          <MemberRow name="Mika" nameplate="mint" activity={{ kind: "game", text: "Planet Coaster" }} />
          <MemberRow name="Rin" nameplate="aurora" activity={{ kind: "music", text: "Lo-fi Beats — Chillhop" }} />
          <MemberRow name="Jun" nameplate="ember" />
          <MemberRow name="Kai" roleColor="#f59e0b" />
        </div>
      </div>
    </div>
  );
}

/** The phone app in the Lounge voice channel: a screen share and three people. */
function PhoneScreen({ gt, clock }: { gt: Gt; clock: string }) {
  const person = (name: string, talking?: boolean, muted?: boolean) => (
    <div
      key={name}
      className={cn(
        "relative aspect-square overflow-hidden rounded-2xl bg-[var(--bg-sidebar-elevated)] ring-1 ring-white/[0.06]",
        talking && "ring-2 ring-[#23a55a] shadow-[0_0_18px_rgba(35,165,90,0.35)]",
      )}
    >
      <Av name={name} className="absolute inset-0 h-full w-full scale-125 rounded-none opacity-35 blur-2xl" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Av name={name} className={cn("h-14 w-14 shadow-lg", talking && "ring-[3px] ring-[#23a55a] ring-offset-2 ring-offset-[var(--bg-sidebar-elevated)]")} />
      </div>
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-lg bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
        {name}
        {muted && <Mic className="h-3 w-3 text-white/70" />}
      </span>
    </div>
  );
  const dock = "flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-surface-alt)] text-[var(--app-muted)]";
  return (
    <div className="flex h-full flex-col bg-[var(--bg-app)] text-[var(--app-text)]">
      <IosStatus time={clock} className="h-12 px-4 text-[15px]" />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
        <ChevronLeft className="h-6 w-6 text-[var(--app-muted)]" />
        <span className="min-w-0 flex-1 truncate font-semibold">{gt("Lounge")}</span>
        <Users className="h-5 w-5 text-[var(--app-muted)]" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="relative overflow-hidden rounded-2xl ring-2 ring-[#23a55a]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static sample screen share */}
          <img src={SHOTS.castle} alt="" width={1280} height={720} loading="lazy" className="aspect-video w-full bg-black object-cover" />
          <span className="absolute left-2 top-2 rounded-md bg-[#e11d48] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{gt("Live")}</span>
          <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md">
            <Monitor className="h-3 w-3" />
            {gt("{name}'s screen", { name: "Theo" })}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {person("Theo", true)}
          {person("Mika")}
          {person("Aya", false, true)}
          {person("Sora")}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2.5 border-t border-[var(--app-border)] px-3 pb-8 pt-3">
        <span className={dock}><Mic className="h-5 w-5" /></span>
        <span className={dock}><Headphones className="h-5 w-5" /></span>
        <span className={dock}><Video className="h-5 w-5" /></span>
        <span className={dock}><ScreenShare className="h-5 w-5" /></span>
        <span className="flex h-11 w-14 items-center justify-center rounded-full bg-[#ef4444] text-white">
          <PhoneOff className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

export async function HeroDevices({ today, clock }: { today: (h: number, m: number) => string; clock: string }) {
  const gt = await getGT();
  return (
    <div className="hm-devices">
      <div className="hm-devices-3d">
      <a href="#try" className="hm-monitor group" aria-label={gt("Try the app, right on this page")}>
        <span className="hm-monitor-screen" aria-hidden inert>
          <Fit w={1160} h={720}>
            <DesktopScreen gt={gt} today={today} />
          </Fit>
        </span>
        <span className="hm-device-hint" aria-hidden>
          {gt("Try it")}
          <ArrowDown className="h-4 w-4" />
        </span>
        <span className="hm-monitor-neck" aria-hidden />
        <span className="hm-monitor-foot" aria-hidden />
      </a>
      <a href="#voice" className="hm-phone hm-device-phone group" aria-label={gt("Voice and video")}>
        <span className="hm-phone-screen hm-device-phone-screen" aria-hidden inert>
          <Fit w={390} h={820}>
            <PhoneScreen gt={gt} clock={clock} />
          </Fit>
        </span>
      </a>
      </div>
    </div>
  );
}
