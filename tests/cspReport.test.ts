import { describe, expect, test } from "bun:test";
import { parseCspReports } from "@/lib/security/cspReport";

describe("parseCspReports", () => {
  test("legacy application/csp-report body", () => {
    expect(parseCspReports({
      "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/mod.js?x=1", "document-uri": "https://serika.chat/channels/me" },
    })).toEqual([{ directive: "script-src-elem", blocked: "evil.example" }]);
  });

  test("Reporting API batch, keywords and schemes", () => {
    expect(parseCspReports([
      { type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline" } },
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data:image/png;base64,xx" } },
      { type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "chrome-extension://abc/x.js" } },
      { type: "deprecation", body: {} },
    ])).toEqual([
      { directive: "script-src-elem", blocked: "inline" },
      { directive: "img-src", blocked: "data" },
      { directive: "script-src", blocked: "extension" },
    ]);
  });

  test("garbage is dropped", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports({ "csp-report": { "effective-directive": "x y; drop table" } })).toEqual([{ directive: "x", blocked: "unknown" }]);
    expect(parseCspReports({ "csp-report": { "effective-directive": "<script>" } })).toEqual([]);
  });
});
