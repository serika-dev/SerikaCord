"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Plus, Pencil, Trash2 } from "lucide-react";
import { useGT } from "gt-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { useServer, useServerMembersOptional } from "@/contexts/ServerContext";
import { cn, cdnImage } from "@/lib/utils";
import { AuditLogEvent, auditVerb, type AuditChange } from "@/lib/audit/auditLog";
import { ROLE_PERMISSION_CATEGORIES } from "@/lib/constants/rolePermissions";

interface AuditEntry {
  id: string;
  actionType: number;
  userId: string | null;
  targetId: string | null;
  changes: AuditChange[];
  options: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

interface AuditUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  isBot?: boolean;
}

interface PanelRole {
  id: string;
  name: string;
  color?: string;
}

const MARK = "\u0001";

const PERMISSION_LABELS: Array<{ bit: bigint; label: string }> = ROLE_PERMISSION_CATEGORIES.flatMap((c) =>
  c.permissions.map((p) => ({ bit: p.bit, label: p.label })),
);

function permissionNames(value: unknown): string[] {
  let bits = 0n;
  try {
    bits = BigInt(String(value ?? "0"));
  } catch {
    return [];
  }
  return PERMISSION_LABELS.filter((p) => (bits & p.bit) === p.bit).map((p) => p.label);
}

/** Renders a translated sentence whose {placeholders} were replaced by MARK-wrapped indexes, with styled names. */
function renderSentence(text: string, parts: ReactNode[]): ReactNode {
  const pieces = text.split(MARK);
  return pieces.map((piece, i) => {
    if (i % 2 === 1) {
      const idx = Number(piece);
      return <Fragment key={i}>{parts[idx] ?? null}</Fragment>;
    }
    return <Fragment key={i}>{piece}</Fragment>;
  });
}

const m = (i: number) => `${MARK}${i}${MARK}`;

/**
 * Discord's server audit log: who did what, newest first, filterable by user
 * and action, each entry expandable to show exactly what changed.
 */
export function ServerAuditLogPanel({ serverId, roles }: { serverId: string; roles: PanelRole[] }) {
  const gt = useGT();
  const { channels } = useServer();
  const members = useServerMembersOptional()?.members;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<Record<string, AuditUser>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (before: string | null) => {
      const params = new URLSearchParams({ limit: "50" });
      if (filterUser) params.set("user_id", filterUser);
      if (filterAction) params.set("action_type", filterAction);
      if (before) params.set("before", before);
      const res = await fetch(`/api/servers/${serverId}/audit-log?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load audit log");
      return data as { entries: AuditEntry[]; users: AuditUser[]; hasMore: boolean };
    },
    [serverId, filterUser, filterAction],
  );

  useEffect(() => {
    let cancelled = false;
    load(null)
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries || []);
        setUsers(Object.fromEntries((data.users || []).map((u) => [u.id, u])));
        setHasMore(Boolean(data.hasMore));
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await load(last.createdAt);
      setEntries((prev) => [...prev, ...(data.entries || []).filter((e) => !prev.some((p) => p.id === e.id))]);
      setUsers((prev) => ({ ...prev, ...Object.fromEntries((data.users || []).map((u) => [u.id, u])) }));
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name] as const)), [channels]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r] as const)), [roles]);

  const memberOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const u of Object.values(users)) seen.set(u.id, u.displayName || u.username);
    for (const mem of (members || []) as Array<{ id?: string; displayName?: string; username?: string }>) {
      if (mem.id && !seen.has(mem.id)) seen.set(mem.id, mem.displayName || mem.username || mem.id);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [users, members]);

  const actionOptions: Array<{ value: number; label: string }> = [
    { value: AuditLogEvent.GUILD_UPDATE, label: gt("Update Server") },
    { value: AuditLogEvent.CHANNEL_CREATE, label: gt("Create Channel") },
    { value: AuditLogEvent.CHANNEL_UPDATE, label: gt("Update Channel") },
    { value: AuditLogEvent.CHANNEL_DELETE, label: gt("Delete Channel") },
    { value: AuditLogEvent.CHANNEL_OVERWRITE_CREATE, label: gt("Create Channel Permission") },
    { value: AuditLogEvent.CHANNEL_OVERWRITE_UPDATE, label: gt("Update Channel Permission") },
    { value: AuditLogEvent.CHANNEL_OVERWRITE_DELETE, label: gt("Delete Channel Permission") },
    { value: AuditLogEvent.MEMBER_KICK, label: gt("Kick Member") },
    { value: AuditLogEvent.MEMBER_BAN_ADD, label: gt("Ban Member") },
    { value: AuditLogEvent.MEMBER_BAN_REMOVE, label: gt("Unban Member") },
    { value: AuditLogEvent.MEMBER_UPDATE, label: gt("Update Member") },
    { value: AuditLogEvent.MEMBER_ROLE_UPDATE, label: gt("Update Member Roles") },
    { value: AuditLogEvent.ROLE_CREATE, label: gt("Create Role") },
    { value: AuditLogEvent.ROLE_UPDATE, label: gt("Update Role") },
    { value: AuditLogEvent.ROLE_DELETE, label: gt("Delete Role") },
    { value: AuditLogEvent.INVITE_CREATE, label: gt("Create Invite") },
    { value: AuditLogEvent.INVITE_DELETE, label: gt("Delete Invite") },
    { value: AuditLogEvent.WEBHOOK_CREATE, label: gt("Create Webhook") },
    { value: AuditLogEvent.WEBHOOK_DELETE, label: gt("Delete Webhook") },
    { value: AuditLogEvent.EMOJI_CREATE, label: gt("Create Emoji") },
    { value: AuditLogEvent.EMOJI_UPDATE, label: gt("Update Emoji") },
    { value: AuditLogEvent.EMOJI_DELETE, label: gt("Delete Emoji") },
    { value: AuditLogEvent.STICKER_CREATE, label: gt("Create Sticker") },
    { value: AuditLogEvent.STICKER_UPDATE, label: gt("Update Sticker") },
    { value: AuditLogEvent.STICKER_DELETE, label: gt("Delete Sticker") },
    { value: AuditLogEvent.SOUNDBOARD_SOUND_CREATE, label: gt("Create Soundboard Sound") },
    { value: AuditLogEvent.SOUNDBOARD_SOUND_DELETE, label: gt("Delete Soundboard Sound") },
    { value: AuditLogEvent.MESSAGE_DELETE, label: gt("Delete Message") },
    { value: AuditLogEvent.MESSAGE_BULK_DELETE, label: gt("Bulk Delete Messages") },
    { value: AuditLogEvent.MESSAGE_PIN, label: gt("Pin Message") },
    { value: AuditLogEvent.MESSAGE_UNPIN, label: gt("Unpin Message") },
    { value: AuditLogEvent.THREAD_CREATE, label: gt("Create Thread") },
    { value: AuditLogEvent.THREAD_UPDATE, label: gt("Update Thread") },
    { value: AuditLogEvent.THREAD_DELETE, label: gt("Delete Thread") },
  ];

  const userName = (id: string | null | undefined) => {
    if (!id) return gt("System");
    const u = users[id];
    return u ? u.displayName || u.username : gt("Unknown User");
  };

  const strong = (text: string, key: string, color?: string) => (
    <strong key={key} className="font-semibold text-[var(--text-primary)]" style={color ? { color } : undefined}>
      {text}
    </strong>
  );

  const changeName = (e: AuditEntry): string | null => {
    const named = e.changes.find((c) => c.key === "name");
    const v = named?.new ?? named?.old;
    return typeof v === "string" ? v : null;
  };

  const channelLabel = (e: AuditEntry) => {
    const name = (e.options?.channel_name as string | undefined) || (e.targetId ? channelNames.get(e.targetId) : undefined) || changeName(e);
    return name ? `#${name}` : gt("deleted-channel");
  };

  const roleLabel = (e: AuditEntry) => {
    const role = e.targetId ? roleById.get(e.targetId) : undefined;
    return { name: role?.name || (e.options?.role_name as string | undefined) || changeName(e) || gt("deleted-role"), color: role?.color };
  };

  const overwriteTargetLabel = (e: AuditEntry) => {
    const id = typeof e.options?.id === "string" ? e.options.id : "";
    if (e.options?.type === "1") return userName(id);
    const role = roleById.get(id);
    return role?.name || (role === undefined && id === serverId ? "@everyone" : gt("deleted-role"));
  };

  const sentence = (e: AuditEntry): ReactNode => {
    const actor = strong(userName(e.userId), "a");
    const user = strong(userName(e.targetId), "t");
    const name = changeName(e) ?? "";
    switch (e.actionType) {
      case AuditLogEvent.GUILD_UPDATE:
        return renderSentence(gt("{actor} updated the server", { actor: m(0) }), [actor]);
      case AuditLogEvent.CHANNEL_CREATE:
        return renderSentence(gt("{actor} created the channel {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      case AuditLogEvent.CHANNEL_UPDATE:
        return renderSentence(gt("{actor} updated the channel {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      case AuditLogEvent.CHANNEL_DELETE:
        return renderSentence(gt("{actor} deleted the channel {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      case AuditLogEvent.CHANNEL_OVERWRITE_CREATE:
        return renderSentence(gt("{actor} created permission overrides for {who} in {target}", { actor: m(0), who: m(1), target: m(2) }), [actor, strong(overwriteTargetLabel(e), "w"), strong(channelLabel(e), "t")]);
      case AuditLogEvent.CHANNEL_OVERWRITE_UPDATE:
        return renderSentence(gt("{actor} updated permission overrides for {who} in {target}", { actor: m(0), who: m(1), target: m(2) }), [actor, strong(overwriteTargetLabel(e), "w"), strong(channelLabel(e), "t")]);
      case AuditLogEvent.CHANNEL_OVERWRITE_DELETE:
        return renderSentence(gt("{actor} removed permission overrides for {who} in {target}", { actor: m(0), who: m(1), target: m(2) }), [actor, strong(overwriteTargetLabel(e), "w"), strong(channelLabel(e), "t")]);
      case AuditLogEvent.MEMBER_KICK:
        return renderSentence(gt("{actor} kicked {target}", { actor: m(0), target: m(1) }), [actor, user]);
      case AuditLogEvent.MEMBER_BAN_ADD:
        return renderSentence(gt("{actor} banned {target}", { actor: m(0), target: m(1) }), [actor, user]);
      case AuditLogEvent.MEMBER_BAN_REMOVE:
        return renderSentence(gt("{actor} unbanned {target}", { actor: m(0), target: m(1) }), [actor, user]);
      case AuditLogEvent.MEMBER_UPDATE: {
        const timeout = e.changes.find((c) => c.key === "communication_disabled_until");
        if (timeout) {
          return timeout.new
            ? renderSentence(gt("{actor} timed out {target}", { actor: m(0), target: m(1) }), [actor, user])
            : renderSentence(gt("{actor} removed the timeout from {target}", { actor: m(0), target: m(1) }), [actor, user]);
        }
        return e.userId && e.userId === e.targetId
          ? renderSentence(gt("{actor} changed their nickname", { actor: m(0) }), [actor])
          : renderSentence(gt("{actor} updated {target}", { actor: m(0), target: m(1) }), [actor, user]);
      }
      case AuditLogEvent.MEMBER_ROLE_UPDATE:
        return renderSentence(gt("{actor} updated roles for {target}", { actor: m(0), target: m(1) }), [actor, user]);
      case AuditLogEvent.ROLE_CREATE: {
        const r = roleLabel(e);
        return renderSentence(gt("{actor} created the role {target}", { actor: m(0), target: m(1) }), [actor, strong(r.name, "t", r.color)]);
      }
      case AuditLogEvent.ROLE_UPDATE: {
        const r = roleLabel(e);
        return renderSentence(gt("{actor} updated the role {target}", { actor: m(0), target: m(1) }), [actor, strong(r.name, "t", r.color)]);
      }
      case AuditLogEvent.ROLE_DELETE: {
        const r = roleLabel(e);
        return renderSentence(gt("{actor} deleted the role {target}", { actor: m(0), target: m(1) }), [actor, strong(r.name, "t")]);
      }
      case AuditLogEvent.INVITE_CREATE:
        return renderSentence(gt("{actor} created the invite {target}", { actor: m(0), target: m(1) }), [actor, strong(e.targetId ?? "", "t")]);
      case AuditLogEvent.INVITE_DELETE:
        return renderSentence(gt("{actor} deleted the invite {target}", { actor: m(0), target: m(1) }), [actor, strong(e.targetId ?? "", "t")]);
      case AuditLogEvent.WEBHOOK_CREATE:
        return renderSentence(gt("{actor} created the webhook {target}", { actor: m(0), target: m(1) }), [actor, strong(String(e.options?.webhook_name ?? name), "t")]);
      case AuditLogEvent.WEBHOOK_UPDATE:
        return renderSentence(gt("{actor} updated the webhook {target}", { actor: m(0), target: m(1) }), [actor, strong(String(e.options?.webhook_name ?? name), "t")]);
      case AuditLogEvent.WEBHOOK_DELETE:
        return renderSentence(gt("{actor} deleted the webhook {target}", { actor: m(0), target: m(1) }), [actor, strong(String(e.options?.webhook_name ?? name), "t")]);
      case AuditLogEvent.EMOJI_CREATE:
        return renderSentence(gt("{actor} created the emoji {target}", { actor: m(0), target: m(1) }), [actor, strong(`:${name}:`, "t")]);
      case AuditLogEvent.EMOJI_UPDATE:
        return renderSentence(gt("{actor} updated the emoji {target}", { actor: m(0), target: m(1) }), [actor, strong(`:${name}:`, "t")]);
      case AuditLogEvent.EMOJI_DELETE:
        return renderSentence(gt("{actor} deleted the emoji {target}", { actor: m(0), target: m(1) }), [actor, strong(`:${name}:`, "t")]);
      case AuditLogEvent.STICKER_CREATE:
        return renderSentence(gt("{actor} created the sticker {target}", { actor: m(0), target: m(1) }), [actor, strong(name, "t")]);
      case AuditLogEvent.STICKER_UPDATE:
        return renderSentence(gt("{actor} updated the sticker {target}", { actor: m(0), target: m(1) }), [actor, strong(name, "t")]);
      case AuditLogEvent.STICKER_DELETE:
        return renderSentence(gt("{actor} deleted the sticker {target}", { actor: m(0), target: m(1) }), [actor, strong(name, "t")]);
      case AuditLogEvent.SOUNDBOARD_SOUND_CREATE:
        return renderSentence(gt("{actor} added the soundboard sound {target}", { actor: m(0), target: m(1) }), [actor, strong(name, "t")]);
      case AuditLogEvent.SOUNDBOARD_SOUND_DELETE:
        return renderSentence(gt("{actor} deleted the soundboard sound {target}", { actor: m(0), target: m(1) }), [actor, strong(name, "t")]);
      case AuditLogEvent.MESSAGE_DELETE:
        return renderSentence(gt("{actor} deleted a message by {target} in {channel}", { actor: m(0), target: m(1), channel: m(2) }), [actor, user, strong(channelLabel(e), "c")]);
      case AuditLogEvent.MESSAGE_BULK_DELETE:
        return renderSentence(gt("{actor} deleted {count} messages in {channel}", { actor: m(0), count: m(1), channel: m(2) }), [actor, strong(String(e.options?.count ?? "?"), "n"), strong(channelLabel(e), "c")]);
      case AuditLogEvent.MESSAGE_PIN:
        return renderSentence(gt("{actor} pinned a message by {target} in {channel}", { actor: m(0), target: m(1), channel: m(2) }), [actor, user, strong(channelLabel(e), "c")]);
      case AuditLogEvent.MESSAGE_UNPIN:
        return renderSentence(gt("{actor} unpinned a message by {target} in {channel}", { actor: m(0), target: m(1), channel: m(2) }), [actor, user, strong(channelLabel(e), "c")]);
      case AuditLogEvent.THREAD_CREATE:
        return renderSentence(gt("{actor} created the thread {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      case AuditLogEvent.THREAD_UPDATE:
        return renderSentence(gt("{actor} updated the thread {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      case AuditLogEvent.THREAD_DELETE:
        return renderSentence(gt("{actor} deleted the thread {target}", { actor: m(0), target: m(1) }), [actor, strong(channelLabel(e), "t")]);
      default:
        return renderSentence(gt("{actor} made a change", { actor: m(0) }), [actor]);
    }
  };

  const keyLabel = (key: string): string => {
    switch (key) {
      case "name": return gt("Name");
      case "topic": return gt("Topic");
      case "nsfw": return gt("Age-Restricted");
      case "rate_limit_per_user": return gt("Slowmode");
      case "type": return gt("Type");
      case "parent_id": return gt("Category");
      case "bitrate": return gt("Bitrate");
      case "user_limit": return gt("User Limit");
      case "archived": return gt("Archived");
      case "locked": return gt("Locked");
      case "color": return gt("Colour");
      case "hoist": return gt("Display Separately");
      case "mentionable": return gt("Mentionable");
      case "permissions": return gt("Permissions");
      case "allow": return gt("Allowed Permissions");
      case "deny": return gt("Denied Permissions");
      case "icon_hash": return gt("Icon");
      case "unicode_emoji": return gt("Emoji");
      case "banner_hash": return gt("Banner");
      case "description": return gt("Description");
      case "system_channel_id": return gt("System Messages Channel");
      case "rules_channel_id": return gt("Rules Channel");
      case "afk_channel_id": return gt("Inactive Channel");
      case "afk_timeout": return gt("Inactive Timeout");
      case "verification_level": return gt("Verification Level");
      case "explicit_content_filter": return gt("Explicit Media Content Filter");
      case "join_mode": return gt("Join Mode");
      case "vanity_url_code": return gt("Vanity URL");
      case "nick": return gt("Nickname");
      case "communication_disabled_until": return gt("Timed Out Until");
      case "code": return gt("Code");
      case "channel_id": return gt("Channel");
      case "max_uses": return gt("Max Uses");
      case "max_age": return gt("Expires After");
      case "uses": return gt("Uses");
      case "temporary": return gt("Temporary Membership");
      case "tags": return gt("Related Emoji");
      case "permission_overwrites": return gt("Permission Overrides");
      case "$add": return gt("Added Roles");
      case "$remove": return gt("Removed Roles");
      default: return key;
    }
  };

  const formatValue = (key: string, value: unknown): ReactNode => {
    if (value === undefined || value === null || value === "") return <em className="text-[var(--text-muted)]">{gt("None")}</em>;
    if (typeof value === "boolean") return value ? gt("On") : gt("Off");
    if (key === "permissions" || key === "allow" || key === "deny") {
      const names = permissionNames(value);
      return names.length ? names.join(", ") : <em className="text-[var(--text-muted)]">{gt("None")}</em>;
    }
    if (key === "$add" || key === "$remove") {
      const list = Array.isArray(value) ? (value as Array<{ id: string; name?: string }>) : [];
      return list.map((r) => roleById.get(r.id)?.name || r.name || r.id).join(", ");
    }
    if ((key === "parent_id" || key.endsWith("channel_id")) && typeof value === "string") {
      const n = channelNames.get(value);
      return n ? (key === "parent_id" ? n : `#${n}`) : value;
    }
    if (key === "color" && typeof value === "string") {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: value }} />
          {value}
        </span>
      );
    }
    if ((key === "icon_hash" || key === "banner_hash") && typeof value === "string" && value.startsWith("http")) {
      return <img src={cdnImage(value)} alt="" className="inline-block w-5 h-5 rounded object-cover align-middle" />;
    }
    if (key === "communication_disabled_until" && typeof value === "string") return new Date(value).toLocaleString();
    if (key === "rate_limit_per_user" && typeof value === "number") return value === 0 ? gt("Off") : gt("{seconds}s", { seconds: value });
    if (key === "permission_overwrites" && Array.isArray(value)) return gt("{count} overrides", { count: value.length });
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const changeLine = (c: AuditChange, i: number) => {
    const label = <strong className="font-semibold text-[var(--text-primary)]">{keyLabel(c.key)}</strong>;
    if (c.key === "$add" || c.key === "$remove") {
      return (
        <li key={i}>
          {label}: {formatValue(c.key, c.new)}
        </li>
      );
    }
    const hasOld = c.old !== undefined;
    const hasNew = c.new !== undefined;
    return (
      <li key={i} className="break-words">
        {hasOld && hasNew ? (
          <>
            {gt("Changed")} {label} {gt("from")} <span className="text-[var(--text-secondary)]">{formatValue(c.key, c.old)}</span> {gt("to")}{" "}
            <span className="text-[var(--text-primary)]">{formatValue(c.key, c.new)}</span>
          </>
        ) : hasNew ? (
          <>
            {gt("Set")} {label} {gt("to")} <span className="text-[var(--text-primary)]">{formatValue(c.key, c.new)}</span>
          </>
        ) : hasOld ? (
          <>
            {gt("Removed")} {label} <span className="text-[var(--text-secondary)]">({formatValue(c.key, c.old)})</span>
          </>
        ) : (
          <>
            {gt("Cleared")} {label}
          </>
        )}
      </li>
    );
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const timeLabel = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? gt("Today at {time}", { time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) })
      : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">{gt("Audit Log")}</h2>
        <p className="text-sm text-[var(--text-secondary)]">{gt("View a record of all changes made to your server")}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="flex-1 min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{gt("Filter by user")}</span>
          <select
            value={filterUser}
            onChange={(e) => {
              setLoading(true);
              setFilterUser(e.target.value);
            }}
            className="w-full h-10 px-3 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
          >
            <option value="">{gt("All users")}</option>
            {memberOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{gt("Filter by action")}</span>
          <select
            value={filterAction}
            onChange={(e) => {
              setLoading(true);
              setFilterAction(e.target.value);
            }}
            className="w-full h-10 px-3 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
          >
            <option value="">{gt("All actions")}</option>
            {actionOptions.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={32} />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{gt("No audit log entries")}</h3>
          <p className="text-[var(--text-secondary)] text-sm">
            {filterUser || filterAction ? gt("Nothing matches these filters.") : gt("Actions taken in your server will appear here")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const actor = e.userId ? users[e.userId] : undefined;
            const verb = auditVerb(e.actionType);
            const canExpand = e.changes.length > 0 || Boolean(e.reason);
            const isOpen = expanded.has(e.id);
            const VerbIcon = verb === "create" ? Plus : verb === "delete" ? Trash2 : Pencil;
            return (
              <div key={e.id} className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => canExpand && toggle(e.id)}
                  aria-expanded={canExpand ? isOpen : undefined}
                  className={cn("w-full flex items-center gap-3 p-3 text-left", canExpand && "hover:bg-[var(--bg-hover)]")}
                >
                  <span
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                      verb === "create" ? "bg-green-500/15 text-green-500" : verb === "delete" ? "bg-red-500/15 text-red-400" : "bg-[var(--app-accent)]/15 text-[var(--app-accent)]",
                    )}
                  >
                    <VerbIcon className="w-3.5 h-3.5" />
                  </span>
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarImage src={cdnImage(actor?.avatar || undefined)} />
                    <AvatarFallback className="bg-[var(--app-accent)] text-white text-xs">
                      {userName(e.userId).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[var(--text-secondary)] break-words">{sentence(e)}</span>
                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">{timeLabel(e.createdAt)}</span>
                  </span>
                  {canExpand && (isOpen ? <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />)}
                </button>
                {canExpand && isOpen && (
                  <div className="px-4 pb-3 pt-1 border-t border-[var(--border-subtle)]">
                    {e.changes.length > 0 && (
                      <ul className="list-disc pl-5 space-y-1 text-sm text-[var(--text-secondary)]">{e.changes.map(changeLine)}</ul>
                    )}
                    {e.reason && (
                      <p className="mt-2 text-sm text-[var(--text-secondary)]">
                        <strong className="font-semibold text-[var(--text-primary)]">{gt("Reason")}:</strong> {e.reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--app-surface-alt)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {loadingMore ? <Loader size={14} /> : gt("Load more")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
