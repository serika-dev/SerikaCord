"use client";
/**
 * Client state for Activities (CORD-92): the Activity open in this window, the
 * shelf (launcher), and the live state of instances shown on Game Invitation
 * cards. The host UI (src/components/activities/ActivityHost.tsx) is mounted
 * once in the app shell; call trays, the composer and cards only call the
 * functions here.
 *
 * Live updates: the server sends `activity_update` on chat streams (cards) and
 * on the user's own stream (participants, frames), and `activity_open` when a
 * command launched an Activity for this user. UnreadContext and the chat
 * engine re-dispatch both as the ACTIVITY_EVENT window event.
 */
import { useEffect, useSyncExternalStore } from "react";
import { isNativeApp, nativePlatform } from "@/lib/native/bridge";
import { isDesktopShell } from "@/lib/desktop/bridge";

export const ACTIVITY_EVENT = "serika:activity";

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
}

export interface OpenActivity {
  instanceId: string;
  frame: FrameInfo;
  /** Bumped when the same instance is opened again (focus it). */
  nonce: number;
}

export interface ShelfRequest { channelId: string; voice: boolean }

export type ActivityError = { code: string; message: string };

type State = {
  open: OpenActivity | null;
  shelf: ShelfRequest | null;
  views: Map<string, InstanceView>;
  error: ActivityError | null;
};

let state: State = { open: null, shelf: null, views: new Map(), error: null };
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

// ─── Instance views (cards, call bars) ──────────────────────

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

export function clearActivityError(): void {
  set({ error: null });
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

function show(instanceId: string, frame: FrameInfo | null | undefined): boolean {
  if (!frame) return fail({ code: "not_configured" });
  if (state.open && state.open.instanceId !== instanceId) void leave(state.open.instanceId);
  set({ open: { instanceId, frame, nonce: (state.open?.nonce ?? 0) + 1 }, shelf: null, error: null });
  void fetchView(instanceId);
  return true;
}

/** Launch an app's Activity here (or join the one running) and open it. */
export async function launchActivity(applicationId: string, channelId: string, voice: boolean): Promise<boolean> {
  const r = await post("/api/activities/launch", { applicationId, channelId, voice, platform: platformHint() });
  if (!r.ok) return fail(r.data);
  return show(String(r.data.instanceId), r.data.frame as FrameInfo | null);
}

/** Join a running instance and open it. */
export async function joinActivity(instanceId: string): Promise<boolean> {
  if (state.open?.instanceId === instanceId) {
    set({ open: { ...state.open, nonce: state.open.nonce + 1 } });
    return true;
  }
  const r = await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/join`, { platform: platformHint() });
  if (!r.ok) return fail(r.data);
  return show(instanceId, r.data.frame as FrameInfo | null);
}

async function leave(instanceId: string): Promise<void> {
  await post(`/api/activities/instances/${encodeURIComponent(instanceId)}/leave`, {});
}

/** Close the open Activity (leaves it; the last one out ends it). */
export function closeActivity(): void {
  const open = state.open;
  set({ open: null });
  if (open) void leave(open.instanceId);
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

// ─── Live events ────────────────────────────────────────────

type ActivityStreamEvent =
  | { type: "activity_update"; instance: InstanceView }
  | { type: "activity_open"; instanceId: string };

/** Let other components (the frame) react to updates of an instance. */
export function onActivityEvent(cb: (e: ActivityStreamEvent) => void): () => void {
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as ActivityStreamEvent | undefined;
    if (detail && (detail.type === "activity_update" || detail.type === "activity_open")) cb(detail);
  };
  window.addEventListener(ACTIVITY_EVENT, handler);
  return () => window.removeEventListener(ACTIVITY_EVENT, handler);
}

/** Re-dispatch a stream event (UnreadContext, the chat engine). */
export function dispatchActivityEvent(data: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: data }));
}

if (typeof window !== "undefined") {
  window.addEventListener(ACTIVITY_EVENT, (ev) => {
    const detail = (ev as CustomEvent).detail as ActivityStreamEvent | undefined;
    if (!detail) return;
    if (detail.type === "activity_update" && detail.instance && typeof detail.instance.id === "string") storeView(detail.instance);
    // A command launched it for this user: only the window they're looking at opens it.
    if (detail.type === "activity_open" && typeof detail.instanceId === "string" && document.visibilityState === "visible" && document.hasFocus()) {
      void joinActivity(detail.instanceId);
    }
  });
}
