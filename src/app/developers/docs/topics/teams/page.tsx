import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Teams",
  description:
    "SerikaCord developer teams: collaborative application management, team roles, inviting members, transferring apps, and team verification.",
  path: "/developers/docs/topics/teams",
  keywords: ["SerikaCord teams", "developer team", "team roles", "collaborative development"],
});

export default async function TeamsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Teams")} description={gt("Developer teams allow multiple developers to collaboratively manage applications.")}>
      <H2 id="what-are-teams">{gt("What Are Developer Teams?")}</H2>
      <P>
        {gt("Teams let you share ownership and management of applications with other developers. This is essential for larger projects with multiple contributors.")}
      </P>

      <H2 id="creating-teams">{gt("Creating a Team")}</H2>
      <P>
        {gt("Create a team from the")}{" "}<Link2 href="/developers/teams">{gt("Teams page")}</Link2> {gt("in the Developer Portal. You'll become the team owner automatically.")}
      </P>

      <H2 id="roles">{gt("Team Roles")}</H2>
      <Table headers={[gt("Role"), gt("Permissions")]} rows={[
        [gt("Owner"), gt("Full control: delete team, transfer ownership, manage all apps and members")],
        [gt("Admin"), gt("Manage members, manage all applications in the team")],
        [gt("Developer"), gt("Manage applications in the team (no member management)")],
        [gt("Viewer"), gt("Read-only access to applications")],
      ]} />

      <H2 id="inviting-members">{gt("Inviting Members")}</H2>
      <P>
        {gt("Team owners and admins can invite members by username. The invitee must accept the invitation before joining the team.")}
      </P>

      <H2 id="transferring-apps">{gt("Transferring Applications")}</H2>
      <P>
        {gt("Applications can be transferred between personal accounts and teams. Only the app owner or team admin can initiate a transfer.")}
      </P>
      <Callout type="warning" title={gt("Transfer Confirmation")}>
        {gt("Transferring an application to a team is irreversible. Ensure all team members are trusted.")}
      </Callout>

      <H2 id="verified-bots">{gt("Verified Bots and Teams")}</H2>
      <P>
        {gt("Bots in 100+ servers must be verified. If the bot is owned by a team, the team must also be verified. See")}{" "}<Link2 href="/developers/docs/topics/bot-verification">{gt("Bot Verification")}</Link2>.
      </P>

      <H2 id="api-endpoints">{gt("API Endpoints")}</H2>
      <Endpoint method="GET" path="/teams">{gt("List teams you're a member of.")}</Endpoint>
      <Endpoint method="POST" path="/teams">{gt("Create a new team.")}</Endpoint>
      <Endpoint method="GET" path="/teams/{team.id}">{gt("Get a team.")}</Endpoint>
      <Endpoint method="PATCH" path="/teams/{team.id}">{gt("Update a team.")}</Endpoint>
      <Endpoint method="DELETE" path="/teams/{team.id}">{gt("Delete a team (owner only).")}</Endpoint>
      <Endpoint method="POST" path="/teams/{team.id}/members">{gt("Invite a member.")}</Endpoint>
      <Endpoint method="DELETE" path="/teams/{team.id}/members/{user.id}">{gt("Remove a member.")}</Endpoint>
    </DocPage>
  );
}
