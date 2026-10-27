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
# Response: { "url": "wss://api.serika.chat/api/v10/gateway" }

GET https://api.serika.chat/api/v10/gateway/bot   (Authorization: Bot <token>)
# Response:
# {
#   "url": "wss://api.serika.chat/api/v10/gateway",
#   "shards": 1,
#   "session_start_limit": { "total": 1000, "remaining": 998, "reset_after": 81234567, "max_concurrency": 1 }
# }`}</CodeBlock>
      <P>
        <InlineCode>GET /gateway/bot</InlineCode> {gt("recommends one shard per 1,000 guilds the bot is in, and session_start_limit shows how many IDENTIFYs the bot has left today (it reads the real counter without using one up).")}
      </P>
      <P>
        {gt("Query parameters on the gateway URL work like Discord's:")} <InlineCode>v=10</InlineCode> {gt("(9 is also accepted; anything else closes with 4012),")} <InlineCode>encoding=json</InlineCode>{gt(", and")} <InlineCode>compress=zlib-stream</InlineCode> {gt("for transport compression (binary frames, one zlib context per connection, each message ends with the Z_SYNC_FLUSH suffix).")}
      </P>
      <Callout type="info" title={gt("Canary environment")}>
        {gt("The canary/staging deployment is served from")} <InlineCode>capi.serika.dev</InlineCode>{gt(". Use")}{" "}
        <InlineCode>wss://capi.serika.dev/api/v10/gateway</InlineCode> {gt("for the gateway and")}{" "}
        <InlineCode>https://capi.serika.dev/api/v10</InlineCode> {gt("for REST when targeting canary. Always prefer the")}{" "}
        <InlineCode>url</InlineCode> {gt("returned by")} <InlineCode>GET /gateway</InlineCode> {gt("on the environment you connected to, rather than hardcoding a host.")}
      </Callout>

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
        ["1", "Heartbeat", "Both", gt("Maintains connection — send every heartbeat_interval ms; the server may also send it to request an immediate beat")],
        ["2", "Identify", "Client→Server", gt("Initial authentication with token and intents")],
        ["3", "Presence Update", "Client→Server", gt("Update the bot's status and activities")],
        ["4", "Voice State Update", "Client→Server", gt("Join/leave a voice channel (answered with VOICE_SERVER_UPDATE endpoint null: bots can't join Serika voice)")],
        ["6", "Resume", "Client→Server", gt("Resume a disconnected session")],
        ["7", "Reconnect", "Server→Client", gt("Server requests you to reconnect and resume (sent before a deploy or shutdown)")],
        ["8", "Request Guild Members", "Client→Server", gt("Request members of a guild, answered with GUILD_MEMBERS_CHUNK")],
        ["9", "Invalid Session", "Server→Client", gt("Session invalidated — the d boolean says whether you may resume")],
        ["10", "Hello", "Server→Client", gt("Sent on connect — contains heartbeat_interval")],
        ["11", "Heartbeat ACK", "Server→Client", gt("Acknowledges a heartbeat — connection is healthy")],
        ["31", "Request Soundboard Sounds", "Client→Server", gt("Request the soundboard sounds of guilds, answered with SOUNDBOARD_SOUNDS")],
      ]} />
      <P>
        {gt("Op 43 (Request Channel Info) is not implemented and closes the connection with 4001 Unknown opcode.")}
      </P>
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
        {gt("The token can be prefixed with")} <InlineCode>Bot </InlineCode> {gt("or sent bare — both are accepted. On success, the server sends a")} <InlineCode>READY</InlineCode> {gt("dispatch event, then one")} <InlineCode>GUILD_CREATE</InlineCode> {gt("per guild. A missing or malformed token gets")} <InlineCode>Invalid Session</InlineCode> {gt("(op 9) followed by close code")}{" "}
        <InlineCode>4004</InlineCode>{gt("; a token that matches no bot closes with")} <InlineCode>4004</InlineCode> {gt("directly.")}
      </P>
      <Callout type="warning" title={gt("Identify limits")}>
        {gt("You can only identify once per connection: a second IDENTIFY (or a RESUME after IDENTIFY) closes with 4005. Like Discord, each bot may identify once every 5 seconds (max_concurrency 1): a faster IDENTIFY is answered with op 9 and the connection stays open, so wait and identify again. Each bot has 1,000 IDENTIFYs per 24 hours; past that the connection closes with 4008. A bot can hold at most 16 live and resumable sessions (more close with 4008), and a socket that hasn't identified or resumed within 20 seconds is closed.")}
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
      <P>{gt("Intents are bitwise flags that determine which events your bot receives. The numbering is Discord's; unknown bits close the connection with 4013.")}</P>
      <Table headers={[gt("Bit"), gt("Intent"), gt("Events")]} rows={[
        ["1 << 0", "GUILDS", "GUILD_CREATE / UPDATE / DELETE, GUILD_ROLE_*, CHANNEL_*, CHANNEL_PINS_UPDATE, THREAD_*, STAGE_INSTANCE_*, VOICE_CHANNEL_STATUS_UPDATE"],
        ["1 << 1", "GUILD_MEMBERS", "GUILD_MEMBER_ADD, UPDATE, REMOVE, THREAD_MEMBERS_UPDATE (privileged)"],
        ["1 << 2", "GUILD_MODERATION", "GUILD_AUDIT_LOG_ENTRY_CREATE, GUILD_BAN_ADD, GUILD_BAN_REMOVE"],
        ["1 << 3", "GUILD_EXPRESSIONS", "GUILD_EMOJIS_UPDATE, GUILD_STICKERS_UPDATE, GUILD_SOUNDBOARD_SOUND_*"],
        ["1 << 4", "GUILD_INTEGRATIONS", "GUILD_INTEGRATIONS_UPDATE"],
        ["1 << 5", "GUILD_WEBHOOKS", "WEBHOOKS_UPDATE"],
        ["1 << 6", "GUILD_INVITES", "INVITE_CREATE, INVITE_DELETE"],
        ["1 << 7", "GUILD_VOICE_STATES", "VOICE_STATE_UPDATE, VOICE_CHANNEL_EFFECT_SEND"],
        ["1 << 8", "GUILD_PRESENCES", "PRESENCE_UPDATE (privileged)"],
        ["1 << 9", "GUILD_MESSAGES", "MESSAGE_CREATE, UPDATE, DELETE, DELETE_BULK"],
        ["1 << 10", "GUILD_MESSAGE_REACTIONS", "MESSAGE_REACTION_ADD, REMOVE, REMOVE_ALL, REMOVE_EMOJI"],
        ["1 << 11", "GUILD_MESSAGE_TYPING", "TYPING_START"],
        ["1 << 12", "DIRECT_MESSAGES", "MESSAGE_CREATE, UPDATE, DELETE, CHANNEL_PINS_UPDATE (DMs)"],
        ["1 << 13", "DIRECT_MESSAGE_REACTIONS", "MESSAGE_REACTION_* (DMs)"],
        ["1 << 14", "DIRECT_MESSAGE_TYPING", "TYPING_START (DMs)"],
        ["1 << 15", "MESSAGE_CONTENT", "Access message content (privileged)"],
        ["1 << 16", "GUILD_SCHEDULED_EVENTS", "GUILD_SCHEDULED_EVENT_*"],
        ["1 << 20", "AUTO_MODERATION_CONFIGURATION", "AUTO_MODERATION_RULE_*"],
        ["1 << 21", "AUTO_MODERATION_EXECUTION", "AUTO_MODERATION_ACTION_EXECUTION"],
        ["1 << 24", "GUILD_MESSAGE_POLLS", "MESSAGE_POLL_VOTE_ADD, MESSAGE_POLL_VOTE_REMOVE"],
        ["1 << 25", "DIRECT_MESSAGE_POLLS", "MESSAGE_POLL_VOTE_ADD, MESSAGE_POLL_VOTE_REMOVE (DMs)"],
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
        {gt("If the server doesn't receive a heartbeat within roughly 1.5× the interval, it closes the connection with code")} <InlineCode>4009</InlineCode> {gt("(Session timed out), which you can resume. Start the heartbeat timer immediately after receiving")} <InlineCode>Hello</InlineCode>. {gt("The server also sends WebSocket-level pings to keep proxies from dropping the connection — the")} <InlineCode>ws</InlineCode> {gt("library answers these automatically.")}
      </Callout>

      <H2 id="send-limit">{gt("Send rate limit")}</H2>
      <P>
        {gt("Like Discord, a connection may send at most 120 payloads per 60 seconds (heartbeats included). The next payload closes the connection with")} <InlineCode>4008</InlineCode> {gt("(Rate limited), which you can resume.")}
      </P>

      <H2 id="resuming">{gt("Resuming Sessions (op 6)")}</H2>
      <P>{gt("If your connection drops, reconnect and send a Resume to re-establish the session:")}</P>
      <CodeBlock lang="json">{`{
  "op": 6,
  "d": {
    "token": "YOUR_BOT_TOKEN",
    "session_id": "SESSION_ID_FROM_READY",
    "seq": 42
  }
}`}</CodeBlock>
      <P>
        {gt("A closed session can be resumed for 5 minutes. The server keeps the last 1,000 dispatches (up to 1 MB) of each session: on RESUME it replays every dispatch after your seq, then sends")} <InlineCode>RESUMED</InlineCode>{gt(". A seq ahead of the session closes with 4007. If the session is unknown, belongs to another bot, or the dispatches you missed are no longer buffered, you get op 9 with d false: identify again.")}
      </P>
      <Callout type="info" title={gt("Replay is per instance")}>
        {gt("The replay buffer lives in the gateway process that held your session. A RESUME that reaches another instance, or comes after a server restart, gets op 9 and you identify again. Before a deploy the server sends op 7 Reconnect so bots resume while the old instance is still up.")}
      </Callout>

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

      <H2 id="troubleshooting">{gt("Troubleshooting connection drops")}</H2>
      <P>
        {gt("A connection that opens, receives")} <InlineCode>Hello</InlineCode> {gt("(op 10), then closes almost immediately with code")}{" "}
        <InlineCode>1006</InlineCode> {gt("(abnormal close, no close frame) is not an application or token problem — the Gateway closes intentionally with a 4xxx code. A")}{" "}
        <InlineCode>1006</InlineCode> {gt("means an intermediary (reverse proxy, CDN, or firewall) severed the TCP connection.")}
      </P>
      <UL>
        <li><Strong>{gt("Cloudflare / CDN:")}</Strong> {gt("ensure WebSockets are enabled, and that bot-mitigation features (Bot Fight Mode / Super Bot Fight Mode, \"Under Attack\" mode, or a WAF managed rule) are not terminating the non-browser WebSocket. Add a WAF skip/allow rule for the Gateway path on every environment host, e.g.")} <InlineCode>{`starts_with(http.request.uri.path, "/api/v10/gateway")`}</InlineCode> {gt("(covers both")} <InlineCode>api.serika.chat</InlineCode> {gt("and the canary host")} <InlineCode>capi.serika.dev</InlineCode>{gt(").")}</li>
        <li><Strong>{gt("Reverse proxy (nginx/Traefik):")}</Strong> {gt("forward the")} <InlineCode>Upgrade</InlineCode> {gt("and")} <InlineCode>Connection: upgrade</InlineCode> {gt("headers, use HTTP/1.1 to the origin, and set a long read/idle timeout. Do not apply request/connection rate limiting to the Gateway route.")}</li>
        <li><Strong>{gt("Isolate the layer:")}</Strong> {gt("connect directly to the origin (bypassing the CDN) — if it stays up, the CDN/edge is the cause.")}</li>
      </UL>

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
      <P>
        {gt("A bot in more than 2,500 guilds that connects without sharding (no shard, or [0, 1]) is closed with 4011 (Sharding required); an invalid shard array closes with 4010. Use the shards count from GET /gateway/bot.")}
      </P>

      <H2 id="encoding">{gt("Encoding & Compression")}</H2>
      <P>
        {gt("The Gateway supports")} <InlineCode>json</InlineCode> {gt("(default) encoding and")} <InlineCode>compress=zlib-stream</InlineCode> {gt("transport compression. The")} <InlineCode>etf</InlineCode> {gt("(Erlang Term Format) encoding and")} <InlineCode>zstd-stream</InlineCode> {gt("compression are not supported.")}
      </P>

      <H2 id="standalone-gateway">{gt("Standalone Gateway (Horizontal Scaling)")}</H2>
      <P>
        {gt("For production deployments, SerikaCord supports a standalone Gateway server via")}{" "}
        <InlineCode>scripts/gateway.ts</InlineCode>. {gt("This runs a dedicated Bun.serve WebSocket server that connects to Postgres and subscribes to Redis for cross-instance event fan-out. This allows you to scale the Gateway independently from the web app.")}
      </P>
      <Callout type="info" title={gt("Redis fan-out")}>
        {gt("In multi-instance deployments, events are published to Redis and fanned out to all Gateway instances. Each instance routes events only to the bot connections it holds. A Redis-based leadership lock (")}
        <InlineCode>serikacord:discord-bot-lock</InlineCode>{gt(") ensures only one instance runs the Discord bot connection to avoid duplicate event processing.")}
      </Callout>
    </DocPage>
  );
}
