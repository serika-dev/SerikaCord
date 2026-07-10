import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Sticker",
  description: "SerikaCord Sticker resource: sticker item object, CRUD endpoints, Nitro sticker packs, create parameters, and permissions.",
  path: "/developers/docs/resources/sticker",
  keywords: ["SerikaCord sticker", "guild sticker", "sticker pack", "custom sticker"],
});

export default async function StickerResourceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Sticker")} description={gt("Manage custom stickers in guilds and use built-in sticker packs.")}>
      <P>
        {gt("See also the")}{" "}<Link2 href="/developers/docs/topics/stickers">{gt("Stickers topic")}</Link2> {gt("for overview and usage.")}
      </P>

      <H2 id="sticker-item">{gt("Sticker Item Object")}</H2>
      <P>{gt("A minimal representation used in messages:")}</P>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "name": "My Sticker",
  "format_type": 1
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/stickers/{sticker.id}">{gt("Get a sticker.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/stickers">{gt("List guild stickers.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/stickers/{sticker.id}">{gt("Get a guild sticker.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/stickers">{gt("Create a sticker (multipart/form-data).")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/stickers/{sticker.id}">{gt("Update a sticker.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/stickers/{sticker.id}">{gt("Delete a sticker.")}</Endpoint>

      <H2 id="nitro-sticker-packs">{gt("Nitro Sticker Packs")}</H2>
      <Endpoint method="GET" path="/sticker-packs">{gt("List available Nitro sticker packs.")}</Endpoint>

      <H2 id="create-params">{gt("Create Parameters")}</H2>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["name", "string", gt("2-30 characters")],
        ["description", "string", gt("2-100 characters")],
        ["tags", "string", gt("2-200 characters (autocomplete keywords)")],
        ["file", "file", gt("PNG/APNG/GIF/Lottie file (max 512 KB)")],
      ]} />

      <Callout type="warning" title={gt("Permissions")}>
        {gt("Creating, updating, and deleting stickers requires the")}{" "}
        <InlineCode>MANAGE_EMOJIS_AND_STICKERS</InlineCode> {gt("permission.")}
      </Callout>
    </DocPage>
  );
}
