import { DocPage, P, H2, UL, CodeBlock, Callout, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Differences from Discord",
  description:
    "Where the SerikaCord bot API behaves differently from Discord API v10: ids, voice, CDN, OAuth2, presence, monetization and limits.",
  path: "/developers/docs/topics/differences",
  keywords: ["SerikaCord vs Discord", "Discord API differences", "bot compatibility", "discord.js", "discord.py"],
});

export default async function DifferencesDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Differences from Discord")}
      description={gt("SerikaCord follows Discord API v10. This page lists everything a Discord bot developer should know that works differently.")}
    >
      <P>
        {gt("For a route-by-route list, see the")}{" "}<Link2 href="/developers/docs/topics/compatibility">{gt("compatibility table")}</Link2>.
      </P>

      <H2 id="ids">{gt("Ids")}</H2>
      <P>
        {gt("New applications see Discord-style numeric ids (snowflakes) and Discord image hashes. Applications created before snowflake ids existed keep seeing UUIDs and full image URLs until their owner switches Developer Portal -> your app -> Bot -> Discord-style ids on. Switching changes every id the bot sees, so ids it stored earlier no longer match. Requests accept both forms.")}
      </P>

      <H2 id="cdn">{gt("Images and the CDN")}</H2>
      <P>
        {gt("Avatars, server icons, banners, role icons, emojis and stickers live on cdn.serika.chat. Discord-style apps get image hashes, and these Discord CDN paths redirect to the real file:")}
      </P>
      <CodeBlock lang="text">{`https://api.serika.chat/cdn-compat/avatars/{user.id}/{hash}.png?size=256
https://api.serika.chat/cdn-compat/icons/{guild.id}/{hash}.webp
https://api.serika.chat/cdn-compat/banners/{id}/{hash}.png
https://api.serika.chat/cdn-compat/splashes/{guild.id}/{hash}.png
https://api.serika.chat/cdn-compat/role-icons/{role.id}/{hash}.png
https://api.serika.chat/cdn-compat/app-icons/{application.id}/{hash}.png
https://api.serika.chat/cdn-compat/guilds/{guild.id}/users/{user.id}/avatars/{hash}.png
https://api.serika.chat/cdn-compat/emojis/{emoji.id}.gif
https://api.serika.chat/cdn-compat/stickers/{sticker.id}.png
https://api.serika.chat/cdn-compat/embed/avatars/0.png`}</CodeBlock>
      <P>
        {gt("Set the library's CDN base to https://api.serika.chat/cdn-compat: rest.cdn in discord.js, discord.asset.Asset.BASE in discord.py. size (16-4096, a power of two) and the png, jpg, webp and gif extensions work; a_ hashes are animated. Images hosted elsewhere (for example a Discord-bridged avatar) come back as null, so libraries show a default avatar. Message attachments keep their full URLs, like on Discord.")}
      </P>

      <H2 id="voice">{gt("Voice")}</H2>
      <P>
        {gt("Serika voice is peer-to-peer between browsers, so bots can't send or receive audio yet. Bots do see who is in which voice channel: VOICE_STATE_UPDATE events (GUILD_VOICE_STATES intent), voice_states in GUILD_CREATE and GET /guilds/:guild_id/voice-states/:user_id.")}
      </P>
      <UL>
        <li>{gt("Op 4 (join voice) is answered with your bot's voice state and VOICE_SERVER_UPDATE with endpoint null, which libraries treat as \"no voice server available\". discord.js voice and discord.py VoiceClient joins then stop with a timeout instead of hanging.")}</li>
        <li>{gt("There is a single voice region, serika. Stage speaker controls (suppress, request to speak) return 50024 because Serika has no stage channels yet.")}</li>
        <li>{gt("Soundboard routes return empty lists.")}</li>
      </UL>

      <H2 id="presence">{gt("Presence")}</H2>
      <P>
        {gt("Op 3 presence updates work: your bot's status and its activity (\"Playing ...\", \"Listening to ...\", custom status) show on its profile in SerikaCord. Bots with the GUILD_PRESENCES intent receive PRESENCE_UPDATE for members of shared servers and presences in GUILD_CREATE. Users who hide their activity are sent without activities; invisible users are sent as offline.")}
      </P>

      <H2 id="oauth2">{gt("OAuth2")}</H2>
      <UL>
        <li>{gt("Access tokens work only on the routes Discord allows them on (see OAuth2 -> Where access tokens work).")}</li>
        <li>{gt("There is no OpenID Connect yet (/oauth2/userinfo and /oauth2/keys), no linked roles and no group DM creation (gdm.join).")}</li>
        <li>{gt("client_credentials tokens act as the application's owner and only get identify and the applications.commands scopes (Discord allows more).")}</li>
      </UL>

      <H2 id="users">{gt("Users and DMs")}</H2>
      <UL>
        <li>{gt("Usernames are unique handles: PATCH /users/@me takes 2-32 lower-case letters, digits, underscores and periods. Two username changes per hour.")}</li>
        <li>{gt("A bot can open a DM only with someone who shares a server with it or already has a DM with it, who hasn't blocked it and who accepts DMs from non-friends. Bots can't DM other bots. Otherwise POST /users/@me/channels answers 50007.")}</li>
        <li>{gt("Users have no discriminators (always \"0\"), like Discord's new usernames.")}</li>
      </UL>

      <H2 id="monetization">{gt("Monetization")}</H2>
      <P>
        {gt("SerikaCord has no app payments. SKU, entitlement and subscription lists are always empty, single lookups answer 404 (10027 Unknown SKU, 10029 Unknown entitlement), and there are no entitlement events.")}
      </P>

      <H2 id="libraries">{gt("Library notes")}</H2>
      <Table headers={[gt("Library"), gt("Note")]} rows={[
        ["discord.py", gt("Set Route.BASE, DiscordWebSocket.DEFAULT_GATEWAY and Asset.BASE. Without DEFAULT_GATEWAY it connects to Discord's gateway with your token.")],
        ["discord.js", gt("Set rest.api and rest.cdn. The gateway URL comes from GET /gateway/bot.")],
        ["JDA, Serenity, DSharpPlus", gt("Not tested yet. They need Discord-style ids, the default for new applications.")],
      ]} />
      <Callout type="info" title={gt("Found a difference that isn't listed?")}>
        {gt("Report it from User Settings -> Report a Bug and include the route, the request body and the response.")}{" "}
        <InlineCode>X-RateLimit-*</InlineCode> {gt("headers and error codes follow Discord; see")}{" "}<Link2 href="/developers/docs/topics/rate-limits">{gt("Rate Limits")}</Link2>.
      </Callout>
    </DocPage>
  );
}
