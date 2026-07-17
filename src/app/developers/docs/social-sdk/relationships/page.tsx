import { DocPage, P, H2, CodeBlock, Strong, InlineCode } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK · Relationships & Presence",
  description: "Read friends and live rich presence, and drive Serika RPC with image assets.",
  path: "/developers/docs/social-sdk/relationships",
  keywords: ["Serika relationships", "rich presence", "Serika RPC"],
});

export default async function RelationshipsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Relationships & Presence")}
      description={gt("Read a user's relationships and live presence, and push a Serika RPC activity with image assets and buttons.")}
    >
      <H2 id="relationships">{gt("Relationships")}</H2>
      <CodeBlock lang="bash">{`GET /api/v1/users/@me/relationships
# → { relationships: [ { type: "friend" | "blocked", user: {…} } ] }`}</CodeBlock>

      <H2 id="presence">{gt("Reading presence")}</H2>
      <P>{gt("Returns the target user's active (non-expired) rich presence entries.")}</P>
      <CodeBlock lang="bash">{`GET /api/v1/users/:id/presences
# → { presences: [ { type, name, details, state, assets, buttons, … } ] }`}</CodeBlock>

      <H2 id="serika-rpc">{gt("Serika RPC")}</H2>
      <P>
        {gt("Push a live activity for the authenticated user. Assets carry image URLs (or Application Asset keys); buttons render as links. The presence expires ~60s after the last heartbeat, so send it on an interval while active.")}
      </P>
      <CodeBlock lang="json">{`PUT /api/v1/users/@me/rich-presence
{
  "type": "game",
  "name": "Phoenix Wright: Ace Attorney Trilogy",
  "details": "Turnabout Sisters",
  "state": "Case 2",
  "application_id": "APP_ID",
  "assets": {
    "large_image": "https://cdn.serika.chat/…/cover.png",
    "large_text": "Ace Attorney",
    "small_image": "https://cdn.serika.chat/…/badge.png",
    "small_text": "Objection!"
  },
  "buttons": [ { "label": "Play", "url": "https://store.example/game" } ]
}`}</CodeBlock>

      <P>
        <Strong>{gt("Note:")}</Strong> {gt("the legacy desktop path")} <InlineCode>POST /api/users/@me/rich-presence</InlineCode> {gt("still works and now also accepts the")} <InlineCode>assets</InlineCode>, <InlineCode>buttons</InlineCode> {gt("and")} <InlineCode>applicationId</InlineCode> {gt("fields.")}
      </P>
    </DocPage>
  );
}
