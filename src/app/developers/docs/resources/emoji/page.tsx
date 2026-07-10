import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Emoji",
  description: "SerikaCord Emoji resource: object structure, CRUD endpoints, image requirements, boost-level limits, and usage in messages.",
  path: "/developers/docs/resources/emoji",
  keywords: ["SerikaCord emoji", "custom emoji", "guild emoji", "animated emoji"],
});

export default async function EmojiDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Emoji")} description={gt("Create, manage, and use custom emojis in guilds.")}>
      <H2 id="emoji-object">{gt("Emoji Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "name": "my_emoji",
  "roles": [],
  "user": {
    "id": "123",
    "username": "creator"
  },
  "require_colons": true,
  "managed": false,
  "animated": false,
  "available": true
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/emojis">{gt("List emojis in a guild.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Get a guild emoji.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/emojis">
        {gt("Create an emoji. Requires")}{" "}<InlineCode>MANAGE_EMOJIS_AND_STICKERS</InlineCode>. {gt("Uses")}{" "}
        <InlineCode>multipart/form-data</InlineCode> {gt("with image as base64 data URI.")}
      </Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Update an emoji.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/emojis/{emoji.id}">{gt("Delete an emoji.")}</Endpoint>

      <H2 id="limits">{gt("Limits")}</H2>
      <Table headers={[gt("Boost Level"), gt("Emoji Slots"), gt("Animated Slots")]} rows={[
        [gt("None"), "50", "50"],
        [gt("Tier 1"), "100", "100"],
        [gt("Tier 2"), "150", "150"],
        [gt("Tier 3"), "250", "250"],
      ]} />

      <H2 id="image-requirements">{gt("Image Requirements")}</H2>
      <UL>
        <li>{gt("Format: PNG, JPG, or GIF (for animated)")}</li>
        <li>{gt("Max size: 256 KB")}</li>
        <li>{gt("Dimensions: 128x128 recommended")}</li>
        <li>{gt("Name: 2-32 characters, alphanumeric and underscores")}</li>
      </UL>

      <H2 id="using-emojis">{gt("Using Emojis in Messages")}</H2>
      <P>{gt("Custom emojis use the syntax")}{" "}<InlineCode>&lt;:name:id&gt;</InlineCode> {gt("(static) or")}{" "}<InlineCode>&lt;a:name:id&gt;</InlineCode> {gt("(animated).")}</P>
      <CodeBlock lang="json">{`{
  "content": "Hello <:my_emoji:1234567890>!"
}`}</CodeBlock>

      <Callout type="warning" title={gt("Emoji Roles")}>
        {gt("Emojis can be restricted to specific roles. Only members with those roles can use the emoji.")}
      </Callout>
    </DocPage>
  );
}
