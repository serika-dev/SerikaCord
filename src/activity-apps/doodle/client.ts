/**
 * Doodle Party client: runs inside the Activity frame on <client_id>.<ACTIVITIES_DOMAIN>,
 * built with the stock Embedded App SDK (bundled by the server with Bun.build).
 * Auth: authorize -> POST ./token -> authenticate, then a WebSocket to ./ws.
 * Game rules live on the server (src/lib/activityApps/doodle/game.ts).
 */
import { DiscordSDK } from '@discord/embedded-app-sdk';

declare global { interface Window { DOODLE_CLIENT_ID: string } }

const W = 800;
const H = 600;
const COLORS = ['#000000', '#4b5563', '#9ca3af', '#ffffff', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f9a8d4', '#92400e', '#fde68a'];
const WIDTHS = [3, 6, 12, 24, 40];

type Op = { k: 'line'; c: string; w: number; p: number[] } | { k: 'fill'; c: string; x: number; y: number };
type PlayerView = { id: string; name: string; avatar: string | null; score: number; turnScore: number; guessed: boolean; connected: boolean };
type State = {
  phase: 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'end';
  hostId: string | null; drawerId: string | null; round: number; rounds: number; drawTime: number; phaseEndsAt: number; now: number;
  word: string | null; mask: string | null; lastWord: string | null; choices: string[]; players: PlayerView[]; groups: Op[][]; me: string;
};

// ─── Styles + layout ─────────────────────────────────────────

const css = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#1e1f2e;color:#e5e7eb;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
button{font:inherit;cursor:pointer;border:0;border-radius:8px}
#app{display:grid;height:100%;grid-template-columns:200px 1fr 260px;grid-template-rows:auto 1fr;gap:10px;padding:10px}
#top{grid-column:1/4;display:flex;align-items:center;gap:12px;background:#2a2b3d;border-radius:12px;padding:8px 14px}
#timer{font-weight:700;font-size:18px;min-width:48px;text-align:center;background:#3b3d55;border-radius:999px;padding:2px 10px}
#round{color:#9ca3af;min-width:90px}#word{flex:1;text-align:center;font-weight:700;font-size:22px;letter-spacing:6px;font-family:ui-monospace,monospace}
#players{background:#2a2b3d;border-radius:12px;padding:6px;overflow:auto}
.pl{display:flex;align-items:center;gap:8px;padding:6px;border-radius:8px}.pl.me{background:#34364d}.pl.ok{background:#1f4d33}
.pl img,.av{width:32px;height:32px;border-radius:50%;object-fit:cover;flex:none;background:#6366f1;display:flex;align-items:center;justify-content:center;font-weight:700}
.pl .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pl .s{color:#9ca3af;font-size:12px}.pl.off{opacity:.45}
#center{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
#board{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
canvas{background:#fff;border-radius:12px;max-width:100%;max-height:100%;aspect-ratio:4/3;touch-action:none;display:block}
#overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,16,28,.78);border-radius:12px;text-align:center;padding:16px}
#overlay.show{display:flex}#overlay h2{margin:0 0 10px;font-size:24px}#overlay .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px}
.big{background:#6366f1;color:#fff;padding:10px 18px;font-weight:700;font-size:16px}.big:disabled{opacity:.5;cursor:default}
.ghost{background:#3b3d55;color:#e5e7eb;padding:8px 12px}
select{background:#3b3d55;color:#e5e7eb;border:0;border-radius:8px;padding:6px 8px;font:inherit}
#tools{display:none;align-items:center;gap:8px;flex-wrap:wrap;background:#2a2b3d;border-radius:12px;padding:8px}
#tools.show{display:flex}.sw{width:24px;height:24px;border-radius:6px;border:2px solid transparent}.sw.on{border-color:#fff;outline:2px solid #6366f1}
.sz{width:32px;height:32px;background:#3b3d55;display:flex;align-items:center;justify-content:center}.sz.on{background:#6366f1}.sz i{display:block;border-radius:50%;background:#e5e7eb}
.tool.on{background:#6366f1;color:#fff}
#chat{display:flex;flex-direction:column;background:#2a2b3d;border-radius:12px;min-height:0}
#log{flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:3px;word-break:break-word}
.m b{color:#c7d2fe}.m.system{color:#9ca3af;font-style:italic}.m.correct{color:#4ade80;font-weight:600}.m.close{color:#facc15}.m.inside{color:#c4b5fd}
#guess{margin:8px;padding:10px;border-radius:8px;border:0;background:#3b3d55;color:#fff;font:inherit}
#status{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1e1f2e;font-size:16px;color:#9ca3af;text-align:center;padding:20px}
.podium{display:flex;gap:12px;align-items:flex-end;justify-content:center;margin:10px 0}.podium div{background:#3b3d55;border-radius:10px;padding:8px 12px;min-width:90px}
.scores{text-align:left;margin:8px auto;max-width:260px}.scores div{display:flex;justify-content:space-between;gap:16px}
@media (max-width:760px){#app{grid-template-columns:1fr;grid-template-rows:auto auto auto 200px}#top{grid-column:1}#players{display:flex;gap:4px;overflow-x:auto;padding:4px}.pl .s{display:none}#center{min-height:52vh}}
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function shell() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.getElementById('app')!.innerHTML = `
    <div id="top"><span id="timer">–</span><span id="round"></span><span id="word"></span></div>
    <div id="players"></div>
    <div id="center">
      <div id="board"><canvas id="cv" width="${W}" height="${H}"></canvas><div id="overlay"></div></div>
      <div id="tools"></div>
    </div>
    <div id="chat"><div id="log"></div><input id="guess" maxlength="100" autocomplete="off" placeholder="Type your guess here…"></div>
    <div id="status">Connecting…</div>`;
}

// ─── Canvas ──────────────────────────────────────────────────

let ctx: CanvasRenderingContext2D;
let groups: Op[][] = [];

function clearCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

function drawLine(op: Extract<Op, { k: 'line' }>) {
  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  ctx.lineWidth = op.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = op.p;
  if (p.length === 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], op.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

function hexRgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Scanline flood fill (same result on every client, they replay the same ops). */
function floodFill(x0: number, y0: number, color: string) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const [r, g, b] = hexRgb(color);
  const at = (x: number, y: number) => (y * W + x) * 4;
  const i0 = at(x0, y0);
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  if (Math.abs(tr - r) + Math.abs(tg - g) + Math.abs(tb - b) < 8) return;
  const match = (i: number) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= 60;
  const stack: number[] = [x0, y0];
  let guard = 0;
  while (stack.length && guard++ < W * H) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && match(at(x, y))) x--;
    x++;
    let up = false;
    let down = false;
    while (x < W && match(at(x, y))) {
      const i = at(x, y);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      if (y > 0) { const m = match(at(x, y - 1)); if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false; }
      if (y < H - 1) { const m = match(at(x, y + 1)); if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false; }
      x++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function applyOp(op: Op) {
  if (op.k === 'line') drawLine(op);
  else floodFill(op.x, op.y, op.c);
}

function redraw() {
  clearCanvas();
  for (const g of groups) for (const op of g) applyOp(op);
}

// ─── App ─────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let state: State | null = null;
let clockOffset = 0;
let color = '#000000';
let width = 6;
let tool: 'pen' | 'fill' | 'eraser' = 'pen';

function sendMsg(msg: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function avatar(p: PlayerView) {
  return p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : `<span class="av">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
}

function chat(kind: string, text: string, name?: string) {
  const log = $('log');
  const div = document.createElement('div');
  div.className = `m ${kind}`;
  div.innerHTML = name && kind !== 'correct' ? `<b>${esc(name)}:</b> ${esc(text)}` : esc(text);
  log.appendChild(div);
  while (log.childElementCount > 200) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

const isDrawer = () => !!state && state.drawerId === state.me && state.phase === 'drawing';

function renderPlayers() {
  if (!state) return;
  const s = state;
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  $('players').innerHTML = sorted.map((p) => `
    <div class="pl ${p.id === s.me ? 'me' : ''} ${p.guessed ? 'ok' : ''} ${p.connected ? '' : 'off'}">
      ${avatar(p)}<div class="n">${esc(p.name)}${p.id === s.hostId ? ' 👑' : ''}${p.id === s.drawerId ? ' ✏️' : ''}<div class="s">${p.score} pts</div></div>
    </div>`).join('');
}

function renderTop() {
  if (!state) return;
  $('round').textContent = state.phase === 'lobby' ? 'Lobby' : state.phase === 'end' ? 'Game over' : `Round ${state.round}/${state.rounds}`;
  const shown = state.word ?? state.mask ?? '';
  $('word').textContent = state.phase === 'drawing' || state.phase === 'reveal' ? shown : state.phase === 'choosing' ? '…' : '';
}

function renderTools() {
  const t = $('tools');
  t.classList.toggle('show', isDrawer());
  if (!isDrawer()) return;
  t.innerHTML = COLORS.map((c) => `<button class="sw ${c === color && tool !== 'eraser' ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')
    + WIDTHS.map((w) => `<button class="sz ${w === width ? 'on' : ''}" data-w="${w}" aria-label="Size ${w}"><i style="width:${Math.min(22, w)}px;height:${Math.min(22, w)}px"></i></button>`).join('')
    + `<button class="ghost tool ${tool === 'pen' ? 'on' : ''}" data-t="pen">✏️ Pen</button>`
    + `<button class="ghost tool ${tool === 'fill' ? 'on' : ''}" data-t="fill">🪣 Fill</button>`
    + `<button class="ghost tool ${tool === 'eraser' ? 'on' : ''}" data-t="eraser">🧽 Eraser</button>`
    + `<button class="ghost" data-a="undo">↶ Undo</button><button class="ghost" data-a="clear">🗑 Clear</button>`;
}

function renderOverlay() {
  const o = $('overlay');
  if (!state) return;
  const s = state;
  const me = s.players.find((p) => p.id === s.me);
  let html = '';
  if (s.phase === 'lobby') {
    const host = s.hostId === s.me;
    html = `<div><h2>🎨 Doodle Party</h2><p>${s.players.filter((p) => p.connected).length} player(s) here. ${s.players.filter((p) => p.connected).length < 2 ? 'Waiting for one more player…' : ''}</p>${host ? `
      <div class="btns"><label>Rounds <select id="rounds">${[2, 3, 4, 5, 6].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Time <select id="dtime">${[45, 60, 80, 100, 120].map((n) => `<option value="${n}" ${n === 80 ? 'selected' : ''}>${n}s</option>`).join('')}</select></label></div>
      <div class="btns"><button class="big" id="start" ${s.players.filter((p) => p.connected).length < 2 ? 'disabled' : ''}>Start game</button></div>` : '<p>Waiting for the host to start…</p>'}</div>`;
  } else if (s.phase === 'choosing') {
    const drawer = s.players.find((p) => p.id === s.drawerId);
    html = s.choices.length
      ? `<div><h2>Choose a word</h2><div class="btns">${s.choices.map((w, i) => `<button class="big" data-pick="${i}">${esc(w)}</button>`).join('')}</div></div>`
      : `<div><h2>${esc(drawer?.name ?? 'Someone')} is choosing a word…</h2></div>`;
  } else if (s.phase === 'reveal') {
    html = `<div><h2>The word was "${esc(s.lastWord ?? '')}"</h2><div class="scores">${[...s.players].sort((a, b) => b.turnScore - a.turnScore).map((p) => `<div><span>${esc(p.name)}</span><b>+${p.turnScore}</b></div>`).join('')}</div></div>`;
  } else if (s.phase === 'end') {
    const top = [...s.players].sort((a, b) => b.score - a.score).slice(0, 3);
    html = `<div><h2>🏆 ${esc(top[0]?.name ?? '')} wins!</h2><div class="podium">${top.map((p, i) => `<div>${['🥇', '🥈', '🥉'][i]}<br>${esc(p.name)}<br><b>${p.score}</b></div>`).join('')}</div>
      ${s.hostId === s.me ? '<div class="btns"><button class="big" id="start">Play again</button></div>' : '<p>Waiting for the host…</p>'}</div>`;
  }
  void me;
  o.innerHTML = html;
  o.classList.toggle('show', !!html);
}

function render() {
  renderTop();
  renderPlayers();
  renderTools();
  renderOverlay();
  const input = $<HTMLInputElement>('guess');
  input.placeholder = isDrawer() ? 'You are drawing — chat with players who guessed' : 'Type your guess here…';
}

function tickTimer() {
  const el = $('timer');
  if (!state || state.phase === 'lobby' || state.phase === 'end' || !state.phaseEndsAt) { el.textContent = '–'; return; }
  const left = Math.max(0, Math.ceil((state.phaseEndsAt - (Date.now() + clockOffset)) / 1000));
  el.textContent = String(left);
}

function onMessage(msg: Record<string, unknown>) {
  switch (msg.t) {
    case 'state': {
      const s = msg as unknown as State;
      const newTurn = !state || state.drawerId !== s.drawerId || state.phase !== s.phase && s.phase === 'drawing';
      state = s;
      clockOffset = s.now - Date.now();
      if (newTurn || JSON.stringify(groups.length) !== JSON.stringify(s.groups.length)) { groups = s.groups; redraw(); }
      $('status').style.display = 'none';
      render();
      break;
    }
    case 'ops': {
      const ops = msg.ops as Op[];
      if (msg.begin || groups.length === 0) groups.push([]);
      groups[groups.length - 1].push(...ops);
      for (const op of ops) applyOp(op);
      break;
    }
    case 'undo': groups.pop(); redraw(); break;
    case 'clear': groups = []; redraw(); break;
    case 'chat': chat(String(msg.kind), String(msg.text), msg.name ? String(msg.name) : undefined); break;
    case 'error': {
      const code = String(msg.code);
      if (code === 'auth' || code === 'not_in_instance') { $('status').style.display = 'flex'; $('status').textContent = 'Could not join this game. Close the Activity and open it again.'; }
      else if (code === 'full') { $('status').style.display = 'flex'; $('status').textContent = 'This game is full.'; }
      else if (code === 'need_players') chat('system', 'You need at least 2 players.');
      break;
    }
    default: break;
  }
}

// ─── Input ───────────────────────────────────────────────────

function canvasPoint(cv: HTMLCanvasElement, e: PointerEvent): [number, number] {
  const r = cv.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
}

function bindInput() {
  const cv = $<HTMLCanvasElement>('cv');
  let drawing = false;
  let pending: number[] = [];
  let last: [number, number] | null = null;
  let flushTimer: number | null = null;
  const strokeColor = () => (tool === 'eraser' ? '#ffffff' : color);

  const flush = (begin = false) => {
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    if (pending.length < 2) return;
    const op: Op = { k: 'line', c: strokeColor(), w: width, p: pending };
    if (begin || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(op);
    sendMsg({ t: 'draw', begin, ops: [op] });
    pending = last ? [last[0], last[1]] : [];
  };

  cv.addEventListener('pointerdown', (e) => {
    if (!isDrawer()) return;
    const pt = canvasPoint(cv, e);
    if (tool === 'fill') {
      const op: Op = { k: 'fill', c: color, x: pt[0], y: pt[1] };
      groups.push([op]);
      applyOp(op);
      sendMsg({ t: 'draw', begin: true, ops: [op] });
      return;
    }
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    last = pt;
    pending = [pt[0], pt[1], pt[0], pt[1]];
    drawLine({ k: 'line', c: strokeColor(), w: width, p: pending });
    flush(true);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing || !isDrawer()) return;
    const pt = canvasPoint(cv, e);
    if (last && Math.abs(pt[0] - last[0]) + Math.abs(pt[1] - last[1]) < 2) return;
    if (last) drawLine({ k: 'line', c: strokeColor(), w: width, p: [last[0], last[1], pt[0], pt[1]] });
    pending.push(pt[0], pt[1]);
    last = pt;
    if (pending.length > 400) flush();
    else if (flushTimer === null) flushTimer = window.setTimeout(() => flush(), 50);
  });
  const end = () => { if (!drawing) return; drawing = false; flush(); last = null; pending = []; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  $('tools').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.c) { color = b.dataset.c; if (tool === 'eraser') tool = 'pen'; }
    else if (b.dataset.w) width = Number(b.dataset.w);
    else if (b.dataset.t) tool = b.dataset.t as typeof tool;
    else if (b.dataset.a === 'undo') { groups.pop(); redraw(); sendMsg({ t: 'draw', action: 'undo' }); }
    else if (b.dataset.a === 'clear') { groups = []; redraw(); sendMsg({ t: 'draw', action: 'clear' }); }
    renderTools();
  });

  $('overlay').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.id === 'start') {
      const rounds = Number(($('rounds') as HTMLSelectElement | null)?.value ?? 3);
      const drawTime = Number(($('dtime') as HTMLSelectElement | null)?.value ?? 80);
      sendMsg({ t: 'start', rounds, drawTime });
    } else if (b.dataset.pick !== undefined) {
      sendMsg({ t: 'pick', index: Number(b.dataset.pick) });
    }
  });

  const input = $<HTMLInputElement>('guess');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    sendMsg({ t: 'guess', text: input.value });
    input.value = '';
  });
}

// ─── Boot ────────────────────────────────────────────────────

async function main() {
  shell();
  const cv = $<HTMLCanvasElement>('cv');
  ctx = cv.getContext('2d', { willReadFrequently: true })!;
  clearCanvas();
  bindInput();
  setInterval(tickTimer, 250);

  const status = $('status');
  const sdk = new DiscordSDK(window.DOODLE_CLIENT_ID);
  await sdk.ready();
  status.textContent = 'Signing in…';
  const { code } = await sdk.commands.authorize({ client_id: window.DOODLE_CLIENT_ID, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
  const res = await fetch('./token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const { access_token: accessToken } = await res.json() as { access_token?: string };
  if (!accessToken) { status.textContent = 'Sign-in failed. Close the Activity and open it again.'; return; }
  await sdk.commands.authenticate({ access_token: accessToken });
  status.textContent = 'Joining the game…';

  const connect = (attempt: number) => {
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token: accessToken, instanceId: sdk.instanceId }));
    sock.onmessage = (ev) => { try { onMessage(JSON.parse(String(ev.data))); } catch { /* ignore */ } };
    sock.onclose = (ev) => {
      if (ev.code === 4001 || ev.code === 4003) return;
      status.style.display = 'flex';
      status.textContent = 'Reconnecting…';
      setTimeout(() => connect(attempt + 1), Math.min(10_000, 500 * 2 ** attempt));
    };
  };
  connect(0);
}

main().catch((err) => {
  const s = document.getElementById('status');
  if (s) { s.style.display = 'flex'; s.textContent = 'Doodle Party could not start. Close it and try again.'; }
  console.error(err);
});
