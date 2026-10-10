/**
 * Pure helpers behind the channel / category Permissions tab (Discord's
 * "Private Channel" toggle, tri-state overwrite editor and "Synced with
 * category" indicator) and the server-side category sync. No DB, no React.
 */
import { PERMISSION_BITS, type PermissionName } from "./bits";

export interface EditableOverwrite {
  id: string;
  type: "role" | "member";
  allow: string;
  deny: string;
}

export type OverwriteState = "allow" | "deny" | "neutral";

function toBits(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

const idKey = (id: string) => String(id).toLowerCase();

/** Drops malformed entries and coerces allow/deny to decimal strings. */
export function normalizeOverwrites(raw: unknown): EditableOverwrite[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EditableOverwrite[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    if (o.type !== "role" && o.type !== "member") continue;
    const key = `${o.type}:${idKey(o.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: o.id,
      type: o.type,
      allow: toBits(typeof o.allow === "string" ? o.allow : String(o.allow ?? "0")).toString(),
      deny: toBits(typeof o.deny === "string" ? o.deny : String(o.deny ?? "0")).toString(),
    });
  }
  return out;
}

function signature(list: readonly EditableOverwrite[] | null | undefined): string {
  return (list || [])
    .filter((o) => toBits(o.allow) !== 0n || toBits(o.deny) !== 0n)
    .map((o) => `${o.type}:${idKey(o.id)}:${toBits(o.allow)}:${toBits(o.deny)}`)
    .sort()
    .join("|");
}

/**
 * Discord's "Permissions synced with category": the channel's overwrites are
 * exactly the category's (order and empty overwrites ignored).
 */
export function overwritesInSync(
  channel: readonly EditableOverwrite[] | null | undefined,
  category: readonly EditableOverwrite[] | null | undefined,
): boolean {
  return signature(channel) === signature(category);
}

export function getOverwriteState(overwrite: Pick<EditableOverwrite, "allow" | "deny"> | null | undefined, flag: bigint): OverwriteState {
  if (!overwrite) return "neutral";
  if ((toBits(overwrite.allow) & flag) === flag) return "allow";
  if ((toBits(overwrite.deny) & flag) === flag) return "deny";
  return "neutral";
}

/** Sets one permission of one overwrite (adding the overwrite if needed). Returns a new list. */
export function setOverwriteState(
  list: readonly EditableOverwrite[],
  target: { id: string; type: "role" | "member" },
  flag: bigint,
  state: OverwriteState,
): EditableOverwrite[] {
  let found = false;
  const next = list.map((o) => {
    if (o.type !== target.type || idKey(o.id) !== idKey(target.id)) return o;
    found = true;
    let allow = toBits(o.allow) & ~flag;
    let deny = toBits(o.deny) & ~flag;
    if (state === "allow") allow |= flag;
    if (state === "deny") deny |= flag;
    return { ...o, allow: allow.toString(), deny: deny.toString() };
  });
  if (!found && state !== "neutral") {
    next.push({
      id: target.id,
      type: target.type,
      allow: (state === "allow" ? flag : 0n).toString(),
      deny: (state === "deny" ? flag : 0n).toString(),
    });
  }
  return next;
}

/** Adds an empty overwrite for a role or member (no-op if present). */
export function addOverwrite(list: readonly EditableOverwrite[], target: { id: string; type: "role" | "member" }): EditableOverwrite[] {
  if (list.some((o) => o.type === target.type && idKey(o.id) === idKey(target.id))) return [...list];
  return [...list, { id: target.id, type: target.type, allow: "0", deny: "0" }];
}

export function removeOverwrite(list: readonly EditableOverwrite[], target: { id: string; type: "role" | "member" }): EditableOverwrite[] {
  return list.filter((o) => !(o.type === target.type && idKey(o.id) === idKey(target.id)));
}

/** Clears every permission of one overwrite (keeps the entry). */
export function clearOverwrite(list: readonly EditableOverwrite[], target: { id: string; type: "role" | "member" }): EditableOverwrite[] {
  return list.map((o) => (o.type === target.type && idKey(o.id) === idKey(target.id) ? { ...o, allow: "0", deny: "0" } : o));
}

const VIEW = PERMISSION_BITS.VIEW_CHANNEL;
const CONNECT = PERMISSION_BITS.CONNECT;

/** "Private Channel": @everyone is denied View Channel. */
export function isPrivateChannel(list: readonly EditableOverwrite[], everyoneRoleId: string | null | undefined, serverId?: string | null): boolean {
  return list.some(
    (o) => o.type === "role"
      && ((everyoneRoleId && idKey(o.id) === idKey(everyoneRoleId)) || (serverId && idKey(o.id) === idKey(serverId)))
      && (toBits(o.deny) & VIEW) === VIEW,
  );
}

/**
 * Turns "Private Channel" on or off. On: deny @everyone View Channel (and
 * Connect for voice) and allow it for `grantTo` (roles/members picked in the
 * "who can access" step). Off: remove that @everyone deny again.
 */
export function setPrivateChannel(
  list: readonly EditableOverwrite[],
  everyoneRoleId: string,
  makePrivate: boolean,
  opts: { voice?: boolean; grantTo?: Array<{ id: string; type: "role" | "member" }> } = {},
): EditableOverwrite[] {
  const flags = opts.voice ? VIEW | CONNECT : VIEW;
  let next = [...list];
  const everyone = { id: everyoneRoleId, type: "role" as const };
  if (makePrivate) {
    next = setOverwriteState(next, everyone, VIEW, "deny");
    if (opts.voice) next = setOverwriteState(next, everyone, CONNECT, "deny");
    for (const target of opts.grantTo || []) {
      next = setOverwriteState(next, target, VIEW, "allow");
      if (opts.voice) next = setOverwriteState(next, target, CONNECT, "allow");
    }
  } else {
    next = next.map((o) =>
      o.type === "role" && idKey(o.id) === idKey(everyoneRoleId)
        ? { ...o, deny: (toBits(o.deny) & ~flags).toString() }
        : o,
    );
  }
  return next;
}

/** Roles/members that can see a private channel (an explicit View Channel allow). */
export function accessHolders(list: readonly EditableOverwrite[], everyoneRoleId?: string | null): EditableOverwrite[] {
  return list.filter(
    (o) => (toBits(o.allow) & VIEW) === VIEW && !(everyoneRoleId && o.type === "role" && idKey(o.id) === idKey(everyoneRoleId)),
  );
}

/**
 * Category edits propagate to the channels that were synced with it before
 * the edit (Discord behaviour). Returns the ids of those children.
 */
export function childrenToResync(
  previousCategoryOverwrites: readonly EditableOverwrite[] | null | undefined,
  children: ReadonlyArray<{ id: string; permissionOverwrites?: unknown }>,
): string[] {
  return children
    .filter((c) => overwritesInSync(normalizeOverwrites(c.permissionOverwrites), previousCategoryOverwrites))
    .map((c) => c.id);
}

export type OverwriteChannelKind = "text" | "voice" | "category" | "forum" | "announcement";

export interface PermissionGroup {
  id: "general" | "membership" | "text" | "voice" | "stage" | "events" | "apps";
  keys: PermissionName[];
}

const GENERAL: PermissionName[] = ["VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_WEBHOOKS"];
const MEMBERSHIP: PermissionName[] = ["CREATE_INVITE"];
const TEXT: PermissionName[] = [
  "SEND_MESSAGES",
  "SEND_MESSAGES_IN_THREADS",
  "CREATE_PUBLIC_THREADS",
  "CREATE_PRIVATE_THREADS",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "USE_EXTERNAL_EMOJIS",
  "USE_EXTERNAL_STICKERS",
  "MENTION_EVERYONE",
  "MANAGE_MESSAGES",
  "PIN_MESSAGES",
  "MANAGE_THREADS",
  "READ_MESSAGE_HISTORY",
  "SEND_TTS_MESSAGES",
  "SEND_VOICE_MESSAGES",
  "SEND_POLLS",
];
const VOICE: PermissionName[] = [
  "CONNECT",
  "SPEAK",
  "VIDEO",
  "USE_SOUNDBOARD",
  "USE_EXTERNAL_SOUNDS",
  "USE_VOICE_ACTIVITY",
  "PRIORITY_SPEAKER",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "SET_VOICE_CHANNEL_STATUS",
];
const APPS: PermissionName[] = ["USE_APPLICATION_COMMANDS", "USE_EMBEDDED_ACTIVITIES", "USE_EXTERNAL_APPS"];
const EVENTS: PermissionName[] = ["CREATE_EVENTS", "MANAGE_EVENTS"];

/** The permission sections Discord shows in a channel's overwrite editor, per channel kind. */
export function permissionGroupsFor(kind: OverwriteChannelKind | string): PermissionGroup[] {
  switch (kind) {
    case "voice":
      return [
        { id: "general", keys: GENERAL },
        { id: "membership", keys: MEMBERSHIP },
        { id: "voice", keys: VOICE },
        { id: "text", keys: TEXT.filter((k) => k !== "CREATE_PUBLIC_THREADS" && k !== "CREATE_PRIVATE_THREADS" && k !== "SEND_MESSAGES_IN_THREADS" && k !== "MANAGE_THREADS") },
        { id: "apps", keys: APPS },
        { id: "events", keys: EVENTS },
      ];
    case "category":
      return [
        { id: "general", keys: GENERAL },
        { id: "membership", keys: MEMBERSHIP },
        { id: "text", keys: TEXT },
        { id: "voice", keys: VOICE },
        { id: "apps", keys: APPS },
        { id: "events", keys: EVENTS },
      ];
    default:
      return [
        { id: "general", keys: GENERAL },
        { id: "membership", keys: MEMBERSHIP },
        { id: "text", keys: TEXT },
        { id: "apps", keys: APPS },
        { id: "events", keys: EVENTS },
      ];
  }
}

/** Every permission bit an overwrite may carry (the union of all groups). */
export const OVERWRITABLE_BITS: bigint = permissionGroupsFor("category")
  .flatMap((g) => g.keys)
  .reduce((acc, key) => acc | PERMISSION_BITS[key], 0n);
