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
  intro: {
    slug: "intro",
    title: "SerikaCord Developer Documentation",
    section: "Getting Started",
    description: "Build bots, apps, and integrations on SerikaCord — a 1:1-compatible mirror of the Discord API. If you can build a Discord bot, you can build a SerikaCord bot.",
    content: `# SerikaCord Developer Documentation

SerikaCord speaks the same REST routes, gateway opcodes, OAuth2 flows, and data structures as Discord. The official serika.js SDK handles everything natively, or existing discord.js / discord.py bots run with a one-line base-URL change.

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
- 100% Discord API Wire Compatibility: Opcodes, payloads, event names, and status codes match Discord v10.
- Single Authorization Model: Both REST and WebSocket Gateway use the same Bot token.
- Drop-in SDKs: Use serika.js natively or route discord.js/discord.py to SerikaCord endpoints.`,
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

## discord.py (Python with Custom Base URL)
\`\`\`python
import discord

class MyClient(discord.Client):
    async on_ready(self):
        print(f'Logged in as {self.user}')

    async on_message(self, message):
        if message.author == self.user:
            return
        if message.content == 'ping':
            await message.channel.send('pong')

# Route discord.py to SerikaCord API host
discord.http.Route.BASE = '${API.host}'
client = MyClient(intents=discord.Intents.default())
client.run('YOUR_BOT_TOKEN')
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
- **Interactions & Commands**: \`/applications/{application_id}/commands\`, \`/interactions/{interaction_id}/{interaction_token}/callback\`
- **Webhooks**: \`/webhooks/{webhook_id}/{webhook_token}\`
- **OAuth2**: \`/oauth2/authorize\`, \`/oauth2/token\`

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
- \`MESSAGE_CONTENT\` (1 << 15) - Privileged

## Privileged Intents
To receive message content (\`MESSAGE_CONTENT\`) or full member lists (\`GUILD_MEMBERS\`), toggle Privileged Gateway Intents in Developer Portal -> Bot -> Privileged Intents.`,
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
- \`9\`: \`MODAL\` (Pop up a form modal)

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
  "topics/gateway": {
    slug: "topics/gateway",
    title: "Gateway & WebSockets",
    section: "Topics",
    description: "Gateway opcodes, connection lifecycle, heartbeats, identify, and resume.",
    content: `# Gateway & Realtime WebSockets

Connect to \`${API.gateway}\` to maintain real-time bidirectional communication.

## Gateway Opcodes
- \`0\`: Dispatch (Receive events)
- \`1\`: Heartbeat (Send/Receive)
- \`2\`: Identify (Send client specs and token)
- \`6\`: Resume (Send session recovery request)
- \`7\`: Reconnect (Receive signal to reconnect)
- \`10\`: Hello (Receive initial heartbeat interval)
- \`11\`: Heartbeat ACK (Receive heartbeat confirmation)

## Handshake Flow
1. Client connects via WebSocket to \`${API.gateway}?v=10&encoding=json\`.
2. Server sends Opcode 10 (\`HELLO\`) with \`heartbeat_interval\` (e.g. 41250ms).
3. Client starts heartbeat timer sending Opcode 1 (\`HEARTBEAT\`) with last sequence number.
4. Client sends Opcode 2 (\`IDENTIFY\`) payload with token and intents.
5. Server sends Opcode 0 (\`READY\`) event containing initial bot state.`,
  },
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
- \`bot\`: Install bot user to server
- \`applications.commands\`: Register slash commands in server`,
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
- \`USE_EXTERNAL_EMOJIS\` (1 << 18)
- \`CONNECT\` (1 << 20)
- \`SPEAK\` (1 << 21)
- \`MUTE_MEMBERS\` (1 << 22)
- \`DEAFEN_MEMBERS\` (1 << 23)
- \`MOVE_MEMBERS\` (1 << 24)
- \`MANAGE_ROLES\` (1 << 28)
- \`MANAGE_WEBHOOKS\` (1 << 29)
- \`MANAGE_EMOJIS_AND_STICKERS\` (1 << 30)
- \`USE_APPLICATION_COMMANDS\` (1 << 31)`,
  },
  "topics/rate-limits": {
    slug: "topics/rate-limits",
    title: "Rate Limits",
    section: "Topics",
    description: "Rate limit headers, bucket IDs, 429 Too Many Requests responses, and retry delays.",
    content: `# Rate Limits

All REST requests are subject to global and route-specific rate limits.

## Rate Limit Response Headers
- \`X-RateLimit-Limit\`: Total allowed requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Epoch timestamp (seconds) when window resets
- \`X-RateLimit-Bucket\`: Rate limit bucket identifier

## 429 Rate Limit Error Payload
\`\`\`json
{
  "message": "You are being rate limited.",
  "retry_after": 1.25,
  "global": false
}
\`\`\``,
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
\`\`\``,
  },
  "resources/channel": {
    slug: "resources/channel",
    title: "Channel Resource",
    section: "Resources",
    description: "Channel object schema, channel types, and channel REST endpoints.",
    content: `# Channel Resource

Represents a guild text channel, voice channel, category, thread, or DM channel.

## Channel Types
- \`0\`: \`GUILD_TEXT\`
- \`1\`: \`DM\`
- \`2\`: \`GUILD_VOICE\`
- \`3\`: \`GROUP_DM\`
- \`4\`: \`GUILD_CATEGORY\`
- \`5\`: \`GUILD_ANNOUNCEMENT\`
- \`11\`: \`GUILD_PUBLIC_THREAD\`
- \`12\`: \`GUILD_PRIVATE_THREAD\`

## Endpoints
- \`GET /channels/{channel.id}\` - Get channel
- \`PATCH /channels/{channel.id}\` - Modify channel
- \`DELETE /channels/{channel.id}\` - Delete channel`,
  },
  "resources/message": {
    slug: "resources/message",
    title: "Message Resource",
    section: "Resources",
    description: "Message object schema, embeds, components, attachments, and message REST endpoints.",
    content: `# Message Resource

Represents a text message sent in a channel or thread.

## Object Schema
- \`id\`: string (Snowflake)
- \`channel_id\`: string
- \`author\`: User object
- \`content\`: string (Up to 2000 chars)
- \`timestamp\`: ISO 8601 timestamp
- \`edited_timestamp\`: ISO 8601 timestamp | null
- \`tts\`: boolean
- \`mention_everyone\`: boolean
- \`mentions\`: Array of User objects
- \`attachments\`: Array of Attachment objects
- \`embeds\`: Array of Embed objects
- \`components\`: Array of MessageComponent objects

## Endpoints
- \`GET /channels/{channel.id}/messages\` - List messages
- \`POST /channels/{channel.id}/messages\` - Create message
- \`GET /channels/{channel.id}/messages/{message.id}\` - Get message
- \`PATCH /channels/{channel.id}/messages/{message.id}\` - Edit message
- \`DELETE /channels/{channel.id}/messages/{message.id}\` - Delete message`,
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
- \`POST /guilds/{guild.id}/roles\` - Create new role`,
  },
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
};

/**
 * Get doc content by slug (falls back to basic generated content from nav info if not explicitly keyed)
 */
export function getDocContentBySlug(slug: string): DocContentItem {
  if (DOCS_CONTENT_REGISTRY[slug]) {
    return DOCS_CONTENT_REGISTRY[slug];
  }

  // Derive title from slug
  const title = slug
    .split('/')
    .pop()!
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    slug,
    title,
    section: slug.includes('/') ? slug.split('/')[0] : 'Documentation',
    description: `SerikaCord documentation for ${title}.`,
    content: `# ${title}\n\nDocumentation details for ${slug}.\nRefer to API Base: ${API.rest}`,
  };
}

/**
 * Search doc content items
 */
export function searchDocContent(query: string): DocContentItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return Object.values(DOCS_CONTENT_REGISTRY);

  return Object.values(DOCS_CONTENT_REGISTRY).filter((item) => {
    return (
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.slug.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q)
    );
  });
}
