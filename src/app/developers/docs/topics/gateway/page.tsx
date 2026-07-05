import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";

export default function GatewayDoc() {
  return (
    <DocPage title="Gateway" description="Connect to the SerikaCord Gateway via WebSocket to receive real-time events.">
      <H2 id="connecting">Connecting to the Gateway</H2>
      <P>The Gateway URL is:</P>
      <CodeBlock lang="bash">wss://api.serika.chat/api/v10/gateway</CodeBlock>
      <P>You can also retrieve it dynamically:</P>
      <CodeBlock lang="bash">{`GET https://api.serika.chat/api/v10/gateway
# Response: { "url": "wss://api.serika.chat/api/v10/gateway" }`}</CodeBlock>

      <H2 id="connection-flow">Connection Flow</H2>
      <UL>
        <li>1. Open WebSocket connection to the Gateway URL</li>
        <li>2. Receive <InlineCode>Hello</InlineCode> (opcode 10) with heartbeat interval</li>
        <li>3. Send <InlineCode>Identify</InlineCode> (opcode 2) with your bot token</li>
        <li>4. Receive <InlineCode>Ready</InlineCode> event (opcode 0, event name "READY")</li>
        <li>5. Send heartbeats (opcode 1) at the specified interval</li>
        <li>6. Receive events (opcode 0) as they occur</li>
      </UL>

      <H2 id="identify">Identify Payload</H2>
      <CodeBlock lang="json">{`{
  "op": 2,
  "d": {
    "token": "YOUR_BOT_TOKEN",
    "intents": 513,
    "properties": {
      "os": "linux",
      "browser": "my_bot",
      "device": "my_bot"
    }
  }
}`}</CodeBlock>

      <H2 id="intents">Gateway Intents</H2>
      <P>Intents are bitwise flags that determine which events your bot receives:</P>
      <Table headers={["Bit", "Intent", "Events"]} rows={[
        ["1 << 0", "GUILDS", "GUILD_CREATE, GUILD_UPDATE, GUILD_DELETE, etc."],
        ["1 << 1", "GUILD_MEMBERS", "GUILD_MEMBER_ADD, UPDATE, REMOVE (privileged)"],
        ["1 << 2", "GUILD_MODERATION", "GUILD_BAN_ADD, GUILD_BAN_REMOVE"],
        ["1 << 3", "GUILD_EMOJIS_AND_STICKERS", "GUILD_EMOJIS_UPDATE, STICKERS_UPDATE"],
        ["1 << 4", "GUILD_INTEGRATIONS", "GUILD_INTEGRATIONS_UPDATE"],
        ["1 << 5", "GUILD_WEBHOOKS", "WEBHOOKS_UPDATE"],
        ["1 << 6", "GUILD_INVITES", "INVITE_CREATE, INVITE_DELETE"],
        ["1 << 7", "GUILD_VOICE_STATES", "VOICE_STATE_UPDATE"],
        ["1 << 8", "GUILD_PRESENCES", "PRESENCE_UPDATE (privileged)"],
        ["1 << 9", "GUILD_MESSAGES", "MESSAGE_CREATE, UPDATE, DELETE"],
        ["1 << 10", "GUILD_MESSAGE_REACTIONS", "MESSAGE_REACTION_ADD, etc."],
        ["1 << 11", "GUILD_MESSAGE_TYPING", "TYPING_START"],
        ["1 << 12", "DIRECT_MESSAGES", "DM message events"],
        ["1 << 13", "DIRECT_MESSAGE_REACTIONS", "DM reaction events"],
        ["1 << 14", "DIRECT_MESSAGE_TYPING", "DM typing events"],
        ["1 << 15", "MESSAGE_CONTENT", "Access message content (privileged)"],
        ["1 << 16", "GUILD_SCHEDULED_EVENTS", "Scheduled event events"],
        ["1 << 17", "AUTO_MODERATION_CONFIGURATION", "Auto mod rule events"],
        ["1 << 18", "AUTO_MODERATION_EXECUTION", "Auto mod action events"],
      ]} />

      <Callout type="warning" title="Privileged Intents">
        <InlineCode>GUILD_PRESENCES</InlineCode>, <InlineCode>GUILD_MEMBERS</InlineCode>, and{" "}
        <InlineCode>MESSAGE_CONTENT</InlineCode> are privileged intents. They must be enabled in the
        Developer Portal and may require verification for bots in 100+ servers.
      </Callout>

      <H2 id="heartbeat">Heartbeat</H2>
      <P>
        Send a heartbeat (opcode 1) at the interval specified in the Hello payload. The payload is
        the last sequence number you received, or <InlineCode>null</InlineCode> if none:
      </P>
      <CodeBlock lang="json">{`{ "op": 1, "d": 42 }`}</CodeBlock>
      <P>The server responds with <InlineCode>Heartbeat ACK</InlineCode> (opcode 11).</P>

      <H2 id="resuming">Resuming Sessions</H2>
      <P>If your connection drops, you can resume to receive missed events:</P>
      <CodeBlock lang="json">{`{
  "op": 6,
  "d": {
    "token": "YOUR_BOT_TOKEN",
    "session_id": "SESSION_ID",
    "seq": 42
  }
}`}</CodeBlock>

      <H2 id="sharding">Sharding</H2>
      <P>
        For bots in many guilds, use sharding to split the WebSocket load. Each shard handles a subset
        of guilds. The number of shards is calculated as:
      </P>
      <CodeBlock lang="text">{`shard_id = (guild_id >> 22) % num_shards`}</CodeBlock>
      <P>Specify shards in the Identify payload:</P>
      <CodeBlock lang="json">{`"shard": [0, 1]  // shard 0 of 1`}</CodeBlock>

      <H2 id="key-events">Key Events</H2>
      <UL>
        <li><Strong>READY</Strong> — Initial connection established, provides session_id</li>
        <li><Strong>MESSAGE_CREATE</Strong> — A message was sent</li>
        <li><Strong>MESSAGE_UPDATE</Strong> — A message was edited</li>
        <li><Strong>MESSAGE_DELETE</Strong> — A message was deleted</li>
        <li><Strong>GUILD_CREATE</Strong> — A guild became available</li>
        <li><Strong>INTERACTION_CREATE</Strong> — A slash command or interaction occurred</li>
        <li><Strong>PRESENCE_UPDATE</Strong> — A user's presence changed</li>
        <li><Strong>VOICE_STATE_UPDATE</Strong> — A user joined/left voice</li>
      </UL>

      <H2 id="encoding">Encoding & Compression</H2>
      <P>
        The Gateway supports <InlineCode>json</InlineCode> (default) and <InlineCode>etf</InlineCode>{" "}
        (Erlang Term Format) encodings. You can also enable payload compression with{" "}
        <InlineCode>compress=true</InlineCode> in the URL query string.
      </P>
    </DocPage>
  );
}
