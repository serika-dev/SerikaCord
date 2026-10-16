import { DocPage, P, H2, CodeBlock, Callout, InlineCode, Endpoint } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Voice",
  description: "SerikaCord Voice resource: voice state object, endpoints, voice regions, and connecting to voice via WebSocket.",
  path: "/developers/docs/resources/voice",
  keywords: ["SerikaCord voice", "voice state", "voice region", "voice connection"],
});

export default async function VoiceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Voice")} description={gt("Connect to and manage voice connections via the Gateway and REST API.")}>
      <H2 id="voice-states">{gt("Voice State Object")}</H2>
      <CodeBlock lang="json">{`{
  "guild_id": "1234567890",
  "channel_id": "1234567890",
  "user_id": "1234567890",
  "session_id": "abc123",
  "deaf": false,
  "mute": false,
  "self_deaf": false,
  "self_mute": false,
  "self_stream": false,
  "self_video": false,
  "suppress": false,
  "request_to_speak_timestamp": null
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/voice-states/{user.id}">{gt("Get a user's voice state in a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/@me">{gt("Update own voice state (requires")}{" "}<InlineCode>CONNECT</InlineCode>{")."}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/{user.id}">{gt("Update another user's voice state (requires")}{" "}<InlineCode>MUTE_MEMBERS</InlineCode> {gt("/")}{" "}<InlineCode>MOVE_MEMBERS</InlineCode>{")."}</Endpoint>
      <Endpoint method="GET" path="/voice/regions">{gt("List available voice regions.")}</Endpoint>

      <Endpoint method="GET" path="/guilds/{guild.id}/regions">{gt("List the voice regions of a guild.")}</Endpoint>
      <P>{gt("GET voice-states/@me always answers 10065 (Unknown voice state): bots never join Serika voice. Both PATCH routes answer 50024 for members in voice, because Serika has no stage channels yet.")}</P>

      <H2 id="voice-regions">{gt("Voice Regions")}</H2>
      <P>{gt("Serika voice is a peer-to-peer mesh, so there is a single region:")}</P>
      <CodeBlock lang="json">{`[{ "id": "serika", "name": "SerikaCord (peer-to-peer)", "optimal": true, "deprecated": false, "custom": false }]`}</CodeBlock>

      <H2 id="events">{gt("Voice state events")}</H2>
      <P>{gt("With the GUILD_VOICE_STATES intent, bots receive VOICE_STATE_UPDATE when members join, leave, mute, deafen, turn on their camera or share their screen, and when a moderator mutes, deafens or disconnects them. GUILD_CREATE carries voice_states.")}</P>

      <H2 id="connecting">{gt("Connecting to Voice")}</H2>
      <Callout type="warning" title={gt("Bots can't send or receive audio yet")}>
        {gt("Discord's voice protocol (voice WebSocket, UDP, Opus) isn't available. When a bot sends op 4 to join a channel, the gateway answers with the bot's voice state and VOICE_SERVER_UPDATE with endpoint null, which libraries treat as no voice server available, so the join stops instead of hanging.")}
      </Callout>
    </DocPage>
  );
}
