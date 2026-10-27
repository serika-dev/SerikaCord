import { DocPage, P, H2, UL, CodeBlock, Callout, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Guild",
  description: "SerikaCord Guild resource: object structure, CRUD endpoints, roles, members, bans, invites, webhooks, message search, join requests, incident actions, widget, verification levels, and features.",
  path: "/developers/docs/resources/guild",
  keywords: ["SerikaCord guild", "server object", "guild members", "guild roles", "guild bans", "guild message search", "join requests", "guild widget"],
});

export default async function GuildDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Guild")} description={gt("Create, manage, and interact with guilds (servers).")}>
      <H2 id="guild-object">{gt("Guild Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "name": "My Server",
  "icon": null,
  "description": null,
  "owner_id": "1234567890",
  "verification_level": 0,
  "member_count": 42,
  "premium_tier": 0,
  "features": [],
  "roles": [...],
  "channels": [...],
  "emojis": [...],
  "incidents_data": null
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}">{gt("Get a guild (with_counts adds approximate member and presence counts).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}">{gt("Update a guild (needs Manage Server). Icon, banner and splash take image data URIs.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/preview">{gt("Get guild preview.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/regions">{gt("List voice regions.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/vanity-url">{gt("Get the vanity invite code and its uses.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/widget">{gt("Get widget settings (enabled, channel_id). Requires Manage Server.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/widget">{gt("Update widget settings. Requires Manage Server; channel_id must be a text or announcement channel of the guild.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/widget.json">{gt("Public widget data, no authentication. See Widget below.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/widget.png">{gt("Public widget image, no authentication. See Widget below.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/channels">{gt("List channels.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/channels">{gt("Create a channel in a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/channels">{gt("Reorder channels.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/roles">{gt("List roles.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/roles/{role.id}">{gt("Get a role.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/roles/member-counts">{gt("Member count per role.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/roles">{gt("Create a role.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/roles">{gt("Reorder roles.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/roles/{role.id}">{gt("Update a role.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/roles/{role.id}">{gt("Delete a role.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members">{gt("List members (limit and after; needs the Server Members intent).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members/search">{gt("Search members by username or nickname prefix (needs the Server Members intent).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members/{user.id}">{gt("Get a member.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/members/{user.id}">{gt("Update a member (nick, roles, mute, deaf, timeout).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/members/@me">{gt("Update the bot's own nickname, server avatar or banner.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/members/{user.id}/roles/{role.id}">{gt("Give a member a role.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/members/{user.id}/roles/{role.id}">{gt("Take a role from a member.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/members/{user.id}">{gt("Kick a member.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/prune">{gt("Count members a prune would remove.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/prune">{gt("Remove members without roles who have not been online for a number of days.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/bans">{gt("List bans (limit, before and after).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/bans/{user.id}">{gt("Get a ban.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/bans/{user.id}">{gt("Ban a user (delete_message_seconds removes their recent messages).")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/bans/{user.id}">{gt("Unban a user.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/bulk-ban">{gt("Ban up to 200 users at once.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/invites">{gt("List invites.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List webhooks.")}</Endpoint>

      <Callout type="info" title={gt("Hierarchy and audit log")}>
        {gt("Moderation follows the role hierarchy: a bot can only manage roles and members below its highest role, and can only grant permissions it has. Send an X-Audit-Log-Reason header to record a reason in the audit log.")}
      </Callout>
      <P>{gt("Adding a member with PUT needs an OAuth2 guilds.join access token, which SerikaCord does not issue yet; the request answers 403 unless the user is already a member.")}</P>

      <H2 id="verification-levels">{gt("Verification Levels")}</H2>
      <Table headers={[gt("Level"), gt("Value"), gt("Description")]} rows={[
        [gt("None"), "0", gt("No verification required")],
        [gt("Low"), "1", gt("Must have verified email")],
        [gt("Medium"), "2", gt("Must be registered for 5+ minutes")],
        [gt("High"), "3", gt("Must be a member for 10+ minutes")],
        [gt("Very High"), "4", gt("Must have verified phone number")],
      ]} />

      <H2 id="features">{gt("Guild Features")}</H2>
      <UL>
        <li><InlineCode>ANIMATED_BANNER</InlineCode> — {gt("Has animated banner")}</li>
        <li><InlineCode>ANIMATED_ICON</InlineCode> — {gt("Has animated icon")}</li>
        <li><InlineCode>BANNER</InlineCode> — {gt("Has banner image")}</li>
        <li><InlineCode>COMMUNITY</InlineCode> — {gt("Community server")}</li>
        <li><InlineCode>DISCOVERABLE</InlineCode> — {gt("In server discovery")}</li>
        <li><InlineCode>ENABLED_DISCOVERABLE_BEFORE</InlineCode></li>
        <li><InlineCode>FEATURABLE</InlineCode></li>
        <li><InlineCode>HAS_DIRECTORY_ENTRY</InlineCode></li>
        <li><InlineCode>INVITE_SPLASH</InlineCode> — {gt("Has invite splash")}</li>
        <li><InlineCode>MEMBER_VERIFICATION_GATE_ENABLED</InlineCode></li>
        <li><InlineCode>NEWS</InlineCode> — {gt("Has announcement channels")}</li>
        <li><InlineCode>PARTNERED</InlineCode> — {gt("Partnered server")}</li>
        <li><InlineCode>PREVIEW_ENABLED</InlineCode></li>
        <li><InlineCode>WELCOME_SCREEN_ENABLED</InlineCode></li>
        <li><InlineCode>VERIFIED</InlineCode> — {gt("Verified server")}</li>
        <li><InlineCode>VIP_REGIONS</InlineCode></li>
      </UL>

      <Callout type="info" title={gt("Member Limits")}>
        <InlineCode>member_count</InlineCode> {gt("is approximate. For exact counts, use the member list endpoint with pagination.")}
      </Callout>

      <H2 id="community">{gt("Onboarding, Welcome Screen, Templates and Integrations")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/onboarding">{gt("Get the onboarding questions.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/onboarding">{gt("Replace the onboarding questions. Requires Manage Server and Manage Roles; options can only grant roles the bot may assign.")}</Endpoint>
      <P>
        <InlineCode>mode</InlineCode>, <InlineCode>default_channel_ids</InlineCode> {gt("and the options'")}{" "}
        <InlineCode>channel_ids</InlineCode> {gt("are stored and returned, but they don't change what members see: Serika shows every channel a member can access. Channel ids that are not in the guild are dropped.")}
      </P>
      <Endpoint method="GET" path="/guilds/{guild.id}/new-member-welcome">{gt("Get the Server Guide. Any member can read it while the guide is enabled; otherwise it requires Manage Server.")}</Endpoint>
      <P>
        {gt("The guide's welcome message becomes welcome_message (authored by the owner). To-dos that point at a channel become new_member_actions (action_type 0 to view the channel, 1 to talk in it), and resources that link a channel become resource_channels. To-dos and resources without a channel have no Discord equivalent and are left out.")}
      </P>
      <Endpoint method="GET" path="/guilds/{guild.id}/welcome-screen">{gt("Get the welcome screen (Manage Server unless it is enabled).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/welcome-screen">{gt("Update the welcome screen. Requires Manage Server.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/templates">{gt("List the guild's template (a guild has at most one).")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/templates">{gt("Create the guild's template.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/templates/{template.code}">{gt("Sync the template with the guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/templates/{template.code}">{gt("Rename the template.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/templates/{template.code}">{gt("Delete the template.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/templates/{template.code}">{gt("Get a template by its code.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/integrations">{gt("List the guild's integrations: one per bot.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/integrations/{integration.id}">{gt("Remove a bot from the guild. The integration id is the bot's application id.")}</Endpoint>

      <H2 id="search-guild-messages">{gt("Search Guild Messages")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/messages/search">{gt("Search the guild's messages with Serika's search index.")}</Endpoint>
      <P>
        {gt("Only channels where the bot has View Channel and Read Message History are searched (threads follow their parent). Age-restricted channels are searched only with include_nsfw=true. End-to-end encrypted messages never match. Array parameters repeat their key, for example")}{" "}
        <InlineCode>{"?author_id=1&author_id=2"}</InlineCode>
        {"; "}{gt("a comma-separated list works for id parameters too.")}
      </P>
      <Table headers={[gt("Parameter"), gt("Description")]} rows={[
        ["content", gt("Words to find, up to 1024 characters.")],
        ["author_id, mentions, mentions_role_id", gt("User or role ids (up to 100 each).")],
        ["author_type", gt("user, bot or webhook; prefix with - to exclude.")],
        ["replied_to_user_id, replied_to_message_id", gt("Replies to these users or messages.")],
        ["mention_everyone, pinned", gt("true or false.")],
        ["min_id, max_id", gt("min_id: only messages after this message id; max_id: only messages before it.")],
        ["has", gt("link, embed, file, image, video, sound, sticker, poll or snapshot; prefix with - to exclude.")],
        ["link_hostname, embed_provider, embed_type", gt("Link host names (subdomains match), embed provider names, and embed types: image, video, gif, sound or article.")],
        ["attachment_extension, attachment_filename", gt("Attachment file extensions, and parts of attachment file names.")],
        ["channel_id", gt("Only these channels (up to 500).")],
        ["include_nsfw", gt("Also search age-restricted channels.")],
        ["sort_by, sort_order", gt("timestamp (default) or relevance; desc (default) or asc. Relevance applies only with content.")],
        ["limit, offset", gt("1 to 25 results (default 25), offset 0 to 9975.")],
        ["slop", gt("Accepted (0 to 100) but not used.")],
      ]} />
      <CodeBlock lang="json">{`{
  "doing_deep_historical_index": false,
  "total_results": 1,
  "messages": [[{ "id": "...", "channel_id": "...", "content": "..." }]],
  "threads": [],
  "members": []
}`}</CodeBlock>
      <P>
        {gt("Each hit is a one-message array, without reactions. threads lists the threads that hold hits, and members the bot's thread member for those it has joined. doing_deep_historical_index is true while older messages are still being indexed. If the index is not available yet, a query that needs it (content, link_hostname or has=link) answers 202 with code 110000 and retry_after.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Without the Message Content intent, content, link, embed, attachment and has filters answer 403 (50001), and hits are redacted like other bot reads. slop is ignored: every word must match, and a word also matches longer words that start with it. link_hostname is checked after the search, so a page can hold fewer than limit messages. Offsets past 5000 return an empty page. Searches use the web search rate limit: 40 per minute per bot.")}
      </Callout>

      <H2 id="join-requests">{gt("Join Requests")}</H2>
      <P>{gt("Join requests are Serika's member applications: apply-to-join forms and rules screening with manual approval. Both routes require Manage Server.")}</P>
      <Endpoint method="GET" path="/guilds/{guild.id}/requests">{gt("List join requests: status (SUBMITTED, APPROVED or REJECTED), limit (1 to 100, default 100), before and after (request ids). Newest first; with after, oldest first. Returns total and guild_join_requests.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/requests/{request.id}">{gt("Approve or reject a request: action (APPROVED or REJECTED) and an optional rejection_reason of up to 160 characters.")}</Endpoint>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "created_at": "2026-07-10T20:00:00.000Z",
  "reviewed_at": null,
  "application_status": "SUBMITTED",
  "rejection_reason": null,
  "guild_id": "1234567890",
  "user_id": "1234567890",
  "user": { "id": "1234567890", "username": "applicant" },
  "form_responses": [
    { "field_type": "TERMS", "label": "Read and agree to the server rules", "required": true, "values": ["Be nice"], "response": true },
    { "field_type": "TEXT_INPUT", "label": "Why do you want to join?", "required": false, "response": "..." }
  ],
  "actioned_by_user": null
}`}</CodeBlock>
      <P>
        {gt("Approving does what a review in Server Settings does: a member waiting in rules screening is let in, and an apply-to-join applicant joins the server (403 with code 40007 if they were banned since). Rejecting stores the reason and removes no one. Serika keeps an application only once it is submitted, so STARTED never matches.")}
      </P>

      <H2 id="incident-actions">{gt("Incident Actions")}</H2>
      <Endpoint method="PUT" path="/guilds/{guild.id}/incident-actions">{gt("Pause invites or DMs during a raid. Requires Manage Server.")}</Endpoint>
      <P>
        <InlineCode>invites_disabled_until</InlineCode> {gt("and")} <InlineCode>dms_disabled_until</InlineCode>{" "}
        {gt("take an ISO 8601 time at most 24 hours ahead. null or a time in the past ends the pause, and a missing field keeps its current value. While invites are paused, joining through an invite is refused. The DM pause is stored and reported only, because Serika's DM rules don't depend on shared servers. The response holds both fields; the guild object reports them as incidents_data, and a change sends GUILD_UPDATE.")}
      </P>

      <H2 id="widget">{gt("Widget")}</H2>
      <P>
        {gt("widget.json and widget.png need no authentication, but answer 403 (50004, Widget Disabled) until the widget is enabled. Both are cached per guild for a minute.")}
      </P>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "name": "My Server",
  "instant_invite": "https://serika.chat/invite/abc123",
  "channels": [{ "id": "1234567890", "name": "Lounge", "position": 0 }],
  "members": [{ "id": "0", "username": "Serika", "discriminator": "0000", "avatar": null, "status": "online", "avatar_url": "https://..." }],
  "presence_count": 12
}`}</CodeBlock>
      <UL>
        <li>{gt("channels: voice and stage channels that @everyone can view and connect to, except age-restricted ones.")}</li>
        <li>{gt("members: up to 100 online members, numbered 0, 1, 2 and so on instead of carrying user ids. Members in a listed channel also carry channel_id and their mute and deafen state.")}</li>
        <li>{gt("instant_invite: the vanity invite of a partnered server, otherwise an existing invite to the widget channel that never expires and has no use limit (none is created), and null while invites are paused.")}</li>
      </UL>
      <P>
        <InlineCode>widget.png</InlineCode> {gt("draws the guild name and online count. style picks shield (the default), banner1, banner2, banner3 or banner4.")}
      </P>

      <H2 id="soundboard">{gt("Soundboard")}</H2>
      <P>
        {gt("Guild soundboard sounds are documented on the")}{" "}
        <Link2 href="/developers/docs/resources/soundboard">{gt("Soundboard")}</Link2>{" "}
        {gt("page.")}
      </P>
    </DocPage>
  );
}
