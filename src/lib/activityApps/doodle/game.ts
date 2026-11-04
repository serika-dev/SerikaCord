/**
 * Doodle Party: a drawing + guessing game (skribbl-style), SerikaCord's
 * built-in Activity. Pure game engine: every function takes the room, the
 * time and (where needed) a random source, mutates the room and returns the
 * messages to send. The WebSocket server (./server.ts) only transports them.
 *
 * Phases: lobby -> choosing (drawer picks a word) -> drawing (others guess,
 * hints appear) -> reveal (the word, turn scores) -> next drawer ... -> end.
 */
import { DOODLE_WORDS } from './words';

export const CANVAS_W = 800;
export const CANVAS_H = 600;
export const COLORS = [
  '#000000', '#4b5563', '#9ca3af', '#ffffff', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f9a8d4', '#92400e', '#fde68a',
];
export const WIDTHS = [3, 6, 12, 24, 40];
export const LIMITS = {
  MAX_PLAYERS: 12,
  NAME: 32,
  GUESS: 100,
  POINTS_PER_OP: 600,
  OPS_PER_MESSAGE: 40,
  NUMBERS_PER_TURN: 400_000,
  GROUPS_PER_TURN: 2_000,
} as const;
export const TIMES = { CHOOSE_MS: 15_000, REVEAL_MS: 6_000, MIN_DRAW_S: 30, MAX_DRAW_S: 180 } as const;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'end';

export type DrawOp =
  | { k: 'line'; c: string; w: number; p: number[] }
  | { k: 'fill'; c: string; x: number; y: number };

export interface Player {
  id: string;
  name: string;
  avatar: string | null;
  score: number;
  /** Points won this turn (shown in the reveal). */
  turnScore: number;
  guessed: boolean;
  connected: boolean;
}

export interface Room {
  id: string;
  hostId: string | null;
  players: Player[];
  phase: Phase;
  rounds: number;
  drawTime: number;
  round: number;
  /** Who still draws this round (in order). */
  queue: string[];
  drawerId: string | null;
  word: string | null;
  choices: string[];
  phaseEndsAt: number;
  turnStartedAt: number;
  hints: number[];
  /** Stroke groups (an undo removes the last group). */
  groups: DrawOp[][];
  numbers: number;
  used: string[];
  lastWord: string | null;
}

export type Out = { to: 'all' | string[]; msg: Record<string, unknown> };

export function createRoom(id: string): Room {
  return {
    id, hostId: null, players: [], phase: 'lobby', rounds: 3, drawTime: 80, round: 0, queue: [], drawerId: null, word: null,
    choices: [], phaseEndsAt: 0, turnStartedAt: 0, hints: [], groups: [], numbers: 0, used: [], lastWord: null,
  };
}

const connected = (r: Room) => r.players.filter((p) => p.connected);
const player = (r: Room, id: string) => r.players.find((p) => p.id === id) ?? null;

/** Lower-case, accents and punctuation dropped, single spaces. */
export function normalizeGuess(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Edit distance, capped (only "is it 1 away" matters). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** The word as others see it: letters hidden except revealed hints; spaces and dashes shown. */
export function maskWord(word: string, revealed: number[]): string {
  return [...word].map((ch, i) => (ch === ' ' || ch === '-' ? ch : revealed.includes(i) ? ch : '_')).join('');
}

/** Points for a correct guess: more for guessing early, a little less for each earlier guesser. */
export function guessPoints(remainingMs: number, totalMs: number, earlierGuessers: number): number {
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  return Math.max(10, Math.round((100 + 300 * frac) * Math.max(0.5, 1 - 0.1 * earlierGuessers)));
}

function pickChoices(r: Room, rng: () => number): string[] {
  const pool = DOODLE_WORDS.filter((w) => !r.used.includes(w));
  const source = pool.length >= 3 ? pool : [...DOODLE_WORDS];
  const out: string[] = [];
  // A random start, then the next unused word on a clash: always ends, whatever rng returns.
  for (let tries = 0; out.length < 3 && tries < source.length; tries++) {
    let i = Math.floor(Math.max(0, Math.min(0.999999, rng())) * source.length);
    while (out.includes(source[i])) i = (i + 1) % source.length;
    out.push(source[i]);
  }
  return out;
}

/** What one player is told about the room. */
export function snapshot(r: Room, forId: string, now: number) {
  const me = player(r, forId);
  const seesWord = r.word && (r.drawerId === forId || r.phase === 'reveal' || r.phase === 'end' || me?.guessed);
  return {
    t: 'state',
    now,
    phase: r.phase,
    hostId: r.hostId,
    drawerId: r.drawerId,
    round: r.round,
    rounds: r.rounds,
    drawTime: r.drawTime,
    phaseEndsAt: r.phaseEndsAt,
    word: seesWord ? r.word : null,
    mask: r.word ? maskWord(r.word, r.hints) : null,
    lastWord: r.lastWord,
    choices: r.phase === 'choosing' && r.drawerId === forId ? r.choices : [],
    players: r.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, turnScore: p.turnScore, guessed: p.guessed, connected: p.connected })),
    groups: r.groups,
    me: forId,
  };
}

function stateForAll(r: Room, now: number): Out[] {
  return connected(r).map((p) => ({ to: [p.id], msg: snapshot(r, p.id, now) }));
}

function system(text: string, to: Out['to'] = 'all'): Out {
  return { to, msg: { t: 'chat', kind: 'system', text } };
}

export function join(r: Room, p: { id: string; name: string; avatar: string | null }, now: number): Out[] {
  const existing = player(r, p.id);
  if (existing) {
    existing.connected = true;
    existing.name = p.name.slice(0, LIMITS.NAME);
    existing.avatar = p.avatar;
  } else {
    if (r.players.filter((x) => x.connected).length >= LIMITS.MAX_PLAYERS) return [{ to: [p.id], msg: { t: 'error', code: 'full' } }];
    r.players.push({ id: p.id, name: p.name.slice(0, LIMITS.NAME), avatar: p.avatar, score: 0, turnScore: 0, guessed: false, connected: true });
  }
  if (!r.hostId || !player(r, r.hostId)?.connected) r.hostId = p.id;
  return [system(`${p.name.slice(0, LIMITS.NAME)} joined`), ...stateForAll(r, now)];
}

export function leave(r: Room, id: string, now: number, rng: () => number): Out[] {
  const p = player(r, id);
  if (!p) return [];
  p.connected = false;
  if (r.phase === 'lobby' || r.phase === 'end') r.players = r.players.filter((x) => x.id !== id);
  r.queue = r.queue.filter((q) => q !== id);
  if (r.hostId === id) r.hostId = connected(r)[0]?.id ?? null;
  const out: Out[] = [system(`${p.name} left`)];
  if (r.phase !== 'lobby' && r.phase !== 'end' && connected(r).length < 2) {
    toLobby(r);
    out.push(system('Not enough players. Back to the lobby.'));
  } else if (r.drawerId === id && (r.phase === 'choosing' || r.phase === 'drawing')) {
    out.push(...endTurn(r, now, rng, 'drawer_left'));
    return [...out, ...stateForAll(r, now)];
  } else if (r.phase === 'drawing' && everyoneGuessed(r)) {
    out.push(...endTurn(r, now, rng, 'all_guessed'));
  }
  return [...out, ...stateForAll(r, now)];
}

function toLobby(r: Room) {
  r.phase = 'lobby';
  r.round = 0;
  r.queue = [];
  r.drawerId = null;
  r.word = null;
  r.choices = [];
  r.groups = [];
  r.numbers = 0;
  r.hints = [];
  r.players = r.players.filter((p) => p.connected);
  for (const p of r.players) { p.guessed = false; p.turnScore = 0; }
}

export function start(r: Room, by: string, settings: { rounds?: unknown; drawTime?: unknown }, now: number, rng: () => number): Out[] {
  if (r.hostId !== by) return [{ to: [by], msg: { t: 'error', code: 'not_host' } }];
  if (r.phase !== 'lobby' && r.phase !== 'end') return [];
  if (connected(r).length < 2) return [{ to: [by], msg: { t: 'error', code: 'need_players' } }];
  const rounds = Number(settings.rounds);
  const drawTime = Number(settings.drawTime);
  r.rounds = Number.isInteger(rounds) && rounds >= 1 && rounds <= 10 ? rounds : 3;
  r.drawTime = Number.isInteger(drawTime) && drawTime >= TIMES.MIN_DRAW_S && drawTime <= TIMES.MAX_DRAW_S ? drawTime : 80;
  toLobby(r);
  for (const p of r.players) p.score = 0;
  r.used = [];
  r.lastWord = null;
  r.round = 1;
  r.queue = connected(r).map((p) => p.id);
  return [system('The game has started!'), ...nextTurn(r, now, rng)];
}

function nextTurn(r: Room, now: number, rng: () => number): Out[] {
  r.queue = r.queue.filter((id) => player(r, id)?.connected);
  if (r.queue.length === 0) {
    r.round += 1;
    if (r.round > r.rounds) {
      r.phase = 'end';
      r.drawerId = null;
      r.word = null;
      r.phaseEndsAt = 0;
      const ranked = [...r.players].sort((a, b) => b.score - a.score);
      return [system(ranked[0] ? `${ranked[0].name} wins with ${ranked[0].score} points!` : 'Game over'), ...stateForAll(r, now)];
    }
    r.queue = connected(r).map((p) => p.id);
  }
  r.drawerId = r.queue.shift() ?? null;
  r.word = null;
  r.hints = [];
  r.groups = [];
  r.numbers = 0;
  for (const p of r.players) { p.guessed = false; p.turnScore = 0; }
  r.choices = pickChoices(r, rng);
  r.phase = 'choosing';
  r.phaseEndsAt = now + TIMES.CHOOSE_MS;
  const drawer = r.drawerId ? player(r, r.drawerId) : null;
  return [system(`${drawer?.name ?? 'Someone'} is choosing a word`), ...stateForAll(r, now)];
}

export function pick(r: Room, by: string, index: unknown, now: number): Out[] {
  if (r.phase !== 'choosing' || r.drawerId !== by) return [];
  const i = Number(index);
  const word = Number.isInteger(i) ? r.choices[i] : undefined;
  if (!word) return [];
  return beginDrawing(r, word, now);
}

function beginDrawing(r: Room, word: string, now: number): Out[] {
  r.word = word;
  r.used.push(word);
  r.choices = [];
  r.phase = 'drawing';
  r.turnStartedAt = now;
  r.phaseEndsAt = now + r.drawTime * 1000;
  return [{ to: 'all', msg: { t: 'clear' } }, ...stateForAll(r, now)];
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Check one drawing op (null = drop it). Coordinates are clamped to the canvas. */
export function validateOp(raw: unknown): DrawOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.c !== 'string' || !COLOR_RE.test(o.c)) return null;
  if (o.k === 'line') {
    if (!WIDTHS.includes(o.w as number) || !Array.isArray(o.p) || o.p.length < 2 || o.p.length % 2 !== 0 || o.p.length > LIMITS.POINTS_PER_OP) return null;
    const p: number[] = [];
    for (let i = 0; i < o.p.length; i++) {
      const v = o.p[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      p.push(Math.round(Math.max(0, Math.min(i % 2 === 0 ? CANVAS_W : CANVAS_H, v))));
    }
    return { k: 'line', c: o.c.toLowerCase(), w: o.w as number, p };
  }
  if (o.k === 'fill') {
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { k: 'fill', c: o.c.toLowerCase(), x: Math.round(Math.max(0, Math.min(CANVAS_W - 1, x))), y: Math.round(Math.max(0, Math.min(CANVAS_H - 1, y))) };
  }
  return null;
}

/** The drawer's strokes: `begin` starts a new undo group; `undo` / `clear` edit the history. */
export function draw(r: Room, by: string, input: { ops?: unknown; begin?: unknown; action?: unknown }): Out[] {
  if (r.phase !== 'drawing' || r.drawerId !== by) return [];
  const others = connected(r).filter((p) => p.id !== by).map((p) => p.id);
  if (input.action === 'undo') {
    if (r.groups.length === 0) return [];
    const removed = r.groups.pop() ?? [];
    r.numbers -= removed.reduce((n, op) => n + (op.k === 'line' ? op.p.length : 2), 0);
    return [{ to: others, msg: { t: 'undo' } }];
  }
  if (input.action === 'clear') {
    r.groups = [];
    r.numbers = 0;
    return [{ to: others, msg: { t: 'clear' } }];
  }
  if (!Array.isArray(input.ops) || input.ops.length === 0 || input.ops.length > LIMITS.OPS_PER_MESSAGE) return [];
  const ops: DrawOp[] = [];
  for (const raw of input.ops) {
    const op = validateOp(raw);
    if (op) ops.push(op);
  }
  if (!ops.length) return [];
  const size = ops.reduce((n, op) => n + (op.k === 'line' ? op.p.length : 2), 0);
  if (r.numbers + size > LIMITS.NUMBERS_PER_TURN) return [{ to: [by], msg: { t: 'error', code: 'canvas_full' } }];
  if (input.begin === true || r.groups.length === 0) {
    if (r.groups.length >= LIMITS.GROUPS_PER_TURN) return [{ to: [by], msg: { t: 'error', code: 'canvas_full' } }];
    r.groups.push([]);
  }
  r.groups[r.groups.length - 1].push(...ops);
  r.numbers += size;
  return [{ to: others, msg: { t: 'ops', begin: input.begin === true, ops } }];
}

function everyoneGuessed(r: Room): boolean {
  const guessers = connected(r).filter((p) => p.id !== r.drawerId);
  return guessers.length > 0 && guessers.every((p) => p.guessed);
}

export function guess(r: Room, by: string, rawText: unknown, now: number, rng: () => number): Out[] {
  if (typeof rawText !== 'string') return [];
  const text = rawText.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS.GUESS);
  if (!text) return [];
  const p = player(r, by);
  if (!p || !p.connected) return [];
  const chat = (to: Out['to'], kind = 'guess') => ({ to, msg: { t: 'chat', kind, from: p.id, name: p.name, text } });
  if (r.phase !== 'drawing' || !r.word) return [chat('all')];
  // The drawer and people who already guessed only talk among themselves.
  const inside = connected(r).filter((x) => x.id === r.drawerId || x.guessed).map((x) => x.id);
  if (by === r.drawerId || p.guessed) return [chat(inside, 'inside')];
  const g = normalizeGuess(text);
  const w = normalizeGuess(r.word);
  if (g === w) {
    const earlier = r.players.filter((x) => x.guessed).length;
    const pts = guessPoints(r.phaseEndsAt - now, r.drawTime * 1000, earlier);
    p.guessed = true;
    p.score += pts;
    p.turnScore = pts;
    const drawer = r.drawerId ? player(r, r.drawerId) : null;
    if (drawer) { const d = Math.round(pts / 4); drawer.score += d; drawer.turnScore += d; }
    const out: Out[] = [{ to: 'all', msg: { t: 'chat', kind: 'correct', from: p.id, name: p.name, text: `${p.name} guessed the word!` } }];
    if (everyoneGuessed(r)) out.push(...endTurn(r, now, rng, 'all_guessed'));
    else out.push(...stateForAll(r, now));
    return out;
  }
  const out: Out[] = [chat('all')];
  if (w.length >= 4 && editDistance(g, w, 1) === 1) out.push({ to: [by], msg: { t: 'chat', kind: 'close', text: `"${text}" is close!` } });
  return out;
}

function endTurn(r: Room, now: number, rng: () => number, why: 'time' | 'all_guessed' | 'drawer_left'): Out[] {
  void rng;
  const word = r.word;
  r.lastWord = word;
  r.phase = 'reveal';
  r.phaseEndsAt = now + TIMES.REVEAL_MS;
  const text = word ? `The word was "${word}"` : why === 'drawer_left' ? 'The drawer left' : 'Nobody picked a word';
  return [system(text), ...stateForAll(r, now)];
}

/** Timers: auto-pick, hints, time up, next turn. Call every ~500 ms. */
export function tick(r: Room, now: number, rng: () => number): Out[] {
  if (r.phase === 'choosing' && now >= r.phaseEndsAt) {
    return beginDrawing(r, r.choices[0] ?? pickChoices(r, rng)[0] ?? 'apple', now);
  }
  if (r.phase === 'drawing' && r.word) {
    if (now >= r.phaseEndsAt) return endTurn(r, now, rng, 'time');
    const total = r.drawTime * 1000;
    const elapsed = now - r.turnStartedAt;
    const letters = [...r.word].map((ch, i) => (ch === ' ' || ch === '-' ? -1 : i)).filter((i) => i >= 0);
    const want = letters.length < 4 ? 0 : elapsed > total * 0.75 ? 2 : elapsed > total * 0.5 ? 1 : 0;
    if (r.hints.length < want) {
      const hidden = letters.filter((i) => !r.hints.includes(i));
      if (hidden.length > 1) {
        r.hints.push(hidden[Math.floor(rng() * hidden.length)]);
        return stateForAll(r, now);
      }
    }
  }
  if (r.phase === 'reveal' && now >= r.phaseEndsAt) return nextTurn(r, now, rng);
  return [];
}

/** Recipients of an Out as user ids. */
export function recipients(r: Room, out: Out): string[] {
  return out.to === 'all' ? connected(r).map((p) => p.id) : out.to;
}
