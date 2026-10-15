import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { cdnImage } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";

/**
 * Server-side link-preview metadata for invite and server pages.
 *
 * Only exposes what the public pages already show to logged-out visitors:
 * the invite card (GET /api/invites/:code) shows name, icon, banner,
 * description and member count; server pages only reveal anything for
 * servers that opted into Discovery. Everything else gets generic metadata.
 */

interface InvitePreview {
  /** "vanity" = a partnered server's custom URL (public by design). */
  kind: "invite" | "vanity";
  name: string;
  description: string | null;
  icon: string | null;
  banner: string | null;
  memberCount: number;
}

/** Mirrors resolveInviteCode() in src/lib/api/servers.ts. */
async function loadInvitePreview(code: string): Promise<InvitePreview | null> {
  if (!code || code.length > 64) return null;
  try {
    const { db, schema } = await import("@/lib/db/postgres");
    const { eq } = await import("drizzle-orm");
    const serverCols = {
      name: schema.servers.name,
      description: schema.servers.description,
      icon: schema.servers.icon,
      banner: schema.servers.banner,
      memberCount: schema.servers.memberCount,
      vanityUrlCode: schema.servers.vanityUrlCode,
      settings: schema.servers.settings,
    };

    const inviteRows = await db
      .select({ serverId: schema.invites.serverId, expiresAt: schema.invites.expiresAt })
      .from(schema.invites)
      .where(eq(schema.invites.code, code))
      .limit(1);

    let kind: InvitePreview["kind"] = "invite";
    let server: { name: string; description: string | null; icon: string | null; banner: string | null; memberCount: number | null } | undefined;

    if (inviteRows.length > 0) {
      const inv = inviteRows[0];
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now()) return null;
      const rows = await db.select(serverCols).from(schema.servers).where(eq(schema.servers.id, inv.serverId)).limit(1);
      const s = rows[0];
      if (!s) return null;
      // "Lock to Custom Invite": regular invites look expired while a vanity URL exists.
      const lockToVanity = (s.settings as { invites?: { lockToVanity?: boolean } } | null)?.invites?.lockToVanity;
      if (lockToVanity && s.vanityUrlCode) return null;
      server = s;
    } else {
      const rows = await db
        .select(serverCols)
        .from(schema.servers)
        .where(eq(schema.servers.vanityUrlCode, code.toLowerCase()))
        .limit(1);
      if (!rows[0]) return null;
      kind = "vanity";
      server = rows[0];
    }

    return {
      kind,
      name: server.name,
      description: server.description ? decodeHtmlEntities(server.description) : null,
      icon: server.icon,
      banner: server.banner,
      memberCount: server.memberCount || 0,
    };
  } catch {
    return null;
  }
}

function previewImage(banner: string | null, icon: string | null): string | undefined {
  if (banner) return cdnImage(banner);
  if (icon) return cdnImage(icon);
  return undefined;
}

function withMemberCount(desc: string, memberCount: number): string {
  return memberCount > 0 ? `${desc} ${memberCount.toLocaleString("en-US")} members.` : desc;
}

/**
 * Metadata for /CODE and /invite/CODE. Regular invites are never indexed
 * (they expire, and private servers' links get posted in public places);
 * partnered vanity URLs are public by design and may be indexed.
 */
export async function buildInviteMetadata(code: string): Promise<Metadata> {
  const preview = await loadInvitePreview(code);
  const keywords = ["SerikaCord invite", "join server", "SerikaCord server invite", "community invite"];

  if (!preview) {
    return buildMetadata({
      title: "Join a Server on SerikaCord",
      description: "Accept a SerikaCord invite and join a community. Chat with members, explore channels, and hang out with friends in real time.",
      path: `/invite/${encodeURIComponent(code)}`,
      keywords,
      noIndex: true,
    });
  }

  const description = withMemberCount(
    preview.description || `Join ${preview.name} on SerikaCord. Chat, voice, and hang out with the community.`,
    preview.memberCount,
  );

  return buildMetadata({
    title: `Join ${preview.name} on SerikaCord`,
    description,
    path: preview.kind === "vanity" ? `/${encodeURIComponent(code.toLowerCase())}` : `/invite/${encodeURIComponent(code)}`,
    image: previewImage(preview.banner, preview.icon),
    keywords: [preview.name, ...keywords],
    noIndex: preview.kind !== "vanity",
  });
}

/**
 * Metadata for /channels/:serverId(/...). Only servers listed in Discovery
 * reveal their name, description and artwork, and only they are indexable.
 */
export async function buildServerMetadata(serverId: string): Promise<Metadata> {
  const generic = () =>
    buildMetadata({
      title: "SerikaCord",
      description: "Sign in to SerikaCord to open this server.",
      path: "/channels/me",
      noIndex: true,
    });

  if (!/^[0-9a-f-]{36}$/i.test(serverId)) return generic();

  try {
    const { db, schema } = await import("@/lib/db/postgres");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({
        name: schema.servers.name,
        description: schema.servers.description,
        discoveryDescription: schema.servers.discoveryDescription,
        icon: schema.servers.icon,
        banner: schema.servers.banner,
        memberCount: schema.servers.memberCount,
        isDiscoverable: schema.servers.isDiscoverable,
      })
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);

    const s = rows[0];
    if (!s || !s.isDiscoverable) return generic();

    const rawDesc = s.discoveryDescription || s.description;
    const description = withMemberCount(
      rawDesc ? decodeHtmlEntities(rawDesc) : `${s.name} is a community on SerikaCord. Join to chat, voice, and hang out.`,
      s.memberCount || 0,
    );

    return buildMetadata({
      title: `${s.name} — SerikaCord`,
      description,
      path: `/channels/${serverId.toLowerCase()}`,
      image: previewImage(s.banner, s.icon),
      keywords: [s.name, "SerikaCord", "SerikaCord server", "community", "chat", "voice chat", "join server"],
    });
  } catch {
    return generic();
  }
}
