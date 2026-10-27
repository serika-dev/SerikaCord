import { DocPage, P, H2, H3, UL, CodeBlock, Callout, InlineCode, Endpoint, Table, CardGrid, Card } from "../DocPage";
import { Wrench, FileText, Sparkles } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Model Context Protocol (MCP) Endpoint",
  description:
    "Connect AI assistants, LLM tools, Cursor, Windsurf, and Claude Desktop directly to SerikaCord documentation, API schemas, gateway opcodes, permission tools, and templates.",
  path: "/developers/docs/mcp",
  keywords: [
    "SerikaCord MCP endpoint",
    "Model Context Protocol",
    "AI documentation endpoint",
    "Cursor MCP SerikaCord",
    "Claude Desktop MCP",
    "LLM docs server",
    "Gateway Opcodes MCP",
    "Permissions Bitmask MCP",
  ],
});

export default async function McpDoc() {
  const gt = await getGT();

  return (
    <DocPage
      title={gt("Model Context Protocol (MCP) Endpoint")}
      description={gt("Query documentation, inspect gateway opcodes, calculate permission bitmasks, and retrieve code templates in real time over the Model Context Protocol. The server speaks the latest MCP version (2026-07-28) by default and every earlier standard version back to 2024-11-05, with no authentication required.")}
    >
      <Callout type="info" title={gt("No Authentication Required")}>
        {gt("The SerikaCord documentation MCP server is public and unauthenticated (no auth). Any AI assistant, IDE extension, or custom LLM tool can issue JSON-RPC 2.0 requests directly to inspect endpoints, fetch docs, lookup Gateway opcodes, and compute permission bitmasks.")}
      </Callout>

      <H2 id="features-overview">{gt("MCP Server Feature Capabilities")}</H2>
      <CardGrid>
        <Card
          href="#mcp-tools"
          icon={<Wrench className="size-4" />}
          title={gt("8 Native Tools")}
        >
          {gt("Tools for fetching docs nav, page text, searching content, listing API endpoints, inspecting Gateway opcodes, calculating permission bitmasks, and validating tokens.")}
        </Card>
        <Card
          href="#mcp-resources"
          icon={<FileText className="size-4" />}
          title={gt("Dynamic Resources")}
        >
          {gt("URI resource schemes (docs://, config://, cheatsheet://, templates://) providing raw markdown pages, cheat sheets, and starter bot code.")}
        </Card>
        <Card
          href="#mcp-prompts"
          icon={<Sparkles className="size-4" />}
          title={gt("System Prompts")}
        >
          {gt("Pre-configured system prompts for bot architecture, Gateway debugging, and slash command definition generation.")}
        </Card>
      </CardGrid>

      <H2 id="endpoint-urls">{gt("Endpoint URLs")}</H2>
      <P>{gt("You can connect to the MCP server endpoint over HTTP POST or GET metadata on any of the following paths:")}</P>

      <Endpoint method="POST" path="https://api.serika.chat/api/v10/mcp">
        {gt("Primary versioned MCP endpoint for JSON-RPC 2.0 messages.")}
      </Endpoint>
      <Endpoint method="POST" path="https://api.serika.chat/api/mcp">
        {gt("Unversioned MCP endpoint alias.")}
      </Endpoint>
      <Endpoint method="POST" path="https://api.serika.chat/api/docs/mcp">
        {gt("Dedicated docs MCP endpoint alias.")}
      </Endpoint>

      <H2 id="protocol-versions">{gt("Protocol versions")}</H2>
      <P>{gt("One endpoint serves every standard MCP version. Clients get the latest by default; older clients keep working without any change.")}</P>
      <Table
        headers={[gt("Version"), gt("How a client uses it")]}
        rows={[
          [<InlineCode key="v1">2026-07-28</InlineCode>, gt("Latest and default. No handshake: every request carries its version, client info and capabilities in params._meta, plus the MCP-Protocol-Version, Mcp-Method and (for tools/call, resources/read and prompts/get) Mcp-Name headers. Call server/discover to list the supported versions.")],
          [<InlineCode key="v2">2025-11-25</InlineCode>, gt("initialize handshake, then the MCP-Protocol-Version header on each request. Server info includes icons and a description.")],
          [<InlineCode key="v3">2025-06-18</InlineCode>, gt("initialize handshake. Tools, prompts and resources include human-readable titles; JSON-RPC batches are not allowed.")],
          [<InlineCode key="v4">2025-03-26</InlineCode>, gt("initialize handshake. Tools include read-only annotations; batches are allowed. Requests without a MCP-Protocol-Version header are served as this version.")],
          [<InlineCode key="v5">2024-11-05</InlineCode>, gt("The original initialize handshake, plain tool definitions and batches.")],
        ]}
      />
      <H3 id="pin-version">{gt("Pinning a version")}</H3>
      <P>
        {gt("Add the v query parameter to the endpoint URL to make it speak exactly one version, for example")}{" "}
        <InlineCode>https://api.serika.chat/api/v10/mcp?v=2024-11-05</InlineCode>.{" "}
        {gt("A pinned endpoint answers initialize with that version and rejects requests for any other one. An unknown version is refused with error -32022 and the list of supported versions.")}
      </P>
      <H3 id="version-errors">{gt("Version and header errors")}</H3>
      <UL>
        <li><InlineCode>-32022</InlineCode> {gt("Unsupported protocol version (HTTP 400). The error data lists supported and requested, so a client can retry with a version it shares with the server.")}</li>
        <li><InlineCode>-32020</InlineCode> {gt("Header mismatch (HTTP 400): a required header is missing or does not match the request body. Applies to 2026-07-28 requests.")}</li>
        <li><InlineCode>-32601</InlineCode> {gt("Method not found. On 2026-07-28 requests the HTTP status is 404.")}</li>
        <li><InlineCode>-32002</InlineCode> {gt("Resource not found on 2025-11-25 and earlier; 2026-07-28 uses -32602 instead.")}</li>
      </UL>
      <P>{gt("The server is stateless: it never issues an Mcp-Session-Id, a GET that asks for an event stream and DELETE both answer 405, and every response is a single JSON object. A plain GET returns the server metadata, including the default and supported versions.")}</P>

      <H2 id="mcp-tools">{gt("Available MCP Tools")}</H2>
      <P>{gt("AI assistants automatically invoke these native tools to retrieve documentation context and API utilities:")}</P>

      <Table
        headers={[gt("Tool Name"), gt("Arguments"), gt("Description")]}
        rows={[
          [
            <InlineCode key="1">get_docs_nav</InlineCode>,
            <span key="2" className="text-[#555]">{gt("None")}</span>,
            gt("Returns the full hierarchical index of documentation sections, categories, and page slugs."),
          ],
          [
            <InlineCode key="3">get_doc_page</InlineCode>,
            <InlineCode key="4">slug: string</InlineCode>,
            gt("Fetches complete text, code examples, and structure for a given doc slug (e.g. 'intro', 'getting-started', 'topics/gateway')."),
          ],
          [
            <InlineCode key="5">search_docs</InlineCode>,
            <InlineCode key="6">query: string</InlineCode>,
            gt("Performs keyword search across documentation titles, descriptions, and body content."),
          ],
          [
            <InlineCode key="7">get_api_endpoints</InlineCode>,
            <span key="8" className="text-[#555]">{gt("None")}</span>,
            gt("Returns canonical SerikaCord API REST base URL, Gateway WebSocket URL, OAuth2 URLs, and authorization headers."),
          ],
          [
            <InlineCode key="9">get_gateway_opcodes</InlineCode>,
            <InlineCode key="10">opcode?: number</InlineCode>,
            gt("Returns Gateway Opcode reference (0-11), WebSocket close codes (4000-4014), and payload structures."),
          ],
          [
            <InlineCode key="11">get_permission_flags</InlineCode>,
            <InlineCode key="12">permissions?: string[]</InlineCode>,
            gt("Returns bitwise permissions table and calculates combined bitmask integer for specified permission flag names."),
          ],
          [
            <InlineCode key="13">get_code_example</InlineCode>,
            <InlineCode key="14">topic: string, language?: string</InlineCode>,
            gt("Returns executable code snippets for bot tasks (connect-gateway, send-message, register-slash-command) across languages (javascript, python, curl)."),
          ],
          [
            <InlineCode key="15">validate_bot_token</InlineCode>,
            <InlineCode key="16">token: string</InlineCode>,
            gt("Structural validation check for SerikaCord/Discord bot token formatting."),
          ],
        ]}
      />

      <H2 id="mcp-resources">{gt("Available MCP Resources")}</H2>
      <P>{gt("Documentation pages, configuration files, cheat sheets, and templates are registered under URI schemes:")}</P>

      <UL>
        <li><InlineCode>docs://&#123;slug&#125;</InlineCode> — {gt("Documentation pages in Markdown (e.g. docs://intro, docs://topics/gateway, docs://resources/message)")}</li>
        <li><InlineCode>config://api-endpoints</InlineCode> — {gt("JSON configuration of all API URLs and hosts")}</li>
        <li><InlineCode>cheatsheet://opcodes</InlineCode> — {gt("Quick cheat sheet for Gateway WebSocket Opcodes and close codes")}</li>
        <li><InlineCode>cheatsheet://permissions</InlineCode> — {gt("Bitwise permissions reference cheat sheet")}</li>
        <li><InlineCode>templates://bot-starter-js</InlineCode> — {gt("Node.js / JavaScript starter bot template")}</li>
        <li><InlineCode>templates://bot-starter-py</InlineCode> — {gt("Python discord.py / websockets starter bot template")}</li>
      </UL>

      <H2 id="mcp-prompts">{gt("Available MCP System Prompts")}</H2>
      <P>{gt("Pre-configured system prompts for guiding AI assistant workflows:")}</P>

      <UL>
        <li><InlineCode>serikacord-doc-assistant</InlineCode> — {gt("Developer assistance system prompt for SerikaCord API mirror.")}</li>
        <li><InlineCode>create-serikacord-bot</InlineCode> — {gt("Step-by-step assistant prompt to architect and build a new bot.")}</li>
        <li><InlineCode>debug-gateway-connection</InlineCode> — {gt("Diagnostic prompt to analyze WebSocket close codes and opcode errors.")}</li>
        <li><InlineCode>generate-slash-command</InlineCode> — {gt("Interactive prompt for generating slash command schemas and interaction handlers.")}</li>
      </UL>

      <H2 id="client-config">{gt("Connecting Your AI Clients")}</H2>

      <H3 id="claude-code-setup">{gt("1. Claude Code")}</H3>
      <CodeBlock lang="bash">{`claude mcp add --transport http serikacord-docs https://api.serika.chat/api/v10/mcp`}</CodeBlock>

      <H3 id="cursor-setup">{gt("2. Cursor and Windsurf")}</H3>
      <P>{gt("Add the endpoint to your project's")} <InlineCode>.cursor/mcp.json</InlineCode> {gt("or global Cursor MCP settings:")}</P>
      <CodeBlock lang="json">{`{
  "mcpServers": {
    "serikacord-docs": {
      "url": "https://api.serika.chat/api/v10/mcp"
    }
  }
}`}</CodeBlock>

      <H3 id="claude-desktop-setup">{gt("3. Claude Desktop")}</H3>
      <P>{gt("Add it as a custom connector with the endpoint URL, or bridge it through mcp-remote in your")} <InlineCode>claude_desktop_config.json</InlineCode>:</P>
      <CodeBlock lang="json">{`{
  "mcpServers": {
    "serikacord-docs": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.serika.chat/api/v10/mcp"]
    }
  }
}`}</CodeBlock>
      <P>{gt("An older client that only speaks one version can use a pinned URL instead, such as")} <InlineCode>https://api.serika.chat/api/v10/mcp?v=2025-06-18</InlineCode>.</P>

      <H3 id="json-rpc-request">{gt("4. Direct HTTP requests")}</H3>
      <P>{gt("A 2026-07-28 request carries the version and client details in params._meta and mirrors the method and tool name into headers:")}</P>
      <CodeBlock lang="bash">{`curl -X POST "https://api.serika.chat/api/v10/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2026-07-28" \\
  -H "Mcp-Method: tools/call" \\
  -H "Mcp-Name: get_permission_flags" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_permission_flags",
      "arguments": { "permissions": ["SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES"] },
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "curl", "version": "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'`}</CodeBlock>
      <P>{gt("Ask which versions the server supports:")}</P>
      <CodeBlock lang="bash">{`curl -X POST "https://api.serika.chat/api/v10/mcp" \\
  -H "Content-Type: application/json" \\
  -H "MCP-Protocol-Version: 2026-07-28" \\
  -H "Mcp-Method: server/discover" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'`}</CodeBlock>
      <P>{gt("The same call with the classic 2024-11-05 handshake, on a pinned endpoint:")}</P>
      <CodeBlock lang="bash">{`curl -X POST "https://api.serika.chat/api/v10/mcp?v=2024-11-05" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'

curl -X POST "https://api.serika.chat/api/v10/mcp?v=2024-11-05" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_permission_flags","arguments":{"permissions":["SEND_MESSAGES"]}}}'`}</CodeBlock>
    </DocPage>
  );
}
