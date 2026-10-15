/**
 * Client side of app interactions (slash commands, components, modals).
 *
 * The server sends `{ type: "interaction", event, ... }` on the user's own
 * activity stream; UnreadContext re-dispatches it as a window event
 * (INTERACTION_EVENT) so the chat engine (ephemeral messages), component
 * buttons (stop spinning) and the modal host can listen without prop drilling.
 */
import { walkComponents, type MessageComponent, type Modal } from "@/lib/botapi/components";

export const INTERACTION_EVENT = "serika:interaction";

export type InteractionEvent =
  | { type: "interaction"; event: "ack"; interactionId: string; channelId: string; callbackType: number }
  | { type: "interaction"; event: "failed"; interactionId?: string; channelId: string; reason?: string; command?: string }
  | { type: "interaction"; event: "modal"; interactionId: string; channelId: string; modalId: string; modal: Modal; application: { id: string; name: string; icon: string | null } }
  | { type: "interaction"; event: "ephemeral" | "ephemeral_update"; channelId: string; message: Record<string, unknown> }
  | { type: "interaction"; event: "ephemeral_delete"; channelId: string; messageId: string };

// Outcomes (ack / failed) seen recently, by interaction id: an app with an
// HTTP endpoint can answer before our POST even returns the id.
const recent = new Map<string, { event: "ack" | "failed"; reason?: string; at: number }>();
const claimed = new Set<string>();

function remember(e: InteractionEvent) {
  if ((e.event === "ack" || e.event === "failed") && e.interactionId) {
    recent.set(e.interactionId, { event: e.event, reason: e.event === "failed" ? e.reason : undefined, at: Date.now() });
    if (recent.size > 100) recent.delete(recent.keys().next().value as string);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(INTERACTION_EVENT, (ev) => {
    const detail = (ev as CustomEvent).detail as InteractionEvent | undefined;
    if (detail && detail.type === "interaction") remember(detail);
  });
}

/** An ack / failure that already arrived for this interaction (last 15 s). */
export function recentOutcome(interactionId: string): { event: "ack" | "failed"; reason?: string } | null {
  const hit = recent.get(interactionId);
  return hit && Date.now() - hit.at < 15_000 ? hit : null;
}

/** Mark an interaction as handled in place (e.g. a component shows its own error). */
export function claimInteraction(interactionId: string): void {
  claimed.add(interactionId);
  if (claimed.size > 200) claimed.delete(claimed.values().next().value as string);
}

export function isClaimedInteraction(interactionId: string): boolean {
  return claimed.has(interactionId);
}

export function onInteractionEvent(cb: (e: InteractionEvent) => void): () => void {
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as InteractionEvent | undefined;
    if (detail && detail.type === "interaction") cb(detail);
  };
  window.addEventListener(INTERACTION_EVENT, handler);
  return () => window.removeEventListener(INTERACTION_EVENT, handler);
}

export interface InteractionPostResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
  error?: string;
}

/** POST JSON to an /api/interactions route. Never throws. */
export async function postInteraction<T = Record<string, unknown>>(path: string, body: unknown): Promise<InteractionPostResult<T>> {
  try {
    const res = await fetch(`/api/interactions/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { code?: string; error?: string }) | null;
    return { ok: res.ok, status: res.status, data, code: data?.code, error: data?.error };
  } catch {
    return { ok: false, status: 0, data: null, code: "network" };
  }
}

/** Message flags the UI cares about. */
export const UI_FLAGS = {
  EPHEMERAL: 1 << 6,
  LOADING: 1 << 7,
  IS_COMPONENTS_V2: 1 << 15,
} as const;

export function isLoadingMessage(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & UI_FLAGS.LOADING) !== 0;
}

/**
 * A message's attachments minus the ones its components already show (v2 file /
 * media components reference uploads by attachment_id), so files don't render twice.
 */
export function attachmentsOutsideComponents<A extends { id: string; url: string }>(attachments: A[] | undefined, components: MessageComponent[] | undefined): A[] | undefined {
  if (!attachments?.length || !components?.length) return attachments;
  const used = new Set<string>();
  for (const c of walkComponents(components)) {
    for (const m of [c.media, c.file, ...(c.items ?? []).map((i) => i.media)]) {
      if (m?.attachment_id) used.add(m.attachment_id);
      if (m?.url) used.add(m.url);
    }
  }
  if (used.size === 0) return attachments;
  return attachments.filter((a) => !used.has(a.id) && !used.has(a.url));
}

export type { MessageComponent, Modal };
