import { DocPage, P, H2, H3, CodeBlock, Callout, InlineCode, Endpoint, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Voice",
  description: "SerikaCord Voice resource: voice state object, voice state endpoints, stage speakers and requests to speak, voice channel status, soundboard playback, voice regions, and connecting bots to voice.",
  path: "/developers/docs/resources/voice",
  keywords: ["SerikaCord voice", "voice state", "voice region", "voice connection", "stage channel", "request to speak", "voice channel status", "send soundboard sound"],
});

export default async function VoiceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Voice")} description={gt("Connect to and manage voice connections via the Gateway and REST API.")}>
      <P>
        {gt("Bots join voice and stage channels with gateway op 4 and send and receive audio over Discord's voice protocol. The connection itself is described on")}{" "}
        <Link2 href="/developers/docs/topics/voice-connections">{gt("Voice Connections")}</Link2>.
      </P>
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
      <P>
        {gt("request_to_speak_timestamp is set while someone in a stage audience has their hand raised. In a stage, the audience has suppress true, and mute is also true while suppressed.")}
      </P>
      <Endpoint method="GET" path="/guilds/{guild.id}/voice-states/@me">{gt("Get the bot's own voice state. Answers 404 with 10065 (Unknown voice state) when the bot is not in a voice channel of the guild.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/voice-states/{user.id}">{gt("Get a user's voice state in a guild.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/@me">{gt("Update the bot's own voice state in a stage channel.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/voice-states/{user.id}">{gt("Update another user's voice state in a stage channel (requires")}{" "}<InlineCode>MUTE_MEMBERS</InlineCode>{")."}</Endpoint>
      <Endpoint method="GET" path="/voice/regions">{gt("List available voice regions.")}</Endpoint>

      <Endpoint method="GET" path="/guilds/{guild.id}/regions">{gt("List the voice regions of a guild.")}</Endpoint>
      <P>{gt("GET voice-states/:user_id answers 10065 when the user is not in voice, or is in a channel the bot can't see.")}</P>

      <H3 id="modify-current-user-voice-state">{gt("Modify Current User Voice State")}</H3>
      <P>{gt("Stage channels only. The bot must be in the stage; channel_id, if sent, must be that stage (10065 otherwise). In a voice channel that isn't a stage the request answers 50024. Returns 204.")}</P>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["channel_id", "snowflake", gt("The stage the bot is in")],
        ["suppress", "boolean", gt("false makes the bot a speaker and needs Mute Members; true moves it to the audience, which is always allowed")],
        ["request_to_speak_timestamp", gt("ISO8601 timestamp or null"), gt("Any time raises the bot's hand (needs Request to Speak); the server records the current time. null lowers it.")],
      ]} />

      <H3 id="modify-user-voice-state">{gt("Modify User Voice State")}</H3>
      <P>{gt("Stage channels only, and needs Mute Members. suppress false makes the user a speaker straight away; suppress true moves them to the audience. Answers 10065 when the user is not in voice and 50024 when they are not in a stage. Returns 204.")}</P>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["channel_id", "snowflake", gt("The stage the user is in")],
        ["suppress", "boolean", gt("Make the user a speaker (false) or move them to the audience (true)")],
      ]} />

      <H2 id="voice-channel-status">{gt("Voice Channel Status")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/voice-status">{gt("Set the short status line of a voice channel. Returns 204.")}</Endpoint>
      <P>
        {gt("The body is")}{" "}<InlineCode>{`{ "status": "..." }`}</InlineCode>{" "}
        {gt("with up to 500 characters; null or an empty string clears it. Only voice channels take a status (50024 otherwise). The bot needs View Channel and Set Voice Channel Status, plus Manage Channels when it isn't connected to the channel (like Discord). The status is cleared when the last person leaves the channel. Changes send VOICE_CHANNEL_STATUS_UPDATE to bots that can see the channel.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("The SerikaCord app does not show voice channel statuses yet.")}
      </Callout>

      <H2 id="send-soundboard-sound">{gt("Send Soundboard Sound")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/send-soundboard-sound">{gt("Play a soundboard sound to everyone in a voice channel. Returns 204.")}</Endpoint>
      <P>
        {gt("The body takes sound_id and, for a sound from another server, source_guild_id. Only voice channels accept it (50024 otherwise). The bot needs View Channel, Speak and Use Soundboard in the channel; a sound from another server also needs Use External Sounds, and the bot must be a member of that server. The request answers 403 when the channel's server has its soundboard turned off, and 404 (10097) for an unknown sound. Bots with the GUILD_VOICE_STATES intent receive VOICE_CHANNEL_EFFECT_SEND whenever a sound is played in a channel they can see.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Discord requires the bot to be connected to the voice channel. On SerikaCord the sound plays whether or not the bot is connected.")}
      </Callout>
      <P>
        {gt("Managing sounds is covered on the")}{" "}
        <Link2 href="/developers/docs/resources/soundboard">{gt("Soundboard")}</Link2>{" "}
        {gt("page, and stage topics on the")}{" "}
        <Link2 href="/developers/docs/resources/stage-instance">{gt("Stage Instance")}</Link2>{" "}
        {gt("page.")}
      </P>

      <H2 id="voice-regions">{gt("Voice Regions")}</H2>
      <P>{gt("There is a single voice region, serika. Bots connect to whatever endpoint VOICE_SERVER_UPDATE names.")}</P>
      <CodeBlock lang="json">{`[{ "id": "serika", "name": "Serika", "optimal": true, "deprecated": false, "custom": false }]`}</CodeBlock>

      <H2 id="events">{gt("Voice state events")}</H2>
      <P>{gt("With the GUILD_VOICE_STATES intent, bots receive VOICE_STATE_UPDATE when members join, leave, mute, deafen, turn on their camera or share their screen, when a moderator mutes, deafens or disconnects them, and when someone in a stage raises or lowers their hand or becomes a speaker or listener. GUILD_CREATE carries voice_states.")}</P>

      <H2 id="connecting">{gt("Connecting to Voice")}</H2>
      <P>
        {gt("Send op 4 with guild_id and channel_id to join a voice or stage channel; the gateway answers with VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE, whose token and endpoint open the voice WebSocket. @discordjs/voice and discord.py's VoiceClient do all of this for you. Op 4 with channel_id null leaves.")}
      </P>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Only channels whose calls run on Serika's media server take bots. Elsewhere VOICE_SERVER_UPDATE has endpoint null, which libraries treat as no voice server available. DM and group DM calls are end-to-end encrypted and never reachable by bots. There is no DAVE and no video for bots.")}
      </Callout>
      <P>
        {gt("The full flow, opcodes, close codes, encryption modes and examples are on")}{" "}
        <Link2 href="/developers/docs/topics/voice-connections">{gt("Voice Connections")}</Link2>.
      </P>
    </DocPage>
  );
}
