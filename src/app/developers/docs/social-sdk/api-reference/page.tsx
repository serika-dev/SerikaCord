import { DocPage, P, H2, Table, InlineCode, Callout, Link2 } from "../../DocPage";
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

      <H2 id="lobbies">{gt("Lobbies (Discord-compatible)")}</H2>
      <P>
        {gt("Discord's Social SDK lobby routes live on the Discord-compatible API, under")} <InlineCode>https://api.serika.chat/api/v10</InlineCode>, {gt("not under /api/v1. They take your bot token, or a user's access token with the sdk.social_layer scope for joining, leaving, chatting, invites and channel linking.")}
      </P>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["POST / PUT", "/lobbies", gt("Create a lobby, or create or join one by secret.")],
        ["GET / PATCH / DELETE", "/lobbies/:id", gt("Read, change or delete a lobby (bot token).")],
        ["PATCH", "/lobbies/:id/channel-linking", gt("Link or unlink a server text channel.")],
        ["PUT / DELETE", "/lobbies/:id/members/:uid", gt("Add, update or remove a member (bot token).")],
        ["GET / POST", "/lobbies/:id/messages", gt("Read or send lobby messages.")],
      ]} />
      <P>
        {gt("Full object shapes, limits and differences from Discord:")} <Link2 href="/developers/docs/resources/lobby">{gt("Lobby")}</Link2>.
      </P>

      <H2 id="partner-sdk">{gt("Partner SDK (Discord-compatible)")}</H2>
      <P>
        {gt("Also under /api/v10. SerikaCord has no provisional accounts: every user signs in with a real Serika account. The token and unmerge routes still check the request like Discord does, so integrations get a clear answer instead of a missing route.")}
      </P>
      <Table headers={[gt("Method"), gt("Path"), gt("Description")]} rows={[
        ["POST", "/partner-sdk/token", gt("Checks client_id, client_secret, external_auth_type and external_auth_token, then answers 403 with code 530000.")],
        ["POST", "/partner-sdk/provisional-accounts/unmerge", gt("Same checks and the same 530000 answer.")],
        ["POST", "/partner-sdk/token/bot", gt("Bot token. Checks external_user_id, then answers 403 with code 530000.")],
        ["POST", "/partner-sdk/provisional-accounts/unmerge/bot", gt("Bot token. Same as above.")],
        ["PUT", "/partner-sdk/dms/:uid1/:uid2/messages/:mid/moderation-metadata", gt("Bot token. Store moderation metadata on a message in the 1:1 DM between two users who both authorized your app. Returns 204.")],
      ]} />
      <Callout type="info" title={gt("Error codes")}>
        {gt("A wrong client secret answers 401 with code 530007, an unknown client id 404 with code 10002, and an invalid body 400 with code 50035. 530000 means the application cannot use provisional accounts, which is true for every application on SerikaCord.")}
      </Callout>
      <P>
        {gt("DM moderation metadata takes up to 5 string keys (1 to 1024 characters) with values up to 2000 characters. It is kept per application and is not shown to users or used by SerikaCord. Any other message, or a DM where either user has not authorized your app, answers 404 Unknown Message.")}
      </P>
    </DocPage>
  );
}
