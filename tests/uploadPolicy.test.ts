import { describe, expect, test } from "bun:test";
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
