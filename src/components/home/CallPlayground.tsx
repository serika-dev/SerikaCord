"use client";

/**
 * The voice channel page, playable: the same header, CallStage tiles
 * (voice/CallStage.tsx StageTileView), call dock, soundboard panel, Activity
 * shelf, text chat panel, pop-out placeholder and "Join Voice" screen as
 * app/channels/[serverId]/[channelId]/page.tsx, all on local state. People
 * take turns talking; every button does what it does in the app. No audio, no
 * camera, nothing sent anywhere.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useGT } from "gt-next";
import {
  ChevronUp,
  DoorOpen,
  ExternalLink,
  HeadphoneOff,
  Headphones,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MonitorOff,
  Music,
  PhoneOff,
  Rocket,
  ScreenShare,
  Search,
  SendHorizontal,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@/components/ui/avatar";
import { fitGrid, gridColumns } from "@/lib/voice/callLayout";
import { cn } from "@/lib/utils";
import { sampleAvatar } from "./preview/parts";

type Person = "Sora" | "Theo" | "Mika" | "Aya" | "Jun";
type ScreenId = "theo-screen" | "mika-screen" | "my-screen";
type TileId = ScreenId | Person;

/** What each screen share is showing. */
const SCREENS: Record<ScreenId, { src: string; owner: Person }> = {
  "theo-screen": { src: "/home/shot-castle.webp", owner: "Theo" },
  "mika-screen": { src: "/home/shot-coaster.webp", owner: "Mika" },
  "my-screen": { src: "/home/shot-snowy-cliff.webp", owner: "Sora" },
};

const PEOPLE: Person[] = ["Sora", "Theo", "Mika", "Aya", "Jun"];

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const chance = (p: number) => Math.random() < p;

/** Smallest grid tile before the call switches to a scrollable two-column grid (phones). */
const MIN_TILE = 150;

/** CallStage's useElementSize: the measured grid area. */
function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, size] as const;
}

function PersonAvatar({ name, className, style }: { name: Person; className?: string; style?: CSSProperties }) {
  return (
    <Avatar className={className} style={style}>
      <AvatarImage src={sampleAvatar(name) ?? undefined} alt="" />
      <AvatarFallback className="bg-[var(--app-accent)] text-lg font-semibold text-[var(--text-on-accent)]">{name.charAt(0)}</AvatarFallback>
    </Avatar>
  );
}

interface ChatLine {
  id: number;
  author: Person;
  text: string;
}

export function CallPlayground() {
  const gt = useGT();
  const [inCall, setInCall] = useState(true);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [noise, setNoise] = useState(true);
  const [panel, setPanel] = useState<"soundboard" | "quality" | null>(null);
  const [quality, setQuality] = useState({ res: "1080p", fps: 60 });
  const [shelf, setShelf] = useState(false);
  const [shelfQuery, setShelfQuery] = useState("");
  const [activity, setActivity] = useState<{ emoji: string; name: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [focused, setFocused] = useState<TileId | null>(null);
  const [gridAreaRef, gridArea] = useElementSize<HTMLDivElement>();
  const [speaking, setSpeaking] = useState<Person | null>("Mika");
  const [fullscreenId, setFullscreenId] = useState<TileId | null>(null);
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState<ChatLine[]>(() => [
    { id: 1, author: "Theo", text: gt("this Eikon fight is insane, everyone watch my screen") },
    { id: 2, author: "Mika", text: gt("one sec, my coaster just launched a guest into the lake 😭") },
  ]);
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<TileId, HTMLDivElement>());
  const inView = useRef(false);
  const silentRef = useRef(false);
  const nextId = useRef(10);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    silentRef.current = muted || deafened;
  }, [muted, deafened]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Take turns talking (Jun is muted; you only when unmuted).
  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(() => {
      if (!inView.current) return;
      const pool: Person[] = ["Theo", "Mika", "Aya", "Theo", "Mika"];
      if (!silentRef.current) pool.push("Sora");
      setSpeaking(chance(0.2) ? null : pick(pool));
    }, 1700);
    return () => clearInterval(id);
  }, [inCall]);

  useEffect(() => {
    const onChange = () => {
      const el = document.fullscreenElement;
      let id: TileId | null = null;
      tileRefs.current.forEach((node, key) => {
        if (node === el) id = key;
      });
      setFullscreenId(id);
    };
    document.addEventListener("fullscreenchange", onChange);
    const list = timers.current;
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      list.forEach(clearTimeout);
    };
  }, []);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const sounds = [
    { id: "airhorn", emoji: "📯", name: gt("Airhorn") },
    { id: "crickets", emoji: "🦗", name: gt("Crickets") },
    { id: "rimshot", emoji: "🥁", name: gt("Ba dum tss") },
    { id: "applause", emoji: "👏", name: gt("Applause") },
    { id: "trombone", emoji: "🎺", name: gt("Sad trombone") },
  ];
  const apps = [
    { emoji: "🍿", name: gt("Watch Together"), description: gt("Watch videos with everyone in the call.") },
    { emoji: "♟️", name: gt("Chess in the Park"), description: gt("A quick game of chess, best of three.") },
    { emoji: "🎨", name: gt("Sketch Heads"), description: gt("Draw, guess, laugh.") },
    { emoji: "🃏", name: gt("Card Night"), description: gt("Classic card games for up to 8 players.") },
  ];
  const shownApps = apps.filter((a) => !shelfQuery.trim() || a.name.toLowerCase().includes(shelfQuery.trim().toLowerCase()));

  const playSound = (id: string) => {
    setPlaying(id);
    later(2000, () => setPlaying((cur) => (cur === id ? null : cur)));
  };

  const leave = () => {
    setInCall(false);
    setPanel(null);
    setShelf(false);
    setSharing(false);
    setCamera(false);
    setActivity(null);
    setPoppedOut(false);
    setFocused(null);
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setChat((c) => [...c.slice(-20), { id: nextId.current++, author: "Sora", text }]);
    setDraft("");
    const replies = [gt("haha yes"), gt("Theo don't die to this boss again 😂"), gt("Mika your park needs a refund booth"), gt("love that 💜")];
    const who = pick<Person>(["Theo", "Mika", "Aya"]);
    later(1400, () => setChat((c) => [...c.slice(-20), { id: nextId.current++, author: who, text: pick(replies) }]));
  };

  const toggleFullscreen = (id: TileId) => {
    const el = tileRefs.current.get(id);
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  // buildStageTiles order: screen shares first (yours leads, you're "self"), then people.
  const tiles: TileId[] = [...(sharing ? (["my-screen"] as TileId[]) : []), "theo-screen", "mika-screen", ...PEOPLE];
  const main = focused && tiles.includes(focused) ? focused : null;

  // CallStage's grid: the largest equal tiles that all fit, side by side, the
  // last row centred. Too small to read (phones): two scrollable columns.
  const gridGap = gridArea.width < 480 ? 8 : 12;
  const edge = 4;
  const fit = fitGrid(tiles.length, gridArea.width - edge * 2, gridArea.height - edge * 2, gridGap);
  const tileWidth = fit ? Math.min(fit.tileWidth, 960) : 0;
  const scrollGrid = !fit || tileWidth < MIN_TILE;

  // Channel page dock buttons.
  const dockBtn = "flex items-center justify-center rounded-full transition-all active:scale-95 hover:scale-105 w-9 h-9 sm:w-10 sm:h-10";
  const idle = "bg-[var(--app-border)] text-[var(--app-muted)] hover:bg-[var(--border-strong)] hover:text-[var(--text-primary)]";
  const off = "bg-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/30";
  const on = "bg-[var(--app-accent)]/20 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/30";
  const icon = "w-4 h-4 sm:w-5 sm:h-5";
  const headerBtn = "flex h-8 w-8 items-center justify-center rounded-lg transition-colors";

  const tile = (id: TileId, mode: "grid" | "spotlight" | "strip") => {
    const isScreen = id in SCREENS;
    const person = isScreen ? null : (id as Person);
    const silent = person === "Jun" || (person === "Sora" && (muted || deafened));
    const talking = person === "Sora" ? speaking === "Sora" || playing !== null : speaking === person;
    const ring = person !== null && talking && !silent;
    const label = id === "my-screen" ? gt("Your Screen") : isScreen ? gt("{name}'s screen", { name: SCREENS[id as ScreenId].owner }) : id;
    const full = fullscreenId === id;
    return (
      <div
        key={id}
        ref={(node) => {
          if (node) tileRefs.current.set(id, node);
          else tileRefs.current.delete(id);
        }}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => setFocused((cur) => (cur === id ? null : id))}
        onDoubleClick={(e) => {
          e.stopPropagation();
          toggleFullscreen(id);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFocused((cur) => (cur === id ? null : id));
          }
        }}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-2xl bg-[var(--bg-card)] outline-none ring-1 ring-white/[0.06] transition-[box-shadow,transform] duration-150 hover:ring-white/[0.14] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]",
          mode === "grid" && "aspect-video w-full",
          mode === "spotlight" && "h-full max-h-full w-full",
          mode === "strip" && "aspect-video h-20 shrink-0 sm:h-24",
          full && "rounded-none",
          ring && "ring-2 ring-[#23a55a] hover:ring-[#23a55a] shadow-[0_0_18px_rgba(35,165,90,0.35)]",
        )}
      >
        {isScreen ? (
          // eslint-disable-next-line @next/next/no-img-element -- static sample screen share
          <img src={SCREENS[id as ScreenId].src} alt="" width={1280} height={720} loading="lazy" className="h-full w-full bg-black object-contain" />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--bg-sidebar-elevated)]" style={{ containerType: "inline-size" }}>
            {mode !== "strip" && (
              // eslint-disable-next-line @next/next/no-img-element -- decorative backdrop, as in CallStage
              <img src={sampleAvatar(person!) ?? ""} alt="" aria-hidden draggable={false} className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-35 blur-2xl" />
            )}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 to-black/40" />
            <div className={cn("relative rounded-full transition-shadow duration-100", ring && "ring-[3px] ring-[#23a55a] ring-offset-2 ring-offset-[var(--bg-sidebar-elevated)] shadow-[0_0_24px_rgba(35,165,90,0.45)]")}>
              <PersonAvatar
                name={person!}
                className={cn(mode === "strip" && "h-10 w-10", "shadow-lg")}
                style={mode === "strip" ? undefined : { width: "clamp(40px, 18cqw, 136px)", height: "clamp(40px, 18cqw, 136px)" }}
              />
            </div>
          </div>
        )}

        <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-lg bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md sm:bottom-2.5 sm:left-2.5 sm:text-xs">
          {isScreen && <Monitor className="h-3 w-3 shrink-0" aria-hidden />}
          <span className="truncate">{label}</span>
          {(person === "Jun" || (person === "Sora" && muted)) && <MicOff className="h-3 w-3 shrink-0 text-white/80" aria-label={gt("Muted")} />}
          {person === "Sora" && deafened && <HeadphoneOff className="h-3 w-3 shrink-0 text-white/80" aria-label={gt("Deafened")} />}
        </div>

        {mode !== "strip" && (
          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:right-2 sm:top-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen(id);
              }}
              title={full ? gt("Exit Full Screen") : gt("Full Screen")}
              aria-label={full ? gt("Exit Full Screen") : gt("Full Screen")}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80"
            >
              {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="hm-frame m-0">
      <div className="relative flex min-w-0 flex-col overflow-hidden bg-[var(--bg-app)]">
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b border-[var(--app-border)] bg-[var(--bg-app)] px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Volume2 className="h-5 w-5 flex-shrink-0 text-[var(--app-accent)]" />
            <span className="truncate font-semibold text-[var(--text-primary)]">{gt("Lounge")}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              title={chatOpen ? gt("Hide Chat") : gt("Show Chat")}
              aria-label={chatOpen ? gt("Hide Chat") : gt("Show Chat")}
              aria-pressed={chatOpen}
              className={cn(headerBtn, chatOpen ? "bg-[var(--app-surface-alt)] text-[var(--text-primary)]" : "text-[var(--app-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")}
            >
              <MessageSquare className="h-5 w-5" />
            </button>
            {inCall && (
              <button
                type="button"
                onClick={() => setPoppedOut(true)}
                title={gt("Pop Out")}
                aria-label={gt("Pop Out")}
                className={cn(headerBtn, "text-[var(--app-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] max-sm:hidden")}
              >
                <ExternalLink className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0" style={{ height: "clamp(320px, 74vw, 500px)" }}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {inCall ? (
              <>
                {/* ActivitySlot: a running Activity fills the top of the stage */}
                {activity && !poppedOut && (
                  <div className="hm-fade-in mx-3 mt-3 flex min-h-[45%] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-[var(--bg-sidebar-elevated)] text-center sm:mx-4">
                    <span className="twemoji text-5xl">{activity.emoji}</span>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{activity.name}</span>
                    <button
                      type="button"
                      onClick={() => setActivity(null)}
                      className="flex items-center gap-1.5 rounded-md bg-[var(--app-surface-alt)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      <DoorOpen className="size-3.5" />
                      {gt("Leave Activity")}
                    </button>
                  </div>
                )}
                {/* CallStage */}
                <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-4">
                  {poppedOut ? (
                    <div className="hm-fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-muted)]">
                      <ExternalLink className="h-6 w-6" aria-hidden />
                      <p>{gt("The call is open in another window.")}</p>
                      <button
                        type="button"
                        onClick={() => setPoppedOut(false)}
                        className="rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] hover:opacity-90"
                      >
                        {gt("Bring Back")}
                      </button>
                    </div>
                  ) : (
                    <>
                      {main && (
                        <div className="pointer-events-none absolute right-5 top-5 z-10 flex gap-1.5 sm:right-6 sm:top-6">
                          <button
                            type="button"
                            onClick={() => setFocused(null)}
                            title={gt("Show grid")}
                            aria-label={gt("Show grid")}
                            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                          >
                            <LayoutGrid className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      {main ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-2">
                          <div className="flex min-h-0 flex-1 items-center justify-center">{tile(main, "spotlight")}</div>
                          <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="list" aria-label={gt("Participants")}>
                            {tiles.filter((t) => t !== main).map((t) => tile(t, "strip"))}
                          </div>
                        </div>
                      ) : (
                        <div ref={gridAreaRef} className={cn("flex min-h-0 flex-1 justify-center", scrollGrid ? "items-start overflow-y-auto [scrollbar-width:thin]" : "items-center overflow-hidden")}>
                          {scrollGrid ? (
                            <div className="grid w-full p-1" style={{ gap: 8, gridTemplateColumns: `repeat(${gridColumns(tiles.length, true)}, minmax(0, 1fr))` }}>
                              {tiles.map((t) => tile(t, "grid"))}
                            </div>
                          ) : (
                            <div className="flex flex-wrap content-center justify-center" style={{ gap: gridGap, width: fit!.cols * tileWidth + (fit!.cols - 1) * gridGap }}>
                              {tiles.map((t) => (
                                <div key={t} style={{ width: tileWidth }}>
                                  {tile(t, "grid")}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Call controls bar */}
                <div className="relative bg-transparent px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
                  {panel === "soundboard" && (
                    <div className="hm-pop-in absolute inset-x-3 bottom-[calc(100%-4px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] p-3 shadow-[var(--app-elev-2)] sm:inset-x-4">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--app-muted-2)]">{gt("Soundboard")}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {sounds.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => playSound(s.id)}
                            disabled={playing === s.id}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg border p-2 transition-all",
                              playing === s.id
                                ? "scale-95 border-[var(--app-accent)] bg-[var(--app-accent)]/20"
                                : "border-[var(--app-border)] bg-[var(--bg-app)] hover:border-[var(--app-accent)]/50 hover:bg-[var(--bg-hover)]",
                            )}
                          >
                            <span className="twemoji text-lg">{s.emoji}</span>
                            <span className="w-full truncate text-center text-[10px] text-[var(--app-muted)]">{s.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {panel === "quality" && (
                    <div className="hm-pop-in absolute bottom-[calc(100%-4px)] left-1/2 z-20 w-60 -translate-x-1/2 rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] p-3 shadow-[var(--app-elev-2)]">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Resolution")}</p>
                      <div className="mb-3 grid grid-cols-3 gap-1.5">
                        {["720p", "1080p", "1440p"].map((r) => (
                          <button key={r} type="button" onClick={() => setQuality((q) => ({ ...q, res: r }))} className={cn("rounded-md border px-2 py-1.5 text-xs font-medium", quality.res === r ? "border-[var(--app-accent)] bg-[var(--app-accent)]/15 text-[var(--text-primary)]" : "border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--text-primary)]")}>
                            {r}
                          </button>
                        ))}
                      </div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Frame rate")}</p>
                      <div className="mb-3 grid grid-cols-3 gap-1.5">
                        {[15, 30, 60].map((f) => (
                          <button key={f} type="button" onClick={() => setQuality((q) => ({ ...q, fps: f }))} className={cn("rounded-md border px-2 py-1.5 text-xs font-medium", quality.fps === f ? "border-[var(--app-accent)] bg-[var(--app-accent)]/15 text-[var(--text-primary)]" : "border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--text-primary)]")}>
                            {f} FPS
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPanel(null);
                          if (!sharing) setSharing(true);
                        }}
                        className="w-full rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--text-on-accent)] hover:opacity-90"
                      >
                        {sharing ? gt("Done") : gt("Go Live")}
                      </button>
                    </div>
                  )}

                  <div className="theme-solid mx-auto flex w-fit items-center justify-center gap-1 rounded-2xl bg-[var(--app-surface-alt)]/90 px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.4)] ring-1 ring-white/5 backdrop-blur-md sm:gap-1.5 sm:px-2.5 sm:py-2">
                    <DockBtn label={muted ? gt("Unmute") : gt("Mute")} className={cn(dockBtn, muted ? off : idle)} onClick={() => setMuted((v) => !v)}>
                      {muted ? <MicOff className={icon} /> : <Mic className={icon} />}
                    </DockBtn>
                    <DockBtn label={deafened ? gt("Undeafen") : gt("Deafen")} className={cn(dockBtn, deafened ? off : idle)} onClick={() => setDeafened((v) => !v)}>
                      {deafened ? <HeadphoneOff className={icon} /> : <Headphones className={icon} />}
                    </DockBtn>
                    <DockBtn label={camera ? gt("Turn Off Camera") : gt("Turn On Camera")} className={cn(dockBtn, camera ? on : idle)} onClick={() => setCamera((v) => !v)}>
                      {camera ? <Video className={icon} /> : <VideoOff className={icon} />}
                    </DockBtn>
                    <DockBtn label={noise ? gt("Disable Noise Suppression") : gt("Enable Noise Suppression")} className={cn(dockBtn, noise ? on : idle)} onClick={() => setNoise((v) => !v)}>
                      <Sparkles className={icon} />
                    </DockBtn>
                    <div className="flex items-center max-sm:hidden">
                      <DockBtn
                        label={sharing ? gt("Stop Sharing") : gt("Share Screen")}
                        className={cn(dockBtn, sharing ? on : idle)}
                        onClick={() => {
                          setSharing((v) => !v);
                        }}
                      >
                        {sharing ? <MonitorOff className={icon} /> : <ScreenShare className={icon} />}
                      </DockBtn>
                      <button
                        type="button"
                        onClick={() => setPanel((p) => (p === "quality" ? null : "quality"))}
                        title={gt("Stream quality")}
                        aria-label={gt("Stream quality")}
                        className={cn("flex h-10 w-5 items-center justify-center rounded-full transition-colors", panel === "quality" ? "text-[var(--text-primary)]" : "text-[var(--app-muted)] hover:text-[var(--text-primary)]")}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <DockBtn label={gt("Soundboard")} className={cn(dockBtn, panel === "soundboard" ? on : idle)} onClick={() => setPanel((p) => (p === "soundboard" ? null : "soundboard"))}>
                      <Music className={icon} />
                    </DockBtn>
                    <DockBtn label={gt("Activities")} className={cn(dockBtn, shelf ? on : idle)} onClick={() => setShelf(true)}>
                      <Rocket className={icon} />
                    </DockBtn>
                    <span className="mx-1 h-6 w-px bg-white/10" />
                    <DockBtn
                      label={gt("Leave Voice Channel")}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ef4444] text-white shadow-[0_2px_10px_rgba(239,68,68,0.4)] transition-all hover:scale-105 hover:bg-[#dc2626] active:scale-95 sm:h-10 sm:w-12"
                      onClick={leave}
                    >
                      <PhoneOff className={icon} />
                    </DockBtn>
                  </div>
                </div>
              </>
            ) : (
              /* Not joined: the join screen */
              <div className="hm-fade-in flex flex-1 flex-col items-center justify-center px-4 text-center">
                <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-b from-[var(--app-accent)]/20 to-[var(--app-surface-alt)] shadow-[0_0_40px_color-mix(in_srgb,var(--app-accent)_25%,transparent)] ring-1 ring-[var(--app-accent)]/20">
                  <Volume2 className="h-11 w-11 text-[var(--app-accent)]" />
                </div>
                <h3 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">{gt("Lounge")}</h3>
                <p className="mb-4 text-sm text-[var(--app-muted-2)]">{gt("{count} people are in this channel", { count: 4 })}</p>
                <div className="mb-6 flex max-w-md flex-col items-center gap-2">
                  <AvatarGroup className="-space-x-3 [--avatar-group-ring:var(--bg-app)]">
                    {(["Theo", "Mika", "Aya", "Jun"] as Person[]).map((p) => (
                      <PersonAvatar key={p} name={p} className="size-12 ring-[3px]" />
                    ))}
                  </AvatarGroup>
                  <p className="max-w-xs truncate text-xs text-[var(--app-muted)]">
                    Theo, Mika, Aya {gt("and {count} more", { count: 1 })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInCall(true)}
                  className="flex items-center gap-2 rounded-full bg-[var(--app-accent)] px-7 py-3 font-semibold text-[var(--text-on-accent)] shadow-[0_4px_20px_color-mix(in_srgb,var(--app-accent)_45%,transparent)] transition-all hover:scale-[1.03] hover:brightness-110 active:scale-95"
                >
                  <PhoneOff className="h-5 w-5 rotate-[135deg]" />
                  {gt("Join Voice")}
                </button>
              </div>
            )}
          </div>

          {/* Text chat in the voice channel (VoiceChatPanel) */}
          {chatOpen && (
            <aside className="hm-fade-in absolute bottom-0 right-0 top-12 z-30 flex w-full min-w-0 flex-col border-l border-[var(--app-border)] bg-[var(--bg-app)] shadow-[var(--app-elev-2)] sm:w-64">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--app-border)] px-3 text-sm font-semibold text-[var(--text-primary)]">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-[var(--app-muted)]" />
                  {gt("Lounge")}
                </span>
                <button type="button" onClick={() => setChatOpen(false)} aria-label={gt("Hide Chat")} className="rounded p-1 text-[var(--app-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto p-3">
                {chat.map((m) => (
                  <div key={m.id} className="hm-live-in flex gap-2">
                    <PersonAvatar name={m.author} className="h-7 w-7 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{m.author}</div>
                      <div className="twemoji break-words text-sm text-[var(--app-text)]">{m.text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-[var(--app-border)] p-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`${gt("Message")} #${gt("Lounge")}`}
                  aria-label={gt("Message")}
                  className="min-w-0 flex-1 rounded-lg bg-[var(--app-surface-alt)] px-3 py-2 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted)] [font-size:16px] sm:[font-size:14px]"
                />
                <button type="submit" aria-label={gt("Send")} disabled={!draft.trim()} className="rounded-lg p-2 text-[var(--app-accent)] disabled:opacity-40">
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </form>
            </aside>
          )}
        </div>

        {/* Activity shelf (ActivityShelf dialog, scoped to the preview) */}
        {shelf && (
          <div className="hm-fade-in absolute inset-0 z-40 flex items-center justify-center p-3" onClick={() => setShelf(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              role="dialog"
              aria-label={gt("Activities")}
              onClick={(e) => e.stopPropagation()}
              className="hm-pop-in relative grid max-h-full w-full max-w-lg gap-4 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)] shadow-[var(--app-elev-2)]"
            >
              <button type="button" onClick={() => setShelf(false)} aria-label={gt("Close")} className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                <X className="h-4 w-4" />
              </button>
              <div className="flex flex-col gap-1.5">
                <h3 className="flex items-center gap-2 text-lg font-semibold leading-none">
                  <Rocket className="size-5 text-[var(--app-accent)]" />
                  {gt("Activities")}
                </h3>
                <p className="text-sm text-[var(--app-muted)]">{gt("Play together with everyone in this call.")}</p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--app-muted)]" />
                <input
                  value={shelfQuery}
                  onChange={(e) => setShelfQuery(e.target.value)}
                  placeholder={gt("Search")}
                  aria-label={gt("Search Activities")}
                  className="w-full rounded-lg border border-[var(--app-border)] bg-transparent py-2 pl-9 pr-3 text-[16px] text-[var(--app-text)] outline-none focus:border-[var(--app-accent)] sm:text-sm"
                />
              </div>
              {activity && (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">{gt("Playing now")}</h4>
                  <div className="flex items-center gap-3 rounded-lg border border-[var(--app-border)] p-2.5">
                    <span className="twemoji flex size-10 items-center justify-center rounded-lg bg-[var(--app-surface-alt)] text-xl">{activity.emoji}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{activity.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setActivity(null);
                      }}
                      className="flex items-center gap-1.5 rounded-md bg-[var(--app-surface-alt)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
                    >
                      <DoorOpen className="size-3.5" />
                      {gt("Leave Activity")}
                    </button>
                  </div>
                </section>
              )}
              <ul className="grid gap-2 sm:grid-cols-2">
                {shownApps.map((a) => (
                  <li key={a.name}>
                    <button
                      type="button"
                      onClick={() => {
                        setActivity({ emoji: a.emoji, name: a.name });
                        setShelf(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg border border-[var(--app-border)] p-2.5 text-left transition-colors hover:border-[var(--app-accent)]/50 hover:bg-[var(--bg-hover)]"
                    >
                      <span className="twemoji flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--app-surface-alt)] text-xl">{a.emoji}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.name}</span>
                        <span className="block truncate text-xs text-[var(--app-muted)]">{a.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {shownApps.length === 0 && <li className="py-4 text-center text-sm text-[var(--app-muted)] sm:col-span-2">{gt("No Activities match your search.")}</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DockBtn({ label, className, onClick, children }: { label: string; className: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={className}>
      {children}
    </button>
  );
}
