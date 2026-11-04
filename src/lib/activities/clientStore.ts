"use client";
/**
 * Client state for Activities (CORD-92): the Activity open in this window and
 * where it is shown, the shelf (launcher), the 18+ confirmation, and the live
 * state of instances shown on Game Invitation cards.
 *
 * Placement (like Discord): an Activity launched in a text chat docks at the
 * top of that chat; one launched in a call fills the call stage. The frame is
 * rendered once by the host (src/components/activities/ActivityHost.tsx) and
 * positioned over the "slot" the chat / call registers, so it never reloads
 * while you move around; away from its chat or call it becomes a mini window,
 * and it can pop out into its own browser window.
 *
 * Live updates: the server sends `activity_update` on chat streams (cards) and
 * on the user's own stream (participants), and `activity_open` when a command
 * launched an Activity for this user. UnreadContext and the chat engine
 * re-dispatch both as the ACTIVITY_EVENT window event; a popped-out window
 * gets them over a BroadcastChannel.
 */
import { useEffect, useSyncExternalStore } from "react";
import { isNativeApp, nativePlatform } from "@/lib/native/bridge";
import { isDesktopShell } from "@/lib/desktop/bridge";

export const ACTIVITY_EVENT = "serika:activity";
const CHANNEL_NAME = "serika-activity";
export const POPOUT_PATH = "/activity-popout";

export interface ActivityParticipant { id: string; username: string; displayName: string | null; avatar: string | null }

export interface InstanceView {
  id: string;
  applicationId?: string;
  launchId?: string;
  app?: { id: string; clientId: string; name: string; icon: string | null; imageUrl: string | null; botId: string | null };
  location?: { kind: "gc" | "pc"; channelId: string; guildId: string | null; voice: boolean };
  launcherId?: string;
  startedAt?: number;
  endedAt?: number | null;
  ended?: boolean;
  participants?: ActivityParticipant[];
}

export interface FrameInfo {
  clientId: string;
  origin: string;
  query: Record<string, string>;
  orientation: { phone: number; tablet: number };
  location: { channelId: string; guildId: string | null; voice: boolean };
  app: { name: string; icon: string | null; ageGated: boolean };
}

export type ActivityLayout = "inline" | "mini" | "popout";

export interface OpenActivity {
  instanceId: string;
  frame: FrameInfo;
  /** Bumped when the same instance is opened again (bring it back from the mini window). */
  nonce: number;
  layout: ActivityLayout;
  /** Text-chat Activity: hide the chat so the Activity fills the conversation (Discord's chevron). */
  chatHidden: boolean;
  /** Where to go to see it docked (the chat or call it was opened from). */
  returnPath: string;
}

export interface ShelfRequest { channelId: string; voice: boolean }

export type ActivityError = { code: string; message: string };

export interface AgePrompt { appName: string; confirm: () => void; cancel: () => void }

type State = {
  open: OpenActivity | null;
  shelf: ShelfRequest | null;
  views: Map<string, InstanceView>;
  error: ActivityError | null;
  age: AgePrompt | null;
  slots: Map<string, HTMLElement>;
};

let state: State = { open: null, shelf: null, views: new Map(), error: null, age: null, slots: new Map() };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** The client's platform family, as the server checks it against the app's supported platforms. */
export function platformHint(): "web" | "desktop" | "ios" | "android" {
  if (typeof window === "undefined") return "web";
  if (isNativeApp()) {
    const p = nativePlatform();
    if (p === "ios" || p === "android") return p;
  }
  if (isDesktopShell()) return "desktop";
  return "web";
}

/** Pop-out windows: browsers only (the desktop and phone apps keep it in the main window). */
export function canPopOut(): boolean {
  if (typeof window === "undefined") return false;
  return !isNativeApp() && !isDesktopShell() && typeof BroadcastChannel !== "undefined";
}

export const isPopoutWindow = () => typeof window !== "undefined" && window.location.pathname === POPOUT_PATH;

// ─── Instance views (cards, bars) ───────────────────────────

const inflight = new Map<string, Promise<void>>();

function storeView(view: InstanceView) {
  const views = new Map(state.views);
  views.set(view.id, view);
  if (views.size > 200) views.delete(views.keys().next().value as string);
  const patch: Partial<State> = { views };
  // The open Activity ended (everyone left, or it timed out): close it.
  if (state.open?.instanceId === view.id && (view.ended || view.endedAt)) patch.open = null;
  set(patch);
}

function fetchView(id: string): Promise<void> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = fetch(`/api/activities/instances/${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((v: InstanceView | null) => { if (v && typeof v.id === "string") storeView(v); })
    .catch(() => {})
    .finally(() => { inflight.delete(id); });
  inflight.set(id, p);
  return p;
}

/** Live view of an instance (fetched once, then kept fresh by ACTIVITY_EVENT). */
export function useInstanceView(id: string | null | undefined): InstanceView | null {
  const view = useSyncExternalStore(subscribe, () => (id ? state.views.get(id) ?? null : null), () => null);
  useEffect(() => {
    if (id && !state.views.has(id)) void fetchView(id);
  }, [id]);
  return view;
}

export function useOpenActivity(): OpenActivity | null {
  return useSyncExternalStore(subscribe, () => state.open, () => null);
}

export function useActivityShelf(): ShelfRequest | null {
  return useSyncExternalStore(subscribe, () => state.shelf, () => null);
}

export function useActivityError(): ActivityError | null {
  return useSyncExternalStore(subscribe, () => state.error, () => null);
}

export function useAgePrompt(): AgePrompt | null {
  return useSyncExternalStore(subscribe, () => state.age, () => null);
}

export function clearActivityError(): void {
  set({ error: null });
}

// ─── Slots (where a chat / call shows its Activity) ─────────

export const slotKey = (channelId: string, voice: boolean) => `${channelId.toLowerCase()}:${voice ? "call" : "chat"}`;

export function registerActivitySlot(key: string, el: HTMLElement): () => void {
  const slots = new Map(state.slots);
  slots.set(key, el);
  set({ slots });
  return () => {
    if (state.slots.get(key) !== el) return;
    const next = new Map(state.slots);
    next.delete(key);
    set({ slots: next });
  };
}

/** The slot element the open Activity docks into right now (null = not on screen). */
export function useOpenActivitySlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => {
    const o = state.open;
    return o ? state.slots.get(slotKey(o.frame.location.channelId, o.frame.location.voice)) ?? null : null;
  }, () => null);
}

/** The open Activity, if it belongs to this chat / call. */
export function useOpenActivityAt(channelId: string | null | undefined, voice: boolean): OpenActivity | null {
  return useSyncExternalStore(subscribe, () => {
    const o = state.open;
    if (!o || !channelId) return null;
    return o.frame.location.channelId.toLowerCase() === channelId.toLowerCase() && o.frame.location.voice === voice ? o : null;
  }, () => null);
}

// ─── Actions ────────────────────────────────────────────────

export function openActivityShelf(req: ShelfRequest): void {
  set({ shelf: req });
}

export function closeActivityShelf(): void {
  set({ shelf: null });
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { code: "network", error: "" } };
  }
}

function fail(data: Record<string, unknown>): false {
  set({ error: { code: String(data.code ?? "error"), message: String(data.error ?? "") } });
  return false;
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
}

function show(instanceId: string, frame: FrameInfo | null | undefined): boolean {
  if (!frame) return fail({ code: "not_configured" });
  if (state.open && state.open.instanceId !== instanceId) void leave(state.open.instanceId);
  closePopout();
  set({
    open: { instanceId, frame, nonce: (state.open?.nonce ?? 0) + 1, layout: "inline", chatHidden: false, returnPath: currentPath() },
    shelf: null,
    error: null,
  });
  void fetchView(instanceId);
  return true;
}

/** Ask the user to confirm an 18+ Activity, then run `retry` (or nothing). */
function askAge(appName: string, retry: () => Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    set({
      age: {
        appName,
        confirm: () => { set({ age: null }); void retry().then(resolve); },
        cancel: () => { set({ age: null }); resolve(false); },
      },
    });
  });
}

/** Launch an app's Activity here (or join the one running) and open it. */
export async function launchActivity(applicationId: string, channelId: string, voice: boolean, ageConfirmed = false, appName = "", urlOverride?: string): Promise<boolean> {
  const r = await post("/api/activities/launch", { applicationId, channelId, voice, platform: platformHint(), ageConfirmed, ...(urlOverride ? { urlOverride } : {}) });
  if (!r.ok && r.data.code === "age_confirm" && !ageConfirmed) {
    return askAge(appName, () => launchActivity(applicationId, channelId, voice, true, appName, urlOverride));
  }
  if (!r.ok) return fail(r.data);
  return show(String(r.data.instanceId), r.data.frame as FrameInfo | null);
}

/** Join a running instance and open it. */
export async function joinActivity(instanceId: string, ageConfirmed = false, appName = ""): Promise<boolean> {
  if (state.open?.instanceId === instanceId) {
    if (state.open.layout === "popout") focusPopout();
    else set({ open: { ...state.open, nonce: state.open.nonce + 1, layout: "inline" } });
    return true;
  }
  const r = await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/join`, { platform: platformHint(), ageConfirmed });
  if (!r.ok && r.data.code === "age_confirm" && !ageConfirmed) {
    const name = appName || state.views.get(instanceId)?.app?.name || "";
    return askAge(name, () => joinActivity(instanceId, true, name));
  }
  if (!r.ok) return fail(r.data);
  return show(instanceId, r.data.frame as FrameInfo | null);
}

async function leave(instanceId: string): Promise<void> {
  await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/leave`, {});
}

/** Close the open Activity (leaves it; the last one out ends it). */
export function closeActivity(): void {
  const open = state.open;
  closePopout();
  set({ open: null });
  if (open) void leave(open.instanceId);
}

export function setActivityLayout(layout: Exclude<ActivityLayout, "popout">): void {
  if (!state.open) return;
  if (state.open.layout === "popout") closePopout();
  set({ open: { ...state.open, layout } });
}

/** Hide / show the chat under a text-chat Activity. */
export function toggleChatHidden(): void {
  if (state.open) set({ open: { ...state.open, chatHidden: !state.open.chatHidden } });
}

// The element holding the open frame (ActivityHost), for full screen.
let activityBox: HTMLElement | null = null;

export function setActivityBox(el: HTMLElement | null): void {
  activityBox = el;
}

export function canFullscreenActivity(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

/**
 * Full screen for the open Activity: the box around the frame goes full
 * screen (the browser's :fullscreen styles override its docked geometry), so
 * the app keeps running. Esc or the same button leaves it.
 */
export function toggleActivityFullscreen(): void {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
    return;
  }
  void activityBox?.requestFullscreen?.().catch(() => {});
}

/** Heartbeat for the open frame. False = the server says we're no longer in it. */
export async function heartbeat(instanceId: string): Promise<boolean> {
  const r = await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/heartbeat`, {});
  return r.ok ? Boolean(r.data.active) : true; // network blip: keep the frame
}

/** An SDK command that needs the server. */
export async function activityRpc(instanceId: string, cmd: string, args: Record<string, unknown> = {}): Promise<{ ok: true; data: unknown } | { ok: false; code: number; message: string }> {
  const r = await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/rpc`, { cmd, args });
  const d = r.data as { ok?: boolean; data?: unknown; code?: number; message?: string };
  if (d && d.ok === true) return { ok: true, data: d.data ?? null };
  return { ok: false, code: typeof d?.code === "number" ? d.code : 4000, message: typeof d?.message === "string" ? d.message : "Request failed" };
}

// ─── Pop-out window ─────────────────────────────────────────

let popout: Window | null = null;
let popoutTimer: number | null = null;

export interface PopoutPayload { instanceId: string; frame: FrameInfo }

/** Move the open Activity into its own browser window. False when the popup was blocked. */
export function popOutActivity(): boolean {
  const o = state.open;
  if (!o || !canPopOut()) return false;
  const payload: PopoutPayload = { instanceId: o.instanceId, frame: o.frame };
  const w = window.open(`${POPOUT_PATH}#${encodeURIComponent(JSON.stringify(payload))}`, `serika-activity-${o.instanceId}`, "popup=yes,width=1100,height=760");
  if (!w) return false;
  popout = w;
  set({ open: { ...o, layout: "popout" } });
  if (popoutTimer !== null) window.clearInterval(popoutTimer);
  // The window was closed (by the user or "return"): bring the Activity back here.
  popoutTimer = window.setInterval(() => {
    if (popout && !popout.closed) return;
    if (popoutTimer !== null) window.clearInterval(popoutTimer);
    popoutTimer = null;
    popout = null;
    if (state.open?.layout === "popout") set({ open: { ...state.open, layout: "inline", nonce: state.open.nonce + 1 } });
  }, 700);
  return true;
}

function focusPopout() {
  try { popout?.focus(); } catch { /* gone */ }
}

function closePopout() {
  if (popoutTimer !== null && typeof window !== "undefined") window.clearInterval(popoutTimer);
  popoutTimer = null;
  try { popout?.close(); } catch { /* gone */ }
  popout = null;
}

/** Bring a popped-out Activity back into the main window. */
export function returnFromPopout(): void {
  closePopout();
  if (state.open?.layout === "popout") set({ open: { ...state.open, layout: "inline", nonce: state.open.nonce + 1 } });
}

// ─── Live events ────────────────────────────────────────────

type ActivityStreamEvent =
  | { type: "activity_update"; instance: InstanceView }
  | { type: "activity_open"; instanceId: string };

type BusMessage = ActivityStreamEvent | { type: "popout_leave"; instanceId: string } | { type: "popout_return"; instanceId: string };

/** Let other components (the frame) react to updates of an instance. */
export function onActivityEvent(cb: (e: ActivityStreamEvent) => void): () => void {
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as ActivityStreamEvent | undefined;
    if (detail && (detail.type === "activity_update" || detail.type === "activity_open")) cb(detail);
  };
  window.addEventListener(ACTIVITY_EVENT, handler);
  return () => window.removeEventListener(ACTIVITY_EVENT, handler);
}

let bus: BroadcastChannel | null = null;
function getBus(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  bus ??= new BroadcastChannel(CHANNEL_NAME);
  return bus;
}

/** Re-dispatch a stream event (UnreadContext, the chat engine) here and to a pop-out window. */
export function dispatchActivityEvent(data: unknown, fromBus = false): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: data }));
  if (!fromBus && !isPopoutWindow() && state.open?.layout === "popout") {
    try { getBus()?.postMessage(data); } catch { /* not cloneable */ }
  }
}

/** Pop-out window → main window: the user left or asked to return. */
export function postToMainWindow(msg: BusMessage): void {
  try { getBus()?.postMessage(msg); } catch { /* gone */ }
}

if (typeof window !== "undefined") {
  window.addEventListener(ACTIVITY_EVENT, (ev) => {
    const detail = (ev as CustomEvent).detail as ActivityStreamEvent | undefined;
    if (!detail) return;
    if (detail.type === "activity_update" && detail.instance && typeof detail.instance.id === "string") storeView(detail.instance);
    // A command launched it for this user: only the window they're looking at opens it.
    if (detail.type === "activity_open" && typeof detail.instanceId === "string" && !isPopoutWindow()
      && document.visibilityState === "visible" && document.hasFocus()) {
      void joinActivity(detail.instanceId);
    }
  });
  getBus()?.addEventListener("message", (ev: MessageEvent) => {
    const msg = ev.data as BusMessage | null;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "activity_update" || msg.type === "activity_open") {
      if (isPopoutWindow() && msg.type === "activity_update") dispatchActivityEvent(msg, true);
      return;
    }
    if (isPopoutWindow()) return;
    if (msg.type === "popout_leave" && state.open?.instanceId === msg.instanceId) closeActivity();
    if (msg.type === "popout_return" && state.open?.instanceId === msg.instanceId) returnFromPopout();
  });
}
