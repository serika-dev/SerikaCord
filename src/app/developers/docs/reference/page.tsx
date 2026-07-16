import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "API Reference",
  description:
    "Complete reference for the SerikaCord REST API v10. Every endpoint, authentication, error codes, data structures, and Gateway connection details.",
  path: "/developers/docs/reference",
  keywords: ["SerikaCord API reference", "REST API", "endpoints", "v10", "Discord compatible"],
});

export default async function ReferenceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("API Reference")} description={gt("Complete reference for the SerikaCord REST API, Gateway, and data structures. Every endpoint implemented in the bot API.")}>
      <P>
        {gt("The SerikaCord API is a Discord v10-compatible REST + Gateway API. All routes, parameters, and response structures mirror Discord's API. This page is the master reference. For detailed field-level docs on individual resources, see the")}{" "}<Link2 href="/developers/docs/resources/application">{gt("Resources")}</Link2> {gt("section.")}
      </P>

      <H2 id="base-url">{gt("Base URL")}</H2>
      <CodeBlock lang="bash">https://api.serika.chat/api/v10</CodeBlock>

      <H2 id="authentication">{gt("Authentication")}</H2>
      <P>{gt("Every request must include an")} <InlineCode>Authorization</InlineCode> {gt("header:")}</P>
      <Table headers={[gt("Type"), gt("Header"), gt("Use Case")]} rows={[
        [gt("Bot Token"), "Authorization: Bot <token>", gt("Bot API requests (all endpoints below)")],
        [gt("Bearer Token"), "Authorization: Bearer <token>", gt("OAuth2 user-context requests")],
      ]} />
      <P>
        {gt("The bot token is validated by looking up the")} <InlineCode>Application</InlineCode> {gt("with a matching")}{" "}
        <InlineCode>botToken</InlineCode> {gt("field, then resolving the associated bot")} <InlineCode>User</InlineCode>.
        {gt("If either is missing, the API returns")} <InlineCode>401: Unauthorized</InlineCode>.
      </P>

      <H2 id="api-versioning">{gt("API Versioning")}</H2>
      <P>
        {gt("The API version is part of the URL path. The current and only supported version is")}{" "}
        <InlineCode>v10</InlineCode>.
      </P>
      <Table headers={[gt("Version"), gt("Status")]} rows={[
        ["v10", gt("Stable (active)")],
        ["v9", gt("Not supported")],
        ["v8", gt("Not supported")],
      ]} />

      <H2 id="request-format">{gt("Request Format")}</H2>
      <P>
        {gt("All request bodies use")}{" "}<InlineCode>application/json</InlineCode> {gt("unless otherwise noted. File uploads (emoji creation, sticker creation, message attachments) use")}{" "}
        <InlineCode>multipart/form-data</InlineCode>.
      </P>

      <H2 id="response-format">{gt("Response Format")}</H2>
      <P>
        {gt("All responses are JSON. Successful responses return the requested data object or an array. Delete operations return")}{" "}<InlineCode>204 No Content</InlineCode>. {gt("Errors return a JSON body:")}
      </P>
      <CodeBlock lang="json">{`{
  "code": 50001,
  "message": "Missing Access"
}`}</CodeBlock>
      <P>{gt("See")}{" "}<Link2 href="/developers/docs/topics/opcodes-and-status-codes">{gt("Opcodes & Status Codes")}</Link2> {gt("for the full list.")}</P>

      <H2 id="gateway-endpoint">{gt("Gateway Endpoint")}</H2>
      <Endpoint method="GET" path="/gateway">{gt("Returns the Gateway WebSocket URL.")}</Endpoint>
      <CodeBlock lang="json">{`{ "url": "wss://api.serika.chat/api/v10/gateway" }`}</CodeBlock>
      <P>{gt("Connect via WebSocket to receive real-time events. See")}{" "}<Link2 href="/developers/docs/topics/gateway">{gt("Gateway")}</Link2>.</P>

      <H2 id="user-endpoints">{gt("User Endpoints")}</H2>
      <Endpoint method="GET" path="/users/@me">{gt("Get the authenticated bot user.")}</Endpoint>
      <Endpoint method="GET" path="/users/{user.id}">{gt("Get any user by ID.")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/channels">{gt("List DM channels the bot is a recipient of.")}</Endpoint>
      <Endpoint method="POST" path="/users/@me/channels">{gt("Create or fetch a DM channel with a recipient.")}</Endpoint>
      <Endpoint method="DELETE" path="/users/@me/guilds/{guild.id}">{gt("Leave a guild (bot leaves the server).")}</Endpoint>

      <H2 id="guild-endpoints">{gt("Guild Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}">{gt("Get a guild by ID.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/channels">{gt("List all channels in a guild.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/channels">{gt("Create a channel in a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/channels/{channel.id}">{gt("Update a guild channel.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/channels/{channel.id}">{gt("Delete a guild channel.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/roles">{gt("List roles in a guild.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/roles">{gt("Create a role.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/roles/{role.id}">{gt("Update a role.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/roles/{role.id}">{gt("Delete a role.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members/{user.id}">{gt("Get a guild member.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/members/{user.id}">{gt("Update a member (nick, roles, mute, deaf, timeout).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/members/@me/nick">{gt("Update the bot's own nickname.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/members/{user.id}">{gt("Kick a member.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/bans/{user.id}">{gt("Ban a user (with optional reason).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/bans/{user.id}">{gt("Get a ban.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/bans/{user.id}">{gt("Unban a user.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Get a guild emoji.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/emojis">{gt("Create a guild emoji.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Update a guild emoji.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Delete a guild emoji.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/stickers">{gt("List guild stickers.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/stickers/{sticker.id}">{gt("Get a guild sticker.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List webhooks in a guild.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/audit-logs">{gt("Get audit log entries (supports limit, user_id, action_type filters).")}</Endpoint>

      <H2 id="channel-endpoints">{gt("Channel Endpoints")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}">{gt("Get a channel by ID.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages">{gt("List messages (supports limit, before, after, around).")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}">{gt("Get a single message.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages">{gt("Create a message (content, embeds, reply_to_message_id, allowed_mentions).")}</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}/messages/{message.id}">{gt("Edit a message (only if authored by the bot).")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}">{gt("Delete a message.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages/bulk-delete">{gt("Bulk delete 2-100 messages (max 14 days old).")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/pins/{message.id}">{gt("Pin a message.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/pins/{message.id}">{gt("Unpin a message.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/pins">{gt("List pinned messages.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/typing">{gt("Trigger typing indicator.")}</Endpoint>
      <Endpoint method="PUT" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">{gt("Add a reaction.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">{gt("Remove own reaction.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}">{gt("Remove another user's reaction.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">{gt("Get users who reacted.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">{gt("Remove all reactions for an emoji.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions">{gt("Remove all reactions.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/webhooks">{gt("Create a webhook.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">{gt("List webhooks in a channel.")}</Endpoint>

      <H2 id="webhook-endpoints">{gt("Webhook Endpoints")}</H2>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">{gt("Get a webhook.")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}">{gt("Delete a webhook.")}</Endpoint>

      <H2 id="application-command-endpoints">{gt("Application Command Endpoints")}</H2>
      <Endpoint method="GET" path="/applications/{app.id}/commands">{gt("List global commands.")}</Endpoint>
      <Endpoint method="PUT" path="/applications/{app.id}/commands">{gt("Bulk overwrite global commands.")}</Endpoint>
      <Endpoint method="POST" path="/applications/{app.id}/commands">{gt("Create a single global command.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{app.id}/commands/{command.id}">{gt("Get a global command.")}</Endpoint>
      <Endpoint method="PATCH" path="/applications/{app.id}/commands/{command.id}">{gt("Update a global command.")}</Endpoint>
      <Endpoint method="DELETE" path="/applications/{app.id}/commands/{command.id}">{gt("Delete a global command.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{app.id}/guilds/{guild.id}/commands">{gt("List guild commands.")}</Endpoint>
      <Endpoint method="PUT" path="/applications/{app.id}/guilds/{guild.id}/commands">{gt("Bulk overwrite guild commands.")}</Endpoint>

      <H2 id="interaction-endpoints">{gt("Interaction Endpoints")}</H2>
      <Endpoint method="POST" path="/interactions/{interaction.id}/{interaction.token}/callback">{gt("Respond to an interaction.")}</Endpoint>

      <H2 id="voice-endpoints">{gt("Voice Endpoints")}</H2>
      <Endpoint method="GET" path="/voice/regions">{gt("List available voice regions.")}</Endpoint>

      <H2 id="snowflakes">{gt("Snowflake IDs")}</H2>
      <P>
        {gt("All SerikaCord IDs are")}{" "}<Strong>{gt("Snowflakes")}</Strong> — {gt("64-bit integers encoded as strings. They encode a timestamp, worker ID, process ID, and increment.")}
      </P>
      <CodeBlock lang="text">{`Bit layout (64 bits):
[63: 42] Timestamp (ms since epoch)
[41: 17] Worker ID (5 bits) + Process ID (5 bits) + Internal (10 bits)
[16:  0] Increment (12 bits)`}</CodeBlock>

      <H2 id="iso8601">{gt("ISO 8601 Timestamps")}</H2>
      <P>
        {gt("All timestamps in the API are ISO 8601 strings (e.g.,")}{" "}
        <InlineCode>2026-07-05T14:30:00.000Z</InlineCode>).
      </P>

      <H2 id="discord-compat">{gt("Discord Compatibility")}</H2>
      <Callout type="info" title={gt("Discord API Compatibility")}>
        {gt("SerikaCord implements the Discord v10 bot API. The official")}{" "}<InlineCode>serika.js</InlineCode> {gt("SDK handles everything natively, or existing")}{" "}<InlineCode>discord.js</InlineCode> /{" "}
        <InlineCode>discord.py</InlineCode> {gt("bots run with a one-line base-URL change. Response shapes for users, channels, messages, guilds, roles, members, and invites are formatted to match Discord's JSON structure exactly.")}
      </Callout>
      <P>
        {gt("The following Discord features are")}{" "}<Strong>{gt("implemented")}</Strong> {gt("in the SerikaCord bot API:")}
      </P>
      <UL>
        <li>{gt("Bot authentication via token")}</li>
        <li>{gt("User lookup")} (<InlineCode>/users/@me</InlineCode>, <InlineCode>/users/:id</InlineCode>)</li>
        <li>{gt("Guild retrieval and management")}</li>
        <li>{gt("Channel CRUD (create, read, update, delete)")}</li>
        <li>{gt("Message send, edit, delete, bulk-delete, pin/unpin")}</li>
        <li>{gt("Reactions (add, remove, list, clear)")}</li>
        <li>{gt("Typing indicator")}</li>
        <li>{gt("Guild roles CRUD")}</li>
        <li>{gt("Guild member management (nick, roles, mute, deaf, timeout, kick)")}</li>
        <li>{gt("Guild bans (add, remove, get)")}</li>
        <li>{gt("Guild emojis CRUD")}</li>
        <li>{gt("Guild stickers (read)")}</li>
        <li>{gt("Guild webhooks (list, create)")}</li>
        <li>{gt("Channel webhooks (list, create, get, delete)")}</li>
        <li>{gt("Audit log retrieval")}</li>
        <li>{gt("DM channels (list, create)")}</li>
        <li>{gt("Leave guild")}</li>
        <li>{gt("Application commands (global + guild, CRUD + bulk overwrite)")}</li>
        <li>{gt("Interaction callback")}</li>
        <li>{gt("Voice regions")}</li>
        <li>{gt("Gateway WebSocket (HELLO, IDENTIFY, HEARTBEAT, RESUME, DISPATCH)")}</li>
        <li>{gt("Gateway dispatch routing (MESSAGE_CREATE, GUILD_MEMBER_ADD, GUILD_CREATE, etc.)")}</li>
        <li>{gt("Intent-based filtering")}</li>
        <li>{gt("Redis-based cross-instance event fan-out")}</li>
      </UL>
    </DocPage>
  );
}
