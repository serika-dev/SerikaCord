import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Guild",
  description: "SerikaCord Guild resource: object structure, CRUD endpoints, roles, members, bans, invites, webhooks, verification levels, and features.",
  path: "/developers/docs/resources/guild",
  keywords: ["SerikaCord guild", "server object", "guild members", "guild roles", "guild bans"],
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
  "emojis": [...]
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}">{gt("Get a guild (with_counts adds approximate member and presence counts).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}">{gt("Update a guild (needs Manage Server). Icon, banner and splash take image data URIs.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/preview">{gt("Get guild preview.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/regions">{gt("List voice regions.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/vanity-url">{gt("Get the vanity invite code and its uses.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/widget">{gt("Get widget settings.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/widget">{gt("Update widget settings.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/widget.json">{gt("Public widget data (only when the widget is enabled).")}</Endpoint>
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
    </DocPage>
  );
}
