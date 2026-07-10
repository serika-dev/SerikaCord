import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
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

      <H2 id="voice-regions">{gt("Voice Regions")}</H2>
      <CodeBlock lang="json">{`{
  "id": "us-west",
  "name": "US West",
  "optimal": false,
  "deprecated": false,
  "custom": false
}`}</CodeBlock>

      <H2 id="connecting">{gt("Connecting to Voice")}</H2>
      <P>{gt("Voice connections require a separate WebSocket connection:")}</P>
      <UL>
        <li>{gt("1. Send")}{" "}<InlineCode>VOICE_STATE_UPDATE</InlineCode> {gt("via main Gateway")}</li>
        <li>{gt("2. Receive")}{" "}<InlineCode>VOICE_STATE_UPDATE</InlineCode> {gt("with session_id and")}{" "}<InlineCode>VOICE_SERVER_UPDATE</InlineCode> {gt("with endpoint + token")}</li>
        <li>{gt("3. Connect to the voice WebSocket at")}{" "}<InlineCode>wss://VOICE_ENDPOINT/?v=8</InlineCode></li>
        <li>{gt("4. Identify with server_id, user_id, session_id, and token")}</li>
        <li>{gt("5. Select a voice protocol and encrypt audio")}</li>
      </UL>

      <Callout type="warning" title={gt("Voice Complexity")}>
        {gt("Voice connections are complex and require UDP for audio transport. Use a library like")}{" "}
        <InlineCode>serika.js/voice</InlineCode> {gt("or")}{" "}<InlineCode>serika.py/voice</InlineCode> {gt("for easier implementation.")}
      </Callout>
    </DocPage>
  );
}
