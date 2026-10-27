import { describe, expect, test } from "bun:test";
import { mcpRoutes } from "@/lib/api/mcp";
import { LATEST_VERSION, SUPPORTED_VERSIONS, decodeHeaderValue, readPin, selectVersion } from "@/lib/mcp/protocol";

const MODERN = "2026-07-28";
const meta = (v = MODERN) => ({
  "io.modelcontextprotocol/protocolVersion": v,
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
});

async function post(body: unknown, headers: Record<string, string> = {}, path = "/mcp") {
  const res = await mcpRoutes.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const modernHeaders = (method: string, name?: string) => ({
  "mcp-protocol-version": MODERN,
  "mcp-method": method,
  ...(name ? { "mcp-name": name } : {}),
});

describe("MCP versions (pure)", () => {
  test("latest is the default and every standard version is supported", () => {
    expect(LATEST_VERSION).toBe(MODERN);
    expect(SUPPORTED_VERSIONS).toEqual(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
  });

  test("?v= pins a version; unknown versions are rejected", () => {
    expect(readPin(undefined)).toEqual({ pin: null });
    expect(readPin("2024-11-05")).toEqual({ pin: "2024-11-05" });
    const bad = readPin("1999-01-01");
    expect("error" in bad && bad.error.code).toBe(-32022);
  });

  test("era selection", () => {
    expect(selectVersion({ method: "initialize", params: { protocolVersion: "2025-06-18" } }, {}, null)).toEqual({ era: "legacy", version: "2025-06-18" });
    expect(selectVersion({ method: "initialize", params: { protocolVersion: "2099-01-01" } }, {}, null)).toEqual({ era: "legacy", version: "2025-11-25" });
    expect(selectVersion({ method: "initialize", params: { protocolVersion: "2025-11-25" } }, {}, "2024-11-05")).toEqual({ era: "legacy", version: "2024-11-05" });
    expect(selectVersion({ method: "tools/list", params: { _meta: meta() } }, {}, null)).toEqual({ era: "modern", version: MODERN });
    expect(selectVersion({ method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" }, null)).toEqual({ era: "legacy", version: "2025-06-18" });
    expect(selectVersion({ method: "tools/list" }, {}, null)).toEqual({ era: "legacy", version: "2025-03-26" });
    const pinnedModern = selectVersion({ method: "initialize", params: { protocolVersion: "2025-11-25" } }, {}, MODERN);
    expect("error" in pinnedModern && pinnedModern.error.data).toEqual({ supported: [MODERN], requested: "2025-11-25" });
  });

  test("base64 header sentinel", () => {
    expect(decodeHeaderValue("plain")).toBe("plain");
    expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界");
  });
});

describe("MCP over HTTP", () => {
  test("modern server/discover lists every version, with resultType and serverInfo", async () => {
    const r = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta() } }, modernHeaders("server/discover"));
    expect(r.status).toBe(200);
    expect(r.json.result.resultType).toBe("complete");
    expect(r.json.result.supportedVersions).toEqual(SUPPORTED_VERSIONS);
    expect(r.json.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("serikacord-docs-mcp");
  });

  test("modern tools/list has titles and read-only annotations", async () => {
    const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta() } }, modernHeaders("tools/list"));
    const tool = r.json.result.tools[0];
    expect(tool.title).toBeTruthy();
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  test("modern header checks: missing or mismatched headers are -32020 (400)", async () => {
    const noHeader = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: meta() } });
    expect(noHeader.status).toBe(400);
    expect(noHeader.json.error.code).toBe(-32020);
    const wrongName = await post(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_docs_nav", arguments: {}, _meta: meta() } },
      modernHeaders("tools/call", "search_docs"),
    );
    expect(wrongName.json.error.code).toBe(-32020);
    const ok = await post(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_docs_nav", arguments: {}, _meta: meta() } },
      modernHeaders("tools/call", "get_docs_nav"),
    );
    expect(ok.status).toBe(200);
    expect(ok.json.result.resultType).toBe("complete");
  });

  test("modern: unsupported version is -32022 with the supported list; unknown method is 404", async () => {
    const r = await post({ jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: meta("1900-01-01") } }, { ...modernHeaders("tools/list"), "mcp-protocol-version": "1900-01-01" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32022);
    expect(r.json.error.data.supported).toEqual(SUPPORTED_VERSIONS);
    const nf = await post({ jsonrpc: "2.0", id: 7, method: "nope/nothing", params: { _meta: meta() } }, modernHeaders("nope/nothing"));
    expect(nf.status).toBe(404);
    expect(nf.json.error.code).toBe(-32601);
  });

  test("legacy initialize negotiates; ?v= pins", async () => {
    const r = await post({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    expect(r.json.result.protocolVersion).toBe("2025-06-18");
    expect(r.json.result.resultType).toBeUndefined();
    const pinned = await post({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {} } }, {}, "/mcp?v=2024-11-05");
    expect(pinned.json.result.protocolVersion).toBe("2024-11-05");
    const bad = await post({ jsonrpc: "2.0", id: 10, method: "ping" }, {}, "/mcp?v=2020-01-01");
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe(-32022);
  });

  test("legacy shapes: 2024-11-05 tools have no annotations; batches only in 2024-11-05 / 2025-03-26", async () => {
    const r = await post({ jsonrpc: "2.0", id: 11, method: "tools/list" }, { "mcp-protocol-version": "2024-11-05" }, "/mcp?v=2024-11-05");
    expect(r.json.result.tools[0].annotations).toBeUndefined();
    const batch = await post([{ jsonrpc: "2.0", id: 12, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], {}, "/mcp?v=2025-03-26");
    expect(Array.isArray(batch.json) && batch.json.length).toBe(1);
    const noBatch = await post([{ jsonrpc: "2.0", id: 13, method: "ping" }], { "mcp-protocol-version": "2025-06-18" });
    expect(noBatch.status).toBe(400);
  });

  test("legacy resource not found is -32002; notifications get 202", async () => {
    const r = await post({ jsonrpc: "2.0", id: 14, method: "resources/read", params: { uri: "nothing://here" } }, { "mcp-protocol-version": "2025-11-25" });
    expect(r.json.error.code).toBe(-32002);
    const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-11-25" });
    expect(n.status).toBe(202);
  });

  test("GET is metadata; an SSE GET and DELETE are 405", async () => {
    const meta = await mcpRoutes.handle(new Request("http://localhost/mcp"));
    const j = await meta.json();
    expect(j.defaultProtocolVersion).toBe(MODERN);
    expect(j.supportedProtocolVersions).toEqual(SUPPORTED_VERSIONS);
    const sse = await mcpRoutes.handle(new Request("http://localhost/mcp", { headers: { accept: "text/event-stream" } }));
    expect(sse.status).toBe(405);
    const del = await mcpRoutes.handle(new Request("http://localhost/mcp", { method: "DELETE" }));
    expect(del.status).toBe(405);
  });
});
