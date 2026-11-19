"use client";

/**
 * The homepage hero preview, fully playable. Same markup and tokens as the
 * app (see ../preview/parts.tsx for the component each piece copies), with
 * four servers and DMs to click through, voice channels to join, profiles,
 * pins, an inbox, search, threads, a forum, emoji, stickers, replies,
 * reactions, polls and an accent picker. People chat on their own while it is
 * on screen. Nothing leaves the page: it is all local state.
 *
 * The first render is deterministic (no randomness until effects run) and
 * matches the server's, whose seed timestamps arrive as `times`.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { useGT, useLocale } from "gt-next";
import {
  ArrowRight,
  AtSign,
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  Compass,
  CornerUpLeft,
  Crown,
  Download,
  Gamepad2,
  HeadphoneOff,
  Headphones,
  HelpCircle,
  Hash,
  ImagePlay,
  Inbox,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Mic,
  MicOff,
  Music2,
  PhoneOff,
  Pin,
  Plus,
  PlusCircle,
  Reply,
  Search,
  Settings,
  Signal,
  Smile,
  SmilePlus,
  Sticker,
  Upload,
  UserPlus,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { getNameplatePreset } from "@/lib/constants/nameplates";
import { twemojiSvgUrl } from "@/lib/twemoji-helpers";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/user/StatusBadge";
import { Av, Poll, Reactions, ThreadChip, type PreviewReaction } from "../preview/parts";
import { ACCENTS, EMOJI, PEOPLE, QUICK_REACTIONS, REACTION_POOL, SHOT_POOL, STICKERS, type Msg, type Person, type RoomKey, type ServerId } from "./model";
import { useLiveStrings, type ChannelDef, type Line, type LiveTimes, type ReplyContext, type ServerDef } from "./strings";

type View = { kind: "server"; server: ServerId; channel: string } | { kind: "dm"; person: Person };

type Popover =
  | { kind: "emoji" | "sticker" | "plus" | "pins" | "inbox" | "threads" | "accent" | "server" }
  | { kind: "react"; msgId: string; x: number; y: number }
  | { kind: "profile"; person: Person; x: number; y: number }
  | { kind: "image"; src: string };

interface Toast {
  id: number;
  text: string;
  cta?: boolean;
}

interface InboxItem {
  id: string;
  person: Person;
  room: RoomKey;
  text: string;
}

const KEEP = 18;
const DMS: Person[] = ["Aya", "Theo", "Rin"];
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const between = (min: number, max: number) => min + Math.random() * (max - min);

function roomOf(view: View): RoomKey {
  return view.kind === "dm" ? `dm:${view.person}` : `${view.server}:${view.channel}`;
}

function Emoji({ e, size = 20 }: { e: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- Twemoji SVG, same source as the app
  return <img src={twemojiSvgUrl(e)} alt={e} width={size} height={size} draggable={false} className="inline-block" style={{ width: size, height: size }} />;
}

export function LivePreview({ times }: { times: LiveTimes }) {
  const gt = useGT();
  const locale = useLocale();
  const S = useLiveStrings(gt, times);
  const serverById = useMemo(() => Object.fromEntries(S.servers.map((s) => [s.id, s])) as Record<ServerId, ServerDef>, [S.servers]);

  // ── state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>({ kind: "server", server: "night-owls", channel: "general" });
  const [lastChannel, setLastChannel] = useState<Record<ServerId, string>>({
    "night-owls": "general",
    "pixel-club": "general",
    "art-corner": "general",
    "lofi-lounge": "general",
  });
  const [rooms, setRooms] = useState<Record<RoomKey, Msg[]>>(() => S.seeds);
  const [unread, setUnread] = useState<Record<RoomKey, boolean>>({ "night-owls:clips": true, "pixel-club:general": true, "pixel-club:lfg": true, "lofi-lounge:general": true });
  const [mentions, setMentions] = useState<Record<RoomKey, number>>({ "art-corner:general": 1 });
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [voice, setVoice] = useState<Record<string, Person[]>>(() => {
    const v: Record<string, Person[]> = {};
    for (const s of S.servers) for (const [ch, people] of Object.entries(s.voice)) v[`${s.id}:${ch}`] = people;
    return v;
  });
  const [myVoice, setMyVoice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Person | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [typing, setTyping] = useState<{ room: RoomKey; who: Person[] }>({ room: "", who: [] });
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [search, setSearch] = useState("");
  const [bellOff, setBellOff] = useState<Record<RoomKey, boolean>>({});
  const [membersOpen, setMembersOpen] = useState(true);
  const [threadOpen, setThreadOpen] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [vote, setVote] = useState<number | null>(0);
  const [settled, setSettled] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const roomsRef = useRef(rooms);
  const myVoiceRef = useRef(myVoice);
  const voiceRef = useRef(voice);
  const nextId = useRef(1);
  const inView = useRef(false);
  // Live messages start at the devices' clock (DEVICE_TIME, 14:44).
  const clockRef = useRef(14 * 60 + 44);
  const lastAuthor = useRef<Person>("Mika");
  const joined = useRef(new Set<ServerId>());
  /** The conversation playing in each room: its lines, the next index and who plays whom. */
  const convos = useRef<Record<RoomKey, { lines: Line[]; i: number; cast: Person[]; last: number }>>({});

  useEffect(() => {
    viewRef.current = view;
    roomsRef.current = rooms;
    myVoiceRef.current = myVoice;
    voiceRef.current = voice;
  }, [view, rooms, myVoice, voice]);

  // ── helpers ────────────────────────────────────────────────────────────
  const now = () => {
    clockRef.current = Math.min(clockRef.current + (Math.random() < 0.6 ? 1 : 0), 23 * 60 + 59);
    const d = new Date(Date.UTC(2026, 0, 1, Math.floor(clockRef.current / 60), clockRef.current % 60));
    let time: string;
    try {
      time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    } catch {
      time = d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    }
    return gt("Today at {time}", { time });
  };

  const showToast = (text: string, cta = false) => {
    const id = nextId.current++;
    setToast({ id, text, cta });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3600);
  };

  const post = (room: RoomKey, author: Person, text: string, extra: Partial<Msg> = {}) => {
    const msg: Msg = { id: `m${nextId.current++}`, author, text, time: now(), reactions: [], live: true, fresh: true, ...extra };
    if (author !== "Sora") lastAuthor.current = author;
    setRooms((prev) => ({ ...prev, [room]: [...(prev[room] ?? []), msg].slice(-KEEP) }));
    if (room !== roomOf(viewRef.current)) {
      setUnread((u) => ({ ...u, [room]: true }));
      if (msg.mention) setMentions((mm) => ({ ...mm, [room]: (mm[room] ?? 0) + 1 }));
    }
    if (msg.mention) setInbox((list) => [{ id: msg.id, person: author, room, text }, ...list].slice(0, 6));
  };

  const react = (room: RoomKey, id: string, emoji: string, byVisitor: boolean) => {
    setRooms((prev) => ({
      ...prev,
      [room]: (prev[room] ?? []).map((m) => {
        if (m.id !== id) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (!existing) {
          if (m.reactions.length >= 5) return m;
          return { ...m, reactions: [...m.reactions, { emoji, count: 1, mine: byVisitor, fresh: true }] };
        }
        if (byVisitor && existing.mine) {
          return {
            ...m,
            reactions: m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0),
          };
        }
        return { ...m, reactions: m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: byVisitor ? true : r.mine } : r)) };
      }),
    }));
  };

  const calm = () =>
    setRooms((prev) => {
      const out: Record<RoomKey, Msg[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        out[k] = list.map((m) =>
          m.live || m.fresh || m.reactions.some((r) => r.fresh)
            ? { ...m, live: false, fresh: false, reactions: m.reactions.map((r: PreviewReaction) => ({ ...r, fresh: false })) }
            : m,
        );
      }
      return out;
    });

  const go = (next: View) => {
    const room = roomOf(next);
    setView(next);
    if (next.kind === "server") setLastChannel((l) => ({ ...l, [next.server]: next.channel }));
    setUnread((u) => ({ ...u, [room]: false }));
    setMentions((mm) => ({ ...mm, [room]: 0 }));
    setTyping({ room: "", who: [] });
    setPopover(null);
    setSearch("");
    setReplyTo(null);
    setThreadOpen(false);
    setSettled(true);
    calm();
  };

  const joinVoice = (key: string) => {
    if (myVoice === key) return;
    setVoice((v) => {
      const out = { ...v };
      if (myVoice) out[myVoice] = (out[myVoice] ?? []).filter((p) => p !== "Sora");
      out[key] = [...(out[key] ?? []).filter((p) => p !== "Sora"), "Sora"];
      return out;
    });
    setMyVoice(key);
  };

  const leaveVoice = () => {
    if (!myVoice) return;
    const key = myVoice;
    setVoice((v) => ({ ...v, [key]: (v[key] ?? []).filter((p) => p !== "Sora") }));
    setMyVoice(null);
  };

  // Latest helpers for the loops below, without making them effect deps.
  /** The next line of the conversation in `room`, starting a new one when it's done. */
  const nextLine = (room: RoomKey, people: Person[]): { author: Person; text: string; extra: Partial<Msg> } => {
    let c = convos.current[room];
    if (!c || c.i >= c.lines.length) {
      const pool = S.talks[room] ?? S.talks[`${room.split(":")[0]}:*`] ?? S.talks["*"];
      let idx = Math.floor(Math.random() * pool.length);
      if (pool.length > 1 && c && idx === c.last) idx = (idx + 1) % pool.length;
      const cast = [...people].sort(() => Math.random() - 0.5);
      c = { lines: pool[idx], i: 0, cast, last: idx };
      convos.current[room] = c;
    }
    const line = c.lines[c.i];
    const prev = c.i > 0 ? c.lines[c.i - 1] : null;
    c.i += 1;
    const author = c.cast[line.who % c.cast.length];
    const extra: Partial<Msg> = {};
    if (line.reply && prev) extra.replyTo = { author: c.cast[prev.who % c.cast.length], text: prev.text };
    if (line.image) Object.assign(extra, { kind: "image", src: line.image });
    return { author, text: line.text, extra };
  };

  const actions = useRef({ post, react, S, nextLine });
  useEffect(() => {
    actions.current = { post, react, S, nextLine };
  });

  // ── effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // People talk on their own while someone can see it.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pace = reduced ? 1.8 : 1;
    let timer: ReturnType<typeof setTimeout>;
    let typingTimer: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      timer = setTimeout(step, ms * pace);
    };

    const step = () => {
      if (!inView.current || document.visibilityState !== "visible") return schedule(1500);
      const { post: send, react: addReaction, S: strings, nextLine: line } = actions.current;
      const current = viewRef.current;
      const roll = Math.random();

      // In a DM, the other person sometimes answers.
      if (current.kind === "dm" && roll < 0.35) {
        const room = roomOf(current);
        const next = line(room, [current.person]);
        setTyping({ room, who: [current.person] });
        typingTimer = setTimeout(() => {
          setTyping({ room: "", who: [] });
          send(room, current.person, next.text, next.extra);
          schedule(between(4000, 7000));
        }, between(1400, 2400) * pace);
        return;
      }

      const serverId: ServerId = current.kind === "server" && Math.random() < 0.8 ? current.server : pick(strings.servers).id;
      const server = strings.servers.find((s) => s.id === serverId)!;
      const textChannels = server.categories.flatMap((c) => c.channels).filter((c) => c.kind === "text");
      const here = current.kind === "server" && current.server === serverId && textChannels.some((c) => c.id === current.channel) ? current.channel : null;
      const people = server.members.filter((p) => p !== "Sora");
      const author = pick(people.filter((p) => p !== lastAuthor.current));

      if (roll < 0.14) {
        // A reaction lands on something recent here.
        const room = roomOf(current);
        const recent = (roomsRef.current[room] ?? []).slice(-4);
        if (recent.length) {
          const target = pick(recent);
          const emoji = target.reactions.length && Math.random() < 0.6 ? pick(target.reactions).emoji : pick(REACTION_POOL);
          addReaction(room, target.id, emoji, false);
        }
        return schedule(between(2500, 4500));
      }

      if (roll < 0.2 && !joined.current.has(serverId)) {
        // Someone new arrives; the visitor can wave.
        joined.current.add(serverId);
        const newcomer = pick(strings.joins.filter((p) => !server.members.includes(p)).concat(["Leo"]));
        send(`${serverId}:general`, newcomer, "", { kind: "join" });
        return schedule(between(3500, 6000));
      }

      if (roll < 0.27) {
        // A mention somewhere else: it shows up as a badge and in the inbox.
        const elsewhere = textChannels.find((c) => c.id !== here) ?? textChannels[0];
        send(`${serverId}:${elsewhere.id}`, author, pick(strings.mentions), { mention: true });
        return schedule(between(4000, 6500));
      }

      if (roll < 0.4 || !here) {
        // Somewhere else: an unread mark.
        const elsewhere = pick(textChannels.filter((c) => c.id !== here));
        const target = `${serverId}:${(elsewhere ?? textChannels[0]).id}`;
        const next = line(target, people);
        send(target, next.author, next.text, next.extra);
        return schedule(between(3000, 5500));
      }

      const room = `${serverId}:${here}`;
      const next = line(room, people);
      // Sometimes two people type at once.
      const second = Math.random() < 0.25 ? pick(people.filter((p) => p !== next.author)) : null;
      setTyping({ room, who: second ? [next.author, second] : [next.author] });
      typingTimer = setTimeout(() => {
        setTyping({ room: "", who: [] });
        send(room, next.author, next.text, next.extra);
        schedule(between(3500, 7000));
      }, between(1300, 2400) * pace);
    };

    schedule(4200);
    return () => {
      clearTimeout(timer);
      clearTimeout(typingTimer);
    };
  }, []);

  // Whoever is in your voice channel takes turns talking.
  useEffect(() => {
    if (!myVoice) return;
    const id = setInterval(() => {
      const key = myVoiceRef.current;
      const here = key ? voiceRef.current[key] ?? [] : [];
      setSpeaking(here.length && Math.random() > 0.25 ? pick(here) : null);
    }, 1800);
    return () => clearInterval(id);
  }, [myVoice]);

  // Esc closes whatever is open.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  // ── interactions ───────────────────────────────────────────────────────
  const room = roomOf(view);
  const server = view.kind === "server" ? serverById[view.server] : null;
  const channel: ChannelDef | null = server && view.kind === "server" ? server.categories.flatMap((c) => c.channels).find((c) => c.id === view.channel) ?? null : null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const reply = replyTo ? { author: replyTo.author, text: replyTo.text || gt("Sticker") } : undefined;
    setReplyTo(null);
    post(room, "Sora", text, { replyTo: reply });
    maybeAnswer(room, { text, replyTo: reply }, text);
  };

  /** Someone answers the visitor: whoever they replied to, else someone here, with a reply that fits. */
  const maybeAnswer = (target: RoomKey, context: Omit<ReplyContext, "dm">, quote: string) => {
    const dm = target.startsWith("dm:");
    const pool = dm ? [target.slice(3) as Person] : (serverById[target.split(":")[0] as ServerId]?.members ?? []).filter((p) => p !== "Sora");
    const repliedTo = context.replyTo?.author as Person | undefined;
    const who = repliedTo && repliedTo !== "Sora" && pool.includes(repliedTo) ? repliedTo : pick(pool);
    const answer = actions.current.S.replyFor({ ...context, dm });
    setTimeout(() => setTyping({ room: target, who: [who] }), 700);
    setTimeout(() => {
      setTyping({ room: "", who: [] });
      actions.current.post(target, who, answer, dm ? {} : { replyTo: { author: "Sora", text: quote } });
    }, between(2000, 3200));
  };

  const sendSticker = (s: string) => {
    setPopover(null);
    post(room, "Sora", "", { kind: "sticker", src: s });
    maybeAnswer(room, { text: "", kind: "sticker" }, gt("Sticker"));
  };

  const sendImage = () => {
    setPopover(null);
    post(room, "Sora", gt("look at this 👀"), { kind: "image", src: pick(SHOT_POOL) });
    maybeAnswer(room, { text: gt("look at this 👀"), kind: "image" }, gt("look at this 👀"));
  };

  const anchored = (e: ReactMouseEvent, kind: "profile" | "react", extra: { person?: Person; msgId?: string }) => {
    const root = rootRef.current?.getBoundingClientRect();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!root) return;
    const x = Math.min(Math.max(8, r.left - root.left), root.width - 300);
    const y = Math.min(Math.max(8, r.bottom - root.top + 6), root.height - 430);
    if (kind === "profile" && extra.person) setPopover({ kind, person: extra.person, x, y });
    if (kind === "react" && extra.msgId) setPopover({ kind, msgId: extra.msgId, x: Math.min(x, root.width - 280), y: Math.min(y, root.height - 200) });
  };

  const onRootPointerDown = (e: ReactPointerEvent) => {
    if (!popover) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-pop]") || t.closest("[data-pop-trigger]")) return;
    setPopover(null);
  };

  const toggle = (kind: "emoji" | "sticker" | "plus" | "pins" | "inbox" | "threads" | "accent" | "server") => setPopover((p) => (p && p.kind === kind ? null : { kind }));

  // ── derived ────────────────────────────────────────────────────────────
  const messages = rooms[room] ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? messages.filter((m) => m.text.toLowerCase().includes(q)) : messages;
  const groups: Msg[][] = [];
  for (const m of shown) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && prev.author === m.author && !prev.kind && !m.kind && !m.replyTo && last.length < 5) last.push(m);
    else groups.push([m]);
  }
  const typingHere = typing.room === room ? typing.who : [];
  const typingText =
    typingHere.length === 2 ? gt("{a} and {b} are typing...", { a: typingHere[0], b: typingHere[1] }) : typingHere.length === 1 ? gt("{user} is typing...", { user: typingHere[0] }) : null;
  const serverHas = (id: ServerId, map: Record<RoomKey, boolean | number>) => Object.entries(map).some(([k, v]) => k.startsWith(`${id}:`) && !!v);
  const serverMentions = (id: ServerId) => Object.entries(mentions).reduce((n, [k, v]) => (k.startsWith(`${id}:`) ? n + v : n), 0);
  const dmUnread = DMS.some((p) => unread[`dm:${p}`]);
  const title = view.kind === "dm" ? view.person : channel?.name ?? "";
  const placeholder = view.kind === "dm" ? `${gt("Message")} @${view.person}` : `${gt("Message")} #${title}`;
  const pinned = messages.filter((m) => m.pinned);
  const showMembers = view.kind === "server" && channel?.kind !== "forum";
  const style = accent ? ({ "--app-accent": accent, "--accent-color": accent } as CSSProperties) : undefined;

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      className="hm-frame m-0"
      role="region"
      aria-label={gt("Preview of the SerikaCord app: a server with text and voice channels, a chat with reactions, a poll and a thread, and friends talking in a voice channel")}
      style={style}
      onPointerDown={onRootPointerDown}
    >
      <div className="hm-app" data-members={showMembers && membersOpen ? undefined : "off"}>
        {/* ── server rail ── */}
        <div className="hm-app-rail flex flex-col items-center w-[72px] h-full bg-[var(--app-bg)] py-3 gap-2 border-r border-[var(--app-border)]">
          <RailButton active={view.kind === "dm"} unread={dmUnread} title={gt("Direct Messages")} onClick={() => go({ kind: "dm", person: "Aya" })}>
            <MessageSquare className="w-7 h-7 text-[var(--text-secondary)]" />
          </RailButton>
          <span className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />
          <div className="flex-1 w-full overflow-hidden py-0.5">
            <div className="flex flex-col items-center gap-2">
              {S.servers.map((s) => {
                const active = view.kind === "server" && view.server === s.id;
                const count = serverMentions(s.id);
                return (
                  <RailButton
                    key={s.id}
                    active={active}
                    unread={!active && serverHas(s.id, unread)}
                    mention={active ? 0 : count}
                    title={s.name}
                    onClick={() => go({ kind: "server", server: s.id, channel: lastChannel[s.id] })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- static sample server icon */}
                    <img src={`/home/servers/${s.id}.webp`} alt="" width={48} height={48} className="w-12 h-12 object-cover" draggable={false} />
                  </RailButton>
                );
              })}
            </div>
          </div>
          <span className="w-8 h-0.5 bg-[var(--app-border)] rounded-full" />
          {[
            { icon: Plus, label: gt("Add a server") },
            { icon: Compass, label: gt("Discover") },
            { icon: Download, label: gt("Download apps") },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              tabIndex={-1}
              title={label}
              onClick={() => showToast(gt("Make your own server in SerikaCord. It's free!"), true)}
              className="hm-rail-btn flex items-center justify-center w-12 h-12 rounded-[24px] bg-[var(--bg-sidebar-elevated)] transition-[border-radius,background-color] hover:rounded-[16px] hover:bg-[var(--app-accent)] group/act"
            >
              <Icon className="w-6 h-6 text-[var(--app-accent)] group-hover/act:text-white transition-colors" />
            </button>
          ))}
        </div>

        {/* ── sidebar ── */}
        <div className="hm-app-side relative flex flex-col w-64 h-full min-h-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] overflow-hidden">
          {view.kind === "dm" ? (
            <>
              <div className="flex items-center border-b border-[var(--border-subtle)] shrink-0 h-12 px-2.5">
                <div className="w-full rounded bg-[var(--app-surface-alt)] px-2 py-1 text-[13px] text-[var(--app-muted)]">{gt("Find or start a conversation")}</div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden py-2 px-2">
                <div className="flex items-center gap-3 rounded px-2 py-2 text-[var(--text-secondary)]">
                  <Users className="w-5 h-5" />
                  <span className="text-sm font-medium">{gt("Friends")}</span>
                </div>
                <div className="mt-3 mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{gt("Direct Messages")}</div>
                {DMS.map((p) => {
                  const active = view.person === p;
                  const isUnread = !active && unread[`dm:${p}`];
                  return (
                    <button
                      key={p}
                      type="button"
                      tabIndex={-1}
                      onClick={() => go({ kind: "dm", person: p })}
                      className={cn(
                        "flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]",
                        active && "bg-[var(--bg-active)]",
                      )}
                    >
                      <span className="relative shrink-0">
                        <Av name={p} className="w-8 h-8" fallbackClassName="text-sm" />
                        <StatusBadge status={p === "Rin" ? "idle" : "online"} size={10} ring={3} ringColor="var(--bg-sidebar-solid)" corner decorative />
                      </span>
                      <span className={cn("truncate text-sm", active || isUnread ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{p}</span>
                      {isUnread && <span className="hm-pop-live ms-auto h-2 w-2 rounded-full bg-[var(--app-accent)]" />}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            server && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  data-pop-trigger
                  onClick={() => toggle("server")}
                  aria-expanded={popover?.kind === "server"}
                  className={cn(
                    "relative flex items-center justify-between border-b border-[var(--border-subtle)] shrink-0 h-12 px-4 text-left transition-colors hover:bg-[var(--bg-hover)]",
                    popover?.kind === "server" && "bg-[var(--bg-hover)]",
                  )}
                >
                  <span className="font-semibold truncate text-[var(--text-primary)]">{server.name}</span>
                  {popover?.kind === "server" ? (
                    <X className="relative w-5 h-5 shrink-0 text-[var(--text-primary)]" />
                  ) : (
                    <ChevronDown className="relative w-5 h-5 shrink-0 text-[var(--text-primary)]" />
                  )}
                </button>
                {popover?.kind === "server" && (
                  <div data-pop className="hm-pop-in absolute left-2 right-2 top-[52px] z-30 flex flex-col gap-0.5 rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] p-1.5 shadow-[var(--app-elev-2)]">
                    <MenuItem
                      icon={<UserPlus className="h-4 w-4" />}
                      label={gt("Invite People")}
                      onClick={() => {
                        setPopover(null);
                        showToast(gt("Invite link copied! (Not really, this is a preview.)"));
                      }}
                    />
                    <MenuItem
                      icon={<Inbox className="h-4 w-4" />}
                      label={gt("Mark As Read")}
                      onClick={() => {
                        setPopover(null);
                        setUnread((u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, k.startsWith(`${server.id}:`) ? false : v])));
                        setMentions((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k.startsWith(`${server.id}:`) ? 0 : v])));
                      }}
                    />
                    <MenuItem
                      icon={bellOff[room] ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                      label={bellOff[room] ? gt("Unmute Channel") : gt("Mute Channel")}
                      onClick={() => {
                        setPopover(null);
                        const off = !bellOff[room];
                        setBellOff((b) => ({ ...b, [room]: off }));
                        showToast(off ? gt("Notifications muted for {name}", { name: title }) : gt("Notifications on for {name}", { name: title }));
                      }}
                    />
                    <MenuItem
                      icon={<PlusCircle className="h-4 w-4" />}
                      label={gt("Create Channel")}
                      onClick={() => {
                        setPopover(null);
                        showToast(gt("Make your own server in SerikaCord. It's free!"), true);
                      }}
                    />
                    <MenuItem
                      icon={<Settings className="h-4 w-4" />}
                      label={gt("Server Settings")}
                      onClick={() => {
                        setPopover(null);
                        showToast(gt("Make your own server in SerikaCord. It's free!"), true);
                      }}
                    />
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className="py-3">
                    <div className="mb-4 min-h-[8px] rounded" />
                    {server.categories.map((cat) => {
                      const ck = `${server.id}:${cat.id}`;
                      const closed = !!collapsed[ck];
                      return (
                        <div key={cat.id} className="mb-4 rounded">
                          <div className="px-2 mb-1 relative">
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={() => setCollapsed((c) => ({ ...c, [ck]: !c[ck] }))}
                              className="w-full px-1 flex items-center gap-0.5 min-w-0 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            >
                              <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", !closed && "rotate-90")} />
                              <span className="text-xs font-bold uppercase truncate min-w-0">{cat.name}</span>
                            </button>
                          </div>
                          <div className="space-y-0.5">
                            {cat.channels.map((ch) => {
                              const key = `${server.id}:${ch.id}`;
                              const active = view.channel === ch.id;
                              if (closed && !active && !(ch.kind === "voice" && myVoice === key)) return null;
                              if (ch.kind === "voice") {
                                const here = voice[key] ?? [];
                                const connected = myVoice === key;
                                return (
                                  <div key={ch.id} className="mb-0.5 relative">
                                    <button
                                      type="button"
                                      tabIndex={-1}
                                      onClick={() => joinVoice(key)}
                                      title={connected ? undefined : gt("Join voice")}
                                      className={cn(
                                        "w-full px-2 py-1 mx-2 rounded flex items-center gap-1.5 min-w-0 overflow-hidden text-left cursor-pointer transition-colors hover:bg-[var(--bg-hover)]",
                                        connected ? "text-green-400" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                                      )}
                                      style={{ width: "calc(100% - 16px)" }}
                                    >
                                      <Volume2 className={cn("w-4 h-4 flex-shrink-0", connected ? "text-green-400" : "text-[var(--text-muted)]")} />
                                      <span className="truncate text-sm flex-1 min-w-0">{ch.name}</span>
                                    </button>
                                    {here.length > 0 && (
                                      <div className="ml-6 mr-2 space-y-0.5 mb-1">
                                        {here.map((p) => {
                                          const talking = connected && speaking === p && !(p === "Sora" && muted);
                                          return (
                                            <div key={p} className={cn("flex items-center gap-1.5 px-1.5 py-0.5 rounded", p === "Sora" && "hm-pop-live")}>
                                              <span className={cn("shrink-0 rounded-full transition-shadow", talking && "ring-2 ring-[#23a55a] ring-offset-1 ring-offset-[var(--bg-sidebar)]")}>
                                                <Av name={p} className="w-5 h-5" fallbackClassName="text-[9px]" />
                                              </span>
                                              <span className={cn("text-xs truncate flex-1", talking ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{p}</span>
                                              {p === "Sora" && muted && <MicOff className="w-3 h-3 shrink-0 text-[#ef4444]" />}
                                              {p === "Jun" && <MicOff className="w-3 h-3 shrink-0 text-[var(--text-muted)]" />}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              const Icon = ch.kind === "announcement" ? Megaphone : ch.kind === "forum" ? MessagesSquare : Hash;
                              const isUnread = !active && unread[key];
                              const count = active ? 0 : mentions[key] ?? 0;
                              return (
                                <div key={ch.id} className="relative">
                                  {isUnread && <div className="hm-unread-pill absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-[var(--text-primary)] z-20" />}
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    onClick={() => go({ kind: "server", server: server.id, channel: ch.id })}
                                    className={cn(
                                      "w-full px-2 py-1.5 mx-2 rounded flex items-center gap-1.5 text-left text-[var(--text-muted)] min-w-0 overflow-hidden cursor-pointer transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                                      active && "bg-[var(--bg-active)] text-[var(--app-accent)] hover:bg-[var(--bg-active)] hover:text-[var(--app-accent)]",
                                      isUnread && "text-[var(--text-primary)] font-semibold",
                                    )}
                                    style={{ width: "calc(100% - 16px)" }}
                                  >
                                    <Icon className="w-5 h-5 flex-shrink-0 text-[var(--text-muted)]" />
                                    <span className="truncate text-sm flex-1 min-w-0">{ch.name}</span>
                                    {bellOff[key] && <BellOff className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />}
                                    {count > 0 && (
                                      <span className="hm-pop-live flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">{count}</span>
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )
          )}

          {/* Voice connected bar */}
          {myVoice && (
            <div className="hm-live-in shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3 py-2">
              <div className="flex items-center gap-2">
                <Signal className="h-4 w-4 text-green-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-green-400">{gt("Voice Connected")}</div>
                  <div className="truncate text-xs text-[var(--app-muted)]">
                    {serverById[myVoice.split(":")[0] as ServerId]?.categories.flatMap((c) => c.channels).find((c) => c.id === myVoice.split(":")[1])?.name} /{" "}
                    {serverById[myVoice.split(":")[0] as ServerId]?.name}
                  </div>
                </div>
                <button type="button" tabIndex={-1} onClick={leaveVoice} title={gt("Disconnect")} className="rounded p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[#ef4444]">
                  <PhoneOff className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* User panel */}
          <div className="relative overflow-hidden h-[52px] px-2 flex items-center bg-[var(--bg-sidebar)] border-t border-[var(--border-subtle)] shrink-0">
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: getNameplatePreset("grape")?.css,
                opacity: 0.55,
                WebkitMaskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
                maskImage: "linear-gradient(90deg, #000 55%, transparent 100%)",
              }}
            />
            <button
              type="button"
              tabIndex={-1}
              data-pop-trigger
              onClick={(e) => anchored(e, "profile", { person: "Sora" })}
              className="relative z-10 flex items-center gap-2 flex-1 min-w-0 p-1 rounded text-left hover:bg-[var(--bg-hover)] transition-colors"
            >
              <span className="relative shrink-0">
                <Av name="Sora" className="w-8 h-8" fallbackClassName="text-sm" />
                <StatusBadge status="online" size={10} ring={3} ringColor="var(--bg-sidebar-solid)" corner decorative />
              </span>
              <span className="text-sm font-bold truncate text-[var(--text-primary)]">Sora</span>
            </button>
            <div className="relative z-10 flex items-center gap-0.5">
              <IconBtn label={muted ? gt("Unmute") : gt("Mute")} onClick={() => setMuted((v) => !v)} active={muted}>
                {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </IconBtn>
              <IconBtn label={deafened ? gt("Undeafen") : gt("Deafen")} onClick={() => setDeafened((v) => !v)} active={deafened}>
                {deafened ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
              </IconBtn>
              <IconBtn label={gt("User settings")} onClick={() => toggle("accent")} trigger>
                <Settings className="w-5 h-5" />
              </IconBtn>
            </div>
          </div>

          {popover?.kind === "accent" && (
            <div data-pop className="hm-pop-in absolute bottom-14 left-2 z-30 w-60 rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-3 shadow-2xl">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Accent color")}</div>
              <div className="mt-2.5 flex gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    tabIndex={-1}
                    onClick={() => setAccent(c)}
                    className={cn("h-8 w-8 rounded-full transition-transform hover:scale-110", (accent ?? ACCENTS[0]) === c && "ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-card)]")}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <p className="mt-2.5 text-xs text-[var(--app-muted)]">{gt("Pick one: the whole preview follows.")}</p>
            </div>
          )}
        </div>

        {/* ── chat ── */}
        <div className="chat-shell relative flex-1 flex flex-col bg-[var(--app-bg)] min-w-0 min-h-0 overflow-hidden">
          <div className="min-w-0 overflow-hidden h-12 px-2 sm:px-4 flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface)] flex-shrink-0">
            <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
              {view.kind === "dm" ? (
                <span className="relative shrink-0">
                  <Av name={view.person} className="w-6 h-6" fallbackClassName="text-xs" />
                </span>
              ) : channel?.kind === "announcement" ? (
                <Megaphone className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
              ) : channel?.kind === "forum" ? (
                <MessagesSquare className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
              ) : (
                <Hash className="w-5 sm:w-6 h-5 sm:h-6 text-[var(--app-muted-2)] flex-shrink-0" />
              )}
              <span className="min-w-0 shrink truncate font-semibold text-[var(--text-primary)] text-sm sm:text-base">{title}</span>
            </div>
            <div className="relative flex shrink-0 items-center gap-2 sm:gap-4 pl-2 text-[var(--app-muted)]">
              {view.kind === "server" && (
                <HeaderBtn label={gt("Threads")} onClick={() => toggle("threads")} on={popover?.kind === "threads"}>
                  <MessagesSquare className="w-5 h-5" />
                </HeaderBtn>
              )}
              <HeaderBtn
                label={bellOff[room] ? gt("Unmute channel") : gt("Mute channel")}
                className="hidden md:flex"
                onClick={() => {
                  const off = !bellOff[room];
                  setBellOff((b) => ({ ...b, [room]: off }));
                  showToast(off ? gt("Notifications muted for {name}", { name: title }) : gt("Notifications on for {name}", { name: title }));
                }}
              >
                {bellOff[room] ? <BellOff className="w-5 h-5 text-[#ef4444]" /> : <Bell className="w-5 h-5" />}
              </HeaderBtn>
              <HeaderBtn label={gt("Pinned messages")} onClick={() => toggle("pins")} on={popover?.kind === "pins"}>
                <Pin className="w-5 h-5" />
              </HeaderBtn>
              {view.kind === "server" && (
                <HeaderBtn label={gt("Member list")} onClick={() => setMembersOpen((o) => !o)} on={membersOpen && showMembers}>
                  <Users className="w-5 h-5" />
                </HeaderBtn>
              )}
              <div className="h-6 w-px bg-[var(--app-border)] hidden lg:block" />
              <div className="relative hidden lg:block">
                <div className="relative flex items-center rounded bg-[var(--app-surface-alt)] h-6 w-36 focus-within:w-44 transition-[width]">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={view.kind === "dm" ? gt("Search") : gt("Search {server}", { server: server?.name ?? "" })}
                    aria-label={gt("Search")}
                    className="w-full bg-transparent pl-2 pr-7 text-sm text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted)]"
                  />
                  {search ? (
                    <button type="button" tabIndex={-1} onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
                  )}
                </div>
              </div>
              <HeaderBtn label={gt("Inbox")} className="hidden md:flex relative" onClick={() => toggle("inbox")} on={popover?.kind === "inbox"}>
                <Inbox className="w-5 h-5" />
                {inbox.length > 0 && (
                  <span className="hm-pop-live absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-bold text-white">{inbox.length}</span>
                )}
              </HeaderBtn>
              <HeaderBtn label={gt("Help")} className="hidden lg:flex" onClick={() => showToast(gt("Need help? The real app has a whole help center 💜"))}>
                <HelpCircle className="w-5 h-5" />
              </HeaderBtn>
            </div>
          </div>

          {/* Header popovers */}
          {popover?.kind === "pins" && (
            <PopCard title={gt("Pinned messages")} onClose={() => setPopover(null)} className="right-2 top-12">
              {pinned.length ? (
                pinned.map((m) => (
                  <div key={m.id} className="flex gap-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5">
                    <Av name={m.author} className="h-8 w-8" fallbackClassName="text-xs" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)]">{m.author}</div>
                      <div className="text-sm text-[var(--app-text)]">{m.text || gt("Sticker")}</div>
                    </div>
                  </div>
                ))
              ) : (
                <Empty emoji="📌" text={gt("Nothing pinned here yet. Pin something from a message's menu.")} />
              )}
            </PopCard>
          )}
          {popover?.kind === "inbox" && (
            <PopCard title={gt("Inbox")} onClose={() => setPopover(null)} className="right-2 top-12">
              {inbox.length ? (
                inbox.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setInbox((l) => l.filter((x) => x.id !== it.id));
                      const [sid, cid] = it.room.split(":");
                      go(it.room.startsWith("dm:") ? { kind: "dm", person: cid as Person } : { kind: "server", server: sid as ServerId, channel: cid });
                    }}
                    className="flex w-full gap-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5 text-left transition-colors hover:border-[var(--app-accent)]"
                  >
                    <Av name={it.person} className="h-8 w-8" fallbackClassName="text-xs" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)]">{gt("{name} mentioned you", { name: it.person })}</div>
                      <div className="truncate text-sm text-[var(--app-muted)]">@Sora {it.text}</div>
                    </div>
                  </button>
                ))
              ) : (
                <Empty emoji="📭" text={gt("You're all caught up! Mentions show up here.")} />
              )}
            </PopCard>
          )}
          {popover?.kind === "threads" && (
            <PopCard title={gt("Threads")} onClose={() => setPopover(null)} className="right-2 top-12">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setPopover(null);
                  setThreadOpen(true);
                }}
                className="flex w-full flex-col gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5 text-left transition-colors hover:border-[var(--app-accent)]"
              >
                <span className="text-sm font-semibold text-[var(--text-primary)]">{gt("Patch notes megathread")}</span>
                <span className="text-xs text-[var(--app-muted)]">{gt("{count} Messages", { count: 12 })}</span>
              </button>
            </PopCard>
          )}

          {/* Messages / forum */}
          {channel?.kind === "forum" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-[var(--app-surface-alt)] px-3 py-2 text-sm text-[var(--app-muted)]">{gt("Search or create a post...")}</div>
                <button type="button" tabIndex={-1} onClick={() => showToast(gt("Posting works in the real app ✨"), true)} className="rounded-lg bg-[var(--app-accent)] px-3 py-2 text-sm font-semibold text-white">
                  {gt("New post")}
                </button>
              </div>
              {S.forumPosts.map((p, i) => (
                <button
                  key={p.title}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setThreadOpen(true)}
                  className="hm-live-in flex items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-3 text-left transition-colors hover:border-[var(--app-accent)]"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <Av name={p.by} className="h-9 w-9" fallbackClassName="text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{p.title}</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      {p.by} · {gt("{count} replies", { count: p.replies })}
                    </div>
                  </div>
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--app-accent)_18%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">{p.tag}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className={cn("flex min-h-0 flex-1 flex-col justify-end overflow-hidden py-4", settled && "hm-still")}>
              {q && (
                <div className="mx-4 mb-2 flex items-center justify-between rounded-lg bg-[var(--app-surface-alt)] px-3 py-1.5 text-xs text-[var(--app-muted)]">
                  <span>{gt("{count} results", { count: shown.length })}</span>
                  <button type="button" tabIndex={-1} onClick={() => setSearch("")} className="font-semibold text-[var(--app-accent)]">
                    {gt("Clear")}
                  </button>
                </div>
              )}
              {view.kind === "dm" && !q && (
                <div className="px-4 pb-4">
                  <Av name={view.person} className="h-16 w-16" fallbackClassName="text-xl" />
                  <div className="mt-2 text-xl font-bold text-[var(--text-primary)]">{view.person}</div>
                  <div className="text-sm text-[var(--app-muted)]">{gt("This is the beginning of your direct messages with {name}.", { name: view.person })}</div>
                </div>
              )}
              {groups.map((group, gi) => (
                <MessageGroupLive
                  key={group[0].id}
                  group={group}
                  i={gi}
                  gt={gt}
                  vote={vote}
                  onVote={setVote}
                  threadTime={times.thread}
                  onOpenThread={() => setThreadOpen(true)}
                  onReact={(id, e) => react(room, id, e, true)}
                  onPickReaction={(e, id) => anchored(e, "react", { msgId: id })}
                  onReply={(m) => setReplyTo(m)}
                  onPin={(id) => {
                    setRooms((prev) => ({ ...prev, [room]: (prev[room] ?? []).map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)) }));
                  }}
                  onProfile={(e, p) => anchored(e, "profile", { person: p })}
                  onImage={(src) => setPopover({ kind: "image", src })}
                  onWave={(p) => {
                    post(room, "Sora", "", { kind: "sticker", src: "👋", replyTo: { author: p, text: gt("joined") } });
                    setTimeout(() => actions.current.post(room, p, gt("hi hi!! thanks for the wave 🥹")), 1600);
                  }}
                />
              ))}
            </div>
          )}

          <Typing text={typingText} />

          {/* Composer */}
          <div className="px-1 sm:px-2 pb-1 sm:pb-1.5 flex-shrink-0 relative">
            <div className="bg-[var(--app-surface)] rounded-lg border border-[var(--app-border)] shadow-[var(--app-elev-1)] overflow-hidden">
              {replyTo && (
                <div className="hm-live-in flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface-alt)] px-3 py-1.5 text-xs text-[var(--app-muted)]">
                  <span>
                    {gt("Replying to")} <span className="font-semibold text-[var(--text-primary)]">{replyTo.author}</span>
                  </span>
                  <button type="button" tabIndex={-1} onClick={() => setReplyTo(null)} className="rounded-full p-0.5 hover:text-[var(--text-primary)]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="relative flex items-center">
                <button
                  type="button"
                  tabIndex={-1}
                  data-pop-trigger
                  onClick={() => toggle("plus")}
                  className="absolute left-0 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10 transition-colors hover:text-[var(--text-primary)]"
                  aria-label={gt("Upload")}
                >
                  <PlusCircle className="w-5 sm:w-6 h-5 sm:h-6" />
                </button>
                <form
                  className="w-full"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={channel?.kind === "forum" ? gt("Open a post to reply") : placeholder}
                    aria-label={placeholder}
                    maxLength={200}
                    autoComplete="off"
                    enterKeyHint="send"
                    disabled={channel?.kind === "forum"}
                    className="block w-full min-h-[44px] py-2.5 pl-10 sm:pl-14 pr-24 sm:pr-40 text-base bg-transparent text-[var(--app-text)] outline-none placeholder:text-[var(--app-muted-2)] disabled:cursor-not-allowed"
                  />
                </form>
                <div className="absolute right-0 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-0 sm:gap-4 text-[var(--app-muted)]">
                  <ComposerBtn label={gt("GIF")} className="hidden sm:block" onClick={() => showToast(gt("GIF search lives in the real app 🎬"))}>
                    <ImagePlay className="w-6 h-6" />
                  </ComposerBtn>
                  <ComposerBtn label={gt("Stickers")} className="hidden sm:block" onClick={() => toggle("sticker")} trigger>
                    <Sticker className="w-6 h-6" />
                  </ComposerBtn>
                  <ComposerBtn label={gt("Emoji")} onClick={() => toggle("emoji")} trigger>
                    <Smile className="w-5 sm:w-6 h-5 sm:h-6" />
                  </ComposerBtn>
                  {view.kind === "server" && (
                    <ComposerBtn label={gt("Voice message")} onClick={() => showToast(gt("Voice messages work in the real app 🎙️"))}>
                      <Mic className="w-5 sm:w-6 h-5 sm:h-6" />
                    </ComposerBtn>
                  )}
                </div>
              </div>
            </div>

            {popover?.kind === "plus" && (
              <div data-pop className="hm-pop-in absolute bottom-[56px] left-2 z-30 w-56 rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-1.5 shadow-2xl">
                <MenuItem icon={<Upload className="h-4 w-4" />} label={gt("Upload a file")} onClick={sendImage} />
                <MenuItem icon={<Sticker className="h-4 w-4" />} label={gt("Send a sticker")} onClick={() => setPopover({ kind: "sticker" })} />
              </div>
            )}
            {popover?.kind === "emoji" && (
              <div data-pop className="hm-pop-in absolute bottom-[56px] right-2 z-30 w-[288px] rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-2.5 shadow-2xl">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Emoji")}</div>
                <div className="grid grid-cols-8 gap-1">
                  {EMOJI.map((e) => (
                    <button key={e} type="button" tabIndex={-1} onClick={() => setDraft((d) => (d + e).slice(0, 200))} className="flex h-8 w-8 items-center justify-center rounded-md transition-transform hover:scale-125 hover:bg-[var(--bg-hover)]">
                      <Emoji e={e} size={22} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {popover?.kind === "sticker" && (
              <div data-pop className="hm-pop-in absolute bottom-[56px] right-2 z-30 w-[288px] rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-2.5 shadow-2xl">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("Stickers")}</div>
                <div className="grid grid-cols-3 gap-2">
                  {STICKERS.map((s) => (
                    <button key={s} type="button" tabIndex={-1} onClick={() => sendSticker(s)} className="hm-sticker-pick flex aspect-square items-center justify-center rounded-lg bg-[var(--app-surface-alt)] p-3 transition-transform hover:scale-105">
                      <StickerArt src={s} size={54} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {toast && (
            <div key={toast.id} className="hm-toast absolute bottom-[70px] left-1/2 z-40 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] px-3.5 py-2.5 text-sm text-[var(--app-text)] shadow-2xl">
              <span>{toast.text}</span>
              {toast.cta && (
                <Link href="/channels/me" className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--app-accent)] px-2.5 py-1 text-xs font-semibold text-white">
                  {gt("Open SerikaCord")}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ── members / thread ── */}
        {threadOpen ? (
          <div className="hm-app-members hm-live-in w-56 shrink-0 h-full bg-[var(--app-bg)] border-l border-[var(--app-border)] overflow-hidden flex flex-col">
            <div className="flex h-12 items-center justify-between border-b border-[var(--app-border)] px-3">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <MessagesSquare className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
                <span className="truncate">{gt("Patch notes megathread")}</span>
              </span>
              <button type="button" tabIndex={-1} onClick={() => setThreadOpen(false)} className="rounded p-1 text-[var(--app-muted)] hover:text-[var(--text-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden p-3">
              {S.thread.map((t, i) => (
                <div key={i} className="hm-live-in flex gap-2" style={{ animationDelay: `${i * 90}ms` }}>
                  <Av name={t.author} className="h-7 w-7" fallbackClassName="text-xs" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-[var(--text-primary)]">{t.author}</div>
                    <div className="text-[13px] leading-snug text-[var(--app-text)]">{t.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          showMembers &&
          server && (
            <div className="hm-app-members w-56 shrink-0 h-full bg-[var(--app-bg)] border-l border-[var(--app-border)] overflow-hidden">
              <div className="py-4">
                <p className="px-4 text-[11px] font-semibold uppercase tracking-wide text-[#7d7d7d]">
                  {gt("Online")} — {server.members.length}
                </p>
                {server.members.map((p) => {
                  const meta = PEOPLE[p];
                  const bg = meta.nameplate ? getNameplatePreset(meta.nameplate)?.css : null;
                  const act = S.activity[p];
                  return (
                    <div key={p} className="relative mt-1">
                      <button
                        type="button"
                        tabIndex={-1}
                        data-pop-trigger
                        onClick={(e) => anchored(e, "profile", { person: p })}
                        className="relative overflow-hidden px-2 py-1.5 mx-2 rounded-lg flex items-center gap-3 bg-white/[0.02] text-left transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ width: "calc(100% - 16px)" }}
                      >
                        {bg && (
                          <span
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: bg, opacity: 0.5, WebkitMaskImage: "linear-gradient(90deg, #000 60%, transparent 100%)", maskImage: "linear-gradient(90deg, #000 60%, transparent 100%)" }}
                          />
                        )}
                        <span className="relative flex-shrink-0">
                          <Av name={p} className="w-8 h-8" fallbackClassName="bg-[#8B5CF6] text-white text-xs" />
                          <StatusBadge status={p === "Leo" ? "idle" : p === "Nova" ? "dnd" : "online"} size={10} ring={3} ringColor="var(--app-bg-solid)" corner decorative />
                        </span>
                        <span className="relative flex-1 min-w-0">
                          <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)]" style={meta.color ? { color: meta.color } : undefined}>
                            <span className="truncate">{p}</span>
                            {meta.owner && <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />}
                          </span>
                          {act && (
                            <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)] min-w-0">
                              {act.kind === "game" ? <Gamepad2 className="w-2.5 h-2.5 shrink-0" /> : <Music2 className="w-2.5 h-2.5 shrink-0 fill-current" />}
                              <span className="truncate min-w-0">{act.text}</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      {/* Floating popovers */}
      {popover?.kind === "react" && (
        <div data-pop className="hm-pop-in absolute z-40 w-[264px] rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] p-2.5 shadow-2xl" style={{ left: popover.x, top: popover.y }}>
          <div className="grid grid-cols-8 gap-1">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                tabIndex={-1}
                onClick={() => {
                  react(room, popover.msgId, e, true);
                  setPopover(null);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-transform hover:scale-125 hover:bg-[var(--bg-hover)]"
              >
                <Emoji e={e} size={20} />
              </button>
            ))}
          </div>
        </div>
      )}
      {popover?.kind === "profile" && (
        <ProfileCard
          person={popover.person}
          x={popover.x}
          y={popover.y}
          gt={gt}
          bio={S.bios[popover.person]}
          activity={S.activity[popover.person]}
          onMessage={() => {
            const p = popover.person;
            if (p === "Sora") {
              setPopover({ kind: "accent" });
              return;
            }
            setRooms((r) => (r[`dm:${p}`] ? r : { ...r, [`dm:${p}`]: [] }));
            if (!DMS.includes(p)) {
              showToast(gt("Say hi to {name} in the real app 💜", { name: p }), true);
              setPopover(null);
              return;
            }
            go({ kind: "dm", person: p });
          }}
        />
      )}
      {popover?.kind === "image" && (
        <div data-pop className="hm-fade-in absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-8" onClick={() => setPopover(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static sample image */}
          <img src={popover.src} alt="" className="hm-zoom-pop max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}

    </div>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────

function RailButton({
  active,
  unread,
  mention = 0,
  title,
  onClick,
  children,
}: {
  active: boolean;
  unread?: boolean;
  mention?: number;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      onClick={onClick}
      className={cn(
        "group/rail relative flex items-center justify-center bg-[var(--bg-sidebar-elevated)] w-12 h-12 shrink-0 cursor-pointer transition-[border-radius,background-color] duration-200",
        active ? "rounded-[16px]" : "rounded-[24px] hover:rounded-[16px]",
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[inherit]">{children}</span>
      <span
        className={cn(
          "absolute -left-3 w-1 h-10 bg-[var(--text-primary)] rounded-r-full origin-center transition-transform duration-200",
          active ? "scale-y-100" : unread ? "scale-y-[0.2] group-hover/rail:scale-y-50" : "scale-y-0 group-hover/rail:scale-y-50",
        )}
      />
      {mention > 0 && (
        <span className="hm-pop-live absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#ef4444] border-[3px] border-[var(--app-bg)] text-[10px] font-bold text-white leading-none">
          {mention}
        </span>
      )}
    </button>
  );
}

function IconBtn({ label, onClick, active, trigger, children }: { label: string; onClick: () => void; active?: boolean; trigger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...(trigger ? { "data-pop-trigger": "" } : {})}
      className={cn("p-1.5 rounded transition-colors hover:bg-[var(--bg-hover)]", active ? "text-[#ef4444]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}
    >
      {children}
    </button>
  );
}

function HeaderBtn({ label, onClick, on, className, children }: { label: string; onClick: () => void; on?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      data-pop-trigger
      onClick={onClick}
      className={cn("flex items-center justify-center rounded-lg transition-colors hover:text-[var(--text-primary)]", on && "text-[var(--text-primary)]", className)}
    >
      {children}
    </button>
  );
}

function ComposerBtn({ label, onClick, trigger, className, children }: { label: string; onClick: () => void; trigger?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...(trigger ? { "data-pop-trigger": "" } : {})}
      className={cn("transition-[color,transform] hover:text-[var(--text-primary)] hover:scale-110", className)}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" tabIndex={-1} onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--app-text)] transition-colors hover:bg-[var(--app-accent)] hover:text-white">
      {icon}
      {label}
    </button>
  );
}

function PopCard({ title, onClose, className, children }: { title: string; onClose: () => void; className?: string; children: ReactNode }) {
  return (
    <div data-pop className={cn("hm-pop-in absolute z-30 flex max-h-[70%] w-[300px] flex-col overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] shadow-2xl", className)}>
      <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2.5">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <button type="button" tabIndex={-1} onClick={onClose} className="rounded p-0.5 text-[var(--app-muted)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2 overflow-hidden p-2.5">{children}</div>
    </div>
  );
}

function Empty({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-5 text-center">
      <Emoji e={emoji} size={34} />
      <p className="text-sm text-[var(--app-muted)]">{text}</p>
    </div>
  );
}

function StickerArt({ src, size }: { src: string; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- static sticker art (SVG mark or Twemoji)
  return <img src={src.startsWith("/") ? src : twemojiSvgUrl(src)} alt="" width={size} height={size} draggable={false} style={{ width: size, height: size }} className="hm-sticker-art" />;
}

function Typing({ text }: { text: string | null }) {
  return (
    <div className="px-4 h-5 flex items-center overflow-hidden">
      {text && (
        <span className="hm-fade-in inline-flex items-center gap-2 text-xs text-[var(--app-muted)]">
          <span className="flex gap-0.5 items-center">
            <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
            <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
            <span className="hm-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
          </span>
          <span className="font-medium">{text}</span>
        </span>
      )}
    </div>
  );
}

function ProfileCard({
  person,
  x,
  y,
  gt,
  bio,
  activity,
  onMessage,
}: {
  person: Person;
  x: number;
  y: number;
  gt: ReturnType<typeof useGT>;
  bio: string;
  activity?: { kind: "game" | "music"; text: string; detail?: string; art?: string };
  onMessage: () => void;
}) {
  const meta = PEOPLE[person];
  const banner = meta.nameplate ? getNameplatePreset(meta.nameplate)?.css : null;
  return (
    <div data-pop className="hm-pop-in absolute z-40 w-[280px] overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--bg-card)] shadow-2xl" style={{ left: x, top: y }}>
      <div className="h-16" style={{ background: banner ?? "var(--app-accent)" }} />
      <div className="relative px-4 pb-4">
        <span className="absolute -top-9 rounded-full ring-[5px] ring-[var(--bg-card)]">
          <Av name={person} className="h-[72px] w-[72px]" fallbackClassName="text-2xl" />
          <StatusBadge status={person === "Leo" ? "idle" : person === "Nova" ? "dnd" : "online"} size={16} ring={4} ringColor="var(--bg-card)" corner decorative />
        </span>
        <div className="pt-11">
          <div className="flex items-center gap-1.5 text-lg font-bold text-[var(--text-primary)]" style={meta.color ? { color: meta.color } : undefined}>
            {person}
            {meta.owner && <Crown className="h-4 w-4 text-[#F59E0B]" />}
          </div>
          <div className="text-sm text-[var(--app-muted)]">{meta.username}</div>
        </div>
        <div className="mt-3 rounded-lg bg-[var(--app-surface-alt)] p-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{gt("About me")}</div>
          <div className="mt-1 text-sm text-[var(--app-text)]">{bio}</div>
          {activity?.kind === "music" && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Music2 className="h-3.5 w-3.5" />
              {gt("Listening to {song}", { song: activity.text })}
            </div>
          )}
        </div>
        {/* GameActivityCard */}
        {activity?.kind === "game" && (
          <div className="mt-2 overflow-hidden rounded-lg bg-[var(--app-surface-alt)]">
            <div className="flex items-center gap-1.5 px-3 pb-2 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />
              {gt("Playing a Game")}
            </div>
            <div className="flex items-center gap-3 px-3 pb-3">
              {activity.art ? (
                // eslint-disable-next-line @next/next/no-img-element -- static sample game art
                <img src={activity.art} alt={activity.text} width={56} height={56} className="h-14 w-14 shrink-0 rounded-[8px] object-cover shadow-md ring-1 ring-inset ring-white/[0.06]" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[8px] bg-[#22c55e]/15">
                  <Gamepad2 className="h-6 w-6 text-[#22c55e]" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">{activity.text}</p>
                {activity.detail && <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{activity.detail}</p>}
                <p className="mt-1 text-[10.5px] tabular-nums text-[var(--app-muted)]">{gt("{h}h {m}m elapsed", { h: 1, m: 12 })}</p>
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={onMessage}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {person === "Sora" ? (
            gt("Edit profile")
          ) : (
            <>
              <AtSign className="h-4 w-4" />
              {gt("Message")}
            </>
          )}
        </button>
        {person !== "Sora" && (
          <div className="mt-2 flex items-center justify-center gap-1 text-xs text-[var(--app-muted)]">
            <UserPlus className="h-3.5 w-3.5" />
            {gt("Friends since 2025")}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageGroupLive({
  group,
  i,
  gt,
  vote,
  onVote,
  threadTime,
  onOpenThread,
  onReact,
  onPickReaction,
  onReply,
  onPin,
  onProfile,
  onImage,
  onWave,
}: {
  group: Msg[];
  i: number;
  gt: ReturnType<typeof useGT>;
  vote: number | null;
  onVote: (v: number | null) => void;
  threadTime: string;
  onOpenThread: () => void;
  onReact: (id: string, emoji: string) => void;
  onPickReaction: (e: ReactMouseEvent, id: string) => void;
  onReply: (m: Msg) => void;
  onPin: (id: string) => void;
  onProfile: (e: ReactMouseEvent, p: Person) => void;
  onImage: (src: string) => void;
  onWave: (p: Person) => void;
}) {
  const first = group[0];
  const meta = PEOPLE[first.author];

  if (first.kind === "join") {
    return (
      <div className={cn(first.live ? "hm-live-in" : "hm-arrive", "chat-message-row px-4 py-1.5")} style={{ "--i": i } as CSSProperties}>
        <div className={cn("flex items-center gap-3 rounded px-1 py-1", first.fresh && "hm-fresh")}>
          <ArrowRight className="h-4 w-4 shrink-0 text-green-400 rtl:rotate-180" />
          <span className="text-sm text-[var(--app-muted)]">
            {gt("{name} just showed up!", { name: first.author })} <span className="text-[11px]">{first.time}</span>
          </span>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onWave(first.author)}
            className="ms-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--app-surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--app-text)] transition-colors hover:bg-[var(--app-accent)] hover:text-white"
          >
            <Emoji e="👋" size={16} />
            {gt("Wave to say hi")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(first.live ? "hm-live-in" : "hm-arrive", "chat-message-row group py-0.5")} style={first.live ? undefined : ({ "--i": i } as CSSProperties)}>
      {group.map((m, mi) => (
        <div
          key={m.id}
          className={cn(
            "group/msg relative mx-2 rounded px-2 transition-colors hover:bg-[var(--bg-hover)]",
            mi > 0 && m.live && "hm-live-in",
            m.fresh && "hm-fresh",
            m.mention && "bg-[color-mix(in_srgb,#f59e0b_9%,transparent)] shadow-[inset_2px_0_0_#f59e0b] hover:bg-[color-mix(in_srgb,#f59e0b_14%,transparent)]",
          )}
        >
          {mi === 0 && m.replyTo && (
            <div className="flex items-center gap-1.5 pl-[52px] pt-1 text-xs text-[var(--app-muted)]">
              <CornerUpLeft className="h-3 w-3 shrink-0 rtl:-scale-x-100" />
              <Av name={m.replyTo.author} className="h-4 w-4" fallbackClassName="text-[8px]" />
              <span className="shrink-0 font-semibold text-[var(--text-secondary)]">{m.replyTo.author}</span>
              <span className="truncate">{m.replyTo.text}</span>
            </div>
          )}
          <div className="flex gap-4 py-0.5">
            <div className="w-10 flex-shrink-0">
              {mi === 0 ? (
                <button type="button" tabIndex={-1} data-pop-trigger onClick={(e) => onProfile(e, m.author)} className="block rounded-full transition-transform hover:scale-105 active:scale-95">
                  <Av name={m.author} className="w-10 h-10 mt-0.5" />
                </button>
              ) : (
                <span className="hidden pt-1 text-[10px] text-[var(--text-muted)] group-hover/msg:block">{m.time.replace(/^.*?(\d)/, "$1")}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {mi === 0 && (
                <div className="flex items-center gap-2 mb-1">
                  <button
                    type="button"
                    tabIndex={-1}
                    data-pop-trigger
                    onClick={(e) => onProfile(e, m.author)}
                    className="!text-[0.8rem] font-medium leading-tight whitespace-nowrap rounded flex items-center gap-1 text-[var(--text-primary)] hover:underline"
                    style={meta.color ? { color: meta.color } : undefined}
                  >
                    <span>{m.author}</span>
                    {meta.owner && <Crown className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B]" />}
                  </button>
                  <span className="text-[10px] leading-none text-[var(--text-muted)] whitespace-nowrap">{m.time}</span>
                  {m.pinned && <Pin className="h-3 w-3 text-[var(--text-muted)]" />}
                </div>
              )}
              {m.text && (
                <span className="twemoji whitespace-pre-wrap break-words chat-message-body text-[var(--app-text)]">
                  {m.mention && <span className="rounded bg-[color-mix(in_srgb,var(--app-accent)_22%,transparent)] px-0.5 font-medium text-[var(--app-accent)]">@Sora</span>}
                  {m.mention && " "}
                  {m.text}
                </span>
              )}
              {m.kind === "image" && m.src && (
                <button type="button" tabIndex={-1} onClick={() => onImage(m.src!)} className="mt-1 block overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static sample image */}
                  <img src={m.src} alt="" width={1280} height={720} loading="lazy" className="max-h-[200px] w-auto max-w-[min(100%,360px)] cursor-zoom-in object-cover transition-transform duration-300 hover:scale-[1.03]" />
                </button>
              )}
              {m.kind === "sticker" && m.src && (
                <div className={cn("mt-1", m.live && "hm-sticker-in")}>
                  <StickerArt src={m.src} size={112} />
                </div>
              )}
              {m.kind === "poll" && <Poll gt={gt} vote={vote} onVote={onVote} />}
              {m.kind === "thread" && (
                <button type="button" tabIndex={-1} onClick={onOpenThread} className="block w-full text-left">
                  <ThreadChip gt={gt} time={threadTime} />
                </button>
              )}
              <Reactions items={m.reactions} onToggle={(emoji) => onReact(m.id, emoji)} onAdd={(e) => onPickReaction(e, m.id)} />
            </div>
          </div>

          {/* Hover toolbar */}
          <div className="absolute -top-4 right-3 z-10 hidden items-center gap-0.5 rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] p-0.5 shadow-lg group-hover/msg:flex">
            {QUICK_REACTIONS.map((e) => (
              <button key={e} type="button" tabIndex={-1} title={e} onClick={() => onReact(m.id, e)} className="flex h-7 w-7 items-center justify-center rounded-md transition-transform hover:scale-110 hover:bg-[var(--bg-hover)]">
                <Emoji e={e} size={18} />
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-[var(--app-border)]" />
            <ToolBtn label={gt("Add reaction")} onClick={(e) => onPickReaction(e, m.id)} trigger>
              <SmilePlus className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label={gt("Reply")} onClick={() => onReply(m)}>
              <Reply className="h-4 w-4 rtl:-scale-x-100" />
            </ToolBtn>
            <ToolBtn label={m.pinned ? gt("Unpin") : gt("Pin")} onClick={() => onPin(m.id)}>
              <Pin className={cn("h-4 w-4", m.pinned && "fill-current")} />
            </ToolBtn>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolBtn({ label, onClick, trigger, children }: { label: string; onClick: (e: ReactMouseEvent) => void; trigger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...(trigger ? { "data-pop-trigger": "" } : {})}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--app-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}
