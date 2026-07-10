import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Invite",
  description: "SerikaCord Invite resource: object structure, create parameters, endpoints, and invite limits.",
  path: "/developers/docs/resources/invite",
  keywords: ["SerikaCord invite", "invite code", "guild invite", "channel invite"],
});

export default async function InviteDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Invite")} description={gt("Create, manage, and accept invites to join guilds.")}>
      <H2 id="invite-object">{gt("Invite Object")}</H2>
      <CodeBlock lang="json">{`{
  "code": "abc123",
  "guild": { "id": "123", "name": "My Server", ... },
  "channel": { "id": "123", "name": "general", ... },
  "inviter": { "id": "123", "username": "host" },
  "approximate_member_count": 42,
  "approximate_presence_count": 10,
  "expires_at": "2026-07-12T20:00:00.000Z",
  "uses": 5,
  "max_uses": 0,
  "max_age": 604800,
  "temporary": false,
  "created_at": "2026-07-05T20:00:00.000Z"
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/invites">{gt("Create an invite.")}</Endpoint>
      <Endpoint method="GET" path="/invites/{invite.code}">{gt("Get an invite (with optional")}{" "}<InlineCode>with_count</InlineCode> {gt("and")}{" "}<InlineCode>with_expiration</InlineCode> {gt("params).")}</Endpoint>
      <Endpoint method="DELETE" path="/invites/{invite.code}">{gt("Revoke an invite.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/invites">{gt("List channel invites.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/invites">{gt("List guild invites.")}</Endpoint>

      <H2 id="create-params">{gt("Create Parameters")}</H2>
      <Table headers={[gt("Param"), gt("Default"), gt("Description")]} rows={[
        ["max_age", "86400", gt("Seconds before expiry (0 = never)")],
        ["max_uses", "0", gt("Max uses (0 = unlimited)")],
        ["temporary", "false", gt("Grant temporary membership")],
        ["unique", "false", gt("Don't reuse similar invite code")],
        ["target_type", "null", gt("Target type for embedded apps")],
        ["target_user_id", "null", gt("Target user for stream target")],
        ["target_application_id", "null", gt("Target embedded application")],
      ]} />

      <Callout type="info" title={gt("Invite Limits")}>
        {gt("Guilds can have up to 1000 active invites. Temporary members are kicked after 24 hours unless assigned a role.")}
      </Callout>
    </DocPage>
  );
}
