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
      <Endpoint method="GET" path="/invites/{invite.code}">{gt("Get an invite (with optional")}{" "}<InlineCode>with_counts</InlineCode> {gt("and")}{" "}<InlineCode>guild_scheduled_event_id</InlineCode> {gt("params; expires_at is always included).")}</Endpoint>
      <Endpoint method="DELETE" path="/invites/{invite.code}">{gt("Revoke an invite. Requires Manage Server, or Manage Channels on the invite's channel. Sends INVITE_DELETE.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/invites">{gt("List channel invites.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/invites">{gt("List guild invites.")}</Endpoint>
      <Endpoint method="GET" path="/invites/{invite.code}/target-users">{gt("Read an invite's target users; see Invite Target Users below for the full set.")}</Endpoint>

      <H2 id="create-params">{gt("Create Parameters")}</H2>
      <Table headers={[gt("Param"), gt("Default"), gt("Description")]} rows={[
        ["max_age", "86400", gt("Seconds before expiry, 0-604800 (0 = never)")],
        ["max_uses", "0", gt("Max uses, 0-100 (0 = unlimited)")],
        ["temporary", "false", gt("Marks the invite as temporary membership")],
        ["unique", "false", gt("Always create a new code. Without it, a live invite this bot already made with the same settings is returned")],
      ]} />
      <P>
        {gt("Those four fields are the only ones read. target_type, target_user_id, target_application_id, target_users_file and role_ids are ignored on create. To limit who can use an invite, create it and then set its target users (below).")}
      </P>
      <Callout type="info" title={gt("Invite Requirements")}>
        {gt("Creating an invite needs View Channel and Create Invite in the channel. Threads, categories and DMs answer 50024. A server locked to its custom invite link refuses new invites with 50013.")}
      </Callout>

      <H2 id="target-users">{gt("Invite Target Users")}</H2>
      <P>
        {gt("An invite can carry a list of users who may use it. With a list, only the listed users can see and accept the invite; everyone else gets the same not-found answer as for a missing invite. Without a list the invite is open to anyone, as before. An empty list opens it to anyone again.")}
      </P>
      <Endpoint method="GET" path="/invites/{invite.code}/target-users">{gt("The list as CSV (text/csv): a user_id header, then one user id per line.")}</Endpoint>
      <Endpoint method="PUT" path="/invites/{invite.code}/target-users">{gt("Replace the list from a CSV file sent as multipart/form-data in target_users_file (up to 512 KB). Applied immediately; returns 204.")}</Endpoint>
      <Endpoint method="GET" path="/invites/{invite.code}/target-users/job-status">{gt("Job status. Lists are applied synchronously, so the status is 2 (completed) once a list exists, or 0 (unspecified) without one.")}</Endpoint>
      <Endpoint method="POST" path="/invites/{invite.code}/target-users/bulk-add">{gt("Add users. Body: user_ids, 1-1000 user ids. Returns 204.")}</Endpoint>
      <Endpoint method="POST" path="/invites/{invite.code}/target-users/bulk-delete">{gt("Remove users. Body: user_ids, 1-1000 user ids. Returns 204.")}</Endpoint>
      <Endpoint method="PUT" path="/invites/{invite.code}/target-users/{user.id}">{gt("Add one user. Returns 204.")}</Endpoint>
      <Endpoint method="DELETE" path="/invites/{invite.code}/target-users/{user.id}">{gt("Remove one user. Returns 204.")}</Endpoint>
      <UL>
        <li>{gt("Who may manage the list: the invite's creator, or anyone with Manage Server. Reading the list or the job status is also allowed with View Audit Log. A bot that isn't in the server gets 10006 Unknown Invite.")}</li>
        <li>{gt("The CSV has one column of user ids, an optional user_id header, and blank lines are skipped. Bad or unknown ids answer 50035 with one message per line, for example \"Line 5: unknown user ID\", and nothing is changed.")}</li>
        <li>{gt("An invite's list holds up to 10000 users. Expired or used-up invites answer 10006.")}</li>
      </UL>
      <CodeBlock lang="bash">{`curl -X PUT \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -F "target_users_file=@users.csv" \\
  "https://api.serika.chat/api/v10/invites/abc123/target-users"`}</CodeBlock>
    </DocPage>
  );
}
