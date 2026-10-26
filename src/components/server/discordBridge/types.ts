import type { CSSProperties } from "react";
import type { BridgeDirection, BridgeLinkOptions } from "@/lib/discord/bridgeConfig";

export type { BridgeDirection, BridgeLinkOptions };

/** GET /api/servers/:id/discord-bridge (src/lib/api/discordBridge.ts bridgeState). */
export interface BridgeHealth {
  lastInboundAt?: string;
  lastOutboundAt?: string;
  error?: { code: "webhook_missing" | "missing_permissions" | "rate_limited" | "discord_error"; status?: number; at: string };
}

export interface BridgeLinkView {
  discordChannelId: string;
  serikaChannelId: string;
  hasWebhook: boolean;
  overrides: Partial<BridgeLinkOptions>;
  options: BridgeLinkOptions;
  health: BridgeHealth | null;
}

export interface SerikaChannelView {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number | null;
}

export interface BridgeState {
  configured: boolean;
  bot: { online: boolean | null; lastSeenAt: string | null; username: string | null; id: string; inviteUrl: string };
  account: { connected: boolean; username: string | null };
  enabled: boolean;
  restrictUnconsented: boolean;
  guild: { id: string; name: string | null; icon: string | null } | null;
  linkedAt: string | null;
  conflict: { serverName: string | null } | null;
  defaults: BridgeLinkOptions;
  links: BridgeLinkView[];
  serikaChannels: SerikaChannelView[];
}

export interface DiscordChannelView {
  id: string;
  name: string;
  kind: "text" | "announcement" | "category";
  parentId: string | null;
  position: number;
}

export interface PickableGuild {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
  claimedBy: { yours: boolean; name: string | null } | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string | null; status: number; code?: string };

/** Fetch a bridge route under /api/servers/:serverId/discord-bridge. */
export async function bridgeApi<T>(serverId: string, path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/servers/${serverId}/discord-bridge${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: typeof data?.error === "string" ? data.error : null, status: res.status, code: typeof data?.code === "string" ? data.code : undefined };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: null, status: 0 };
  }
}

/** Discord's brand colour, scoped to the bridge UI via a CSS variable. */
export const DISCORD_BRAND_STYLE = { "--discord-brand": "#5865F2" } as CSSProperties;
