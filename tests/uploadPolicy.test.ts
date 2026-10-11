import { describe, expect, test } from "bun:test";
import { checkAttachmentWhitelist, isInlineVideo } from "@/lib/chat/uploadPolicy";
import { DOWNLOAD_CONTENT_TYPE, fileExtension, isRiskyAttachment, storedAttachmentType } from "@/lib/chat/uploadPolicy";

const KNOWN = ["image/png", "text/plain", "application/zip", "video/mp4"];

describe("storedAttachmentType", () => {
  test("keeps known types", () => {
    expect(storedAttachmentType("image/png", KNOWN)).toBe("image/png");
    expect(storedAttachmentType("text/plain; charset=utf-8", KNOWN)).toBe("text/plain");
  });
  test("unknown and empty types (split archives) become downloads", () => {
    expect(storedAttachmentType("", KNOWN)).toBe(DOWNLOAD_CONTENT_TYPE);
    expect(storedAttachmentType("application/x-7z-compressed", KNOWN)).toBe(DOWNLOAD_CONTENT_TYPE);
  });
  test("page-like types are never kept, even if listed", () => {
    expect(storedAttachmentType("text/html", [...KNOWN, "text/html"])).toBe(DOWNLOAD_CONTENT_TYPE);
    expect(storedAttachmentType("image/svg+xml", [...KNOWN, "image/svg+xml"])).toBe(DOWNLOAD_CONTENT_TYPE);
  });
});

describe("isRiskyAttachment", () => {
  test("flags executables and admin-flagged types only", () => {
    expect(isRiskyAttachment("setup.EXE")).toBe(true);
    expect(isRiskyAttachment("backup.7z.001")).toBe(false);
    expect(isRiskyAttachment("a.bin", ["application/x-foo"], "application/x-foo")).toBe(true);
  });
  test("fileExtension", () => {
    expect(fileExtension("archive.7z.001")).toBe("001");
    expect(fileExtension(".bashrc")).toBe("");
  });
});

describe("checkAttachmentWhitelist", () => {
  const BUILT_IN = ["image/png", "text/plain"];
  test("the DB whitelist decides; exe is blocked unless listed", () => {
    const list = [{ type: "image/png", safe: true }];
    expect(checkAttachmentWhitelist("s.exe", "application/x-msdownload", list, BUILT_IN).allowed).toBe(false);
    expect(checkAttachmentWhitelist("a.png", "image/png", list, BUILT_IN)).toEqual({ allowed: true, warn: false });
  });
  test("file endings match files browsers send without a type", () => {
    const list = [{ type: ".7z.001", safe: true }, { type: ".zip", safe: true }];
    expect(checkAttachmentWhitelist("backup.7z.001", "", list, BUILT_IN).allowed).toBe(true);
    expect(checkAttachmentWhitelist("backup.7z.002", "", list, BUILT_IN).allowed).toBe(false);
    expect(checkAttachmentWhitelist("A.ZIP", "", list, BUILT_IN).allowed).toBe(true);
  });
  test("families, * and unsafe flags", () => {
    expect(checkAttachmentWhitelist("v.mp4", "video/mp4", [{ type: "video/*", safe: true }], BUILT_IN).allowed).toBe(true);
    expect(checkAttachmentWhitelist("x.bin", "", [{ type: "*", safe: true }], BUILT_IN).allowed).toBe(true);
    expect(checkAttachmentWhitelist("s.exe", "application/x-msdownload", [{ type: ".exe", safe: false }], BUILT_IN)).toEqual({ allowed: true, warn: true });
  });
  test("empty whitelist falls back to the built-in types", () => {
    expect(checkAttachmentWhitelist("a.txt", "text/plain", [], BUILT_IN).allowed).toBe(true);
    expect(checkAttachmentWhitelist("a.7z", "", [], BUILT_IN).allowed).toBe(false);
  });
});

describe("split archives", () => {
  test("a typeless part counts as application/octet-stream", () => {
    const list = [{ type: "application/octet-stream", safe: false }];
    expect(checkAttachmentWhitelist("backup.7z.001", "", list, [])).toEqual({ allowed: true, warn: true });
    expect(checkAttachmentWhitelist("setup.exe", "application/x-msdownload", list, []).allowed).toBe(false);
  });
  test(".7z.* covers every part", () => {
    const list = [{ type: ".7z.*", safe: true }];
    expect(checkAttachmentWhitelist("backup.7z.001", "", list, []).allowed).toBe(true);
    expect(checkAttachmentWhitelist("BACKUP.7Z.012", "", list, []).allowed).toBe(true);
    expect(checkAttachmentWhitelist("backup.zip", "", list, []).allowed).toBe(false);
  });
});

describe("MIME aliases", () => {
  test("video/matroska matches a video/x-matroska entry", () => {
    const list = [{ type: "video/x-matroska", safe: true }];
    expect(checkAttachmentWhitelist("a.mkv", "video/matroska", list, []).allowed).toBe(true);
    expect(storedAttachmentType("video/matroska", ["video/x-matroska"])).toBe("video/matroska");
  });
  test("aliases work in both directions", () => {
    expect(checkAttachmentWhitelist("a.wav", "audio/x-wav", [{ type: "audio/wav", safe: true }], []).allowed).toBe(true);
    expect(checkAttachmentWhitelist("a.zip", "application/x-zip-compressed", [{ type: "application/zip", safe: true }], []).allowed).toBe(true);
  });
});


describe("isInlineVideo", () => {
  test("mkv is a file card, other video plays inline", () => {
    expect(isInlineVideo("video/mp4", "a.mp4")).toBe(true);
    expect(isInlineVideo("video/webm", "a.webm")).toBe(true);
    expect(isInlineVideo("video/x-matroska", "a.mkv")).toBe(false);
    expect(isInlineVideo("video/matroska", "clip")).toBe(false);
    expect(isInlineVideo("video/webm", "rec.mkv")).toBe(false);
    expect(isInlineVideo("application/pdf", "a.pdf")).toBe(false);
  });
});
