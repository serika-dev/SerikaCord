import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Link2, Table, Steps, Step } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Voice Connections",
  description:
    "Connect a SerikaCord bot to voice and stage channels: gateway op 4, the voice WebSocket, UDP IP discovery, Opus over RTP, encryption modes, receiving audio, and discord.js / discord.py examples.",
  path: "/developers/docs/topics/voice-connections",
  keywords: ["SerikaCord voice", "bot voice", "voice gateway", "@discordjs/voice", "discord.py VoiceClient", "music bot", "stage channel"],
});

export default async function VoiceConnectionsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Voice Connections")}
      description={gt("Bots join voice and stage channels and send and receive audio with Discord's voice protocol, so @discordjs/voice and discord.py's VoiceClient work unchanged.")}
    >
      <P>
        {gt("A voice connection has two parts: a voice WebSocket that handles signalling, and a UDP socket that carries Opus audio. The flow, opcodes and packet formats are Discord's (voice gateway v4 to v8), so a library that speaks Discord voice needs no changes beyond pointing its REST and gateway URLs at SerikaCord, as in the")}{" "}
        <Link2 href="/developers/docs/quick-start">{gt("Quick Start")}</Link2>.
      </P>

      <Callout type="info" title={gt("Where bots can connect")}>
        {gt("Bots can join server voice and stage channels whose calls run on Serika's media server. In a channel that still uses peer-to-peer calls, op 4 answers with the bot's voice state and VOICE_SERVER_UPDATE with endpoint null, which libraries treat as no voice server available; the bot does not appear in the channel. DM and group DM calls are end-to-end encrypted and never reachable by bots.")}
      </Callout>

      <H2 id="flow">{gt("Connecting")}</H2>
      <Steps>
        <Step n={1} title={gt("Send op 4 (Voice State Update) on the gateway")}>
          <P>
            {gt("The bot really joins: everyone in the server sees it in the channel. The same checks as for people apply: it needs Connect in the channel and room under the user limit, and without Speak it joins suppressed. If the bot can't join, there is no answer, as on Discord. Sending op 4 for another channel of the same server moves the bot.")}
          </P>
          <CodeBlock lang="json">{`{
  "op": 4,
  "d": {
    "guild_id": "41771983423143937",
    "channel_id": "127121515262115840",
    "self_mute": false,
    "self_deaf": false
  }
}`}</CodeBlock>
        </Step>
        <Step n={2} title={gt("Receive VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE")}>
          <P>
            {gt("The gateway answers with the bot's voice state (keep its session_id) and VOICE_SERVER_UPDATE with a voice token and the endpoint to connect to. Use the endpoint as given rather than hard-coding it. A new op 4 gives a new token.")}
          </P>
          <CodeBlock lang="json">{`// VOICE_SERVER_UPDATE
{
  "token": "5a1f0c3e9b7d4a2c8e6f1b3d5c7a9e0f",
  "guild_id": "41771983423143937",
  "endpoint": "voice.serika.chat:443"
}`}</CodeBlock>
        </Step>
        <Step n={3} title={gt("Open the voice WebSocket and identify")}>
          <P>
            {gt("Open a WebSocket to the endpoint with ?v=8, for example wss://voice.serika.chat/?v=8 (any path on the voice host works; v picks the protocol version, 4 by default). The server sends Hello (op 8) right away. Send Identify (op 0) with server_id, user_id, session_id and token; session_id and token must match what the gateway sent. max_dave_protocol_version is accepted and ignored.")}
          </P>
          <CodeBlock lang="json">{`{
  "op": 0,
  "d": {
    "server_id": "41771983423143937",
    "user_id": "104694319306248192",
    "session_id": "my_session_id",
    "token": "my_token",
    "max_dave_protocol_version": 0
  }
}`}</CodeBlock>
        </Step>
        <Step n={4} title={gt("Receive Ready (op 2)")}>
          <P>
            {gt("Ready carries the bot's SSRC, the UDP address and port, and the encryption modes. The ip field can be a host name rather than an IP address; UDP sockets in Node.js and Python resolve it.")}
          </P>
          <CodeBlock lang="json">{`{
  "op": 2,
  "d": {
    "ssrc": 1,
    "ip": "203.0.113.10",
    "port": 50000,
    "modes": ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"],
    "experiments": [],
    "heartbeat_interval": 13750
  }
}`}</CodeBlock>
        </Step>
        <Step n={5} title={gt("Discover your address over UDP")}>
          <P>
            {gt("Send a 74-byte IP discovery request with your SSRC to the UDP address from Ready. The answer holds the address and port the server saw, which you send back in Select Protocol.")}
          </P>
        </Step>
        <Step n={6} title={gt("Select Protocol (op 1)")}>
          <CodeBlock lang="json">{`{
  "op": 1,
  "d": {
    "protocol": "udp",
    "data": {
      "address": "203.0.113.7",
      "port": 54321,
      "mode": "aead_aes256_gcm_rtpsize"
    }
  }
}`}</CodeBlock>
        </Step>
        <Step n={7} title={gt("Receive Session Description (op 4) and send audio")}>
          <P>
            {gt("Session Description carries the 32-byte secret key. From then on, send encrypted Opus packets over UDP from the address and port you selected; the server ignores packets from anywhere else.")}
          </P>
          <CodeBlock lang="json">{`{
  "op": 4,
  "d": {
    "mode": "aead_aes256_gcm_rtpsize",
    "secret_key": [251, 100, 11, "... 32 bytes"],
    "audio_codec": "opus",
    "video_codec": null,
    "media_session_id": "89f1d62f166b948746f7646713d39dbb",
    "dave_protocol_version": 0
  }
}`}</CodeBlock>
        </Step>
      </Steps>

      <H2 id="voice-opcodes">{gt("Voice opcodes")}</H2>
      <Table headers={[gt("Opcode"), gt("Name"), gt("Sent by"), gt("Description")]} rows={[
        ["0", "Identify", gt("Client"), gt("Start a voice session: server_id, user_id, session_id, token")],
        ["1", "Select Protocol", gt("Client"), gt("protocol udp and data with your address, port and encryption mode")],
        ["2", "Ready", gt("Server"), gt("ssrc, ip, port, modes and heartbeat_interval")],
        ["3", "Heartbeat", gt("Client"), gt("Keep the connection alive (d is a nonce; in v8 an object with t and seq_ack)")],
        ["4", "Session Description", gt("Server"), gt("mode and secret_key; audio_codec opus, dave_protocol_version 0")],
        ["5", "Speaking", gt("Both"), gt("From the bot: accepted and ignored. From the server: user_id, ssrc and speaking for each person whose audio the bot is about to receive")],
        ["6", "Heartbeat ACK", gt("Server"), gt("Echoes the heartbeat nonce (in v8 as an object with t)")],
        ["7", "Resume", gt("Client"), gt("Resume a dropped connection: server_id, session_id, token")],
        ["8", "Hello", gt("Server"), gt("Sent on connect with heartbeat_interval (13,750 ms)")],
        ["9", "Resumed", gt("Server"), gt("The resume worked")],
        ["13", "Client Disconnect", gt("Server"), gt("A person the bot was hearing left, or is no longer heard (server muted or moved to a stage audience)")],
      ]} />
      <P>
        {gt("Other opcodes are ignored, including video (op 12) and the DAVE opcodes 21 to 31. Binary frames, which DAVE uses, are ignored too. In v8, op 5 and op 13 from the server carry a seq number, like Discord's.")}
      </P>

      <H3 id="heartbeat-resume">{gt("Heartbeats and resuming")}</H3>
      <P>
        {gt("Send op 3 every heartbeat_interval milliseconds. If the WebSocket drops, reconnect and send Resume (op 7) within about a minute to keep the session, key and UDP address; the server answers Resumed (op 9). After that the session is gone and Resume closes with 4006: send op 4 again for a new token.")}
      </P>

      <H2 id="voice-close-codes">{gt("Voice close codes")}</H2>
      <Table headers={[gt("Code"), gt("Description"), gt("What to do")]} rows={[
        ["4000", gt("Voice server unavailable: the media connection for the bot could not be set up"), gt("Join again later with op 4")],
        ["4002", gt("Failed to decode payload: invalid JSON, a frame over 16 KiB, or a bad address or port in Select Protocol"), gt("Fix the payload")],
        ["4004", gt("Authentication failed: unknown or expired token, or a session_id that doesn't match"), gt("Send op 4 again for a new token")],
        ["4006", gt("Session no longer valid (Resume of a session that has ended)"), gt("Send op 4 again for a new token")],
        ["4014", gt("Disconnected: the bot left the channel, was moved to another one, or was disconnected by a moderator"), gt("Don't reconnect unless you send op 4 again")],
        ["4016", gt("Unknown encryption mode, a protocol other than udp, or Select Protocol before Identify"), gt("Pick a mode from Ready")],
      ]} />

      <H2 id="udp">{gt("UDP and encryption")}</H2>
      <P>
        {gt("IP discovery packets are 74 bytes, big-endian: a type (1 for the request, 2 for the response), the length 70, your SSRC, a 64-byte null-padded address and a 2-byte port. The server only answers requests for an SSRC it handed out in Ready.")}
      </P>
      <CodeBlock lang="text">{`offset  size  field
0       2     type      (0x1 request, 0x2 response)
2       2     length    (70)
4       4     ssrc
8       64    address   (null-terminated string)
72      2     port`}</CodeBlock>
      <P>
        {gt("Audio is Opus at 48 kHz in RTP packets, encrypted with one of two modes:")}
      </P>
      <Table headers={[gt("Mode"), gt("Cipher"), gt("Nonce")]} rows={[
        ["aead_aes256_gcm_rtpsize", "AES-256-GCM", gt("4-byte counter, padded with zeros to 12 bytes")],
        ["aead_xchacha20_poly1305_rtpsize", "XChaCha20-Poly1305", gt("4-byte counter, padded with zeros to 24 bytes")],
      ]} />
      <P>
        {gt("In both modes the RTP header, including CSRCs and the 4-byte extension header if present, is authenticated but not encrypted. The extension body and the Opus payload are encrypted, and the 4-byte nonce counter is appended to the end of the packet. Packets the server sends have a plain 12-byte header (payload type 120, no extension). The older xsalsa20_poly1305 modes are not offered.")}
      </P>

      <H2 id="receiving">{gt("Receiving audio")}</H2>
      <UL>
        <li>{gt("Every person the bot hears arrives on their own SSRC. Before their first packet the server sends op 5 (Speaking) with their user_id and that SSRC, so libraries can tell speakers apart, as on Discord.")}</li>
        <li>{gt("When the bot stops hearing someone (they left, were server muted or moved to a stage audience), the server sends op 13 (Client Disconnect) with their user_id. If they are heard again, a new op 5 announces them, possibly on a new SSRC.")}</li>
        <li>{gt("A self-deafened bot (self_deaf true in op 4) receives nothing, and so does a server-deafened bot. @discordjs/voice joins self-deafened by default; pass selfDeaf: false to receive.")}</li>
        <li>{gt("Server-muted people and the stage audience are never forwarded, to bots or to people. The same applies to the bot's own audio: if it is server muted or in a stage audience, nobody hears it.")}</li>
        <li>{gt("The bot never gets its own audio back.")}</li>
      </UL>

      <H2 id="leaving">{gt("Leaving and moving")}</H2>
      <P>
        {gt("Send op 4 with channel_id null to leave. Sending op 4 with another channel of the same server moves the bot, and moderators can move or disconnect it too. In each case the old voice WebSocket closes with 4014; after a move, connect again with the new VOICE_SERVER_UPDATE. Libraries do this for you.")}
      </P>

      <H2 id="stages">{gt("Stage channels")}</H2>
      <UL>
        <li>{gt("Stage moderators (Mute Members, Move Members or Manage Channels in the stage, or Administrator) join as speakers. Everyone else, bots included, joins the audience: their voice state has suppress true (and mute true while suppressed).")}</li>
        <li>{gt("A bot raises its hand with PATCH /guilds/:guild_id/voice-states/@me and request_to_speak_timestamp (needs Request to Speak), and lowers it with null. suppress false makes it a speaker and needs Mute Members; suppress true steps down, which is always allowed.")}</li>
        <li>{gt("With Mute Members, PATCH /guilds/:guild_id/voice-states/:user_id with suppress false makes someone a speaker straight away, and suppress true moves them to the audience.")}</li>
        <li>{gt("The topic of a live stage is a stage instance, managed through /stage-instances.")}</li>
      </UL>
      <P>
        {gt("See")}{" "}<Link2 href="/developers/docs/resources/voice">{gt("Voice")}</Link2>{" "}{gt("and")}{" "}<Link2 href="/developers/docs/resources/stage-instance">{gt("Stage Instance")}</Link2>.
      </P>

      <H2 id="not-supported">{gt("Not supported")}</H2>
      <UL>
        <li>{gt("DAVE, Discord's end-to-end encryption for calls: the server answers with dave_protocol_version 0, so libraries fall back to transport encryption.")}</li>
        <li>{gt("Video and Go Live: bots can only send and receive audio.")}</li>
        <li>{gt("DM and group DM calls.")}</li>
        <li>{gt("The server never sends op 11 (Clients Connect). A bot learns about a person from op 5 when their audio starts.")}</li>
      </UL>

      <Callout type="warning" title={gt("Firewalls")}>
        {gt("The bot's host needs outbound TCP 443 to the voice endpoint and outbound UDP to the port given in Ready.")}
      </Callout>

      <H2 id="discordjs">{gt("discord.js (@discordjs/voice)")}</H2>
      <P>
        {gt("Set up discord.js as in the Quick Start, add the Guild Voice States intent, and install @discordjs/voice with an Opus library and FFmpeg, as its README describes. joinVoiceChannel sends op 4 through the client, and the rest happens inside @discordjs/voice.")}
      </P>
      <CodeBlock lang="bash">npm install discord.js @discordjs/voice @discordjs/opus ffmpeg-static</CodeBlock>
      <CodeBlock lang="javascript">{`import { Client, Events, GatewayIntentBits } from "discord.js";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  rest: {
    api: "https://api.serika.chat/api",
    cdn: "https://api.serika.chat/cdn-compat",
  },
});

client.once(Events.ClientReady, async () => {
  const channel = await client.channels.fetch(process.env.VOICE_CHANNEL_ID);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  const player = createAudioPlayer();
  connection.subscribe(player);
  player.play(createAudioResource("./song.mp3"));
  player.on(AudioPlayerStatus.Idle, () => connection.destroy());
});

client.login(process.env.BOT_TOKEN);`}</CodeBlock>
      <P>{gt("To receive audio, join with selfDeaf: false and subscribe to people when they start speaking:")}</P>
      <CodeBlock lang="javascript">{`import { EndBehaviorType, joinVoiceChannel } from "@discordjs/voice";

const connection = joinVoiceChannel({
  channelId: channel.id,
  guildId: channel.guild.id,
  adapterCreator: channel.guild.voiceAdapterCreator,
  selfDeaf: false,
});

connection.receiver.speaking.on("start", (userId) => {
  const opus = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  opus.on("data", (packet) => {
    // one Opus packet from userId
  });
});`}</CodeBlock>
      <P>
        {gt("In a stage, guild.members.me.voice.setRequestToSpeak(true) raises the bot's hand and setSuppressed(false) makes it a speaker (with Mute Members).")}
      </P>

      <H2 id="discordpy">{gt("discord.py (VoiceClient)")}</H2>
      <P>
        {gt("Keep the three overrides from the Quick Start (REST base, gateway and CDN). The voice extra installs PyNaCl, and FFmpeg must be on the PATH. Use a recent 2.x release: older ones only know the xsalsa20 modes, which SerikaCord doesn't offer.")}
      </P>
      <CodeBlock lang="bash">{`pip install -U "discord.py[voice]"`}</CodeBlock>
      <CodeBlock lang="python">{`import os

import discord
import yarl
from discord.asset import Asset
from discord.gateway import DiscordWebSocket
from discord.http import Route

Route.BASE = "https://api.serika.chat/api/v10"
DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("wss://api.serika.chat/api/v10/gateway")
Asset.BASE = "https://api.serika.chat/cdn-compat"

intents = discord.Intents.default()  # includes voice_states
client = discord.Client(intents=intents)


@client.event
async def on_ready():
    channel = client.get_channel(int(os.environ["VOICE_CHANNEL_ID"]))
    vc = await channel.connect()
    vc.play(discord.FFmpegPCMAudio("song.mp3"))


client.run(os.environ["BOT_TOKEN"])`}</CodeBlock>
      <P>
        {gt("In a stage, await guild.me.request_to_speak() raises the bot's hand and await guild.me.edit(suppress=False) makes it a speaker (with Mute Members). discord.py has no built-in API for receiving audio.")}
      </P>
    </DocPage>
  );
}
