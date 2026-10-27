import { redirect } from "next/navigation";
import { resolveMessageLink } from "@/lib/chat/messageLink";

/**
 * Discord-style message link: /channels/{guild}/{channel}/{message}. Bots
 * build these from the ids they see, which are snowflakes for Discord-style
 * apps, so the ids are resolved to SerikaCord's and the link opens the
 * channel jumped to the message (the app's own links use ?jump=).
 */
export default async function MessageLinkPage({
  params,
}: {
  params: Promise<{ serverId: string; channelId: string; messageId: string }>;
}) {
  const { serverId, channelId, messageId } = await params;
  redirect(await resolveMessageLink(serverId, channelId, messageId));
}
