/**
 * Discord-style message links (/channels/{guild}/{channel}/{message}) for
 * the web app, which links messages as /channels/{server}/{channel}?jump={id}.
 * Bots see snowflakes (Discord-style apps), so ids may be either form.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE_RE = /^\d{15,21}$/;

/**
 * Where a message link goes once its ids are resolved (`resolve` maps a
 * snowflake to its UUID, or undefined when unknown). Unknown or malformed
 * ids fall back to the closest page that still makes sense. Pure.
 */
export function messageLinkTarget(
  serverId: string,
  channelId: string,
  messageId: string,
  resolve: (snowflake: string) => string | undefined,
): string {
  const id = (raw: string): string | null => {
    if (UUID_RE.test(raw)) return raw.toLowerCase();
    if (SNOWFLAKE_RE.test(raw)) return resolve(raw) ?? null;
    return null;
  };
  // DMs are opened by recipient in the web app, not by channel id.
  if (serverId === "@me" || serverId === "me") return "/channels/me";
  const server = id(serverId);
  if (!server) return "/channels/me";
  const channel = id(channelId);
  if (!channel) return `/channels/${server}`;
  const message = id(messageId);
  return message ? `/channels/${server}/${channel}?jump=${message}` : `/channels/${server}/${channel}`;
}

export async function resolveMessageLink(serverId: string, channelId: string, messageId: string): Promise<string> {
  const snowflakes = [serverId, channelId, messageId].filter((v) => SNOWFLAKE_RE.test(v));
  let map = new Map<string, { uuid: string }>();
  if (snowflakes.length > 0) {
    const { uuidsForSnowflakes } = await import("@/lib/botapi/snowflakeStore");
    map = (await uuidsForSnowflakes(snowflakes).catch(() => ({ map }))).map;
  }
  return messageLinkTarget(serverId, channelId, messageId, (sf) => map.get(sf)?.uuid);
}
