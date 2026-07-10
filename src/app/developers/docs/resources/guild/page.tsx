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
      <Endpoint method="POST" path="/guilds">{gt("Create a guild (bot only, max 10 per bot).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}">{gt("Get a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}">{gt("Update a guild.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}">{gt("Delete a guild (owner only).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/preview">{gt("Get guild preview.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/channels">{gt("List channels.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/roles">{gt("List roles.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/roles">{gt("Create a role.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/roles/@me">{gt("Update own roles.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members">{gt("List members.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members/{user.id}">{gt("Get a member.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/members/{user.id}">{gt("Add a member (bot, with token).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/members/{user.id}">{gt("Update a member.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/members/{user.id}">{gt("Kick a member.")}</Endpoint>
      <Endpoint method="PUT" path="/guilds/{guild.id}/bans/{user.id}">{gt("Ban a member.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/bans/{user.id}">{gt("Unban a user.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/bans">{gt("List bans.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/invites">{gt("List invites.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List webhooks.")}</Endpoint>

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
    </DocPage>
  );
}
