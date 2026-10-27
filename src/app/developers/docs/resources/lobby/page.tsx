import { DocPage, P, H2, H3, UL, CodeBlock, Callout, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Lobby",
  description: "SerikaCord Lobby resource (Discord Social SDK lobbies): lobby, member and message objects, endpoints, limits, channel linking and how SerikaCord differs from Discord.",
  path: "/developers/docs/resources/lobby",
  keywords: ["SerikaCord lobby", "Social SDK lobby", "lobby messages", "linked channel", "sdk.social_layer"],
});

export default async function LobbyDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Lobby")} description={gt("Group players of your game into lobbies with shared metadata and text chat, and link a lobby to a server channel.")}>
      <P>
        {gt("Lobbies are Discord's Social SDK lobby resource, served on the Discord-compatible API under")} <InlineCode>/api/v10</InlineCode>. {gt("A lobby belongs to one application: your bot token only ever sees your own app's lobbies, and any other lobby id answers 404 Unknown lobby (10031).")}
      </P>

      <Callout type="warning" title={gt("How SerikaCord lobbies differ from Discord")}>
        <UL>
          <li>{gt("There is no Social SDK client and no Social SDK gateway: LOBBY_* gateway events are never sent. Poll GET /lobbies/... and its messages instead.")}</li>
          <li>{gt("Members must be real Serika users who authorized your application. Users who did not, bots and banned users are dropped silently from member lists; ids that are not users at all fail the request with 404 Unknown User.")}</li>
          <li>{gt("The idle timeout counts writes, not connections: a lobby with no write for idle_timeout_seconds is deleted, with its members and messages, the next time it is accessed.")}</li>
          <li>{gt("Lobby messages are text only and kept for 72 hours. They are encrypted at rest.")}</li>
          <li>{gt("Messages are copied into a linked channel by your app's bot, only when the bot can send messages there. Messages sent in the linked channel are not copied back into the lobby.")}</li>
        </UL>
      </Callout>

      <H2 id="lobby-object">{gt("Lobby Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1300000000000000001",
  "application_id": "1234567890",
  "metadata": { "mode": "ranked", "map": "harbor" },
  "members": [
    { "id": "1300000000000000002", "metadata": { "team": "blue" }, "flags": 1 },
    { "id": "1300000000000000003", "metadata": null, "flags": 0, "additional_name": "Seika (guest)" }
  ],
  "linked_channel": { "id": "1300000000000000004", "type": 0, "guild_id": "1300000000000000005", "name": "ranked-lobby" },
  "flags": 0
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Description")]} rows={[
        ["id", gt("The lobby id")],
        ["application_id", gt("The application that owns the lobby")],
        ["metadata", gt("String keys and string values, or null. Keys and values together may hold up to 1000 characters.")],
        ["members", gt("Lobby member objects")],
        ["linked_channel", gt("The linked server text channel (a channel object). Only present while a channel is linked.")],
        ["flags", gt("No lobby flags are defined; only 0 is accepted")],
      ]} />

      <H3 id="lobby-member-object">{gt("Lobby Member Object")}</H3>
      <Table headers={[gt("Field"), gt("Description")]} rows={[
        ["id", gt("The user's id")],
        ["metadata", gt("String keys and string values, or null (same 1000 character limit)")],
        ["flags", gt("Lobby member flags. CanLinkLobby (1 << 0) lets the member link and unlink a channel.")],
        ["additional_name", gt("Optional extra name of 1 to 80 characters, shown on the member's lobby messages")],
      ]} />

      <H3 id="lobby-message-object">{gt("Lobby Message Object")}</H3>
      <CodeBlock lang="json">{`{
  "id": "1300000000000000010",
  "type": 0,
  "content": "gg, rematch?",
  "lobby_id": "1300000000000000001",
  "channel_id": "1300000000000000001",
  "author": { "id": "1300000000000000002", "username": "seika", "global_name": "Seika", "avatar": null },
  "lobby_member": { "additional_name": "Seika (guest)" },
  "metadata": { "round": "3" },
  "flags": 0,
  "application_id": "1234567890"
}`}</CodeBlock>
      <P>
        {gt("channel_id is the lobby id. metadata is echoed in the response to the send but is not stored, so listed messages never carry it; lobby_member only when the author has an additional name; nonce only when you sent one; moderation_metadata once your bot has set it.")}
      </P>

      <H2 id="auth">{gt("Authentication")}</H2>
      <UL>
        <li>{gt("Bot token: your application acts as itself. A bot is never a lobby member; it can manage every lobby of its app.")}</li>
        <li>{gt("Bearer token: a user's OAuth2 access token with the sdk.social_layer scope, issued to the same application. The user acts as a lobby player and must be a member for most routes. Client credentials tokens are refused with 50026.")}</li>
      </UL>
      <P>
        {gt("Bearer callers have their own rate limit budget, keyed by user, on joins, channel linking, invites and message sends. See")} <Link2 href="/developers/docs/topics/oauth2#bearer-routes">{gt("Where access tokens work")}</Link2>.
      </P>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Table headers={[gt("Method"), gt("Path"), gt("Auth"), gt("Description")]} rows={[
        ["POST", "/lobbies", gt("Bot"), gt("Create a lobby with metadata, members (up to 25), idle_timeout_seconds and flags.")],
        ["PUT", "/lobbies", gt("Bot or Bearer"), gt("Create or join a lobby by secret. A Bearer caller also joins it, with optional member_metadata.")],
        ["GET", "/lobbies/{lobby.id}", gt("Bot"), gt("Get a lobby.")],
        ["PATCH", "/lobbies/{lobby.id}", gt("Bot"), gt("Change metadata, idle_timeout_seconds or flags. members, when sent, replaces the whole member list.")],
        ["DELETE", "/lobbies/{lobby.id}", gt("Bot"), gt("Delete a lobby with its members and messages. Returns 204, also when the lobby is already gone.")],
        ["PATCH", "/lobbies/{lobby.id}/channel-linking", gt("Bot or Bearer member"), gt("Link a channel (channel_id) or unlink it (no channel_id).")],
        ["DELETE", "/lobbies/{lobby.id}/members/@me", gt("Bearer"), gt("Leave the lobby. Returns 204.")],
        ["POST", "/lobbies/{lobby.id}/members/@me/invites", gt("Bearer member"), gt("Create an invite to the linked channel for yourself. Bots get 403 (20001).")],
        ["POST", "/lobbies/{lobby.id}/members/bulk", gt("Bot"), gt("Add, update or remove (remove_member: true) up to 25 members. Returns the added or updated members.")],
        ["PUT", "/lobbies/{lobby.id}/members/{user.id}", gt("Bot"), gt("Add or update one member (metadata, flags, additional_name).")],
        ["DELETE", "/lobbies/{lobby.id}/members/{user.id}", gt("Bot"), gt("Remove a member. Returns 204, also when the user was not a member.")],
        ["POST", "/lobbies/{lobby.id}/members/{user.id}/invites", gt("Bot"), gt("Create an invite to the linked channel for a member.")],
        ["GET", "/lobbies/{lobby.id}/messages", gt("Bot or Bearer member"), gt("Recent messages, newest first. limit 1 to 200, default 50.")],
        ["POST", "/lobbies/{lobby.id}/messages", gt("Bot or Bearer member"), gt("Send a message.")],
        ["PUT", "/lobbies/{lobby.id}/messages/{message.id}/moderation-metadata", gt("Bot"), gt("Set moderation metadata on a lobby message. Returns 204.")],
      ]} />

      <H2 id="limits">{gt("Limits")}</H2>
      <Table headers={[gt("Limit"), gt("Value")]} rows={[
        [gt("Members per lobby"), "1000"],
        [gt("Lobbies one user can be in, per application"), "100"],
        [gt("Live lobbies per application"), "10000"],
        [gt("Members per create, modify or bulk request"), "25"],
        [gt("Metadata (keys and values together)"), gt("1000 characters")],
        ["idle_timeout_seconds", gt("5 to 604800, default 300")],
        ["secret", gt("Up to 250 characters")],
        [gt("Message content"), gt("1 to 2000 characters")],
        [gt("Message history"), gt("72 hours")],
        [gt("Moderation metadata"), gt("Up to 5 keys; keys 1 to 1024 characters, values up to 2000")],
      ]} />
      <P>{gt("Going over the member, per-user or per-application cap answers 400 with error code 0.")}</P>

      <H2 id="members">{gt("Members")}</H2>
      <P>
        {gt("Only users who authorized your application (through OAuth2) can be lobby members. On create, modify and bulk, ineligible users are skipped without an error; PUT for a single member answers 403 Missing Access instead. A member list can name each user once.")}
      </P>

      <H2 id="create-or-join">{gt("Create or join by secret")}</H2>
      <P>
        {gt("PUT /lobbies takes a secret and returns the lobby with that secret, creating it if needed. Secrets are unique per application and stored only as a hash. When the lobby already exists, any lobby_metadata, idle_timeout_seconds or flags you send update it. With a Bearer token the user also joins the lobby.")}
      </P>
      <CodeBlock lang="bash">{`curl -X PUT https://api.serika.chat/api/v10/lobbies \\
  -H "Authorization: Bearer USER_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"secret": "match-8812", "lobby_metadata": {"mode": "ranked"}, "member_metadata": {"team": "blue"}}'`}</CodeBlock>

      <H2 id="idle-timeout">{gt("Idle timeout")}</H2>
      <P>
        {gt("Any write by your app or a member counts as activity: joins, member changes, lobby edits, channel linking, invites and messages (a member reading messages counts too). A lobby idle for longer than idle_timeout_seconds is deleted the next time anyone accesses it, and then answers Unknown lobby.")}
      </P>

      <H2 id="channel-linking">{gt("Channel linking")}</H2>
      <P>
        {gt("PATCH /lobbies/.../channel-linking with a channel_id links a server text channel; without one it unlinks. A Bearer caller must be a member with the CanLinkLobby flag. Linking also checks the caller's permissions in that channel (for a bot token, the bot's):")}
      </P>
      <UL>
        <li>{gt("A channel the caller cannot view answers 404 Unknown Channel.")}</li>
        <li>{gt("Only server text channels can be linked, and not age-restricted ones (50035).")}</li>
        <li>{gt("The caller needs Send Messages and Manage Channels there (403 otherwise).")}</li>
        <li>{gt("A channel can be linked to one lobby at a time (50035 CHANNEL_ALREADY_LINKED).")}</li>
      </UL>
      <P>
        {gt("While a channel is linked, each lobby message is also posted there by your app's bot as the author's name followed by the text, with @everyone and @here defused. If the bot is not in the server or cannot send there, the copy is skipped. Messages people send in the channel stay in the channel.")}
      </P>

      <H3 id="invites">{gt("Invites")}</H3>
      <P>
        {gt("The invite routes create a single-use invite to the linked channel that expires after one hour and that only the chosen member can accept. They return the invite code. Without a linked channel they answer 404 Unknown Channel, and a server whose invites are locked to its vanity URL answers 403.")}
      </P>

      <H2 id="messages">{gt("Messages")}</H2>
      <P>
        {gt("A message has content, optional metadata and flags (only SUPPRESS_NOTIFICATIONS, 1 << 12). nonce and enforce_nonce work like channel messages: with enforce_nonce, repeating a nonce returns the first message. embeds, attachments, components, poll, sticker_ids, message_reference, tts and shared_client_theme are rejected with 50035. A bot token sends as your app's bot; a Bearer member sends as the user.")}
      </P>
      <CodeBlock lang="bash">{`curl -X POST https://api.serika.chat/api/v10/lobbies/LOBBY_ID/messages \\
  -H "Authorization: Bot YOUR_BOT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Match starts in 30 seconds", "metadata": {"round": "1"}}'`}</CodeBlock>
      <P>
        {gt("Moderation metadata is a set of string pairs your bot attaches to a lobby message. It is stored and returned as moderation_metadata on that message; SerikaCord does not act on it.")}
      </P>

      <H2 id="related">{gt("Related")}</H2>
      <P>
        <Link2 href="/developers/docs/social-sdk/overview">{gt("Social SDK Overview")}</Link2> · <Link2 href="/developers/docs/social-sdk/api-reference">{gt("API Reference")}</Link2> · <Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2")}</Link2>
      </P>
    </DocPage>
  );
}
