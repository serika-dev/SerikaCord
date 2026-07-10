import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Gateway",
  description:
    "SerikaCord Gateway protocol: WebSocket connection, opcodes, heartbeats, identify, resume, intents, dispatch events, and sharding.",
  path: "/developers/docs/topics/gateway",
  keywords: ["SerikaCord gateway", "WebSocket", "opcodes", "heartbeat", "intents", "real-time events"],
});

export default async function GatewayDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Gateway")} description={gt("Connect to the SerikaCord Gateway via WebSocket to receive real-time events. Full protocol reference with opcodes, heartbeats, intents, and dispatch routing.")}>
      <P>
        {gt("The Gateway is a persistent WebSocket connection that streams real-time events to your bot. It uses the Discord v10 Gateway protocol. The heartbeat interval is")}{" "}
        <Strong>{gt("41,250 ms")}</Strong> ({gt("41.25 seconds")}).
      </P>

      <H2 id="connecting">{gt("Connecting to the Gateway")}</H2>
      <P>{gt("The Gateway URL is:")}</P>
      <CodeBlock lang="bash">wss://api.serika.chat/api/v10/gateway</CodeBlock>
      <P>{gt("You can also retrieve it dynamically via REST:")}</P>
      <CodeBlock lang="bash">{`GET https://api.serika.chat/api/v10/gateway
# Response: { "url": "wss://api.serika.chat/api/v10/gateway" }`}</CodeBlock>

      <H2 id="connection-flow">{gt("Connection Flow")}</H2>
      <P>{gt("After opening the WebSocket, follow this sequence:")}</P>
      <UL>
        <li><Strong>1.</Strong> {gt("Open WebSocket connection to the Gateway URL")}</li>
        <li><Strong>2.</Strong> {gt("Receive")} <InlineCode>Hello</InlineCode> {gt("(op 10) with")} <InlineCode>heartbeat_interval: 41250</InlineCode></li>
        <li><Strong>3.</Strong> {gt("Send")} <InlineCode>Identify</InlineCode> {gt("(op 2) with your bot token and intents")}</li>
        <li><Strong>4.</Strong> {gt("Receive")} <InlineCode>Ready</InlineCode> {gt("dispatch (op 0, event")} <InlineCode>READY</InlineCode>{gt(") with session_id, user, guilds")}</li>
        <li><Strong>5.</Strong> {gt("Send")} <InlineCode>Heartbeat</InlineCode> {gt("(op 1) every 41,250 ms")}</li>
        <li><Strong>6.</Strong> {gt("Receive")} <InlineCode>Heartbeat ACK</InlineCode> {gt("(op 11) after each heartbeat")}</li>
        <li><Strong>7.</Strong> {gt("Receive dispatch events (op 0) as they occur")}</li>
      </UL>

      <H2 id="opcodes">{gt("Opcodes")}</H2>
      <Table headers={[gt("Opcode"), gt("Name"), gt("Direction"), gt("Description")]} rows={[
        ["0", "Dispatch", "Server→Client", gt("Dispatches an event (MESSAGE_CREATE, READY, etc.)")],
        ["1", "Heartbeat", "Client→Server", gt("Maintains connection — send every heartbeat_interval ms")],
        ["2", "Identify", "Client→Server", gt("Initial authentication with token and intents")],
        ["3", "Presence Update", "Client→Server", gt("Update the bot's presence (not fully implemented)")],
        ["4", "Voice State Update", "Client→Server", gt("Join/leave a voice channel")],
        ["5", "Resume", "Client→Server", gt("Resume a disconnected session to receive missed events")],
        ["6", "Reconnect", "Server→Client", gt("Server requests you to reconnect (not currently sent)")],
        ["7", "Request Guild Members", "Client→Server", gt("Request guild member info (not currently implemented)")],
        ["8", "Invalid Session", "Server→Client", gt("Session invalidated — must re-identify, not resume")],
        ["9", "Hello", "Server→Client", gt("Sent on connect — contains heartbeat_interval")],
        ["10", "Heartbeat ACK", "Server→Client", gt("Acknowledges a heartbeat — connection is healthy")],
        ["11", "Request Soundboard Sounds", "Client→Server", gt("Request soundboard sounds (not implemented)")],
      ]} />
      <Callout type="info" title={gt("Opcode numbering")}>
        {gt("SerikaCord uses the same opcode numbers as Discord v10. The")} <InlineCode>Hello</InlineCode> {gt("opcode is")} <InlineCode>10</InlineCode> {gt("and")} <InlineCode>Heartbeat ACK</InlineCode> {gt("is")}{" "}
        <InlineCode>11</InlineCode>, {gt("matching the Discord protocol.")}
      </Callout>

      <H2 id="frame-format">{gt("Frame Format")}</H2>
      <P>{gt("Every Gateway frame is a JSON object with this structure:")}</P>
      <CodeBlock lang="json">{`{
  "op": 0,       // opcode (integer)
  "d": {},       // payload data (object or null)
  "s": 42,       // sequence number (only for DISPATCH, null otherwise)
  "t": "MESSAGE_CREATE"  // event name (only for DISPATCH, null otherwise)
}`}</CodeBlock>

      <H2 id="hello">{gt("Hello (op 10)")}</H2>
      <P>{gt("Sent immediately after the WebSocket connects:")}</P>
      <CodeBlock lang="json">{`{
  "op": 10,
  "d": {
    "heartbeat_interval": 41250
  }
}`}</CodeBlock>

      <H2 id="identify">{gt("Identify (op 2)")}</H2>
      <P>{gt("Authenticate your bot. Send this after receiving Hello:")}</P>
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
      <P>
        {gt("The token can be prefixed with")} <InlineCode>Bot </InlineCode> {gt("or sent bare — both are accepted. On success, the server sends a")} <InlineCode>READY</InlineCode> {gt("dispatch event. On failure, it sends")} <InlineCode>Invalid Session</InlineCode> {gt("(op 8) and closes with code")}{" "}
        <InlineCode>4004</InlineCode>.
      </P>
      <Callout type="warning" title={gt("Identify is one-time")}>
        {gt("You can only identify once per connection. Sending")} <InlineCode>IDENTIFY</InlineCode> {gt("again on an already-authenticated connection is silently ignored.")}
      </Callout>

      <H2 id="ready">{gt("Ready Event")}</H2>
      <P>{gt("After a successful identify, you receive the")} <InlineCode>READY</InlineCode> {gt("dispatch:")}</P>
      <CodeBlock lang="json">{`{
  "op": 0,
  "t": "READY",
  "s": 1,
  "d": {
    "v": 10,
    "user": {
      "id": "1234567890",
      "username": "MyBot",
      "global_name": "MyBot",
      "avatar": null,
      "bot": true,
      "discriminator": "0",
      "verified": true,
      "flags": 0
    },
    "guilds": [
      { "id": "guild_id", "unavailable": true }
    ],
    "session_id": "unique_session_id",
    "resume_gateway_url": "wss://api.serika.chat/api/v10/gateway",
    "application": {
      "id": "app_id",
      "flags": 0
    }
  }
}`}</CodeBlock>
      <P>
        {gt("The")} <InlineCode>guilds</InlineCode> {gt("array contains all guilds the bot is a member of, marked as")}{" "}
        <InlineCode>unavailable: true</InlineCode>. {gt("Guild data is fetched via REST or arrives as")}{" "}
        <InlineCode>GUILD_CREATE</InlineCode> {gt("dispatches.")}
      </P>

      <H2 id="intents">{gt("Gateway Intents")}</H2>
      <P>{gt("Intents are bitwise flags that determine which events your bot receives:")}</P>
      <Table headers={[gt("Bit"), gt("Intent"), gt("Events")]} rows={[
        ["1 << 0", "GUILDS", "GUILD_CREATE, GUILD_UPDATE, GUILD_DELETE"],
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
      <Callout type="warning" title={gt("Privileged Intents")}>
        <InlineCode>GUILD_PRESENCES</InlineCode>, <InlineCode>GUILD_MEMBERS</InlineCode>, {gt("and")}{" "}
        <InlineCode>MESSAGE_CONTENT</InlineCode> {gt("are privileged. They must be enabled in the")}{" "}
        <Link2 href="/developers/applications">{gt("Developer Portal")}</Link2> {gt("and may require")}{" "}
        <Link2 href="/developers/docs/topics/bot-verification">{gt("verification")}</Link2> {gt("for bots in 100+ servers.")}
      </Callout>

      <H2 id="heartbeat">{gt("Heartbeat (op 1)")}</H2>
      <P>
        {gt("Send a heartbeat every")} <InlineCode>heartbeat_interval</InlineCode> {gt("ms (41,250 ms). The payload is the last sequence number you received, or")} <InlineCode>null</InlineCode> {gt("if none:")}
      </P>
      <CodeBlock lang="json">{`{ "op": 1, "d": 42 }`}</CodeBlock>
      <P>{gt("The server responds with")} <InlineCode>Heartbeat ACK</InlineCode> {gt("(op 11):")}</P>
      <CodeBlock lang="json">{`{ "op": 11, "d": null }`}</CodeBlock>
      <Callout type="danger" title={gt("Heartbeat timeout")}>
        {gt("If you don't send heartbeats, the server will eventually close your connection. Always start the heartbeat timer immediately after receiving")} <InlineCode>Hello</InlineCode>, {gt("and reset it each time you send a heartbeat.")}
      </Callout>

      <H2 id="resuming">{gt("Resuming Sessions (op 5)")}</H2>
      <P>{gt("If your connection drops, you can resume to receive missed events:")}</P>
      <CodeBlock lang="json">{`{
  "op": 6,
  "d": {
    "token": "YOUR_BOT_TOKEN",
    "session_id": "SESSION_ID_FROM_READY",
    "seq": 42
  }
}`}</CodeBlock>
      <P>
        {gt("On success, the server sends a")} <InlineCode>RESUMED</InlineCode> {gt("dispatch event. The current implementation sends an empty payload with the")} <InlineCode>RESUMED</InlineCode> {gt("type and increments the sequence number.")}
      </P>

      <H2 id="dispatch-routing">{gt("Dispatch Routing")}</H2>
      <P>
        {gt("When the server dispatches an event, it filters which connections receive it based on:")}
      </P>
      <UL>
        <li><Strong>{gt("Authentication")}</Strong> — {gt("only authenticated connections receive events")}</li>
        <li><Strong>{gt("Target bot ID")}</Strong> — {gt("if the dispatch targets a specific bot, only that bot receives it")}</li>
        <li><Strong>{gt("Intents")}</Strong> — {gt("if the dispatch has an intent flag, only bots with that intent receive it")}</li>
        <li><Strong>{gt("Guild membership")}</Strong> — {gt("guild-scoped events only go to bots in that guild")}</li>
        <li><Strong>{gt("DM channel access")}</Strong> — {gt("DM events only go to bots that are recipients of that channel")}</li>
        <li><Strong>{gt("Self-message suppression")}</Strong> — <InlineCode>MESSAGE_CREATE</InlineCode> {gt("events are not sent to the bot that authored the message")}</li>
      </UL>
      <P>
        {gt("When a bot joins a guild (via")} <InlineCode>GUILD_MEMBER_ADD</InlineCode> {gt("where the user is the bot, or")} <InlineCode>GUILD_CREATE</InlineCode> {gt("targeting the bot), the guild ID is dynamically added to the connection's guild set.")}
      </P>

      <H2 id="close-codes">{gt("Close Codes")}</H2>
      <Table headers={[gt("Code"), gt("Description"), gt("Can Resume?")]} rows={[
        ["4000", gt("Unknown error"), gt("Yes")],
        ["4001", gt("Unknown opcode"), gt("Yes")],
        ["4002", gt("Decode error (invalid JSON)"), gt("Yes")],
        ["4003", gt("Not authenticated"), gt("Yes")],
        ["4004", gt("Authentication failed (bad token)"), gt("No")],
        ["4005", gt("Already authenticated"), gt("Yes")],
        ["4007", gt("Invalid seq"), gt("Yes")],
        ["4008", gt("Rate limited"), gt("Yes")],
        ["4009", gt("Session timed out"), gt("Yes")],
        ["4010", gt("Invalid shard"), gt("No")],
        ["4011", gt("Sharding required"), gt("No")],
        ["4012", gt("Invalid API version"), gt("No")],
        ["4013", gt("Invalid intent(s)"), gt("No")],
        ["4014", gt("Disallowed intent(s)"), gt("No")],
      ]} />

      <H2 id="key-events">{gt("Key Dispatch Events")}</H2>
      <Table headers={[gt("Event"), gt("Intent"), gt("Description")]} rows={[
        ["READY", "—", gt("Initial connection established, provides session_id and user")],
        ["RESUMED", "—", gt("Session resumed after reconnect")],
        ["MESSAGE_CREATE", "GUILD_MESSAGES (1<<9)", gt("A message was sent in a guild channel")],
        ["MESSAGE_UPDATE", "GUILD_MESSAGES (1<<9)", gt("A message was edited")],
        ["MESSAGE_DELETE", "GUILD_MESSAGES (1<<9)", gt("A message was deleted")],
        ["GUILD_CREATE", "GUILDS (1<<0)", gt("A guild became available or bot joined")],
        ["GUILD_MEMBER_ADD", "GUILD_MEMBERS (1<<1)", gt("A new member joined a guild (privileged)")],
        ["INTERACTION_CREATE", "—", gt("A slash command or interaction occurred")],
        ["PRESENCE_UPDATE", "GUILD_PRESENCES (1<<8)", gt("A user's presence changed (privileged)")],
        ["VOICE_STATE_UPDATE", "GUILD_VOICE_STATES (1<<7)", gt("A user joined/left voice")],
      ]} />

      <H2 id="sharding">{gt("Sharding")}</H2>
      <P>
        {gt("For bots in many guilds, use sharding to split the WebSocket load. Each shard handles a subset of guilds. The number of shards is calculated as:")}
      </P>
      <CodeBlock lang="text">{`shard_id = (guild_id >> 22) % num_shards`}</CodeBlock>
      <P>{gt("Specify shards in the Identify payload:")}</P>
      <CodeBlock lang="json">{`"shard": [0, 1]  // shard 0 of 1`}</CodeBlock>

      <H2 id="encoding">{gt("Encoding & Compression")}</H2>
      <P>
        {gt("The Gateway supports")} <InlineCode>json</InlineCode> {gt("(default) encoding. All frames are sent as JSON text messages. The")} <InlineCode>etf</InlineCode> {gt("(Erlang Term Format) encoding is not currently supported.")}
      </P>

      <H2 id="standalone-gateway">{gt("Standalone Gateway (Horizontal Scaling)")}</H2>
      <P>
        {gt("For production deployments, SerikaCord supports a standalone Gateway server via")}{" "}
        <InlineCode>scripts/gateway.ts</InlineCode>. {gt("This runs a dedicated Bun.serve WebSocket server that connects to MongoDB and subscribes to Redis for cross-instance event fan-out. This allows you to scale the Gateway independently from the web app.")}
      </P>
      <Callout type="info" title={gt("Redis fan-out")}>
        {gt("In multi-instance deployments, events are published to Redis and fanned out to all Gateway instances. Each instance routes events only to the bot connections it holds. A Redis-based leadership lock (")}
        <InlineCode>serikacord:discord-bot-lock</InlineCode>{gt(") ensures only one instance runs the Discord bot connection to avoid duplicate event processing.")}
      </Callout>
    </DocPage>
  );
}
