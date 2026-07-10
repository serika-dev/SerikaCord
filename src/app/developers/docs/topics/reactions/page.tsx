import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Reactions",
  description:
    "SerikaCord reactions: add, remove, list, and manage emoji reactions on messages. Reaction objects, burst reactions, and gateway events.",
  path: "/developers/docs/topics/reactions",
  keywords: ["SerikaCord reactions", "emoji reaction", "burst reaction", "message reaction"],
});

export default async function ReactionsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Reactions")} description={gt("Add, remove, and manage emoji reactions on messages.")}>
      <H2 id="adding-reactions">{gt("Adding Reactions")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">
        {gt("Add a reaction to a message.")}{" "}<InlineCode>emoji</InlineCode> {gt("can be a unicode emoji or")}{" "}
        <InlineCode>name:id</InlineCode> {gt("for custom emojis.")}
      </Endpoint>

      <H2 id="removing-reactions">{gt("Removing Reactions")}</H2>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">
        {gt("Remove your own reaction.")}
      </Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}">
        {gt("Remove someone else's reaction (requires")}{" "}<InlineCode>MANAGE_MESSAGES</InlineCode>).
      </Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">
        {gt("Remove all reactions for a specific emoji.")}
      </Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions">
        {gt("Remove all reactions on a message.")}
      </Endpoint>

      <H2 id="getting-reactions">{gt("Getting Reactions")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">
        {gt("Get users who reacted with a specific emoji. Supports pagination with")}{" "}<InlineCode>before</InlineCode>,{" "}
        <InlineCode>after</InlineCode>, {gt("and")}{" "}<InlineCode>limit</InlineCode> {gt("query params.")}
      </Endpoint>

      <H2 id="reaction-object">{gt("Reaction Object")}</H2>
      <CodeBlock lang="json">{`{
  "count": 2,
  "me": true,
  "emoji": {
    "id": null,
    "name": "👍"
  }
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["count", "integer", gt("Total number of reactions (including burst)")],
        ["me", "boolean", gt("Whether the current user has reacted")],
        ["emoji", "object", gt("The emoji object (id, name, animated)")],
        ["burst_colors", "array", gt("Colors of burst reactions (hex integers)")],
        ["count_details", "object", gt("Breakdown: '{' burst: int, normal: int '}'")],
      ]} />

      <H2 id="burst-reactions">{gt("Burst Reactions")}</H2>
      <P>
        {gt("Super reactions (burst reactions) are animated reactions. The reaction object includes a")}{" "}
        <InlineCode>burst_colors</InlineCode> {gt("array and")}{" "}<InlineCode>count</InlineCode> {gt("may include both normal and burst counts.")}
      </P>

      <H2 id="gateway-events">{gt("Gateway Events")}</H2>
      <UL>
        <li><InlineCode>MESSAGE_REACTION_ADD</InlineCode> — {gt("A user reacted")}</li>
        <li><InlineCode>MESSAGE_REACTION_REMOVE</InlineCode> — {gt("A user removed a reaction")}</li>
        <li><InlineCode>MESSAGE_REACTION_REMOVE_ALL</InlineCode> — {gt("All reactions removed")}</li>
        <li><InlineCode>MESSAGE_REACTION_REMOVE_EMOJI</InlineCode> — {gt("All reactions for an emoji removed")}</li>
      </UL>

      <Callout type="info" title={gt("Reaction Limits")}>
        {gt("A message can have up to 40 different reactions. Each user can only react with one of each emoji per message.")}
      </Callout>
    </DocPage>
  );
}
