import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Reaction",
  description: "SerikaCord Reaction resource: reaction object, endpoints for add, remove, list, and delete reactions, with pagination and emoji parameter formats.",
  path: "/developers/docs/resources/reaction",
  keywords: ["SerikaCord reaction", "reaction object", "emoji reaction", "message reaction API"],
});

export default async function ReactionDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Reaction")} description={gt("Manage emoji reactions on messages.")}>
      <P>
        {gt("Reactions allow users to respond to messages with emojis. See also the")}{" "}
        <Link2 href="/developers/docs/topics/reactions">{gt("Reactions topic")}</Link2> {gt("for event details.")}
      </P>

      <H2 id="reaction-object">{gt("Reaction Object")}</H2>
      <CodeBlock lang="json">{`{
  "count": 3,
  "count_details": {
    "burst": 1,
    "normal": 2
  },
  "me": true,
  "me_burst": false,
  "burst_colors": ["#8B5CF6"],
  "emoji": {
    "id": null,
    "name": "👍"
  }
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">{gt("Add reaction.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me">{gt("Remove own reaction.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}">{gt("Remove other's reaction.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">{gt("Get users who reacted.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions/{emoji}">{gt("Remove all reactions for emoji.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}/reactions">{gt("Remove all reactions.")}</Endpoint>

      <H2 id="emoji-parameter">{gt("Emoji Parameter")}</H2>
      <P>
        {gt("The")}{" "}<InlineCode>emoji</InlineCode> {gt("URL parameter can be:")}
      </P>
      <UL>
        <li>{gt("A unicode emoji (e.g.,")}{" "}<InlineCode>👍</InlineCode>{") — URL-encoded"}</li>
        <li>{gt("A custom emoji in")}{" "}<InlineCode>name:id</InlineCode> {gt("format (e.g.,")}{" "}<InlineCode>my_emoji:123456</InlineCode>{")"}</li>
      </UL>

      <Callout type="info" title={gt("Pagination")}>
        {gt("The GET reactions endpoint supports")}{" "}<InlineCode>before</InlineCode>, <InlineCode>after</InlineCode>,
        {gt(" and")}{" "}<InlineCode>limit</InlineCode> {gt("(max 100) query parameters for pagination.")}
      </Callout>
    </DocPage>
  );
}
