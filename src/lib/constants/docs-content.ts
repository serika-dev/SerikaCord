import { API, docNav } from './docs-nav';

export interface DocContentItem {
  slug: string;
  title: string;
  section: string;
  description: string;
  content: string;
  codeExamples?: { lang: string; title?: string; code: string }[];
}

export const DOCS_CONTENT_REGISTRY: Record<string, DocContentItem> = {
  // --- Getting Started ---
  intro: {
    slug: "intro",
    title: "SerikaCord Developer Documentation",
    section: "Getting Started",
    description: "Build bots, apps, and integrations on SerikaCord — a 1:1-compatible mirror of the Discord API. If you can build a Discord bot, you can build a SerikaCord bot.",
    content: `# SerikaCord Developer Documentation

SerikaCord follows Discord v10 for REST routes, gateway opcodes, OAuth2 flows and data structures, for the parts it implements. The official serika.js SDK handles everything natively. discord.js (v14) and discord.py (2.x) log in, see their servers, receive messages and reply once you point them at SerikaCord (see Quick Start). Not every Discord route exists yet; the API reference lists what does.

## Ids
New applications see Discord-style numeric ids (snowflakes), so libraries that parse ids as 64-bit integers work. Applications created before snowflake ids existed keep seeing UUIDs until their owner switches **Developer Portal -> your app -> Bot -> Discord-style ids** on. Switching changes every id the bot sees, so ids it stored before no longer match. Requests accept both forms. An application's id is its numeric client id, and the @everyone role has the same id as its server, like Discord.

## Base URL & Endpoints
Every request goes to the dedicated bot API host. The version lives in the path, just like Discord.

- REST API: ${API.rest}
- Gateway (WebSocket): ${API.gateway}
- OAuth2 Authorize: ${API.authorize}

## Authentication
Bot requests carry a bot token in the Authorization header with the Bot prefix. Grab one from Developer Portal -> your app -> Bot.

\`\`\`http
Authorization: Bot YOUR_BOT_TOKEN_HERE
\`\`\`

## Key Concepts
- Discord v10 shapes: opcodes, payloads, event names and error codes follow Discord v10 where implemented (see the API reference for what exists).
- Single Authorization Model: Both REST and WebSocket Gateway use the same Bot token.
- SDK: use serika.js, or call the REST API and gateway directly.`,
    codeExamples: [
      {
        lang: "http",
        title: "Bot Authorization Header",
        code: "Authorization: Bot YOUR_BOT_TOKEN_HERE",
      },
      {
        lang: "text",
        title: "SerikaCord Endpoints",
        code: `REST: ${API.rest}\nGateway: ${API.gateway}\nOAuth2: ${API.authorize}`,
      },
    ],
  },
  "getting-started": {
    slug: "getting-started",
    title: "Getting Started",
    section: "Getting Started",
    description: "From zero to a running bot that replies in a channel. Walkthrough using serika.js and Discord-compatible SDKs.",
    content: `# Getting Started with SerikaCord API

SerikaCord bots consist of an Application (metadata, slash commands, OAuth2) and a Bot User (appears in member list, sends messages).

## Step-by-Step Walkthrough

1. **Create an Application**: Open the Developer Portal, click Create, and obtain your Application ID.
2. **Enable Bot & Copy Token**: Go to the Bot tab, enable the bot user, and copy your Bot Token. Keep this secret!
3. **Install Client Library**: Use \`serika.js\` (\`npm i serika.js\`) or \`discord.js\`.
4. **Initialize Bot & Connect**: Set up gateway listeners for \`messageCreate\` or \`interactionCreate\`.
5. **Invite Bot to Server**: Construct an OAuth2 authorization URL with \`bot\` and \`applications.commands\` scopes.

## Quick Example (serika.js)
\`\`\`typescript
import { Client, GatewayIntentBits } from 'serika.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('ready', () => {
  console.log(\`Logged in as \${client.user?.tag}!\`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('Pong!');
  }
});

client.login('YOUR_BOT_TOKEN');
\`\`\``,
    codeExamples: [
      {
        lang: "typescript",
        title: "Simple Bot in serika.js",
        code: `import { Client, GatewayIntentBits } from 'serika.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on('ready', () => {
  console.log(\`Logged in as \${client.user?.tag}!\`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('Pong!');
  }
});

client.login('YOUR_BOT_TOKEN');`,
      },
    ],
  },
  "quick-start": {
    slug: "quick-start",
    title: "Quick Start",
    section: "Getting Started",
    description: "Code snippets for instant bot setup in Node.js, Python, and raw cURL.",
    content: `# Quick Start Code Snippets

## serika.js (Node.js / Bun)
\`\`\`javascript
const { Client } = require('serika.js');
const client = new Client({ intents: 3276799 });

client.on('ready', () => console.log('Bot is ready!'));
client.on('messageCreate', msg => {
  if (msg.content === 'ping') msg.reply('pong');
});

client.login(process.env.BOT_TOKEN);
\`\`\`

## discord.js (v14)
Point the REST client at SerikaCord. The gateway URL comes from GET /gateway/bot. \`cdn\` makes avatar / icon / emoji URLs resolve.

\`\`\`javascript
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  rest: { api: '${API.rest.replace(/\/v10$/, '')}', cdn: '${API.cdn}' },
});

client.on('messageCreate', (msg) => {
  if (msg.content === 'ping') msg.reply('pong');
});

client.login(process.env.BOT_TOKEN);
\`\`\`

## discord.py (2.x)
Set the REST base, the gateway URL and the CDN base **before** creating the client. discord.py does not ask GET /gateway/bot for its gateway unless it is sharded, so without the DEFAULT_GATEWAY line it sends your SerikaCord token to Discord's gateway.

\`\`\`python
import os

import discord
import yarl

discord.http.Route.BASE = "${API.rest}"
discord.gateway.DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("${API.gateway}")
discord.asset.Asset.BASE = "${API.cdn}"

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)


@client.event
async def on_message(message: discord.Message):
    if message.content == "ping":
        await message.reply("pong")


client.run(os.environ["BOT_TOKEN"])
\`\`\`

Message Content and Server Members are privileged intents: switch them on in the Developer Portal (Bot tab) first, or the gateway closes with 4014.

JDA (\`RestConfig.setBaseUrl\`), Serenity (\`HttpBuilder::proxy\`) and DSharpPlus are not tested yet. See topics/differences for what behaves differently from Discord.

## Python (REST with requests)
Without a library, call the REST API directly:

\`\`\`python
import os

import requests

API = "${API.rest}"
HEADERS = {"Authorization": "Bot " + os.environ["BOT_TOKEN"]}


def send_message(channel_id: str, content: str) -> dict:
    res = requests.post(
        f"{API}/channels/{channel_id}/messages",
        headers=HEADERS,
        json={"content": content},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()


me = requests.get(f"{API}/users/@me", headers=HEADERS, timeout=10).json()
print("Logged in as", me["username"])
send_message("CHANNEL_ID", "Hello from Python!")
\`\`\`

## Raw cURL (REST API)
\`\`\`bash
# Post a message to a channel
curl -X POST "${API.rest}/channels/CHANNEL_ID/messages" \\
  -H "Authorization: Bot YOUR_BOT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Hello from raw HTTP cURL!"}'
\`\`\``,
  },
  reference: {
    slug: "reference",
    title: "API Reference Overview",
    section: "Getting Started",
    description: "Full overview of SerikaCord REST API endpoints, rate limits, errors, and formatting.",
    content: `# SerikaCord API Reference

SerikaCord implements standard v10 REST resources.

## Major Endpoint Groups
- **Channels**: \`/channels/{channel_id}\`, \`/channels/{channel_id}/messages\`, \`/channels/{channel_id}/pins\`
- **Guilds / Servers**: \`/guilds/{guild_id}\`, \`/guilds/{guild_id}/members\`, \`/guilds/{guild_id}/roles\`
- **Users**: \`/users/@me\`, \`/users/{user_id}\`
- **Applications**: \`GET/PATCH /applications/@me\`, \`GET /oauth2/applications/@me\`, \`GET/PATCH /applications/{application_id}\` (your own application only). PATCH accepts every Discord field: \`description\`, \`tags\`, \`icon\` / \`cover_image\` (image data), \`custom_install_url\`, \`install_params\`, \`integration_types_config\`, \`interactions_endpoint_url\` (verified with a signed PING), \`role_connections_verification_url\`, \`event_webhooks_*\` (status 2 is refused: no webhook events yet), \`explicit_content_filter\`, \`max_participants\` and the intent \`flags\`. Also \`POST /applications/{application_id}/attachment\` and linked-roles metadata.
- **Gateway**: \`GET /gateway\`, \`GET /gateway/bot\` (recommended shards, 1 per 1000 guilds, and the real remaining daily IDENTIFY budget). The gateway sends READY, then one GUILD_CREATE per server (channels with permission overwrites, threads, roles, emojis, stickers, scheduled events, members). It supports \`compress=zlib-stream\`, RESUME (missed events are replayed for 5 minutes on the same instance), op 3 presence, op 8 Request Guild Members, op 31 Request Soundboard Sounds and op 7 RECONNECT before deploys.
- **Guild extras**: \`GET /guilds/{guild_id}/messages/search\`, join requests (\`/guilds/{guild_id}/requests\`), \`PUT /guilds/{guild_id}/incident-actions\`, \`GET /guilds/{guild_id}/new-member-welcome\`, \`widget.json\` and \`widget.png\` (public), soundboard sounds, \`/stage-instances\`, \`PUT /channels/{channel_id}/voice-status\`, \`POST /channels/{channel_id}/send-soundboard-sound\`.
- **Social SDK**: \`/lobbies\` (app-scoped; user calls need the \`sdk.social_layer\` scope), \`/invites/{code}/target-users\`, \`/partner-sdk/*\` (answers 530000: no provisional accounts).
- **Interactions & Commands**: \`/applications/{application_id}/commands\`, \`/interactions/{interaction_id}/{interaction_token}/callback\`
- **Webhooks**: \`/webhooks/{webhook_id}/{webhook_token}\`, plus \`/slack\` and \`/github\` compatible execute
- **OAuth2**: \`/oauth2/authorize\`, \`/oauth2/token\`, \`/oauth2/userinfo\`, \`/oauth2/keys\` (OpenID Connect)

## Standard Error Response Format
\`\`\`json
{
  "code": 50035,
  "message": "Invalid Form Body",
  "errors": {
    "content": {
      "_errors": [{ "code": "BASE_TYPE_REQUIRED", "message": "This field is required" }]
    }
  }
}
\`\`\``,
  },
  mcp: {
    slug: "mcp",
    title: "Model Context Protocol (MCP) Endpoint",
    section: "Getting Started",
    description: "Connect AI assistants and LLM agents directly to SerikaCord documentation, API schemas, gateway opcodes, permissions, and code templates using standard unauthenticated MCP endpoints.",
    content: `# Model Context Protocol (MCP) Endpoint

SerikaCord provides a native, unauthenticated Model Context Protocol (MCP) server endpoint compliant with the MCP 2024-11-05 specification. This allows AI assistants, IDE extensions (Cursor, Windsurf), and custom LLM agents to query documentation, inspect Gateway opcodes, calculate permission bitmasks, and retrieve code templates in real time.

## Endpoint URLs
The MCP server endpoint is publicly accessible with **no authentication required** (\`no auth\`):

- \`https://api.serika.chat/api/v10/mcp\` (Primary versioned endpoint)
- \`https://api.serika.chat/api/mcp\` (Unversioned alias)
- \`https://api.serika.chat/api/docs/mcp\` (Dedicated docs alias)
- \`https://api.serika.chat/api/v10/docs/mcp\`

## Available MCP Tools

| Tool Name | Parameters | Description |
| --- | --- | --- |
| \`get_docs_nav\` | None | Returns full hierarchical index of documentation sections and pages. |
| \`get_doc_page\` | \`slug\` (string) | Fetches complete text, code examples, and structure for a given doc slug (e.g. \`intro\`, \`getting-started\`, \`topics/gateway\`). |
| \`search_docs\` | \`query\` (string) | Performs keyword search across documentation titles and body content. |
| \`get_api_endpoints\` | None | Returns canonical SerikaCord API REST base URL, Gateway WebSocket URL, OAuth2 URLs, and authorization headers. |
| \`get_gateway_opcodes\` | \`opcode\` (number, optional) | Returns Gateway Opcode reference (0-11), WebSocket close codes (4000-4014), and payload structures. |
| \`get_permission_flags\` | \`permissions\` (array, optional) | Returns bitwise permissions table and calculates combined bitmask integer for specified flag names. |
| \`get_code_example\` | \`topic\` (string), \`language\` (string) | Returns executable code snippets for bot tasks (\`connect-gateway\`, \`send-message\`, \`register-slash-command\`) across languages. |
| \`validate_bot_token\` | \`token\` (string) | Structural validation check for SerikaCord/Discord bot token format. |

## Available MCP Resources

The endpoint registers documentation pages, API configurations, cheat sheets, and bot templates:

- **Documentation Pages**: \`docs://{slug}\` (e.g. \`docs://intro\`, \`docs://topics/gateway\`, \`docs://resources/message\`)
- **API Configuration**: \`config://api-endpoints\`
- **Gateway Opcodes Cheat Sheet**: \`cheatsheet://opcodes\`
- **Permissions Reference**: \`cheatsheet://permissions\`
- **Node.js Bot Template**: \`templates://bot-starter-js\`
- **Python Bot Template**: \`templates://bot-starter-py\`

## Available MCP Prompts

- **\`serikacord-doc-assistant\`**: General developer assistant system prompt.
- **\`create-serikacord-bot\`**: Guided bot project setup & architecture prompt.
- **\`debug-gateway-connection\`**: Diagnostic prompt for WebSocket close codes & gateway reconnects.
- **\`generate-slash-command\`**: Slash command definition & interaction handler builder.

## Connecting MCP Clients

### 1. Cursor Setup (\`.cursor/mcp.json\`)
\`\`\`json
{
  "mcpServers": {
    "serikacord-docs": {
      "url": "https://api.serika.chat/api/v10/mcp"
    }
  }
}
\`\`\`

### 2. Claude Desktop Setup (\`claude_desktop_config.json\`)
\`\`\`json
{
  "mcpServers": {
    "serikacord-docs": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch", "https://api.serika.chat/api/v10/mcp"]
    }
  }
}
\`\`\`

### 3. Direct JSON-RPC Request (HTTP POST)
Send a POST request with \`Content-Type: application/json\`:

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_doc_page",
    "arguments": {
      "slug": "getting-started"
    }
  }
}
\`\`\``,
    codeExamples: [
      {
        lang: "json",
        title: "Cursor Configuration (.cursor/mcp.json)",
        code: `{
  "mcpServers": {
    "serikacord-docs": {
      "url": "https://api.serika.chat/api/v10/mcp"
    }
  }
}`,
      },
      {
        lang: "bash",
        title: "cURL JSON-RPC call example",
        code: `curl -X POST "https://api.serika.chat/api/v10/mcp" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_doc_page",
      "arguments": { "slug": "intro" }
    }
  }'`,
      },
    ],
  },

  // --- Bots ---
  "bots/overview": {
    slug: "bots/overview",
    title: "Bots Overview",
    section: "Bots",
    description: "Architecture, intents, bot tokens, and lifetime cycles of SerikaCord bot users.",
    content: `# Bots Overview

Bot users are specialized accounts owned by Applications. They can receive WebSocket events via Gateway and invoke REST methods.

## Bot Intents
Intents allow your bot to subscribe to specific categories of gateway events to conserve bandwidth.
- \`GUILDS\` (1 << 0)
- \`GUILD_MEMBERS\` (1 << 1) - Privileged
- \`GUILD_MESSAGES\` (1 << 9)
- \`GUILD_MESSAGE_REACTIONS\` (1 << 10)
- \`GUILD_MESSAGE_TYPING\` (1 << 11)
- \`DIRECT_MESSAGES\` (1 << 12)
- \`DIRECT_MESSAGE_REACTIONS\` (1 << 13)
- \`DIRECT_MESSAGE_TYPING\` (1 << 14)
- \`MESSAGE_CONTENT\` (1 << 15) - Privileged

## Privileged Intents
\`GUILD_MEMBERS\`, \`GUILD_PRESENCES\` (1 << 8) and \`MESSAGE_CONTENT\` are privileged: switch them on in Developer Portal -> Bot -> Privileged Gateway Intents.
- IDENTIFY with a privileged intent that is not switched on closes the connection with code 4014.
- Without \`MESSAGE_CONTENT\`, server messages arrive with empty content, embeds, attachments, components and poll (gateway and REST). Messages that mention the bot, the bot's own messages and DMs are unaffected.
- Without \`GUILD_MEMBERS\`, \`GET /guilds/{guild.id}/members\` returns 403.
- Applications created before 16 October 2026 keep all three until the owner changes the toggles for the first time.`,
  },
  "bots/slash-commands": {
    slug: "bots/slash-commands",
    title: "Slash Commands",
    section: "Bots",
    description: "Registering global and guild application slash commands on SerikaCord.",
    content: `# Slash Commands & Application Commands

Slash commands allow users to interact with your bot via rich auto-completing commands in chat.

## Registering Global Commands
PUT or POST to \`/applications/{application_id}/commands\`:

\`\`\`json
[
  {
    "name": "ping",
    "description": "Replies with pong and latency!",
    "options": []
  },
  {
    "name": "echo",
    "description": "Echoes back your text",
    "options": [
      {
        "type": 3,
        "name": "text",
        "description": "The text to repeat",
        "required": true
      }
    ]
  }
]
\`\`\``,
  },
  "bots/interactions": {
    slug: "bots/interactions",
    title: "Interactions & Responses",
    section: "Bots",
    description: "Handling interaction callbacks, message components, buttons, select menus, and modals.",
    content: `# Interactions & Callbacks

When a user triggers a slash command or clicks a component, SerikaCord delivers an Interaction object over the Gateway or HTTP Webhook.

## Interaction Callback Types
- \`1\`: \`PONG\` (Heartbeat acknowledgment)
- \`4\`: \`CHANNEL_MESSAGE_WITH_SOURCE\` (Respond with a new message)
- \`5\`: \`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE\` (Acknowledge now, update later)
- \`6\`: \`DEFERRED_UPDATE_MESSAGE\` (Acknowledge component click without edit)
- \`7\`: \`UPDATE_MESSAGE\` (Edit component message)
- \`8\`: \`APPLICATION_COMMAND_AUTOCOMPLETE_RESULT\` (Autocomplete choices)
- \`9\`: \`MODAL\` (Pop up a form modal)

Acknowledge within 3 seconds, once (late: 10062, twice: 40060). The token works for 15 minutes for followups and \`@original\` edits (\`/webhooks/{application_id}/{token}\`). \`flags: 64\` replies are shown only to the invoker. Add \`?with_response=true\` to get the created message back.

## Responding to Interaction
\`\`\`http
POST /api/v10/interactions/{interaction_id}/{interaction_token}/callback
Content-Type: application/json

{
  "type": 4,
  "data": {
    "content": "Hello from interaction callback!",
    "flags": 64
  }
}
\`\`\``,
  },

  // --- Social SDK ---
  "social-sdk/overview": {
    slug: "social-sdk/overview",
    title: "Social SDK Overview",
    section: "Social SDK",
    description: "Embed social graphs, presence widgets, friend relationships, and chat inside external games and web apps.",
    content: `# Social SDK Overview

The SerikaCord Social SDK connects third-party games, desktop apps, and web applications to the SerikaCord network.

## Key Features
- **External Auth**: Authenticate players using their SerikaCord identity.
- **Rich Presence**: Display game status, party size, and join buttons on player profiles.
- **Relationships & Friends**: Sync in-game friends with SerikaCord friend lists.
- **Embeddable Widgets**: Chat overlay and voice channel widgets.`,
  },
  "social-sdk/external-auth": {
    slug: "social-sdk/external-auth",
    title: "External Auth Integration",
    section: "Social SDK",
    description: "Authenticate game players and web users with SerikaCord accounts using OAuth2 single sign-on.",
    content: `# Social SDK - External Auth

Authenticate players in external games or web applications using SerikaCord single sign-on (SSO).

## Flow Diagram
1. Client requests authorization code via OAuth2 popup or redirect.
2. App exchanges \`code\` for \`access_token\` on SerikaCord backend.
3. App fetches user profile using \`GET /users/@me\` with bearer token.

\`\`\`http
GET https://api.serika.chat/api/oauth2/authorize?client_id=APP_ID&response_type=code&scope=identify%20guilds
\`\`\``,
  },
  "social-sdk/relationships": {
    slug: "social-sdk/relationships",
    title: "Relationships & Presence",
    section: "Social SDK",
    description: "Sync in-game friend lists, online status, rich presence, and party invitations.",
    content: `# Social SDK - Relationships & Presence

Synchronize player status, rich activity presence, and friend relationships across SerikaCord and external games.

## Rich Presence Payload Schema
\`\`\`json
{
  "state": "In Competitive Match",
  "details": "Ranked 5v5",
  "timestamps": { "start": 1690000000 },
  "assets": {
    "large_image": "map_bind",
    "large_text": "Bind Map"
  },
  "party": { "id": "party123", "size": [3, 5] }
}
\`\`\``,
  },
  "social-sdk/widgets": {
    slug: "social-sdk/widgets",
    title: "Embeddable Widgets",
    section: "Social SDK",
    description: "Embed chat overlays, voice channel widgets, and server status cards in web applications.",
    content: `# Social SDK - Embeddable Widgets

Embed interactive SerikaCord chat boxes, voice channel status, and member lists into external web pages.

## Embed Code Example
\`\`\`html
<iframe
  src="https://api.serika.chat/widget/YOUR_SERVER_ID?theme=dark"
  width="350"
  height="500"
  allowtransparency="true"
  frameborder="0"
  sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
></iframe>
\`\`\``,
  },
  "social-sdk/api-reference": {
    slug: "social-sdk/api-reference",
    title: "Social SDK API Reference",
    section: "Social SDK",
    description: "REST and SDK method signatures for Social SDK authentication, presence, and friendship APIs.",
    content: `# Social SDK API Reference

Complete endpoint list for Social SDK integrations:

- \`GET /social/v1/users/@me\` - Get current authenticated player profile.
- \`GET /social/v1/friends\` - List player friends and relationship states.
- \`POST /social/v1/presence\` - Broadcast rich presence activity payload.
- \`GET /social/v1/widgets/server/{serverId}\` - Fetch JSON metadata for server embed widget.`,
  },

  // --- Topics ---
  "topics/oauth2": {
    slug: "topics/oauth2",
    title: "OAuth2",
    section: "Topics",
    description: "OAuth2 scopes, authorization code grant, bot installation links, and access tokens.",
    content: `# OAuth2 Authentication

SerikaCord provides OAuth2 authorization for third-party client authentication and bot invitations.

## Bot Authorization Link
\`\`\`
https://api.serika.chat/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=8
\`\`\`

## Supported Scopes
- \`identify\`: Read user basic profile
- \`email\`: Read user email address
- \`guilds\`: Read user server list
- \`guilds.join\`: Add the user to a server (\`PUT /guilds/{guild_id}/members/{user_id}\`)
- \`gdm.join\`: Add the user to a group DM (\`PUT /channels/{channel_id}/recipients/{user_id}\`, or \`POST /users/@me/channels\` with \`access_tokens\`)
- \`openid\`: OpenID Connect: an RS256 \`id_token\` in the token response (also on refresh), \`GET /oauth2/userinfo\`, signing keys at \`GET /oauth2/keys\`. There is no discovery document.
- \`role_connections.write\`: Write the user's linked-roles connection (\`/users/@me/applications/{application_id}/role-connection\`)
- \`sdk.social_layer\`: Act as the user in your application's lobbies
- \`bot\`: Install bot user to server
- \`applications.commands\`: Register slash commands in server

\`client_credentials\` tokens act as the application's owner and only get \`identify\` and the \`applications.commands*\` scopes.`,
  },
  "topics/opcodes-and-status-codes": {
    slug: "topics/opcodes-and-status-codes",
    title: "Opcodes & Status Codes",
    section: "Topics",
    description: "SerikaCord Gateway opcodes, Gateway close codes, HTTP status codes, and JSON error codes.",
    content: `# Opcodes & Status Codes

Complete reference for all Gateway opcodes, close codes, HTTP status codes, and JSON API error codes.

## Gateway Opcodes
- \`0\` Dispatch | \`1\` Heartbeat | \`2\` Identify | \`3\` Presence Update | \`4\` Voice State Update
- \`6\` Resume | \`7\` Reconnect | \`8\` Request Guild Members | \`9\` Invalid Session | \`10\` Hello | \`11\` Heartbeat ACK | \`31\` Request Soundboard Sounds
- Op 43 (Request Channel Info) is not implemented (close 4001).

## Close Event Codes
- \`4000\` Unknown Error | \`4001\` Unknown opcode | \`4002\` Decode error | \`4003\` Not authenticated | \`4004\` Authentication Failed | \`4005\` Already authenticated | \`4007\` Invalid seq | \`4008\` Rate Limited | \`4009\` Session timed out | \`4010\` Invalid shard | \`4011\` Sharding required | \`4012\` Invalid API version | \`4013\` Invalid intent(s) | \`4014\` Disallowed Intent(s)

## JSON error codes
Discord's numbers, e.g. \`10003\` Unknown Channel, \`10031\` Unknown lobby, \`10067\` Unknown Stage Instance, \`10097\` Unknown Sound, \`50004\` Widget disabled, \`50013\` Missing Permissions, \`50025\` Invalid OAuth2 access token, \`50026\` Missing required OAuth2 scope, \`50035\` Invalid Form Body (with an \`errors\` tree), \`160004\` A thread has already been created for this message, \`530000\` provisional accounts not enabled, \`530007\` invalid client secret.

## HTTP Status Codes
- \`200\` OK | \`201\` Created | \`204\` No Content | \`400\` Bad Request | \`401\` Unauthorized | \`403\` Forbidden | \`404\` Not Found | \`429\` Too Many Requests`,
  },
  "topics/permissions": {
    slug: "topics/permissions",
    title: "Permissions",
    section: "Topics",
    description: "Bitwise permission flags for server roles, channel overwrites, and bot access.",
    content: `# Permissions & Bitwise Flags

Permissions in SerikaCord are represented as 64-bit integer bitfields.

## Key Permission Bit Flags
- \`CREATE_INSTANT_INVITE\` (1 << 0)
- \`KICK_MEMBERS\` (1 << 1)
- \`BAN_MEMBERS\` (1 << 2)
- \`ADMINISTRATOR\` (1 << 3)
- \`MANAGE_CHANNELS\` (1 << 4)
- \`MANAGE_GUILD\` (1 << 5)
- \`ADD_REACTIONS\` (1 << 6)
- \`VIEW_AUDIT_LOG\` (1 << 7)
- \`VIEW_CHANNEL\` (1 << 10)
- \`SEND_MESSAGES\` (1 << 11)
- \`MANAGE_MESSAGES\` (1 << 13)
- \`EMBED_LINKS\` (1 << 14)
- \`ATTACH_FILES\` (1 << 15)
- \`READ_MESSAGE_HISTORY\` (1 << 16)
- \`MENTION_EVERYONE\` (1 << 17)
- \`MANAGE_ROLES\` (1 << 28)
- \`MANAGE_WEBHOOKS\` (1 << 29)
- \`USE_SOUNDBOARD\` (1 << 42), \`CREATE_GUILD_EXPRESSIONS\` (1 << 43), \`CREATE_EVENTS\` (1 << 44), \`USE_EXTERNAL_SOUNDS\` (1 << 45), \`SEND_VOICE_MESSAGES\` (1 << 46)
- \`SET_VOICE_CHANNEL_STATUS\` (1 << 48), \`SEND_POLLS\` (1 << 49), \`USE_EXTERNAL_APPS\` (1 << 50), \`PIN_MESSAGES\` (1 << 51)

These are Discord API v10 numbers, used by applications with snowflake ids in every permission bitfield (roles, overwrites, member and app permissions, \`default_member_permissions\`, install params, authorize links). Legacy UUID-format applications see SerikaCord's original numbers for five flags: USE_EXTERNAL_SOUNDS 1 << 42, SEND_VOICE_MESSAGES 1 << 43, USE_SOUNDBOARD 1 << 44, CREATE_EXPRESSIONS 1 << 45, CREATE_EVENTS 1 << 46.`,
  },
  "topics/rate-limits": {
    slug: "topics/rate-limits",
    title: "Rate Limits",
    section: "Topics",
    description: "Per-bot rate limits, X-RateLimit headers, 429 responses, and retry delays.",
    content: `# Rate Limits

Requests with a valid bot token count against per-bot limits, reported with Discord-style headers (\`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`, \`X-RateLimit-Reset-After\`, \`X-RateLimit-Bucket\`):

- All requests: 50 per second per bot (global).
- \`POST /channels/{id}/messages\`: 5 per 5 seconds per channel. Reactions: 4 per second per channel. Deleting a message: 5 per second per channel. Other writes: 30 per 10 seconds per route and channel/server.
- A 429 has \`Retry-After\`, \`X-RateLimit-Scope\` and the body \`{ "message": "You are being rate limited.", "retry_after": 0.642, "global": false, "code": 0 }\`.
- Requests without a valid bot token share a per-IP limit of 1,200 requests per minute (429 body \`{ "error", "retryAfter" }\`). Channel webhook execution (including \`/slack\` and \`/github\`): 30 requests per 10 seconds per webhook. Interaction token routes: 5 per 2 seconds per interaction. Guild message search: 40 per minute per bot. Lobby writes with a user's Bearer token use the bot budgets keyed by that user.
- Gateway: 120 payloads per 60 seconds per connection (close 4008); IDENTIFY once per 5 seconds per bot (faster ones get op 9) and 1000 per day (close 4008), reported in \`GET /gateway/bot\` \`session_start_limit\`; a full op 8 member list once per guild every 30 seconds (else a RATE_LIMITED dispatch).

Read the headers rather than hard-coding these numbers, and honour \`retry_after\` / \`Retry-After\` on any 429 (exponential backoff when it is missing).`,
  },
  "topics/threads": {
    slug: "topics/threads",
    title: "Threads & Conversations",
    section: "Topics",
    description: "Public and private threads, creation, archival, and message threads.",
    content: `# Threads & Sub-Conversations

Threads allow users to break out focused discussions without cluttering main text channels.

## Thread Types
- \`11\`: \`GUILD_PUBLIC_THREAD\` (Visible to everyone in channel)
- \`12\`: \`GUILD_PRIVATE_THREAD\` (Invite only)

## Creating a Thread from Message
\`\`\`http
POST /channels/{channel_id}/messages/{message_id}/threads
Content-Type: application/json

{
  "name": "Project Discussion",
  "auto_archive_duration": 1440
}
\`\`\`

The thread takes the starter message's id, like Discord; a second create for the same message answers 160004. Forum posts (\`POST /channels/{channel_id}/threads\` with \`message\`) need View Channel and Send Messages in the forum. Thread members carry their real \`join_timestamp\` (members who joined before join times were recorded fall back to the thread's creation time); \`flags\` is always 0. \`GET /channels/{channel_id}/threads/search\` honours \`slop\`, \`min_id\` and \`max_id\`.`,
  },
  "topics/gateway": {
    slug: "topics/gateway",
    title: "Gateway & WebSockets",
    section: "Topics",
    description: "Gateway opcodes, connection lifecycle, heartbeats, identify, and resume.",
    content: `# Gateway & Realtime WebSockets

Connect to \`${API.gateway}\` to maintain real-time bidirectional communication.

## Handshake Flow
1. Client connects via WebSocket to \`${API.gateway}?v=10&encoding=json\`.
2. Server sends Opcode 10 (\`HELLO\`) with \`heartbeat_interval\` (e.g. 41250ms).
3. Client starts heartbeat timer sending Opcode 1 (\`HEARTBEAT\`) with last sequence number.
4. Client sends Opcode 2 (\`IDENTIFY\`) payload with token and intents.
5. Server sends Opcode 0 (\`READY\`) event containing initial bot state, then one \`GUILD_CREATE\` per guild.

## Limits and failures
- A missing or malformed token gets op 9 (Invalid Session) then close 4004; an unknown token closes with 4004. A second IDENTIFY closes with 4005.
- IDENTIFY: once per 5 seconds per bot (a faster one gets op 9, retry later) and 1000 per day (close 4008). At most 16 live + resumable sessions per bot.
- 120 payloads per 60 seconds per connection; the next one closes with 4008.
- RESUME within 5 minutes replays missed dispatches (last 1000 / 1 MB per session, same instance only); otherwise op 9 and identify again. A seq ahead of the session closes with 4007.
- \`compress=zlib-stream\` is supported; ETF and zstd are not.`,
  },
  "topics/webhooks": {
    slug: "topics/webhooks",
    title: "Webhooks",
    section: "Topics",
    description: "Creating, executing, and managing webhooks for channel messaging.",
    content: `# Webhooks

Webhooks provide a simple HTTP POST interface to post messages to channels without running a WebSocket bot.

## Execute Webhook
\`\`\`http
POST /api/v10/webhooks/{webhook_id}/{webhook_token}
Content-Type: application/json

{
  "content": "Webhook payload message",
  "username": "Custom Sender Name",
  "avatar_url": "https://example.com/avatar.png"
}
\`\`\`

Execute also takes \`embeds\`, \`components\` (\`?with_components=true\`), files, \`poll\`, \`thread_id\` (query) and \`thread_name\` + \`applied_tags\` for a new forum post, and \`?wait=true\` to get the message back. Creating or editing a webhook takes \`avatar\` as image data.

## Slack and GitHub compatible execute
- \`POST /webhooks/{webhook_id}/{webhook_token}/slack\`: Slack incoming-webhook JSON (\`text\`, \`username\`, \`icon_url\`, \`attachments\`); mrkdwn becomes markdown and attachments become embeds. Answers \`ok\`, or the message with \`?wait=true\`.
- \`POST /webhooks/{webhook_id}/{webhook_token}/github\`: point a GitHub webhook here (content type application/json). Push, create, delete, issues, issue_comment, pull_request, pull_request_review(_comment), commit_comment, release, star, watch, fork, member, public, discussion(_comment), check_run and check_suite become embeds; other events answer 204.`,
  },
  "topics/message-formatting": {
    slug: "topics/message-formatting",
    title: "Message Formatting & Markdown",
    section: "Topics",
    description: "Markdown syntax, user/role/channel mentions, custom emojis, timestamps, and spoiler text.",
    content: `# Message Formatting & Markdown

SerikaCord text messages support rich markdown formatting, user mentions, and dynamic timestamp tags.

## Formatting Cheat Sheet
- **Bold**: \`**text**\`
- *Italics*: \`*text*\` or \`_text_\`
- ~~Strikethrough~~: \`~~text~~\`
- Code Block: \\\`\\\`\\\`js ... \\\`\\\`\\\`
- User Mention: \`<@USER_ID>\`
- Channel Link: \`<#CHANNEL_ID>\`
- Role Mention: \`<@&ROLE_ID>\`
- Dynamic Timestamp: \`<t:1690000000:R>\` (Relative time)`,
  },
  "topics/slash-commands": {
    slug: "topics/slash-commands",
    title: "Application Slash Commands Deep-Dive",
    section: "Topics",
    description: "Option types, choices, autocomplete, subcommands, and permissions for slash commands.",
    content: `# Application Slash Commands Deep-Dive

Advanced configuration for application commands including options, choices, and subcommands.

## Option Types
- \`1\`: SUB_COMMAND
- \`2\`: SUB_COMMAND_GROUP
- \`3\`: STRING
- \`4\`: INTEGER
- \`5\`: BOOLEAN
- \`6\`: USER
- \`7\`: CHANNEL
- \`8\`: ROLE
- \`10\`: NUMBER
- \`11\`: ATTACHMENT`,
  },
  "topics/tts": {
    slug: "topics/tts",
    title: "Text-to-Speech (TTS)",
    section: "Topics",
    description: "Sending TTS messages and configuring Fish Audio TTS voice synthesizer backends.",
    content: `# Text-to-Speech (TTS) Integration

SerikaCord supports real-time Text-to-Speech (TTS) voice playback powered by Fish Audio backends.

## Sending TTS Message
\`\`\`http
POST /channels/{channel_id}/messages
Content-Type: application/json

{
  "content": "Alert: Backup completed.",
  "tts": true
}
\`\`\``,
  },
  "topics/reactions": {
    slug: "topics/reactions",
    title: "Reactions & Emoji Expressions",
    section: "Topics",
    description: "Adding, removing, and fetching emoji reactions on channel messages.",
    content: `# Reactions & Emoji Expressions

Add unicode or custom server emoji reactions to messages. Reactions show up live for everyone viewing the message.

## The {emoji} path segment
- Unicode: the emoji itself, URL-encoded (\`%F0%9F%91%8D\` for 👍).
- Custom: \`name:id\` (\`a:name:id\` also works), URL-encoded. Using an emoji from another server needs the bot to be in that server and \`USE_EXTERNAL_EMOJIS\` in the channel. Unknown or unusable emoji answer \`10014 Unknown Emoji\`.

## Endpoints
- \`PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me\` - Add reaction (a new emoji needs \`ADD_REACTIONS\`; at most 20 different emoji per message, error 30010)
- \`DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me\` - Remove own reaction
- \`DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/{user_id}\` - Remove someone's reaction (\`MANAGE_MESSAGES\`)
- \`GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji}\` - Users who reacted, ordered by id: \`after\`, \`limit\` (1-100, default 25), \`type\` (0 normal, 1 burst; Serika has no burst reactions)
- \`DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}\` - Remove every reaction of one emoji (\`MANAGE_MESSAGES\`)
- \`DELETE /channels/{channel_id}/messages/{message_id}/reactions\` - Remove all reactions (\`MANAGE_MESSAGES\`)

Reaction routes share a per-channel bucket of 4 requests per second (one every 250 ms, like Discord).

## Gateway events
\`MESSAGE_REACTION_ADD\` (with \`member\` in servers and \`message_author_id\`), \`MESSAGE_REACTION_REMOVE\`, \`MESSAGE_REACTION_REMOVE_ALL\` and \`MESSAGE_REACTION_REMOVE_EMOJI\`, under the \`GUILD_MESSAGE_REACTIONS\` / \`DIRECT_MESSAGE_REACTIONS\` intents, only to bots that can see the channel.`,
  },
  "topics/stickers": {
    slug: "topics/stickers",
    title: "Stickers & Expressions",
    section: "Topics",
    description: "Sticker objects, sticker packs, and attaching stickers to messages.",
    content: `# Stickers & Expression Assets

Stickers are rich illustrated media assets attached to messages.

## Endpoints
- \`GET /stickers/{sticker_id}\` - Fetch sticker details
- \`GET /sticker-packs\` - Fetch official sticker packs`,
  },
  "topics/teams": {
    slug: "topics/teams",
    title: "Teams & Application Management",
    section: "Topics",
    description: "Developer teams, organization roles, shared application management, and bot ownership.",
    content: `# Developer Teams

Teams allow multiple developers to co-own applications and share bot tokens, analytics, and webhook settings.

## Roles
- **Owner**: Full administrative control over team apps.
- **Admin**: Can edit bot tokens, slash commands, and settings.
- **Developer**: Can view analytics and app metadata.`,
  },
  "topics/bot-verification": {
    slug: "topics/bot-verification",
    title: "Bot Verification",
    section: "Topics",
    description: "Guidelines and requirements for verifying large bots installed across 75+ servers.",
    content: `# Bot Verification & Badges

Bots joined to 75 or more servers require developer identity verification and privileged intent review.

## Requirements
- Verified developer account email & identity document.
- Justification for \`MESSAGE_CONTENT\` and \`GUILD_MEMBERS\` privileged intents.`,
  },

  // --- Resources ---
  "resources/application-role-connection-metadata": {
    slug: "resources/application-role-connection-metadata",
    title: "Application Role Connection Metadata",
    section: "Resources",
    description: "Role connection metadata record schemas and linked accounts metadata.",
    content: `# Application Role Connection Metadata Resource

Allows apps to register custom metadata fields for user linked role verification.

## Endpoints
- \`GET /applications/{application_id}/role-connections/metadata\` - Get app role connection metadata (bot token)
- \`PUT /applications/{application_id}/role-connections/metadata\` - Replace the records (bot token): up to 5, types 1-8, \`key\` 1-50 of a-z 0-9 _, \`name\` 1-100, \`description\` 1-200, optional localizations
- \`GET\` / \`PUT\` / \`DELETE /users/@me/applications/{application_id}/role-connection\` - The user's connection (Bearer with \`role_connections.write\`): \`platform_name\` (50), \`platform_username\` (100), \`metadata\` values checked against the records

Values are stored and returned like Discord's, but Serika servers can't require them for roles yet.`,
  },
  "resources/application": {
    slug: "resources/application",
    title: "Application Resource",
    section: "Resources",
    description: "Application object schema, OAuth2 metadata, bot flags, and developer app endpoints.",
    content: `# Application Resource

Represents a developer application registered on SerikaCord.

## Endpoints
- \`GET /applications/@me\` - Get current developer app info
- \`GET /applications/{application.id}\` - Fetch application details
- \`PATCH /applications/@me\`, \`PATCH /applications/{application.id}\` - Edit your own application: \`description\`, \`tags\`, \`icon\` / \`cover_image\` (image data), \`custom_install_url\`, \`install_params\`, \`integration_types_config\`, \`interactions_endpoint_url\` (verified with a signed PING), \`role_connections_verification_url\`, \`event_webhooks_url\` / \`_types\` / \`_status\` (2 = enabled is refused: SerikaCord does not deliver webhook events), \`explicit_content_filter\`, \`max_participants\`, \`flags\`. \`team_id\` can't be changed here.
- \`POST /applications/{application.id}/attachment\` - Upload an Activities attachment (multipart \`file\`), returned as an ephemeral attachment
- \`GET /applications/{application.id}/activity-instances/{instance_id}\` - Always 404 (no Embedded App activities)
- \`PUT /applications/{application.id}/guilds/{guild.id}/commands/permissions\` - Batch command permissions (\`[{ id, permissions }]\`, replaces every override the app has in the guild)`,
  },
  "resources/audit-log": {
    slug: "resources/audit-log",
    title: "Audit Log Resource",
    section: "Resources",
    description: "Guild audit log entry schemas, change keys, and audit log REST endpoints.",
    content: `# Audit Log Resource

Tracks administrative actions taken within a server (channel modifications, role edits, member bans).

## Endpoints
- \`GET /guilds/{guild_id}/audit-logs\` - Query guild audit logs`,
  },
  "resources/channel": {
    slug: "resources/channel",
    title: "Channel Resource",
    section: "Resources",
    description: "Channel object schema, channel types, and channel REST endpoints.",
    content: `# Channel Resource

Represents a guild text channel, voice channel, category, thread, or DM channel.

## Endpoints
- \`GET /channels/{channel.id}\` - Get channel (DMs and group DMs carry \`recipients\` as user objects, your bot left out)
- \`PATCH /channels/{channel.id}\` - Modify channel
- \`DELETE /channels/{channel.id}\` - Delete channel
- \`PUT /channels/{channel.id}/recipients/{user.id}\` - Add a user to a group DM with their \`gdm.join\` access token for your application (\`nick\` is ignored); 50025 for a bad token, 50026 without the scope
- \`PUT /channels/{channel.id}/voice-status\` - Set a voice channel's status (\`status\` up to 500 characters, null clears; needs Set Voice Channel Status and Manage Channels; cleared when the channel empties; not shown in the web client yet)
- \`POST /channels/{channel.id}/send-soundboard-sound\` - Play a soundboard sound (\`sound_id\`, \`source_guild_id\`) to everyone in a voice channel; the bot need not be connected (bots can't join voice)
- Pinning a message posts a "pinned a message" system message (type 6) with \`message_reference\` to the pinned message.`,
  },
  "resources/emoji": {
    slug: "resources/emoji",
    title: "Emoji Resource",
    section: "Resources",
    description: "Custom guild emoji object schema, creation, modification, and deletion.",
    content: `# Emoji Resource

Represents custom server emoji images and animated GIFs.

## Endpoints
- \`GET /guilds/{guild_id}/emojis\` - List guild emojis
- \`POST /guilds/{guild_id}/emojis\` - Create guild emoji`,
  },
  "resources/guild": {
    slug: "resources/guild",
    title: "Guild Resource",
    section: "Resources",
    description: "Guild (Server) object schema, members, roles, channels, and guild REST endpoints.",
    content: `# Guild Resource

Guilds in SerikaCord represent servers where users interact across channels.

## Endpoints
- \`GET /guilds/{guild.id}\` - Get guild details
- \`GET /guilds/{guild.id}/members\` - List guild members
- \`GET /guilds/{guild.id}/roles\` - List guild roles
- \`GET /guilds/{guild.id}/messages/search\` - Discord's guild message search (channels the bot can read; content filters need MESSAGE_CONTENT; \`slop\` ignored; offsets past 5000 return an empty page; 40 searches per minute)
- \`GET /guilds/{guild.id}/requests\`, \`PATCH /guilds/{guild.id}/requests/{request.id}\` - Join requests (member applications), MANAGE_GUILD
- \`PUT /guilds/{guild.id}/incident-actions\` - Pause invites (\`invites_disabled_until\`, enforced) and DMs (\`dms_disabled_until\`, stored and reported only, not enforced)
- \`GET /guilds/{guild.id}/new-member-welcome\` - The Server Guide
- \`GET /guilds/{guild.id}/widget.json\`, \`GET /guilds/{guild.id}/widget.png?style=shield|banner1-4\` - Public while the widget is enabled (else 50004)
- \`GET/POST /guilds/{guild.id}/soundboard-sounds\`, \`GET/PATCH/DELETE /guilds/{guild.id}/soundboard-sounds/{sound.id}\` - Server soundboard`,
  },
  "resources/guild-scheduled-event": {
    slug: "resources/guild-scheduled-event",
    title: "Guild Scheduled Event Resource",
    section: "Resources",
    description: "Scheduled event schemas, voice/stage channel events, and event management.",
    content: `# Guild Scheduled Event Resource

Represents upcoming community events in voice or stage channels.

## Endpoints
- \`GET /guilds/{guild_id}/scheduled-events\` - List scheduled events
- \`POST /guilds/{guild_id}/scheduled-events\` - Create scheduled event
- \`GET /guilds/{guild_id}/scheduled-events/{event_id}/users/counts\` - Interested user count (exception counts are always empty)
- Exception routes (\`POST .../exceptions\`, \`PATCH/DELETE .../exceptions/{exception_id}\`, \`GET .../{exception_id}/users\`): Serika events don't recur, so no exceptions exist (create answers 50035, the others 404).`,
  },
  "resources/invite": {
    slug: "resources/invite",
    title: "Invite Resource",
    section: "Resources",
    description: "Invite code schemas, max uses, expiration, and invite REST endpoints.",
    content: `# Invite Resource

Represents a server invite code link used by members to join a guild.

## Endpoints
- \`GET /invites/{invite_code}\` - Get invite details
- \`DELETE /invites/{invite_code}\` - Revoke invite link
- \`POST /channels/{channel_id}/invites\` - Create an invite (\`max_age\`, \`max_uses\`, \`temporary\`, \`unique\`; target fields are ignored)
- Invite target users (only listed users may accept): \`GET\` / \`PUT /invites/{invite_code}/target-users\` (CSV; PUT takes multipart \`target_users_file\`), \`GET .../target-users/job-status\`, \`POST .../target-users/bulk-add\` and \`/bulk-delete\` (\`user_ids\`, 1-1000), \`PUT\` / \`DELETE .../target-users/{user_id}\`. The inviter or Manage Server may change the list.`,
  },
  "resources/message": {
    slug: "resources/message",
    title: "Message Resource",
    section: "Resources",
    description: "Message object schema, embeds, components, attachments, and message REST endpoints.",
    content: `# Message Resource

Represents a text message sent in a channel, thread, DM or group DM. Message objects follow Discord v10: \`type\` (0 default, 19 reply, 20 command reply, 46 poll result, ...), \`mentions\` as user objects, \`mention_roles\`, \`mention_everyone\`, \`referenced_message\` + \`message_reference\` on replies, \`message_snapshots\` on forwards, \`sticker_items\`, \`webhook_id\`, \`reactions\` (with \`me\` for your bot), \`poll\` with results, \`position\` in threads and \`nonce\` on the create response. End-to-end encrypted DM messages are returned without content, attachments or embeds.

## Endpoints
- \`GET /channels/{channel.id}/messages\` - List messages, newest first. \`limit\` 1-100 (default 50) and one of \`around\`, \`before\`, \`after\` (a message id, or a snowflake whose timestamp is used). \`after\` returns the messages right after the cursor.
- \`GET /channels/{channel.id}/messages/{message.id}\` - Get one message
- \`POST /channels/{channel.id}/messages\` - Create message (JSON, or multipart with \`files[n]\` + \`payload_json\`)
- \`PATCH /channels/{channel.id}/messages/{message.id}\` - Edit message (others' messages: only \`flags\` to suppress embeds, with \`MANAGE_MESSAGES\`)
- \`DELETE /channels/{channel.id}/messages/{message.id}\` - Delete message (others' messages need \`MANAGE_MESSAGES\`, audited)
- \`POST /channels/{channel.id}/messages/bulk-delete\` - Delete 2-100 messages at once (\`MANAGE_MESSAGES\`; messages older than 14 days fail with 50034; returns 204)
- \`POST /channels/{channel.id}/messages/{message.id}/crosspost\` - Publish an announcement-channel message to followers
- \`GET /channels/{channel.id}/messages/pins\` - Pinned messages: \`{ items: [{ pinned_at, message }], has_more }\`, \`before\` (ISO8601) and \`limit\` (1-50)
- \`PUT\` / \`DELETE /channels/{channel.id}/messages/pins/{message.id}\` - Pin / unpin (\`PIN_MESSAGES\`; 250 pins per channel). The older \`/channels/{channel.id}/pins\` routes still work.
- \`GET /channels/{channel.id}/polls/{message.id}/answers/{answer_id}\` - Voters of a poll answer (\`after\`, \`limit\` 1-100)
- \`POST /channels/{channel.id}/polls/{message.id}/expire\` - End your poll now
- \`POST /channels/{channel.id}/typing\` - Show your bot as typing for about 10 seconds

## Creating and editing
- \`content\` up to 2000 characters.
- \`embeds\` up to 10, Discord's limits (title 256, description 4096, 25 fields, 6000 characters in total); URLs must be http(s). \`attachment://filename.png\` uses a file uploaded with the message. Embeds need \`EMBED_LINKS\`.
- \`allowed_mentions\` (\`parse\`, \`users\`, \`roles\`, \`replied_user\`) decides who is pinged before anything is notified. Without it every mention in the content pings (still limited by \`MENTION_EVERYONE\` and mentionable roles) and a reply pings its author.
- \`message_reference\`: \`{ message_id }\` replies in the same channel (\`fail_if_not_exists: false\` sends a normal message when the target is gone); \`{ type: 1, message_id, channel_id }\` forwards a message your bot can read (no other content allowed).
- \`nonce\` (string up to 25 characters or integer) is echoed back; with \`enforce_nonce: true\` a retry within 5 minutes returns the first message instead of posting twice.
- \`sticker_ids\` (one sticker), \`tts\` (needs \`SEND_TTS_MESSAGES\`), \`flags\` (\`SUPPRESS_EMBEDS\`, \`SUPPRESS_NOTIFICATIONS\`, \`IS_VOICE_MESSAGE\`, \`IS_COMPONENTS_V2\`), \`poll\` and \`attachments\` (file metadata; on edit, the attachments to keep).
- \`components\`: up to 5 action rows (buttons, selects), or a Components V2 layout with the \`IS_COMPONENTS_V2\` flag (below).

## Components V2
Set \`flags: 32768\` (\`IS_COMPONENTS_V2\`, 1 << 15) to build the message from layout components, like Discord. Works for bot messages (create / edit), interaction responses and followups (ephemeral too) and webhooks (\`?with_components=true\`).
- Top level: action row (1), section (9), text display (10), media gallery (12), file (13), separator (14), container (17). Thumbnails (11) only as a section accessory.
- Container (17): no nesting; holds action rows, sections, text displays, galleries, files, separators; \`accent_color\` 0x000000-0xFFFFFF or null; \`spoiler\`.
- Section (9): 1-3 text displays + \`accessory\` (thumbnail or button). Thumbnail: \`media.url\`, \`description\` (1024), \`spoiler\`.
- Media gallery (12): 1-10 items (\`media.url\`, \`description\` 1024, \`spoiler\`). File (13): \`file.url\` must be \`attachment://name\` of an upload; the response adds \`name\` and \`size\`. Separator (14): \`divider\` (default true), \`spacing\` 1 or 2.
- \`content\`, \`embeds\`, \`poll\`, \`sticker_ids\` must be absent; at most 40 components in total (nested ones count) and 4000 characters across text displays; ids are optional unique 32-bit ints (0 or missing = assigned in order).
- Media URLs: http(s) or \`attachment://\`. Attachments only show through components. The flag can't be removed on edit. Errors are 50035 with the field path (e.g. \`components.0.components.1.accessory.media.url\`).

\`\`\`json
{
  "flags": 32768,
  "components": [
    { "type": 17, "accent_color": 5793266, "components": [
      { "type": 10, "content": "# Weekly report" },
      { "type": 9, "components": [{ "type": 10, "content": "**Uptime** 99.98%" }],
        "accessory": { "type": 11, "media": { "url": "attachment://chart.png" } } },
      { "type": 14, "divider": true, "spacing": 1 },
      { "type": 12, "items": [{ "media": { "url": "https://example.com/a.png" } }] },
      { "type": 13, "file": { "url": "attachment://report.pdf" } },
      { "type": 1, "components": [{ "type": 2, "style": 1, "label": "Acknowledge", "custom_id": "report_ack" }] }
    ] }
  ]
}
\`\`\`

## Gateway events
\`MESSAGE_CREATE\` (with \`member\` and \`guild_id\` in servers), \`MESSAGE_UPDATE\` (full message), \`MESSAGE_DELETE\`, \`MESSAGE_DELETE_BULK\`, \`CHANNEL_PINS_UPDATE\`, \`TYPING_START\` (\`GUILD_MESSAGE_TYPING\` / \`DIRECT_MESSAGE_TYPING\`), \`MESSAGE_POLL_VOTE_ADD\` / \`_REMOVE\`. They fire for messages from users, bots, webhooks and the system, in channels, threads and DMs, and only reach bots that can see the channel.`,
  },
  "resources/reaction": {
    slug: "resources/reaction",
    title: "Reaction Resource",
    section: "Resources",
    description: "Message reaction count object schema and reaction user list endpoints.",
    content: `# Reaction Resource

Tracks emoji reaction totals and user lists on messages: \`{ count, count_details: { normal, burst }, me, me_burst, burst_colors, emoji }\`, where \`me\` is true when your bot reacted.

## Endpoints
- \`GET /channels/{channel_id}/messages/{message_id}/reactions/{emoji}\` - List reaction users (\`after\`, \`limit\`, \`type\`)
- See Reactions & Emoji Expressions for adding and removing reactions.`,
  },
  "resources/sticker": {
    slug: "resources/sticker",
    title: "Sticker Resource",
    section: "Resources",
    description: "Custom server sticker schemas, format types, and sticker management endpoints.",
    content: `# Sticker Resource

Custom illustrated sticker assets attached to server channels.

## Endpoints
- \`GET /guilds/{guild_id}/stickers\` - List guild stickers
- \`POST /guilds/{guild_id}/stickers\` - Upload new sticker`,
  },
  "resources/user": {
    slug: "resources/user",
    title: "User Resource",
    section: "Resources",
    description: "User object schema, profile metadata, badges, and user REST endpoints.",
    content: `# User Resource

Represents a SerikaCord user account or bot user.

## Endpoints
- \`GET /users/@me\` - Current user (bot token, or OAuth2 Bearer with \`identify\`; \`email\` adds email)
- \`PATCH /users/@me\` - Bots: change username (Serika handle rules, 2 per hour), avatar / banner (image data URI); sends USER_UPDATE
- \`GET /users/{user_id}\` - Public user object
- \`GET /users/@me/guilds\` - Partial guilds (before / after / limit 1-200 / with_counts); Bearer needs \`guilds\`
- \`GET /users/@me/guilds/{guild_id}/member\` - Own member object; Bearer needs \`guilds.members.read\`
- \`DELETE /users/@me/guilds/{guild_id}\` - Bot leaves the server
- \`GET /users/@me/connections\` - Bearer only, \`connections\` scope
- \`POST /users/@me/channels\` - Open a DM (\`recipient_id\`): only with users who share a server or already have a DM with the bot, who haven't blocked it and accept DMs; never with other bots (50007). With \`access_tokens\` (users' \`gdm.join\` tokens for your app) it creates a group DM.`,
  },
  "resources/voice": {
    slug: "resources/voice",
    title: "Voice Resource",
    section: "Resources",
    description: "Voice state schemas, voice regions, RTC connection parameters, and voice status.",
    content: `# Voice Resource

Represents voice channel connectivity and WebRTC audio session state.

Bots can see voice state but cannot carry audio yet: op 4 is answered with VOICE_SERVER_UPDATE \`endpoint: null\`.

## Endpoints
- \`GET /voice/regions\`, \`GET /guilds/{guild_id}/regions\` - One region, \`serika\`
- \`GET /guilds/{guild_id}/voice-states/{user_id}\` - A member's voice state (10065 when not in voice); \`@me\` is always 10065
- \`PATCH /guilds/{guild_id}/voice-states/{user_id}\` - Needs MUTE_MEMBERS; answers 10065 when the user isn't in voice, otherwise 50024 (suppress isn't supported); \`@me\` is always 10065
- \`PUT /channels/{channel_id}/voice-status\` - Voice channel status (see Channel)
- \`POST /channels/{channel_id}/send-soundboard-sound\` - Play a server soundboard sound to the channel (bot need not be connected)
- \`GET /soundboard-default-sounds\` - Empty (no built-in sounds); \`/guilds/{guild_id}/soundboard-sounds\` lists, creates, edits and deletes the server soundboard
- \`/stage-instances\` - Stage instance CRUD (topic, privacy_level 2)

## Events
- \`VOICE_STATE_UPDATE\` (GUILD_VOICE_STATES intent) on join, leave, mute, deafen, camera, screen share and moderator mute / deafen / disconnect
- \`voice_states\` in GUILD_CREATE`,
  },
  "topics/differences": {
    slug: "topics/differences",
    title: "Differences from Discord",
    section: "Topics",
    description: "Where the SerikaCord bot API behaves differently from Discord API v10.",
    content: `# Differences from Discord

- **Ids**: new apps see snowflakes and image hashes; apps created earlier see UUIDs and full URLs until switched in the portal.
- **CDN**: set the library CDN base to ${API.cdn} (discord.js \`rest.cdn\`, discord.py \`Asset.BASE\`); Discord CDN paths redirect to cdn.serika.chat. Images hosted elsewhere come back as null.
- **Voice**: no audio for bots; voice states and VOICE_STATE_UPDATE work; op 4 gets VOICE_SERVER_UPDATE endpoint null. send-soundboard-sound plays without the bot connected; voice-status always needs Manage Channels and isn't shown in the web client; stage instances send no start notification.
- **Presence**: op 3 activities show on the bot's profile; PRESENCE_UPDATE for bots with GUILD_PRESENCES.
- **OAuth2**: Bearer tokens work on the routes Discord allows them on. OpenID Connect (\`openid\`, \`/oauth2/userinfo\`, \`/oauth2/keys\`) and gdm.join work; linked roles are stored but no server uses them for roles yet. client_credentials tokens only get identify and applications.commands scopes.
- **Applications**: interaction callback types 10 and 12 are rejected (50035); \`event_webhooks_status\` 2 is refused (no webhook events); activity instances 404.
- **Incident actions**: only the invite pause is enforced; \`dms_disabled_until\` is stored and reported.
- **Scheduled events**: no recurrence, so no exceptions.
- **Lobbies**: app-scoped; text-only messages kept 72 hours; linked channels get a copy from the app's bot but nothing is relayed back; no lobby gateway events. Partner-sdk (provisional accounts) routes answer 530000.
- **Messages**: one sticker per message; shared_client_theme ignored; guild search ignores slop.
- **Monetization**: no payments; lists are empty, lookups 404.
- **Usernames**: unique lower-case handles (2-32 of a-z 0-9 _ .).`,
  },
  "resources/webhook": {
    slug: "resources/webhook",
    title: "Webhook Resource",
    section: "Resources",
    description: "Webhook object schema, tokenized execute endpoints, and channel webhooks.",
    content: `# Webhook Resource

Represents an incoming HTTP webhook attached to a text channel.

## Endpoints
- \`GET /channels/{channel_id}/webhooks\` - List channel webhooks
- \`POST /channels/{channel_id}/webhooks\` - Create (\`name\`, \`avatar\` as image data)
- \`POST /webhooks/{webhook_id}/{webhook_token}\` - Execute webhook (polls, forum posts with \`thread_name\` + \`applied_tags\`, \`?wait=true\`, \`?thread_id\`)
- \`POST /webhooks/{webhook_id}/{webhook_token}/slack\`, \`/github\` - Slack- and GitHub-compatible execute`,
  },
  "resources/lobby": {
    slug: "resources/lobby",
    title: "Lobby Resource",
    section: "Resources",
    description: "Discord-compatible Social SDK lobbies: members, lobby chat and linked channels.",
    content: `# Lobby Resource

Lobbies are groups of users of one application who can chat together, like Discord's Social SDK lobbies. A lobby belongs to the application that created it; other applications get 10031 Unknown lobby.

- Bot token: create, edit, delete lobbies and manage members. Users act through a Bearer token with the \`sdk.social_layer\` scope granted to your application.
- Members must be SerikaCord users who authorized your application (others are dropped; unknown users 404). Up to 1000 members per lobby, 100 lobbies per user, 10000 lobbies per application. Member flag 1 (CanLinkLobby) lets a member link a channel.
- \`idle_timeout_seconds\`: a lobby with no writes for that long is deleted on its next access.
- Lobby messages are text only (embeds, attachments, components, polls, stickers, replies and TTS are rejected with 50035), encrypted at rest and kept for 72 hours.
- A linked server text channel gets a copy of each lobby message, posted by your bot when it can send there. Messages sent in the channel are not relayed back. No lobby gateway events are sent.

## Endpoints
- \`POST /lobbies\`, \`PUT /lobbies\` (create, or join by \`secret\` with a user token), \`GET/PATCH/DELETE /lobbies/{lobby_id}\`
- \`PATCH /lobbies/{lobby_id}/channel-linking\` (link with \`channel_id\`, unlink without; needs View Channel, Send Messages and Manage Channels in that channel)
- \`POST /lobbies/{lobby_id}/members/bulk\`, \`PUT/DELETE /lobbies/{lobby_id}/members/{user_id}\`, \`DELETE /lobbies/{lobby_id}/members/@me\`
- \`POST /lobbies/{lobby_id}/members/@me/invites\`, \`POST /lobbies/{lobby_id}/members/{user_id}/invites\` (single-use, one-hour invite to the linked channel for that user)
- \`GET/POST /lobbies/{lobby_id}/messages\`, \`PUT /lobbies/{lobby_id}/messages/{message_id}/moderation-metadata\`

## Partner SDK
SerikaCord has no provisional accounts: \`POST /partner-sdk/token\`, \`/partner-sdk/token/bot\`, \`/partner-sdk/provisional-accounts/unmerge\` and \`/unmerge/bot\` validate the request (530007 for a bad client secret) and then answer 530000. \`PUT /partner-sdk/dms/{user_id_1}/{user_id_2}/messages/{message_id}/moderation-metadata\` stores app-scoped metadata on a DM message between two users who both authorized your application.`,
  },
  "resources/soundboard": {
    slug: "resources/soundboard",
    title: "Soundboard Resource",
    section: "Resources",
    description: "Server soundboard sounds: list, create, edit, delete and play them in voice channels.",
    content: `# Soundboard Resource

The server soundboard, the same sounds members play from the voice panel.

## Endpoints
- \`GET /soundboard-default-sounds\` - Always empty (SerikaCord has no built-in sounds)
- \`GET /guilds/{guild_id}/soundboard-sounds\` - \`{ items }\`; \`user\` only for bots with Create or Manage Expressions
- \`GET /guilds/{guild_id}/soundboard-sounds/{sound_id}\`
- \`POST /guilds/{guild_id}/soundboard-sounds\` - \`name\`, \`sound\` (audio data URI), \`volume\`, \`emoji_id\` / \`emoji_name\`; needs Create Expressions
- \`PATCH\` / \`DELETE /guilds/{guild_id}/soundboard-sounds/{sound_id}\` - Manage Expressions, or Create Expressions for your own sounds
- \`POST /channels/{channel_id}/send-soundboard-sound\` - Play to everyone in a voice channel (View Channel, Speak, Use Soundboard; Use External Sounds for another server's sound). The bot need not be connected.
- Gateway: op 31 Request Soundboard Sounds -> SOUNDBOARD_SOUNDS; GUILD_SOUNDBOARD_SOUND_CREATE / UPDATE / DELETE (GUILD_EXPRESSIONS); VOICE_CHANNEL_EFFECT_SEND when a sound plays. Changes are audit-logged (130-132).`,
  },
  "resources/stage-instance": {
    slug: "resources/stage-instance",
    title: "Stage Instance Resource",
    section: "Resources",
    description: "Stage instances: the topic and privacy level of a live stage channel.",
    content: `# Stage Instance Resource

A stage instance holds the topic of a live stage channel. One per stage channel.

## Endpoints
- \`POST /stage-instances\` - \`channel_id\`, \`topic\` (1-120), \`privacy_level\` (2 GUILD_ONLY; 1 is refused), \`send_start_notification\` (needs Mention Everyone; no notification is sent yet), \`guild_scheduled_event_id\`
- \`GET\` / \`PATCH\` / \`DELETE /stage-instances/{channel_id}\`

Needs the stage moderator permissions (Manage Channels, Mute Members and Move Members in the channel). Emits STAGE_INSTANCE_CREATE / UPDATE / DELETE and audit log entries 83-85.`,
  },
};

/**
 * Get doc content by slug (falls back gracefully with formatted title/section if not explicitly in registry)
 */
export function getDocContentBySlug(slug: string): DocContentItem {
  const normalized = slug.replace(/^\/+|\/+$/g, '');
  if (DOCS_CONTENT_REGISTRY[normalized]) {
    return DOCS_CONTENT_REGISTRY[normalized];
  }

  // Derive title & section from slug
  const parts = normalized.split('/');
  const rawTitle = parts[parts.length - 1] || 'Documentation';
  const title = rawTitle
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const section = parts.length > 1
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    : 'Documentation';

  return {
    slug: normalized,
    title,
    section,
    description: `SerikaCord API documentation for ${title}.`,
    content: `# ${title}\n\nSection: ${section}\n\nComplete API documentation and schema references for ${normalized}.\n\n- REST API Endpoint: ${API.rest}/${normalized}\n- Gateway WebSocket: ${API.gateway}\n- Authorization Header: \`Authorization: Bot YOUR_BOT_TOKEN_HERE\``,
  };
}

/**
 * Search doc content items across all registered documentation pages
 */
export function searchDocContent(query: string): DocContentItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return Object.values(DOCS_CONTENT_REGISTRY);

  return Object.values(DOCS_CONTENT_REGISTRY).filter((item) => {
    return (
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.slug.toLowerCase().includes(q) ||
      item.section.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q)
    );
  });
}
