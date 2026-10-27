import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Channel",
  description: "SerikaCord Channel resource: types, object structure, endpoints for messages, pins, typing, permission overwrites, and slow mode.",
  path: "/developers/docs/resources/channel",
  keywords: ["SerikaCord channel", "channel types", "text channel", "voice channel", "permission overwrites"],
});

export default async function ChannelDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Channel")} description={gt("Create, manage, and interact with channels — text, voice, categories, and more.")}>
      <H2 id="channel-types">{gt("Channel Types")}</H2>
      <Table headers={[gt("Type"), gt("Value")]} rows={[
        [gt("Guild Text"), "0"],
        [gt("DM"), "1"],
        [gt("Guild Voice"), "2"],
        [gt("Group DM"), "3"],
        [gt("Guild Category"), "4"],
        [gt("Guild Announcement"), "5"],
        [gt("Announcement Thread"), "10"],
        [gt("Public Thread"), "11"],
        [gt("Private Thread"), "12"],
        [gt("Guild Stage Voice"), "13"],
        [gt("Guild Directory"), "14"],
        [gt("Guild Forum"), "15"],
        [gt("Guild Media"), "16"],
      ]} />

      <H2 id="channel-object">{gt("Channel Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "type": 0,
  "guild_id": "1234567890",
  "name": "general",
  "topic": "General chat",
  "position": 0,
  "nsfw": false,
  "rate_limit_per_user": 0,
  "parent_id": null,
  "permission_overwrites": []
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}">{gt("Get a channel. DM and group DM channels include recipients as user objects.")}</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}">{gt("Update a channel.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}">{gt("Delete a channel.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/channels">{gt("Create a channel in a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/channels">{gt("Reorder channels.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages">{gt("List messages.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages">{gt("Create a message.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}">{gt("Get a message.")}</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}/messages/{message.id}">{gt("Edit a message.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}">{gt("Delete a message.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages/bulk-delete">{gt("Bulk delete messages (2-100, max 14 days old).")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/pins">{gt("List pinned messages, newest pin first (limit 1-50, before as an ISO8601 time). Returns items with pinned_at and message, plus has_more.")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/messages/pins/{message.id}">{gt("Pin a message (up to 250 per channel). Posts a pinned-message system message, see below.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/pins/{message.id}">{gt("Unpin a message.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/pins">{gt("Legacy: list up to 50 pinned messages as a plain array.")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/pins/{message.id}">{gt("Legacy pin route; behaves like the one above.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/pins/{message.id}">{gt("Legacy unpin route.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/typing">{gt("Trigger typing indicator.")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/permissions/{overwrite.id}">{gt("Create or edit a permission overwrite (needs Manage Roles).")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/permissions/{overwrite.id}">{gt("Delete a permission overwrite.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/invites">{gt("List the channel's invites (needs Manage Channels).")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/invites">{gt("Create an invite (needs Create Invite).")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/followers">{gt("Follow an announcement channel into another channel (needs Manage Webhooks there).")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/recipients/{user.id}">{gt("Add someone to a group DM the bot is in, using their OAuth2 access token (see below).")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/recipients/{user.id}">{gt("Remove someone from a group DM the bot owns.")}</Endpoint>

      <H2 id="pinned-message-notice">{gt("Pinned Message Notice")}</H2>
      <P>
        {gt("Pinning a message posts a CHANNEL_PINNED_MESSAGE system message (type 6), shown as \"X pinned a message to this channel.\", like Discord. Its message_reference points at the pinned message, and bots receive it as MESSAGE_CREATE. It marks the channel unread but never sends a notification. Unpinning posts nothing.")}
      </P>

      <H2 id="dm-channels">{gt("DM and Group DM Channels")}</H2>
      <P>
        {gt("DM (type 1) and group DM (type 3) channel objects carry recipients as full user objects, with the bot itself left out, like Discord. This applies to")}{" "}
        <InlineCode>{"GET /channels/{channel.id}"}</InlineCode>, <InlineCode>{"GET /users/@me/channels"}</InlineCode> {gt("and")}{" "}
        <InlineCode>{"POST /users/@me/channels"}</InlineCode>.
      </P>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "type": 1,
  "recipients": [
    { "id": "111", "username": "someone", "discriminator": "0", "global_name": "Someone", "avatar": null, "bot": false }
  ]
}`}</CodeBlock>

      <H3 id="group-dm-add-recipient">{gt("Group DM Add Recipient")}</H3>
      <Endpoint method="PUT" path="/channels/{channel.id}/recipients/{user.id}">
        {gt("Adds the user to a group DM the bot is a member of. Returns 204.")}
      </Endpoint>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["access_token", "string", gt("Required. The user's OAuth2 access token for the bot's own application, granted with the gdm.join scope")],
        ["nick", "string", gt("Ignored: SerikaCord group DMs have no per-member nicknames")],
      ]} />
      <Table headers={[gt("Error"), gt("When")]} rows={[
        ["400 50035", gt("access_token is missing, or the group can't take the user (for example it is full, or end-to-end encrypted)")],
        ["403 50025", gt("The token is invalid or expired, belongs to another application, or belongs to a different user than the one in the path")],
        ["403 50026", gt("The token was granted without the gdm.join scope")],
        ["404 10003", gt("Not a group DM, or the bot is not in it")],
        ["404 10013", gt("Unknown user")],
      ]} />
      <P>
        {gt("Get the token with the authorization code flow described in")}{" "}<Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2")}</Link2>.{" "}
        {gt("Adding someone who is already in the group is a no-op.")}
      </P>

      <H2 id="permission-overwrites">{gt("Permission Overwrites")}</H2>
      <CodeBlock lang="json">{`{
  "id": "role_or_member_id",
  "type": 0,
  "allow": "1024",
  "deny": "0"
}`}</CodeBlock>

      <P>{gt("A bot can only allow or deny permissions it has in the channel itself. The guild id as an overwrite id means the @everyone role. When an edit gives a bot access to a channel or takes it away, that bot receives CHANNEL_CREATE or CHANNEL_DELETE instead of CHANNEL_UPDATE.")}</P>

      <Callout type="info" title={gt("Slow Mode")}>
        <InlineCode>rate_limit_per_user</InlineCode> {gt("sets slow mode (0-21600 seconds). Users must wait this long between messages.")}
      </Callout>
    </DocPage>
  );
}
