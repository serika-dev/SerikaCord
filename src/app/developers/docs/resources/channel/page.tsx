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
      <Endpoint method="GET" path="/channels/{channel.id}">{gt("Get a channel.")}</Endpoint>
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
      <Endpoint method="PUT" path="/channels/{channel.id}/pins/{message.id}">{gt("Pin a message.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/pins/{message.id}">{gt("Unpin a message.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/pins">{gt("List pinned messages.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/typing">{gt("Trigger typing indicator.")}</Endpoint>

      <H2 id="permission-overwrites">{gt("Permission Overwrites")}</H2>
      <CodeBlock lang="json">{`{
  "id": "role_or_member_id",
  "type": 0,
  "allow": "1024",
  "deny": "0"
}`}</CodeBlock>

      <Callout type="info" title={gt("Slow Mode")}>
        <InlineCode>rate_limit_per_user</InlineCode> {gt("sets slow mode (0-21600 seconds). Users must wait this long between messages.")}
      </Callout>
    </DocPage>
  );
}
