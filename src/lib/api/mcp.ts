import { Elysia } from 'elysia';
import { API, docNav, getAllDocSlugs } from '@/lib/constants/docs-nav';
import { getDocContentBySlug, searchDocContent } from '@/lib/constants/docs-content';
import {
  ERR, HEADERLESS_LEGACY_VERSION, LATEST_VERSION, SUPPORTED_VERSIONS, allowsBatch, capabilitiesFor, isModern, readPin,
  selectVersion, serverInfoFor, shapeErrorCode, shapeResult, validateModernRequest, type McpError, type ServerIdentity,
} from '@/lib/mcp/protocol';

const SERVER_IDENTITY: ServerIdentity = {
  name: 'serikacord-docs-mcp',
  title: 'SerikaCord Docs',
  version: '1.3.0',
  description: 'Official Model Context Protocol Server for SerikaCord Documentation & API Specs',
  websiteUrl: 'https://serika.chat/developers/docs/mcp',
  icons: [{ src: 'https://serika.chat/icons/icon-192x192.png', mimeType: 'image/png', sizes: ['192x192'] }],
};

const SERVER_INSTRUCTIONS =
  'Use these tools to answer questions about building bots and integrations for SerikaCord (a Discord-API-v10-compatible chat platform): '
  + 'search_docs and get_doc_page for documentation, get_api_endpoints for base URLs, get_gateway_opcodes and get_permission_flags for reference tables, '
  + 'and get_code_example for snippets. Everything is read-only.';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

function buildJsonRpcResponse(id: string | number | null | undefined, result: any) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function buildJsonRpcError(id: string | number | null | undefined, code: number, message: string, data?: any) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  };
}

/** Gateway Opcodes Reference */
const GATEWAY_OPCODES = [
  { opcode: 0, name: 'Dispatch', direction: 'Receive', description: 'Dispatches an event from server to client (e.g. READY, MESSAGE_CREATE).' },
  { opcode: 1, name: 'Heartbeat', direction: 'Send/Receive', description: 'Used to maintain connection and measure latency.' },
  { opcode: 2, name: 'Identify', direction: 'Send', description: 'Initial handshake payload sent by bot with authentication token and intents.' },
  { opcode: 3, name: 'Presence Update', direction: 'Send', description: 'Updates bot online status and activity.' },
  { opcode: 4, name: 'Voice State Update', direction: 'Send', description: 'Joins, leaves, or moves voice channels.' },
  { opcode: 6, name: 'Resume', direction: 'Send', description: 'Resumes a disconnected gateway session.' },
  { opcode: 7, name: 'Reconnect', direction: 'Receive', description: 'Server forces client to disconnect and reconnect.' },
  { opcode: 8, name: 'Request Guild Members', direction: 'Send', description: 'Requests offline members of a guild.' },
  { opcode: 9, name: 'Invalid Session', direction: 'Receive', description: 'Session is invalid; client should re-identify or resume.' },
  { opcode: 10, name: 'Hello', direction: 'Receive', description: 'Sent upon connection with heartbeat_interval in milliseconds.' },
  { opcode: 11, name: 'Heartbeat ACK', direction: 'Receive', description: 'Sent in response to a client heartbeat.' },
];

/** Gateway Close Event Codes Reference */
const GATEWAY_CLOSE_CODES = [
  { code: 4000, name: 'Unknown error', reconnect: true, description: 'Unknown error occurred; try reconnecting.' },
  { code: 4001, name: 'Unknown opcode', reconnect: true, description: 'Invalid opcode sent to Gateway.' },
  { code: 4002, name: 'Decode error', reconnect: true, description: 'Invalid payload JSON sent.' },
  { code: 4003, name: 'Not authenticated', reconnect: true, description: 'Payload sent before Identify.' },
  { code: 4004, name: 'Authentication failed', reconnect: false, description: 'Invalid token specified in Identify.' },
  { code: 4005, name: 'Already authenticated', reconnect: true, description: 'More than one Identify sent.' },
  { code: 4007, name: 'Invalid seq', reconnect: true, description: 'Invalid sequence number provided during Resume.' },
  { code: 4008, name: 'Rate limited', reconnect: true, description: 'Sending payloads too quickly.' },
  { code: 4009, name: 'Session timed out', reconnect: true, description: 'Session expired; send fresh Identify.' },
  { code: 4010, name: 'Invalid shard', reconnect: false, description: 'Invalid shard credentials sent.' },
  { code: 4011, name: 'Sharding required', reconnect: false, description: 'Guild count requires sharding.' },
  { code: 4012, name: 'Invalid API version', reconnect: false, description: 'Unsupported Gateway API version.' },
  { code: 4013, name: 'Invalid intent(s)', reconnect: false, description: 'Invalid or disallowed Gateway intents specified.' },
  { code: 4014, name: 'Disallowed intent(s)', reconnect: false, description: 'Intent requested requires approval in Developer Portal.' },
];

/** Permission Bitwise Flags Table */
const PERMISSION_FLAGS = [
  { name: 'CREATE_INSTANT_INVITE', flag: '0x0000000000000001', bit: 0, description: 'Allows creation of instant invites.' },
  { name: 'KICK_MEMBERS', flag: '0x0000000000000002', bit: 1, description: 'Allows kicking members.' },
  { name: 'BAN_MEMBERS', flag: '0x0000000000000004', bit: 2, description: 'Allows banning members.' },
  { name: 'ADMINISTRATOR', flag: '0x0000000000000008', bit: 3, description: 'Grants all permissions and bypasses channel overrides.' },
  { name: 'MANAGE_CHANNELS', flag: '0x0000000000000010', bit: 4, description: 'Allows management and editing of channels.' },
  { name: 'MANAGE_GUILD', flag: '0x0000000000000020', bit: 5, description: 'Allows management and editing of guild settings.' },
  { name: 'ADD_REACTIONS', flag: '0x0000000000000040', bit: 6, description: 'Allows adding new emoji reactions to messages.' },
  { name: 'VIEW_AUDIT_LOG', flag: '0x0000000000000080', bit: 7, description: 'Allows viewing of guild audit logs.' },
  { name: 'PRIORITY_SPEAKER', flag: '0x0000000000000100', bit: 8, description: 'Allows using priority speaker in voice channels.' },
  { name: 'STREAM', flag: '0x0000000000000200', bit: 9, description: 'Allows video streaming in voice channels.' },
  { name: 'VIEW_CHANNEL', flag: '0x0000000000000400', bit: 10, description: 'Allows viewing channels and reading message history.' },
  { name: 'SEND_MESSAGES', flag: '0x0000000000000800', bit: 11, description: 'Allows sending text messages in channels.' },
  { name: 'SEND_TTS_MESSAGES', flag: '0x0000000000001000', bit: 12, description: 'Allows sending text-to-speech messages.' },
  { name: 'MANAGE_MESSAGES', flag: '0x0000000000002000', bit: 13, description: 'Allows deleting and pinning messages sent by others.' },
  { name: 'EMBED_LINKS', flag: '0x0000000000004000', bit: 14, description: 'Links posted will auto-embed.' },
  { name: 'ATTACH_FILES', flag: '0x0000000000008000', bit: 15, description: 'Allows uploading images and files.' },
  { name: 'READ_MESSAGE_HISTORY', flag: '0x0000000000010000', bit: 16, description: 'Allows reading message history.' },
  { name: 'MENTION_EVERYONE', flag: '0x0000000000020000', bit: 17, description: 'Allows using @everyone and @here mentions.' },
  { name: 'USE_EXTERNAL_EMOJIS', flag: '0x0000000000040000', bit: 18, description: 'Allows using emojis from other servers.' },
  { name: 'MANAGE_ROLES', flag: '0x0000000010000000', bit: 28, description: 'Allows creating and editing roles below highest role.' },
  { name: 'MANAGE_WEBHOOKS', flag: '0x0000000020000000', bit: 29, description: 'Allows creating and editing webhooks.' },
];

/** Pre-packaged code examples for common bot workflows */
const CODE_EXAMPLES: Record<string, Record<string, string>> = {
  'connect-gateway': {
    javascript: `import WebSocket from 'ws';

const ws = new WebSocket('${API.gateway}');

ws.on('open', () => {
  console.log('Connected to SerikaCord Gateway');
});

ws.on('message', (data) => {
  const payload = JSON.parse(data.toString());
  const { op, d, t } = payload;

  if (op === 10) { // Hello opcode
    const heartbeatInterval = d.heartbeat_interval;
    setInterval(() => {
      ws.send(JSON.stringify({ op: 1, d: null }));
    }, heartbeatInterval);

    // Identify
    ws.send(JSON.stringify({
      op: 2,
      d: {
        token: 'YOUR_BOT_TOKEN',
        intents: 513, // GUILDS + GUILD_MESSAGES
        properties: {
          os: 'linux',
          browser: 'serika.js',
          device: 'serika.js'
        }
      }
    }));
  }

  if (t === 'MESSAGE_CREATE') {
    console.log(\`[Message] \${d.author.username}: \${d.content}\`);
  }
});`,
    python: `import asyncio
import json
import websockets

GATEWAY_URL = "${API.gateway}"
BOT_TOKEN = "YOUR_BOT_TOKEN"

async def run_bot():
    async with websockets.connect(GATEWAY_URL) as ws:
        hello = json.loads(await ws.recv())
        interval = hello["d"]["heartbeat_interval"] / 1000.0

        async def heartbeat():
            while True:
                await asyncio.sleep(interval)
                await ws.send(json.dumps({"op": 1, "d": None}))

        asyncio.create_task(heartbeat())

        # Send Identify
        await ws.send(json.dumps({
            "op": 2,
            "d": {
                "token": BOT_TOKEN,
                "intents": 513,
                "properties": {"$os": "linux", "$browser": "python", "$device": "python"}
            }
        }))

        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            if data.get("t") == "MESSAGE_CREATE":
                print(f"Message from {data['d']['author']['username']}: {data['d']['content']}")

asyncio.run(run_bot())`,
    curl: `curl -X GET "${API.rest}/users/@me" \\
  -H "Authorization: Bot YOUR_BOT_TOKEN_HERE" \\
  -H "Content-Type: application/json"`
  },
  'send-message': {
    javascript: `const CHANNEL_ID = '1234567890';
const TOKEN = 'YOUR_BOT_TOKEN';

const response = await fetch(\`${API.rest}/channels/\${CHANNEL_ID}/messages\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bot \${TOKEN}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    content: 'Hello from SerikaCord Bot!',
    embeds: [{
      title: 'SerikaCord Embed',
      description: 'Built with REST API v10',
      color: 0x00FF88
    }]
  })
});

const data = await response.json();
console.log('Message sent:', data.id);`,
    python: `import requests

CHANNEL_ID = "1234567890"
TOKEN = "YOUR_BOT_TOKEN"

res = requests.post(
    f"${API.rest}/channels/{CHANNEL_ID}/messages",
    headers={
        "Authorization": f"Bot {TOKEN}",
        "Content-Type": "application/json"
    },
    json={
        "content": "Hello from Python SerikaCord bot!",
        "embeds": [{"title": "Python Embed", "color": 65280}]
    }
)
print("Sent message ID:", res.json()["id"])`,
    curl: `curl -X POST "${API.rest}/channels/CHANNEL_ID/messages" \\
  -H "Authorization: Bot YOUR_BOT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Hello world from cURL!"
  }'`
  },
  'register-slash-command': {
    javascript: `const APPLICATION_ID = 'YOUR_APP_ID';
const TOKEN = 'YOUR_BOT_TOKEN';

const response = await fetch(\`${API.rest}/applications/\${APPLICATION_ID}/commands\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bot \${TOKEN}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'ping',
    description: 'Replies with Pong!',
    options: []
  })
});

const command = await response.json();
console.log('Registered slash command:', command.name);`,
    curl: `curl -X POST "${API.rest}/applications/YOUR_APP_ID/commands" \\
  -H "Authorization: Bot YOUR_BOT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "info",
    "description": "Get bot status info"
  }'`
  }
};

function handleMcpMessage(body: JsonRpcRequest, version: string = LATEST_VERSION, pin: string | null = null) {
  if (!body || typeof body !== 'object') {
    return buildJsonRpcError(null, -32700, 'Parse error: Request body must be a valid JSON-RPC object');
  }

  const { id, method, params } = body;

  // Handle JSON-RPC Notifications (no id)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized' || method === 'cancelled') {
      return null; // No response needed for notification
    }
  }

  switch (method) {
    case 'initialize': {
      // Legacy handshake (2025-11-25 and earlier); `version` is already negotiated.
      return buildJsonRpcResponse(id, {
        protocolVersion: version,
        capabilities: capabilitiesFor(version),
        serverInfo: serverInfoFor(version, SERVER_IDENTITY),
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case 'server/discover': {
      return buildJsonRpcResponse(id, {
        supportedVersions: pin ? [pin] : [...SUPPORTED_VERSIONS],
        capabilities: capabilitiesFor(version),
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: 3_600_000,
        cacheScope: 'public',
      });
    }

    case 'logging/setLevel': {
      return buildJsonRpcResponse(id, {});
    }

    case 'completion/complete': {
      // Doc slugs for the docs://{slug} resource template; nothing else completes.
      const ref = params?.ref;
      const arg = params?.argument;
      const values = ref?.type === 'ref/resource' && ref?.uri === 'docs://{slug}' && arg?.name === 'slug'
        ? getAllDocSlugs().filter((s) => s.startsWith(String(arg?.value ?? ''))).slice(0, 100)
        : [];
      return buildJsonRpcResponse(id, { completion: { values, total: values.length, hasMore: false } });
    }

    case 'ping': {
      return buildJsonRpcResponse(id, {});
    }

    case 'tools/list': {
      return buildJsonRpcResponse(id, {
        tools: [
          {
            name: 'get_docs_nav',
            description: 'Returns the full hierarchical index of SerikaCord documentation sections, categories, and page slugs.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_doc_page',
            description: 'Retrieves complete text, code examples, and structure of a SerikaCord documentation page by slug (e.g. "intro", "getting-started", "quick-start", "bots/overview", "topics/gateway", "resources/message").',
            inputSchema: {
              type: 'object',
              properties: {
                slug: {
                  type: 'string',
                  description: 'The documentation page slug identifier',
                },
              },
              required: ['slug'],
            },
          },
          {
            name: 'search_docs',
            description: 'Search SerikaCord documentation titles, descriptions, and body text by query string.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search terms or keywords to query across documentation content.',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_api_endpoints',
            description: 'Returns canonical SerikaCord API REST base URL, Gateway WebSocket URL, OAuth2 URLs, and authorization headers.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_gateway_opcodes',
            description: 'Returns Discord/SerikaCord Gateway Opcode reference, WebSocket close event codes, and payload explanations.',
            inputSchema: {
              type: 'object',
              properties: {
                opcode: {
                  type: 'number',
                  description: 'Optional Gateway opcode number (0-11) to lookup specific opcode info.',
                },
              },
            },
          },
          {
            name: 'get_permission_flags',
            description: 'Returns bitwise permissions table, descriptions, and allows calculating total permissions integer from an array of permission names.',
            inputSchema: {
              type: 'object',
              properties: {
                permissions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional array of permission flag names (e.g. ["SEND_MESSAGES", "EMBED_LINKS"]) to calculate combined integer bitmask.',
                },
              },
            },
          },
          {
            name: 'get_code_example',
            description: 'Returns executable code snippets for bot tasks (connect-gateway, send-message, register-slash-command) across languages (javascript, python, curl).',
            inputSchema: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: 'Task identifier: "connect-gateway", "send-message", or "register-slash-command".',
                },
                language: {
                  type: 'string',
                  description: 'Programming language: "javascript", "python", or "curl".',
                },
              },
              required: ['topic'],
            },
          },
          {
            name: 'validate_bot_token',
            description: 'Checks structural validity and format of a SerikaCord/Discord Bot token string without performing live auth call.',
            inputSchema: {
              type: 'object',
              properties: {
                token: {
                  type: 'string',
                  description: 'The bot token string to check.',
                },
              },
              required: ['token'],
            },
          },
        ],
      });
    }

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (!toolName) {
        return buildJsonRpcError(id, -32602, 'Missing tool name in params.name');
      }

      if (toolName === 'get_docs_nav') {
        const text = JSON.stringify(docNav, null, 2);
        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'get_doc_page') {
        const slug = args.slug || 'intro';
        const doc = getDocContentBySlug(slug);
        const text = `# ${doc.title}\nSection: ${doc.section}\nDescription: ${doc.description}\n\n${doc.content}`;
        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'search_docs') {
        const query = args.query || '';
        const results = searchDocContent(query);
        const text = results.length > 0
          ? results.map((r) => `### [${r.title}] (${r.slug})\nSection: ${r.section}\n${r.description}\n`).join('\n---\n\n')
          : `No documentation matches found for query: "${query}"`;
        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'get_api_endpoints') {
        const text = `# SerikaCord API Endpoints Reference\n\n` +
          `- **REST Base URL (v10)**: ${API.rest}\n` +
          `- **REST Host (Unversioned)**: ${API.host}\n` +
          `- **Gateway WebSocket URL**: ${API.gateway}\n` +
          `- **OAuth2 Authorize URL**: ${API.authorize}\n` +
          `- **MCP Endpoint**: https://api.serika.chat/api/v10/mcp\n\n` +
          `## Authorization Header\n` +
          `\`\`\`http\nAuthorization: Bot YOUR_BOT_TOKEN_HERE\n\`\`\``;
        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'get_gateway_opcodes') {
        const reqOpcode = args.opcode;
        if (typeof reqOpcode === 'number') {
          const match = GATEWAY_OPCODES.find((o) => o.opcode === reqOpcode);
          const text = match
            ? `# Gateway Opcode ${match.opcode}: ${match.name}\n- Direction: ${match.direction}\n- Description: ${match.description}`
            : `Opcode ${reqOpcode} not found. Valid opcodes are 0 through 11.`;
          return buildJsonRpcResponse(id, { content: [{ type: 'text', text }] });
        }

        const opcodesFormatted = GATEWAY_OPCODES.map(
          (o) => `| ${o.opcode} | ${o.name} | ${o.direction} | ${o.description} |`
        ).join('\n');

        const closeCodesFormatted = GATEWAY_CLOSE_CODES.map(
          (c) => `| ${c.code} | ${c.name} | ${c.reconnect ? 'Yes' : 'No'} | ${c.description} |`
        ).join('\n');

        const text = `# SerikaCord / Discord Gateway Opcodes & Close Codes\n\n` +
          `## Opcodes\n` +
          `| Opcode | Name | Direction | Description |\n|---|---|---|---|\n${opcodesFormatted}\n\n` +
          `## WebSocket Close Event Codes\n` +
          `| Code | Name | Reconnectable? | Description |\n|---|---|---|---|\n${closeCodesFormatted}`;

        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'get_permission_flags') {
        const requestedPerms = args.permissions;
        let calculatedBitmaskStr = '';

        if (Array.isArray(requestedPerms) && requestedPerms.length > 0) {
          let mask = BigInt(0);
          const matched: string[] = [];
          const unknown: string[] = [];

          for (const perm of requestedPerms) {
            const found = PERMISSION_FLAGS.find((p) => p.name.toUpperCase() === perm.toUpperCase());
            if (found) {
              mask |= (BigInt(1) << BigInt(found.bit));
              matched.push(found.name);
            } else {
              unknown.push(perm);
            }
          }

          calculatedBitmaskStr = `\n## Calculated Bitmask\n` +
            `- **Requested Flags**: ${matched.join(', ')}\n` +
            `- **Bitmask Integer**: \`${mask.toString()}\` (0x${mask.toString(16)})\n` +
            (unknown.length > 0 ? `- **Unknown Flags**: ${unknown.join(', ')}\n` : '');
        }

        const flagsFormatted = PERMISSION_FLAGS.map(
          (p) => `| ${p.name} | \`1 << ${p.bit}\` | \`${p.flag}\` | ${p.description} |`
        ).join('\n');

        const text = `# SerikaCord Permissions Bitwise Table\n\n` +
          `| Permission | Bit Shift | Hex Flag | Description |\n|---|---|---|---|\n${flagsFormatted}\n` +
          calculatedBitmaskStr;

        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'get_code_example') {
        const topic = args.topic || 'connect-gateway';
        const lang = args.language || 'javascript';

        const topicExamples = CODE_EXAMPLES[topic];
        if (!topicExamples) {
          return buildJsonRpcError(
            id,
            -32602,
            `Unknown topic "${topic}". Available topics: ${Object.keys(CODE_EXAMPLES).join(', ')}`
          );
        }

        const snippet = topicExamples[lang] || topicExamples['javascript'];
        const text = `### Code Example: ${topic} (${lang})\n\n\`\`\`${lang}\n${snippet}\n\`\`\``;

        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      if (toolName === 'validate_bot_token') {
        const token = args.token || '';
        const parts = token.split('.');

        let valid = false;
        let reason = '';

        if (!token) {
          reason = 'Token string is empty.';
        } else if (parts.length !== 3) {
          reason = 'Token must contain exactly 3 dot-separated base64 parts (USER_ID.TIMESTAMP.HMAC).';
        } else if (parts[0].length < 15) {
          reason = 'First part (User ID segment) is suspiciously short.';
        } else if (parts[2].length < 20) {
          reason = 'HMAC signature segment is invalid or incomplete.';
        } else {
          valid = true;
          reason = 'Token structure matches standard bot token format.';
        }

        const text = JSON.stringify({ valid, tokenLength: token.length, reason }, null, 2);
        return buildJsonRpcResponse(id, {
          content: [{ type: 'text', text }],
        });
      }

      return buildJsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    case 'resources/list': {
      const allSlugs = getAllDocSlugs();
      const docResources = allSlugs.map((slug) => {
        const doc = getDocContentBySlug(slug);
        return {
          uri: `docs://${slug}`,
          name: doc.title,
          description: doc.description,
          mimeType: 'text/markdown',
        };
      });

      const systemResources = [
        {
          uri: 'config://api-endpoints',
          name: 'SerikaCord API Endpoints Configuration',
          description: 'JSON object containing REST base, Gateway WebSocket URL, OAuth2 URLs, and version identifiers.',
          mimeType: 'application/json',
        },
        {
          uri: 'cheatsheet://opcodes',
          name: 'Gateway Opcodes Cheat Sheet',
          description: 'Quick reference guide for Gateway WebSocket Opcodes (0-11) and close status codes.',
          mimeType: 'text/markdown',
        },
        {
          uri: 'cheatsheet://permissions',
          name: 'Permissions Bitwise Reference',
          description: 'Comprehensive table of all permission flags, bitwise offsets, and Descriptions.',
          mimeType: 'text/markdown',
        },
        {
          uri: 'templates://bot-starter-js',
          name: 'JavaScript / Node.js Bot Starter Template',
          description: 'Ready-to-run Node.js WebSocket bot starter code.',
          mimeType: 'text/plain',
        },
        {
          uri: 'templates://bot-starter-py',
          name: 'Python discord.py Bot Starter Template',
          description: 'Ready-to-run Python bot starter code using websockets/aiohttp.',
          mimeType: 'text/plain',
        },
      ];

      return buildJsonRpcResponse(id, { resources: [...docResources, ...systemResources] });
    }

    case 'resources/templates/list': {
      return buildJsonRpcResponse(id, {
        resourceTemplates: [
          {
            uriTemplate: 'docs://{slug}',
            name: 'Documentation Page Resource',
            description: 'Fetch complete documentation page content by slug',
            mimeType: 'text/markdown',
          },
        ],
      });
    }

    case 'resources/read': {
      const uri = params?.uri || '';

      if (uri.startsWith('docs://')) {
        const slug = uri.replace(/^docs:\/\//, '');
        const doc = getDocContentBySlug(slug);
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: `docs://${slug}`,
              mimeType: 'text/markdown',
              text: `# ${doc.title}\nSection: ${doc.section}\nDescription: ${doc.description}\n\n${doc.content}`,
            },
          ],
        });
      }

      if (uri === 'config://api-endpoints') {
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: 'config://api-endpoints',
              mimeType: 'application/json',
              text: JSON.stringify(API, null, 2),
            },
          ],
        });
      }

      if (uri === 'cheatsheet://opcodes') {
        const text = `# Gateway Opcodes Cheat Sheet\n\n` +
          GATEWAY_OPCODES.map((o) => `- **Opcode ${o.opcode} (${o.name})**: ${o.description}`).join('\n');
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: 'cheatsheet://opcodes',
              mimeType: 'text/markdown',
              text,
            },
          ],
        });
      }

      if (uri === 'cheatsheet://permissions') {
        const text = `# Permissions Bitwise Cheat Sheet\n\n` +
          PERMISSION_FLAGS.map((p) => `- **${p.name}** (\`1 << ${p.bit}\`): ${p.description}`).join('\n');
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: 'cheatsheet://permissions',
              mimeType: 'text/markdown',
              text,
            },
          ],
        });
      }

      if (uri === 'templates://bot-starter-js') {
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: 'templates://bot-starter-js',
              mimeType: 'text/plain',
              text: CODE_EXAMPLES['connect-gateway']['javascript'],
            },
          ],
        });
      }

      if (uri === 'templates://bot-starter-py') {
        return buildJsonRpcResponse(id, {
          contents: [
            {
              uri: 'templates://bot-starter-py',
              mimeType: 'text/plain',
              text: CODE_EXAMPLES['connect-gateway']['python'],
            },
          ],
        });
      }

      return buildJsonRpcError(id, -32602, `Resource not found: ${uri}`);
    }

    case 'prompts/list': {
      return buildJsonRpcResponse(id, {
        prompts: [
          {
            name: 'serikacord-doc-assistant',
            description: 'System instructions for an assistant helping developers build on SerikaCord.',
            arguments: [
              {
                name: 'topic',
                description: 'Optional topic name (e.g. gateway, bots, slash-commands)',
                required: false,
              },
            ],
          },
          {
            name: 'create-serikacord-bot',
            description: 'Guided assistant prompt to create a new SerikaCord bot application from scratch.',
            arguments: [
              {
                name: 'language',
                description: 'Target programming language (e.g. typescript, python, rust)',
                required: false,
              },
              {
                name: 'features',
                description: 'Features desired (e.g. slash-commands, gateway-events, auto-moderation)',
                required: false,
              },
            ],
          },
          {
            name: 'debug-gateway-connection',
            description: 'Diagnostic system prompt for troubleshooting Gateway WebSocket close codes and opcode errors.',
            arguments: [
              {
                name: 'closeCode',
                description: 'WebSocket close code number (e.g. 4004, 4008, 4014)',
                required: false,
              },
            ],
          },
          {
            name: 'generate-slash-command',
            description: 'Interactive prompt to generate application slash command JSON schemas and interaction handlers.',
            arguments: [
              {
                name: 'commandName',
                description: 'Name of the slash command',
                required: true,
              },
            ],
          },
        ],
      });
    }

    case 'prompts/get': {
      const promptName = params?.name || 'serikacord-doc-assistant';
      const args = params?.arguments || {};

      if (promptName === 'serikacord-doc-assistant') {
        const topic = args.topic || 'general';
        const promptText = `You are an expert developer assistant for SerikaCord.
SerikaCord is a 1:1 Discord API mirror.
REST Host: ${API.rest}
Gateway WebSocket: ${API.gateway}
Topic: ${topic}
Use the get_doc_page or search_docs tools to fetch exact API schemas, intents, and opcodes.`;

        return buildJsonRpcResponse(id, {
          description: 'SerikaCord Developer Assistance Prompt',
          messages: [{ role: 'user', content: { type: 'text', text: promptText } }],
        });
      }

      if (promptName === 'create-serikacord-bot') {
        const lang = args.language || 'TypeScript';
        const feat = args.features || 'Slash commands and Gateway event listeners';
        const promptText = `You are a bot architect designing a SerikaCord bot in ${lang}.
Target Features: ${feat}.
Base URLs:
- REST API: ${API.rest}
- Gateway: ${API.gateway}

Step 1: Provide project setup dependencies.
Step 2: Provide complete working bot source code.
Step 3: Provide instructions for bot token setup and running.`;

        return buildJsonRpcResponse(id, {
          description: 'Create SerikaCord Bot Prompt',
          messages: [{ role: 'user', content: { type: 'text', text: promptText } }],
        });
      }

      if (promptName === 'debug-gateway-connection') {
        const closeCode = args.closeCode || 'Unknown';
        const promptText = `You are a Gateway WebSocket debugging expert for SerikaCord.
Problem: Gateway disconnected with Close Code: ${closeCode}.
Gateway WebSocket URL: ${API.gateway}.
Analyze possible root causes (e.g. invalid opcode, token auth failure, missing heartbeat) and suggest concrete fixes.`;

        return buildJsonRpcResponse(id, {
          description: 'Debug Gateway Connection Prompt',
          messages: [{ role: 'user', content: { type: 'text', text: promptText } }],
        });
      }

      if (promptName === 'generate-slash-command') {
        const cmdName = args.commandName || 'example';
        const promptText = `Generate full SerikaCord slash command registration JSON and interaction payload handler for command "/${cmdName}".
REST Endpoint: POST ${API.rest}/applications/YOUR_APP_ID/commands.`;

        return buildJsonRpcResponse(id, {
          description: 'Generate Slash Command Prompt',
          messages: [{ role: 'user', content: { type: 'text', text: promptText } }],
        });
      }

      return buildJsonRpcError(id, -32602, `Unknown prompt name: ${promptName}`);
    }

    default:
      return buildJsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// Meta endpoint JSON object payload (GET on the MCP endpoint, for humans and probes).
const getMcpMeta = (pin: string | null) => ({
  status: 'online',
  name: SERVER_IDENTITY.name,
  version: SERVER_IDENTITY.version,
  mcp: true,
  auth: false,
  protocolVersion: pin ?? LATEST_VERSION,
  defaultProtocolVersion: LATEST_VERSION,
  supportedProtocolVersions: pin ? [pin] : [...SUPPORTED_VERSIONS],
  versionSelection: 'Modern clients (2026-07-28) send io.modelcontextprotocol/protocolVersion in params._meta on every request; legacy clients (2025-11-25 and earlier) use initialize. Add ?v=<version> to the endpoint URL to pin one version.',
  transport: 'streamable-http (POST, application/json responses)',
  endpoints: [
    '/api/mcp',
    '/api/v10/mcp',
    '/api/docs/mcp',
    '/api/v10/docs/mcp',
  ],
  description: 'Model Context Protocol (MCP) unauthenticated endpoint for SerikaCord documentation, API endpoints, gateway opcodes, permissions, and templates.',
  capabilities: {
    tools: ['get_docs_nav', 'get_doc_page', 'search_docs', 'get_api_endpoints', 'get_gateway_opcodes', 'get_permission_flags', 'get_code_example', 'validate_bot_token'],
    resources: ['docs://{slug}', 'config://api-endpoints', 'cheatsheet://opcodes', 'cheatsheet://permissions', 'templates://bot-starter-js', 'templates://bot-starter-py'],
    prompts: ['serikacord-doc-assistant', 'create-serikacord-bot', 'debug-gateway-connection', 'generate-slash-command'],
  },
});

type SetLike = { status?: number | string; headers: Record<string, string | number> };
type Ctx = { body?: unknown; set: SetLike; headers: Record<string, string | undefined>; query: Record<string, string | undefined> };

const cors = (set: SetLike) => {
  set.headers['Access-Control-Allow-Origin'] = '*';
  set.headers['Access-Control-Expose-Headers'] = 'MCP-Protocol-Version';
};

// Helper for HTTP OPTIONS preflight
const handleOptions = ({ set }: { set: SetLike }) => {
  cors(set);
  set.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID';
  set.status = 204;
  return null;
};

const rpcError = (id: unknown, err: McpError) => buildJsonRpcError((id ?? null) as string | number | null, err.code, err.message, err.data);

// Helper for HTTP GET: metadata JSON for humans and probes. No standalone SSE
// stream (2025-03-26..2025-11-25 allowed one; 2026-07-28 removed it): 405.
const handleGetMeta = ({ set, headers, query }: Ctx) => {
  cors(set);
  const pinned = readPin(query?.v);
  if ('error' in pinned) {
    set.status = 400;
    return rpcError(null, pinned.error);
  }
  if ((headers?.accept ?? '').includes('text/event-stream')) {
    set.status = 405;
    set.headers['Allow'] = 'POST';
    return '';
  }
  return getMcpMeta(pinned.pin);
};

// Sessions don't exist here (stateless server): DELETE is not allowed.
const handleDelete = ({ set }: Ctx) => {
  cors(set);
  set.status = 405;
  set.headers['Allow'] = 'POST';
  return '';
};

/** One JSON-RPC message: era/version selection, modern header checks, core handling, version shaping. */
function processMessage(msg: unknown, headers: Record<string, string | undefined>, pin: string | null): { status: number; body: unknown } {
  const m = (msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : {}) as JsonRpcRequest;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof m.method !== 'string') {
    return { status: 400, body: buildJsonRpcError(m.id ?? null, ERR.invalidRequest, 'Invalid Request: expected a JSON-RPC request or notification') };
  }
  const era = selectVersion(m, headers, pin);
  if ('error' in era) return { status: era.error.status, body: rpcError(m.id, era.error) };
  if (era.era === 'modern') {
    const invalid = validateModernRequest(m, headers);
    if (invalid) return { status: invalid.status, body: rpcError(m.id, invalid) };
  }
  // Notifications: accepted, never answered.
  if (m.id === undefined || m.id === null) return { status: 202, body: null };

  const res = handleMcpMessage(m, era.version, pin) as { error?: { code: number; message: string }; result?: unknown };
  if (res?.error) {
    const code = shapeErrorCode(m.method, res.error.code, res.error.message, era.version);
    const body = { ...res, error: { ...res.error, code } };
    // Modern HTTP: an unknown method is a 404 with -32601 (so legacy probes can tell modern servers apart).
    const status = isModern(era.version) && code === ERR.methodNotFound ? 404 : 200;
    return { status, body };
  }
  return { status: 200, body: { ...res, result: shapeResult(m.method, res.result, era.version, SERVER_IDENTITY) } };
}

// Helper for HTTP POST JSON-RPC
const handlePostJsonRpc = async ({ body, set, headers, query }: Ctx) => {
  cors(set);
  set.headers['Content-Type'] = 'application/json';
  const h = headers ?? {};
  const pinned = readPin(query?.v);
  if ('error' in pinned) {
    set.status = 400;
    return rpcError(null, pinned.error);
  }
  const pin = pinned.pin;

  if (Array.isArray(body)) {
    // JSON-RPC batches exist only in 2024-11-05 and 2025-03-26.
    const version = h['mcp-protocol-version'] ?? pin ?? HEADERLESS_LEGACY_VERSION;
    if (!allowsBatch(version)) {
      set.status = 400;
      return buildJsonRpcError(null, ERR.invalidRequest, `Invalid Request: batches are not supported in protocol version ${version}`);
    }
    const responses = body.map((m) => processMessage(m, h, pin).body).filter(Boolean);
    if (responses.length === 0) {
      set.status = 202;
      return '';
    }
    return responses;
  }

  if (body === undefined || body === null || typeof body !== 'object') {
    set.status = 400;
    return buildJsonRpcError(null, ERR.parse, 'Parse error: Request body must be a valid JSON-RPC object');
  }
  const out = processMessage(body, h, pin);
  set.status = out.status;
  if (out.body === null) return '';
  return out.body;
};

// Unauthenticated MCP Route definitions
export const mcpRoutes = new Elysia({ prefix: '' })
  // Options CORS Preflights
  .options('/mcp', handleOptions)
  .options('/v10/mcp', handleOptions)
  .options('/docs/mcp', handleOptions)
  .options('/v10/docs/mcp', handleOptions)

  // GET Meta info (405 for an SSE GET)
  .get('/mcp', handleGetMeta)
  .get('/v10/mcp', handleGetMeta)
  .get('/docs/mcp', handleGetMeta)
  .get('/v10/docs/mcp', handleGetMeta)

  // DELETE (legacy session termination): no sessions here
  .delete('/mcp', handleDelete)
  .delete('/v10/mcp', handleDelete)
  .delete('/docs/mcp', handleDelete)
  .delete('/v10/docs/mcp', handleDelete)

  // POST JSON-RPC handler for MCP methods
  .post('/mcp', handlePostJsonRpc)
  .post('/v10/mcp', handlePostJsonRpc)
  .post('/docs/mcp', handlePostJsonRpc)
  .post('/v10/docs/mcp', handlePostJsonRpc);
