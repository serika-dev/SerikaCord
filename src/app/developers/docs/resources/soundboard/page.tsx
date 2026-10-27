import { DocPage, P, H2, CodeBlock, Callout, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Soundboard",
  description: "SerikaCord Soundboard resource: soundboard sound object, guild soundboard endpoints, permissions, gateway events, and playing sounds in voice channels.",
  path: "/developers/docs/resources/soundboard",
  keywords: ["SerikaCord soundboard", "soundboard sound", "guild soundboard", "send soundboard sound"],
});

export default async function SoundboardDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Soundboard")} description={gt("List, upload, edit and play a server's soundboard sounds.")}>
      <P>{gt("These routes work on the same sound list as the soundboard in the SerikaCord app.")}</P>

      <H2 id="soundboard-sound-object">{gt("Soundboard Sound Object")}</H2>
      <CodeBlock lang="json">{`{
  "name": "airhorn",
  "sound_id": "1234567890",
  "volume": 1,
  "emoji_id": null,
  "emoji_name": "🔊",
  "guild_id": "1234567890",
  "available": true,
  "user": { "id": "1234567890", "username": "uploader" }
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Description")]} rows={[
        ["name", gt("2 to 32 characters.")],
        ["sound_id", gt("The sound's id.")],
        ["volume", gt("0 to 1. Playback multiplies it with the server's soundboard volume.")],
        ["emoji_id, emoji_name", gt("A custom emoji of the same server, or a unicode emoji. Only one of them is set.")],
        ["available", gt("false while the server's soundboard is turned off.")],
        ["user", gt("Who uploaded the sound. Only included for bots with Create Expressions or Manage Expressions.")],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/soundboard-default-sounds">{gt("Always an empty list: Serika has no built-in sounds.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/soundboard-sounds">{gt("List the server's sounds, as an object with an items array. Any member can list them.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/soundboard-sounds/{sound.id}">{gt("Get one sound.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/soundboard-sounds">{gt("Upload a sound. Requires Create Expressions or Manage Expressions.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/soundboard-sounds/{sound.id}">{gt("Change name, volume, emoji_id or emoji_name. Requires Manage Expressions, or Create Expressions for the bot's own sounds.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/soundboard-sounds/{sound.id}">{gt("Delete a sound. Same permissions as PATCH. Returns 204.")}</Endpoint>
      <P>
        {gt("POST takes name, sound, and optionally volume, emoji_id and emoji_name. sound is a base64 data URI of an MP3 or Ogg file of at most 512 KB, for example")}{" "}
        <InlineCode>data:audio/mpeg;base64,...</InlineCode>
        {". "}
        {gt("A server holds at most 500 sounds (30045 when full). Uploads are scanned like other media, and blocked content answers 20009. Unknown sounds answer 10097.")}
      </P>
      <P>
        {gt("Changes are recorded in the audit log (SOUNDBOARD_SOUND_CREATE 130, UPDATE 131, DELETE 132); send an X-Audit-Log-Reason header to add a reason.")}
      </P>

      <H2 id="playing-sounds">{gt("Playing Sounds")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/send-soundboard-sound">{gt("Play a sound to everyone in a voice channel. Returns 204.")}</Endpoint>
      <P>
        {gt("The body takes sound_id and, for a sound from another server, source_guild_id. The bot needs View Channel, Speak and Use Soundboard in the channel, plus Use External Sounds and membership in the other server for an external sound. See")}{" "}
        <Link2 href="/developers/docs/resources/voice#send-soundboard-sound">{gt("Voice")}</Link2>
        {"."}
      </P>

      <H2 id="gateway-events">{gt("Gateway Events")}</H2>
      <Table headers={[gt("Event"), gt("When")]} rows={[
        ["GUILD_SOUNDBOARD_SOUND_CREATE", gt("A sound was added.")],
        ["GUILD_SOUNDBOARD_SOUND_UPDATE", gt("A sound was edited.")],
        ["GUILD_SOUNDBOARD_SOUND_DELETE", gt("A sound was deleted (sound_id and guild_id).")],
        ["GUILD_SOUNDBOARD_SOUNDS_UPDATE", gt("The server's soundboard settings changed, for example it was turned on or off. Carries every sound.")],
        ["SOUNDBOARD_SOUNDS", gt("The answer to gateway op 31.")],
        ["VOICE_CHANNEL_EFFECT_SEND", gt("Someone played a sound in a voice channel.")],
      ]} />
      <P>
        {gt("The sound events need the GUILD_EXPRESSIONS intent (1 << 3), and VOICE_CHANNEL_EFFECT_SEND needs GUILD_VOICE_STATES (1 << 7). GUILD_CREATE carries soundboard_sounds. Gateway op 31 (Request Soundboard Sounds) takes up to 100 guild_ids and answers SOUNDBOARD_SOUNDS once for each of the session's guilds in the list.")}
      </P>

      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("There are no default sounds. Bots can play sounds without joining voice, since bots can't join SerikaCord voice.")}
      </Callout>
    </DocPage>
  );
}
