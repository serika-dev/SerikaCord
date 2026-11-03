import { describe, expect, test } from "bun:test";
import { detectClientIntegrity } from "@/lib/clientIntegrity/detect";
import { parseSignals } from "@/lib/clientIntegrity/signals";

const nativeFetch = globalThis.fetch;

/** A clean page: native network functions, webpack's bound push installed. */
function page(extra: Record<string, unknown> = {}, scripts: string[] = []) {
  const queue: unknown[] & { push: (...a: unknown[]) => number } = [] as never;
  function webpackJsonpCallback(this: unknown, ...a: unknown[]) { return a.length; }
  queue.push = webpackJsonpCallback.bind(null);
  return {
    fetch: nativeFetch,
    WebSocket: globalThis.WebSocket,
    EventSource: undefined,
    XMLHttpRequest: undefined,
    webpackChunk_N_E: queue,
    location: { origin: "https://serika.chat" },
    document: { scripts: scripts.map((src) => ({ src })) },
    ...extra,
  } as Record<string, unknown>;
}

describe("detectClientIntegrity", () => {
  test("a clean page has no signals", () => {
    expect(detectClientIntegrity(page(), { allowedScriptHosts: ["cdn.serika.chat"] })).toEqual([]);
  });

  test("own and allowed scripts are fine", () => {
    const w = page({}, ["https://serika.chat/_next/static/chunks/main.js", "/_next/x.js", "https://cdn.serika.chat/a.js"]);
    expect(detectClientIntegrity(w, { allowedScriptHosts: ["cdn.serika.chat"] })).toEqual([]);
  });

  test("known mod globals", () => {
    expect(detectClientIntegrity(page({ Vencord: {} }))).toContain("mod_global");
    expect(detectClientIntegrity(page({ BdApi: {} }))).toContain("mod_global");
  });

  test("a replaced or trapped chunk loader", () => {
    const w = page();
    (w.webpackChunk_N_E as { push: unknown }).push = function patchedPush() { return 0; };
    expect(detectClientIntegrity(w)).toContain("webpack_hook");

    const trapped = page();
    delete trapped.webpackChunk_N_E;
    Object.defineProperty(trapped, "webpackChunk_N_E", { get: () => [], set: () => {}, configurable: true });
    expect(detectClientIntegrity(trapped)).toContain("webpack_hook");
  });

  test("a chunk queue the runtime hasn't taken over yet is not a hook", () => {
    expect(detectClientIntegrity(page({ webpackChunk_N_E: [] }))).not.toContain("webpack_hook");
  });

  test("patched network functions", () => {
    expect(detectClientIntegrity(page({ fetch: (...a: unknown[]) => nativeFetch(...(a as [string])) }))).toContain("network_patched");
  });

  test("the desktop shells' own fetch wrapper is not a mod", () => {
    expect(detectClientIntegrity(page({ __TAURI__: {}, fetch: (...a: unknown[]) => nativeFetch(...(a as [string])) }))).toEqual([]);
  });

  test("injected scripts", () => {
    expect(detectClientIntegrity(page({}, ["https://evil.example/mod.js"]))).toContain("remote_script");
    // Extension scripts aren't reported (password managers, dev tools inject them too).
    expect(detectClientIntegrity(page({}, ["chrome-extension://abc/inject.js"]))).toEqual([]);
  });
});

describe("parseSignals", () => {
  test("keeps only known ids, deduplicated, in a stable order", () => {
    expect(parseSignals(["webpack_hook", "nope", "mod_global", "mod_global", 3])).toEqual(["mod_global", "webpack_hook"]);
    expect(parseSignals("mod_global")).toEqual([]);
  });
});
