"use client";

/**
 * The encrypted DM on a phone, playable. It is the app's phone layout: the DM
 * header (back, avatar, lock, call buttons), MessageGroup's locked /
 * "Decrypting…" message states, and the E2EE dialogs as bottom sheets (the
 * DialogContent mobile sheet): "Enter your PIN" with the real PinInput, "Set
 * up with another device", "Start over with new keys?", the conversation
 * lock panel and the safety number. Back opens the DM list, the call buttons
 * start an encrypted call, reactions and the composer work, and once you're
 * in, Aya answers. If the visitor doesn't type, a PIN types itself when the
 * phone is on screen. Nothing leaves the page.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  ArrowLeft,
  ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PlusCircle,
  ShieldAlert,
  ShieldCheck,
  Smile,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { PinInput } from "@/components/e2ee/PinInput";
import { StatusBadge } from "@/components/user/StatusBadge";
import { PIN_LENGTH } from "@/lib/e2ee/pin";
import { cn } from "@/lib/utils";
import { IosStatus } from "./IosStatus";
import { Av } from "./preview/parts";

type Person = "Aya" | "Theo" | "Rin";
type Phase = "locked" | "busy" | "decrypting" | "open";
type Sheet = "pin" | "link" | "reset" | "lock" | "safety" | null;

interface Msg {
  id: string;
  author: Person | "Sora";
  time: string;
  text: string;
  /** Sent on this device after unlocking: never shown locked. */
  local?: boolean;
  image?: string;
  reaction?: { emoji: string; count: number; mine: boolean };
}

export interface PhoneTimes {
  a: string;
  b: string;
  c: string;
  d: string;
  status: string;
}

const DEMO_PIN = "482915";
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A deterministic QR-looking grid (decorative; the real one encodes the link code). */
function FakeQr() {
  const n = 25;
  const cells: ReactNode[] = [];
  let seed = 7;
  const finder = (x: number, y: number) => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        return edge || core ? 1 : 0;
      }
    }
    return -1;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const f = finder(x, y);
      if (f === 1 || (f === -1 && seed % 3 === 0)) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="h-[168px] w-[168px] rounded-lg bg-white p-2" fill="#000" aria-hidden shapeRendering="crispEdges">
      {cells}
    </svg>
  );
}

export function PrivacyPhone({ times }: { times: PhoneTimes }) {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const touched = useRef(false);
  const nextId = useRef(100);
  const [phase, setPhase] = useState<Phase>("locked");
  const [sheet, setSheet] = useState<Sheet>("pin");
  const [pin, setPin] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<"dm" | "list" | "call">("dm");
  const [person, setPerson] = useState<Person>("Aya");
  const [encrypted, setEncrypted] = useState(true);
  const [verified, setVerified] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [call, setCall] = useState<{ video: boolean; muted: boolean; seconds: number; connected: boolean }>({ video: false, muted: false, seconds: 0, connected: false });
  const [resetPassword, setResetPassword] = useState("");
  const [tray, setTray] = useState<"emoji" | "plus" | null>(null);

  const [rooms, setRooms] = useState<Record<Person, Msg[]>>(() => ({
    Aya: [
      { id: "a1", author: "Aya", time: times.a, text: gt("sent you the birthday plan, don't tell Rin") },
      { id: "a2", author: "Aya", time: times.a, text: gt("cake at 7, balloons at 6:30 🎈"), reaction: { emoji: "🎉", count: 1, mine: false } },
      { id: "a3", author: "Sora", time: times.b, text: gt("my lips are sealed. so is this chat") },
    ],
    Theo: [{ id: "t1", author: "Theo", time: times.c, text: gt("you joining game night?") }],
    Rin: [{ id: "r1", author: "Rin", time: times.d, text: gt("made you a playlist 🎧"), reaction: { emoji: "💜", count: 1, mine: true } }],
  }));

  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const submit = (value: string) => {
    if (value.length !== PIN_LENGTH) return;
    setPhase("busy");
    later(1100, () => {
      setSheet(null);
      setPhase("decrypting");
    });
    later(1600, () => {
      setPhase("open");
      toast.success(gt("Your encrypted messages are unlocked on this device."));
    });
  };

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  // Once on screen, type the demo PIN unless the visitor got there first.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    const local: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const step = reduced ? 0 : 180;
        local.push(
          setTimeout(() => {
            if (touched.current) return;
            DEMO_PIN.split("").forEach((_, i) =>
              local.push(
                setTimeout(() => {
                  if (touched.current) return;
                  setPin(DEMO_PIN.slice(0, i + 1));
                  if (i === PIN_LENGTH - 1) local.push(setTimeout(() => !touched.current && submitRef.current(DEMO_PIN), 300));
                }, i * step),
              ),
            );
          }, reduced ? 0 : 1600),
        );
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      local.forEach(clearTimeout);
    };
  }, [attempt]);

  // Call timer.
  useEffect(() => {
    if (view !== "call") return;
    const connect = setTimeout(() => setCall((c) => ({ ...c, connected: true })), 1800);
    const tick = setInterval(() => setCall((c) => (c.connected ? { ...c, seconds: c.seconds + 1 } : c)), 1000);
    return () => {
      clearTimeout(connect);
      clearInterval(tick);
    };
  }, [view]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const relock = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    touched.current = false;
    setPin("");
    setPhase("locked");
    setView("dm");
    setSheet("pin");
    setAttempt((n) => n + 1);
  };

  const touch = () => {
    touched.current = true;
  };

  const locked = phase === "locked" || phase === "busy";
  const messages = rooms[person];

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (locked) {
      setSheet("pin");
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setTray(null);
    const to = person;
    setRooms((r) => ({ ...r, [to]: [...r[to].slice(-30), { id: `m${nextId.current++}`, author: "Sora", time: gt("Just now"), text, local: true }] }));
    setDraft("");
    const replies = [gt("haha yes"), gt("omg same 😭"), gt("ok that's perfect"), gt("you're the best 💜"), gt("wait really? 👀")];
    later(900, () => setTyping(true));
    later(2300, () => {
      setTyping(false);
      setRooms((r) => ({ ...r, [to]: [...r[to].slice(-30), { id: `m${nextId.current++}`, author: to, time: gt("Just now"), text: pick(replies), local: true }] }));
    });
  };

  const openTray = (kind: "emoji" | "plus") => {
    if (locked) {
      setSheet("pin");
      return;
    }
    setTray((t) => (t === kind ? null : kind));
  };

  const sendPhoto = () => {
    setTray(null);
    const to = person;
    setRooms((r) => ({ ...r, [to]: [...r[to].slice(-30), { id: `m${nextId.current++}`, author: "Sora", time: gt("Just now"), text: "", image: "/home/shot-coaster.webp", local: true }] }));
    later(1800, () =>
      setRooms((r) => ({ ...r, [to]: [...r[to].slice(-30), { id: `m${nextId.current++}`, author: to, time: gt("Just now"), text: gt("wait is that a rollercoaster in a forest?? 🎢"), local: true }] })),
    );
  };

  const toggleReaction = (id: string) => {
    setRooms((r) => ({
      ...r,
      [person]: r[person].map((m) =>
        m.id === id
          ? {
              ...m,
              reaction: m.reaction
                ? { ...m.reaction, mine: !m.reaction.mine, count: m.reaction.count + (m.reaction.mine ? -1 : 1) }
                : { emoji: "💜", count: 1, mine: true },
            }
          : m,
      ),
    }));
  };

  const safetyNumber = useMemo(() => {
    const groups: string[] = [];
    let s = person.charCodeAt(0) * 7919;
    for (let i = 0; i < 12; i++) {
      s = (s * 48271) % 2147483647;
      groups.push(String(s % 100000).padStart(5, "0"));
    }
    return groups;
  }, [person]);

  const body = (m: Msg) => {
    if (m.local || phase === "open") return <span className="hm-fade-in">{m.text}</span>;
    if (phase === "decrypting") {
      return (
        <span className="inline-flex items-center gap-1.5 italic text-[var(--app-muted)]" aria-busy="true">
          <Lock className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          {gt("Decrypting…")}
        </span>
      );
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 italic text-[var(--app-muted)]">
        <ShieldAlert className="h-3.5 w-3.5 text-red-400" aria-hidden />
        {gt("Set up encryption on this device to read this message.")}
      </span>
    );
  };

  const linkButton = "rounded text-sm font-medium text-[var(--app-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]";
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const lastText = (p: Person) => {
    const last = rooms[p][rooms[p].length - 1];
    if (!last) return "";
    return last.local || phase === "open" ? `${last.author === "Sora" ? `${gt("You")}: ` : ""}${last.text || gt("Photo")}` : gt("Encrypted message");
  };

  return (
    <div ref={rootRef} className="hm-phone mx-auto">
      <div className="hm-phone-screen">
        {/* Status bar */}
        <IosStatus time={times.status} className="h-11 px-3 text-[13px] text-[var(--text-primary)]" />

        {view === "list" && (
          <div className="hm-fade-in flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center px-4 text-lg font-bold text-[var(--text-primary)]">{gt("Messages")}</div>
            <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
              {(["Aya", "Theo", "Rin"] as Person[]).map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => {
                      setPerson(p);
                      setView("dm");
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]"
                  >
                    <span className="relative shrink-0">
                      <Av name={p} className="h-11 w-11" fallbackClassName="text-sm" />
                      <StatusBadge status={p === "Theo" ? "idle" : "online"} size={12} ring={3} ringColor="var(--bg-app)" corner decorative />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--text-primary)]">
                        {p}
                        {encrypted && <Lock className="h-3 w-3 text-[var(--text-secondary)]" aria-label={gt("End-to-end encrypted")} />}
                      </span>
                      <span className="block truncate text-[13px] text-[var(--app-muted)]">{lastText(p)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view === "call" && (
          <div className="hm-fade-in flex min-h-0 flex-1 flex-col items-center justify-between bg-[var(--bg-sidebar-elevated)] px-6 pb-8 pt-10 text-center">
            <div className="flex flex-col items-center gap-3">
              <span className={cn("rounded-full", call.connected && !call.muted && "ring-[3px] ring-[#23a55a] ring-offset-4 ring-offset-[var(--bg-sidebar-elevated)]")}>
                <Av name={person} className="h-24 w-24" fallbackClassName="text-2xl" />
              </span>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{person}</div>
              <div className="text-sm text-[var(--app-muted)]">{call.connected ? fmt(call.seconds) : gt("Calling…")}</div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-surface-alt)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                <Lock className="h-3 w-3 text-green-500" aria-hidden />
                {gt("End-to-end encrypted")}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setCall((c) => ({ ...c, muted: !c.muted }))}
                aria-label={call.muted ? gt("Unmute") : gt("Mute")}
                className={cn("flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95", call.muted ? "bg-[#ef4444]/20 text-[#ef4444]" : "bg-[var(--app-border)] text-[var(--text-primary)]")}
              >
                {call.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={() => setCall((c) => ({ ...c, video: !c.video }))}
                aria-label={call.video ? gt("Turn Off Camera") : gt("Turn On Camera")}
                className={cn("flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95", call.video ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]" : "bg-[var(--app-border)] text-[var(--text-primary)]")}
              >
                {call.video ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
              </button>
              <button
                type="button"
                onClick={() => setView("dm")}
                aria-label={gt("End Call")}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ef4444] text-white shadow-[0_2px_10px_rgba(239,68,68,0.4)] transition-all hover:bg-[#dc2626] active:scale-95"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}

        {view === "dm" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* DM header (phone) */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button type="button" onClick={() => setView("list")} aria-label={gt("Back")} className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="relative shrink-0">
                  <Av name={person} className="h-8 w-8" fallbackClassName="text-sm" />
                  <StatusBadge status={person === "Theo" ? "idle" : "online"} size={10} ring={3} ringColor="var(--bg-app)" corner decorative />
                </span>
                <span className="truncate font-semibold text-[var(--text-primary)]">{person}</span>
                <button
                  type="button"
                  onClick={() => setSheet("lock")}
                  aria-label={encrypted ? gt("End-to-end encrypted") : gt("Not end-to-end encrypted")}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  {encrypted ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="flex shrink-0 items-center text-[var(--text-secondary)]">
                <button type="button" onClick={() => { setCall({ video: false, muted: false, seconds: 0, connected: false }); setView("call"); }} aria-label={gt("Start Voice Call")} className="rounded-md p-2 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Phone className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => { setCall({ video: true, muted: false, seconds: 0, connected: false }); setView("call"); }} aria-label={gt("Start Video Call")} className="rounded-md p-2 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                  <Video className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Locked: a way back into the PIN sheet once it's closed */}
            {locked && sheet === null && (
              <div className="hm-fade-in mx-2 mt-2 flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-[13px] text-[var(--text-secondary)]">
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
                <span className="min-w-0 flex-1">{gt("Enter your PIN to read encrypted messages on this device.")}</span>
                <button type="button" onClick={() => setSheet("pin")} className="shrink-0 rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--text-on-accent)]">
                  {gt("Enter PIN")}
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-3 pb-2 pt-3 [scrollbar-width:none]">
              {messages.map((m, i) => {
                const first = i === 0 || messages[i - 1].author !== m.author;
                return (
                  <div key={m.id} className={cn("chat-message-row group", m.local ? "hm-live-in" : "", first ? "mt-3 first:mt-0" : "mt-0.5")}>
                    <div className="flex gap-3">
                      <div className="w-9 shrink-0">{first && <Av name={m.author} className="mt-0.5 h-9 w-9" fallbackClassName="text-sm" />}</div>
                      <div className="min-w-0 flex-1">
                        {first && (
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-[0.8rem] font-medium leading-tight text-[var(--text-primary)]">{m.author}</span>
                            <span className="whitespace-nowrap text-[10px] leading-none text-[var(--text-muted)]">{m.time}</span>
                          </div>
                        )}
                        {m.image && (
                          // eslint-disable-next-line @next/next/no-img-element -- static sample photo
                          <img src={m.image} alt="" width={1280} height={720} className="hm-live-in mt-1 max-h-36 w-auto max-w-full rounded-lg border border-[var(--app-border)]" />
                        )}
                        {m.text && <div className="twemoji chat-message-body whitespace-pre-wrap break-words text-[15px] text-[var(--app-text)]">
                          {body(m)}
                          {encrypted && (m.local || phase === "open") && (
                            <span className="ml-1 inline-flex items-center align-middle text-[var(--app-muted)] opacity-60" title={gt("End-to-end encrypted")}>
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                        </div>}
                        {m.reaction && m.reaction.count > 0 && (phase === "open" || m.local) && (
                          <button
                            type="button"
                            onClick={() => toggleReaction(m.id)}
                            className={cn(
                              "mt-1 inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-sm transition-colors",
                              m.reaction.mine ? "border-[var(--app-accent)] bg-[var(--app-accent)]/15 text-[var(--text-primary)]" : "border-transparent bg-[var(--app-surface-alt)] text-[var(--app-muted)] hover:border-[var(--app-border)]",
                            )}
                          >
                            <span className="twemoji">{m.reaction.emoji}</span>
                            <span className="text-xs font-semibold">{m.reaction.count}</span>
                          </button>
                        )}
                        {!m.reaction && phase === "open" && m.author !== "Sora" && (
                          <button type="button" onClick={() => toggleReaction(m.id)} aria-label={gt("Add Reaction")} className="mt-1 hidden rounded-lg bg-[var(--app-surface-alt)] p-1 text-[var(--app-muted)] hover:text-[var(--text-primary)] group-hover:inline-flex">
                            <Smile className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typing && (
                <div className="hm-fade-in mt-2 flex items-center gap-1.5 pl-12 text-xs text-[var(--app-muted)]">
                  <span className="flex gap-0.5">
                    <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                    <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                    <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                  </span>
                  {gt("{name} is typing…", { name: person })}
                </div>
              )}
            </div>

            {/* Composer (phone) */}
            <form onSubmit={send} className="relative shrink-0 px-2 pb-2">
              {tray && (
                <div className="hm-pop-in absolute bottom-[calc(100%+4px)] left-2 right-2 z-10 rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] p-2 shadow-[var(--app-elev-2)]">
                  {tray === "emoji" ? (
                    <div className="grid grid-cols-8 gap-1">
                      {["😂", "💜", "🎉", "🥹", "👀", "🔥", "✨", "🙏"].map((e) => (
                        <button key={e} type="button" onClick={() => setDraft((d) => d + e)} className="twemoji flex h-8 items-center justify-center rounded-md text-lg hover:bg-[var(--bg-hover)]">
                          {e}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" onClick={sendPhoto} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-[var(--app-text)] hover:bg-[var(--bg-hover)]">
                      <ImageIcon className="h-4 w-4 text-[var(--app-muted)]" />
                      {gt("Upload a File")}
                    </button>
                  )}
                </div>
              )}
              <div className="relative flex items-center overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[var(--app-elev-1)]">
                <button type="button" onClick={() => openTray("plus")} aria-label={gt("Upload a File")} className="absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--app-muted)] hover:text-[var(--text-primary)]">
                  <PlusCircle className="h-5 w-5" />
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => locked && setSheet("pin")}
                  placeholder={`${gt("Message")} @${person}`}
                  aria-label={`${gt("Message")} @${person}`}
                  maxLength={200}
                  autoComplete="off"
                  enterKeyHint="send"
                  className="block min-h-[44px] w-full bg-transparent py-2.5 pl-10 pr-10 text-[16px] text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted-2)]"
                />
                <button type="button" onClick={() => openTray("emoji")} aria-label={gt("Emoji")} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--app-muted)] hover:text-[var(--text-primary)]">
                  <Smile className="h-5 w-5" />
                </button>
              </div>
            </form>

            {phase === "open" && (
              <button type="button" onClick={relock} className="mx-auto mb-1 text-xs font-medium text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:underline">
                {gt("Lock again")}
              </button>
            )}
          </div>
        )}

        {/* Home indicator */}
        <div className="flex h-5 shrink-0 items-center justify-center">
          <span className="h-1 w-28 rounded-full bg-[var(--text-primary)] opacity-60" />
        </div>

        {/* Bottom sheets (DialogContent on phones) */}
        <div className={cn("hm-sheet-layer", sheet === null && "is-closed")} aria-hidden={sheet === null}>
          <div className="absolute inset-0 bg-black/60" onClick={() => phase !== "busy" && setSheet(null)} />
          <div role="dialog" aria-label={gt("End-to-end encryption")} className="hm-sheet relative max-h-[88%] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 pb-6 pt-7 text-[var(--text-primary)] shadow-[var(--app-elev-2)]">
            <span className="pointer-events-none absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--text-muted)] opacity-40" />
            <button
              type="button"
              onClick={() => setSheet(null)}
              disabled={phase === "busy"}
              aria-label={gt("Close")}
              className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <X className="size-5" />
            </button>

            {sheet === "pin" && (
              <div className="flex flex-col gap-4">
                <div className="space-y-1 text-center">
                  <h3 className="text-lg font-semibold">{gt("Enter your PIN")}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">{gt("Enter the 6-digit PIN you created to read your encrypted messages on this device.")}</p>
                </div>
                {phase === "busy" ? (
                  <div className="flex flex-col items-center gap-2 py-4 text-sm text-[var(--text-secondary)]" role="status" aria-live="polite">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" />
                    {gt("Unlocking…")}
                  </div>
                ) : (
                  <div onPointerDown={touch} onKeyDown={touch}>
                    <PinInput
                      key={attempt}
                      value={pin}
                      onChange={(v) => {
                        touch();
                        setPin(v);
                      }}
                      onComplete={(v) => submit(v)}
                      label={gt("Enter your PIN")}
                      purpose="current"
                    />
                  </div>
                )}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <button type="button" className={linkButton} disabled={phase === "busy"} onClick={() => { touch(); setSheet("link"); }}>
                    {gt("Use another device instead")}
                  </button>
                  <button type="button" className={linkButton} disabled={phase === "busy"} onClick={() => { touch(); setSheet("reset"); }}>
                    {gt("Forgot PIN? Start over with new keys")}
                  </button>
                </div>
              </div>
            )}

            {sheet === "link" && (
              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold">{gt("Set up with another device")}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {gt("On a phone or computer where SerikaCord already shows your encrypted messages, open Settings → Encryption → Link a new device, then scan this code or type it in.")}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-3">
                  <FakeQr />
                  <div className="text-center">
                    <p className="text-xs text-[var(--app-muted)]">{gt("Or type this code on the other device")}</p>
                    <p className="select-all font-mono text-2xl font-semibold tracking-widest text-[var(--app-text)]">K7QM-2XPA-9D</p>
                  </div>
                  <p className="text-center text-xs text-[var(--app-muted)]">{gt("The code works once and expires in 5 minutes.")}</p>
                  <button type="button" onClick={() => setSheet("pin")} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-[var(--bg-hover)]">
                    <KeyRound className="h-4 w-4" />
                    {gt("Use my PIN instead")}
                  </button>
                </div>
              </div>
            )}

            {sheet === "reset" && (
              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                    {gt("Start over with new keys?")}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {gt("Nothing is recovered. This creates brand-new encryption keys: encrypted messages from before can't be read on new devices (devices that already have your old keys keep them). Your contacts will see that your security code changed. Enter your account password to confirm.")}
                  </p>
                </div>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder={gt("Account password")}
                  aria-label={gt("Account password")}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className="h-10 w-full rounded-md border border-[var(--app-border)] bg-transparent px-3 text-[16px] text-[var(--app-text)] outline-none focus:border-[var(--app-accent)]"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setSheet("pin")} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]">
                    {gt("Cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={!resetPassword}
                    onClick={() => {
                      setResetPassword("");
                      setSheet("pin");
                      toast(gt("This is only a preview, so nothing was reset."));
                    }}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {gt("Start over")}
                  </button>
                </div>
              </div>
            )}

            {sheet === "lock" && (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 pr-8 text-sm font-semibold">
                  {encrypted ? <Lock className="h-4 w-4 shrink-0 text-green-500" /> : <LockOpen className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />}
                  {encrypted ? gt("Messages and calls are end-to-end encrypted.") : gt("End-to-end encryption is off")}
                </p>
                {encrypted ? (
                  <>
                    <p className="text-xs text-[var(--text-secondary)]">{gt("Only the people in this conversation can read its messages and join its calls. Not even SerikaCord can.")}</p>
                    <ul className="flex flex-col gap-1">
                      <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                        <span className="truncate text-sm">{person}</span>
                        {verified ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {gt("Verified")}
                          </span>
                        ) : (
                          <button type="button" onClick={() => setSheet("safety")} className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-[var(--app-accent)] hover:underline">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {gt("Verify safety number")}
                          </button>
                        )}
                      </li>
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        setEncrypted(false);
                        toast.success(gt("End-to-end encryption is off for this conversation."));
                      }}
                      className="self-start rounded-md px-2 py-1.5 text-sm font-medium text-red-500 hover:bg-red-500/10"
                    >
                      {gt("Turn off encryption")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {gt("{name} turned off end-to-end encryption. New messages here aren't end-to-end encrypted; earlier encrypted messages stay encrypted.", { name: gt("You") })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEncrypted(true);
                        toast.success(gt("End-to-end encryption is on for this conversation."));
                      }}
                      className="self-start rounded-md bg-[var(--app-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--text-on-accent)] hover:opacity-90"
                    >
                      {gt("Turn on encryption")}
                    </button>
                  </>
                )}
              </div>
            )}

            {sheet === "safety" && (
              <div className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <h3 className="text-lg font-semibold">{gt("Verify safety number")}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">{gt("Compare these numbers with {name}, in person or on a call. If they match, nobody is in between.", { name: person })}</p>
                </div>
                <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 rounded-lg bg-[var(--app-surface-alt)] p-3 text-center font-mono text-sm tracking-wider text-[var(--app-text)]">
                  {safetyNumber.map((g, i) => (
                    <span key={i}>{g}</span>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setSheet("lock")} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--bg-hover)]">
                    {gt("Back")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVerified(true);
                      setSheet("lock");
                    }}
                    className="rounded-md bg-[var(--app-accent)] px-3 py-2 text-sm font-semibold text-[var(--text-on-accent)] hover:opacity-90"
                  >
                    {gt("Mark as verified")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
