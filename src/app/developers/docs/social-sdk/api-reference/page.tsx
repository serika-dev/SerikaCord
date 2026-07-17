import { DocPage, P, H2, Table, InlineCode, Callout } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK · API Reference",
  description: "Every native /api/v1 Social SDK endpoint: identity, relationships, presence, games, and widgets.",
  path: "/developers/docs/social-sdk/api-reference",
  keywords: ["Serika API reference", "Social SDK endpoints", "/api/v1"],
});

export default async function ApiReferenceDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("API Reference")}
      description={gt("The native Social SDK HTTP surface, all under https://api.serika.chat/api/v1.")}
    >
      <Callout type="info" title={gt("Auth")}>
        {gt("Send")} <InlineCode>Authorization: Bearer ACCESS_TOKEN</InlineCode>. {gt("Endpoints with @me act on the token's user.")}
      </Callout>

      <H2 id="identity">{gt("Identity & Relationships")}</H2>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["GET", "/users/@me", gt("The authenticated user.")],
        ["GET", "/users/:id", gt("A public user profile.")],
        ["GET", "/users/@me/relationships", gt("Friends and blocked users.")],
      ]} />

      <H2 id="presence">{gt("Presence")}</H2>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["GET", "/users/:id/presences", gt("Active rich presence for a user.")],
        ["PUT", "/users/@me/rich-presence", gt("Set/replace the caller's presence (assets, buttons).")],
        ["DELETE", "/users/@me/rich-presence", gt("Clear presence.")],
      ]} />

      <H2 id="games">{gt("Game library")}</H2>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["GET", "/users/:id/games", gt("Library (optionally ?category=favorite|liked|rotation|wishlist).")],
        ["POST", "/users/@me/games", gt("Add a game to a category.")],
        ["PATCH", "/users/@me/games/:id", gt("Edit tags / note / cover.")],
        ["DELETE", "/users/@me/games/:id", gt("Remove an entry.")],
      ]} />

      <H2 id="widgets">{gt("Widgets")}</H2>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["GET", "/applications/:id/widget/config", gt("Published widget config (public).")],
        ["PUT", "/applications/:id/users/@me/widget-data", gt("Push the caller's dynamic widget data.")],
        ["GET", "/applications/:id/users/:uid/widget-data", gt("Read stored widget data.")],
      ]} />

      <P>
        {gt("Category limits: favorite 1, liked 20, rotation 5, wishlist 20. Presence expires ~60s after the last write.")}
      </P>
    </DocPage>
  );
}
