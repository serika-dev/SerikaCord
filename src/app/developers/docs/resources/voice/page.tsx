import { DocPage, P, H2, CodeBlock, Callout, InlineCode, Endpoint, Link2 } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Voice",
  description: "SerikaCord Voice resource: voice state object, endpoints, voice channel status, soundboard playback, voice regions, and connecting to voice via WebSocket.",
  path: "/developers/docs/resources/voice",
  keywords: ["SerikaCord voice", "voice state", "voice region", "voice connection", "voice channel status", "send soundboard sound"],
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
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/@me">{gt("Update the bot's own voice state in a stage channel.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/{user.id}">{gt("Update another user's voice state in a stage channel (requires")}{" "}<InlineCode>MUTE_MEMBERS</InlineCode>{")."}</Endpoint>
      <Endpoint method="GET" path="/voice/regions">{gt("List available voice regions.")}</Endpoint>

      <Endpoint method="GET" path="/guilds/{guild.id}/regions">{gt("List the voice regions of a guild.")}</Endpoint>
      <P>{gt("GET voice-states/@me always answers 10065 (Unknown voice state): bots never join Serika voice. PATCH voice-states/@me checks the body, then answers 10065 for the same reason. PATCH on another user's voice state answers 10065 when the user is not in voice, and otherwise 50024: Serika does not support stage speakers or requests to speak yet, so there is nothing to suppress.")}</P>

      <H2 id="voice-channel-status">{gt("Voice Channel Status")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/voice-status">{gt("Set the short status line of a voice channel. Returns 204.")}</Endpoint>
      <P>
        {gt("The body is")}{" "}<InlineCode>{`{ "status": "..." }`}</InlineCode>{" "}
        {gt("with up to 500 characters; null or an empty string clears it. Only voice channels take a status (50024 otherwise). The bot needs View Channel, Set Voice Channel Status and Manage Channels. The status is cleared when the last person leaves the channel. Changes send VOICE_CHANNEL_STATUS_UPDATE to bots that can see the channel.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Discord asks for Manage Channels only when the caller is not connected to the channel. Bots can't join SerikaCord voice, so they always need it. The SerikaCord app does not show voice channel statuses yet.")}
      </Callout>

      <H2 id="send-soundboard-sound">{gt("Send Soundboard Sound")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/send-soundboard-sound">{gt("Play a soundboard sound to everyone in a voice channel. Returns 204.")}</Endpoint>
      <P>
        {gt("The body takes sound_id and, for a sound from another server, source_guild_id. Only voice channels accept it (50024 otherwise). The bot needs View Channel, Speak and Use Soundboard in the channel; a sound from another server also needs Use External Sounds, and the bot must be a member of that server. The request answers 403 when the channel's server has its soundboard turned off, and 404 (10097) for an unknown sound. Bots with the GUILD_VOICE_STATES intent receive VOICE_CHANNEL_EFFECT_SEND whenever a sound is played in a channel they can see.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Discord requires the bot to be connected to the voice channel. Bots can't join SerikaCord voice, so the sound plays without a connection.")}
      </Callout>
      <P>
        {gt("Managing sounds is covered on the")}{" "}
        <Link2 href="/developers/docs/resources/soundboard">{gt("Soundboard")}</Link2>{" "}
        {gt("page, and stage topics on the")}{" "}
        <Link2 href="/developers/docs/resources/stage-instance">{gt("Stage Instance")}</Link2>{" "}
        {gt("page.")}
      </P>

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
