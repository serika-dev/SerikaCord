import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "User",
  description: "SerikaCord User resource: object structure, user flags, premium types, endpoints for current user, guilds, DMs, connections, and role connections.",
  path: "/developers/docs/resources/user",
  keywords: ["SerikaCord user", "user object", "user flags", "premium types", "DM channel"],
});

export default async function UserDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("User")} description={gt("Get and manage user information, including the current authenticated user.")}>
      <H2 id="user-object">{gt("User Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "username": "user",
  "global_name": "Display Name",
  "avatar": "avatar_hash",
  "banner": null,
  "accent_color": null,
  "bot": false,
  "system": false,
  "mfa_enabled": true,
  "verified": true,
  "email": null,
  "flags": 0,
  "premium_type": 0,
  "public_flags": 0
}`}</CodeBlock>

      <H2 id="user-flags">{gt("User Flags")}</H2>
      <Table headers={[gt("Flag"), gt("Value"), gt("Description")]} rows={[
        [gt("Staff"), "1 << 0", gt("SerikaCord employee")],
        [gt("Partner"), "1 << 1", gt("Partnered server owner")],
        [gt("Hypesquad"), "1 << 2", gt("HypeSquad member")],
        [gt("Bug Hunter"), "1 << 3"],
        [gt("HypeSquad Online House 1"), "1 << 6"],
        [gt("HypeSquad Online House 2"), "1 << 7"],
        [gt("HypeSquad Online House 3"), "1 << 8"],
        [gt("Premium Early Supporter"), "1 << 9"],
        [gt("Team Pseudo User"), "1 << 10"],
        [gt("Bug Hunter Level 2"), "1 << 14"],
        [gt("Verified Bot"), "1 << 16"],
        [gt("Verified Developer"), "1 << 17"],
        [gt("Certified Moderator"), "1 << 18"],
        [gt("Bot HTTP Interactions"), "1 << 19"],
        [gt("Active Developer"), "1 << 22"],
      ]} />

      <H2 id="premium-types">{gt("Premium Types")}</H2>
      <Table headers={[gt("Type"), gt("Value")]} rows={[
        [gt("None"), "0"],
        [gt("Nitro Classic"), "1"],
        [gt("Nitro"), "2"],
        [gt("Nitro Basic"), "3"],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/users/@me">{gt("Get current user (requires auth).")}</Endpoint>
      <Endpoint method="GET" path="/users/{user.id}">{gt("Get a user by ID.")}</Endpoint>
      <Endpoint method="PATCH" path="/users/@me">{gt("Update current user.")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/guilds">{gt("List guilds the current user is in.")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/guilds/{guild.id}/member">{gt("Get current user's member object in a guild.")}</Endpoint>
      <Endpoint method="DELETE" path="/users/@me/guilds/{guild.id}">{gt("Leave a guild.")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/channels">{gt("List DM channels.")}</Endpoint>
      <Endpoint method="POST" path="/users/@me/channels">{gt("Create a DM or group DM.")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/connections">{gt("List connected accounts (OAuth2).")}</Endpoint>
      <Endpoint method="GET" path="/users/@me/applications/{application.id}/role-connection">{gt("Get role connection.")}</Endpoint>
      <Endpoint method="PUT" path="/users/@me/applications/{application.id}/role-connection">{gt("Update role connection.")}</Endpoint>

      <Callout type="info" title={gt("Bot Users")}>
        {gt("Bot users have")}{" "}<InlineCode>bot: true</InlineCode> {gt("and cannot access all user endpoints. Bots cannot use")}{" "}<InlineCode>/users/@me</InlineCode> {gt("to get email or premium info.")}
      </Callout>
    </DocPage>
  );
}
