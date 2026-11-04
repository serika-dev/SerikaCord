import { describe, expect, test } from "bun:test";
import {
  BOT_MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  applyAttachmentTruth,
  clampAttachmentContentType,
  displayFilename,
  maxAttachmentsFor,
  mediaTypeMatchesExtension,
  normalizeBotAttachments,
  parseAttachmentRecord,
  sanitizeAttachmentFilename,
  storedKeyExtension,
  urlKeyExtension,
  validateMessageAttachments,
  type IncomingAttachment,
} from "@/lib/chat/attachmentPolicy";
import { MESSAGE_LIMITS } from "@/lib/constants/limits";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CDN = "https://cdn.serika.chat";
// The built-in render list (config.ALLOWED_FILE_TYPES) as far as these tests need it.
const KNOWN = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "audio/ogg", "audio/mpeg", "video/mp4", "application/pdf", "text/plain"];

const att = (file: string, extra: Partial<IncomingAttachment> = {}): IncomingAttachment => ({
  id: "1",
  filename: "cat.png",
  contentType: "image/png",
  url: `${CDN}/attachments/${ALICE}/${file}`,
  size: 1234,
  ...extra,
});

describe("attachment caps", () => {
  test("users get their tier's cap, bots Discord's 10", () => {
    expect(maxAttachmentsFor({ isPremium: false })).toBe(MESSAGE_LIMITS.FREE.maxAttachments);
    expect(maxAttachmentsFor(null)).toBe(MESSAGE_LIMITS.FREE.maxAttachments);
    expect(maxAttachmentsFor({ isPremium: true })).toBe(MESSAGE_LIMITS.SERIKA_PLUS.maxAttachments);
    expect(BOT_MAX_ATTACHMENTS).toBe(10);
  });

  test("validateMessageAttachments enforces the cap it is given", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => att(`f${i}.png`, { id: String(i) }));
    const opts = { cdnUrl: CDN, userId: ALICE };
    expect(validateMessageAttachments(many(10), { ...opts, maxAttachments: 10 })).toBeNull();
    expect(validateMessageAttachments(many(11), { ...opts, maxAttachments: 10 })).toBe("Too many attachments");
    expect(validateMessageAttachments(many(25), { ...opts, maxAttachments: 25 })).toBeNull();
    // Never above the absolute ceiling, whatever is passed.
    expect(validateMessageAttachments(many(MAX_ATTACHMENTS_PER_MESSAGE + 1), { ...opts, maxAttachments: 1000 })).toBe("Too many attachments");
  });

  test("bot JSON attachments are capped at 10", () => {
    const raw = Array.from({ length: 11 }, (_, i) => ({ url: `${CDN}/attachments/${BOT}/f${i}.png`, filename: `f${i}.png`, content_type: "image/png" }));
    expect("error" in normalizeBotAttachments(raw, { cdnUrl: CDN, botId: BOT })).toBe(true);
    expect("error" in normalizeBotAttachments(raw.slice(0, 10), { cdnUrl: CDN, botId: BOT })).toBe(false);
  });
});

describe("extensions", () => {
  test("storedKeyExtension mirrors StorageService's key naming", () => {
    expect(storedKeyExtension("Cat.PNG")).toBe("png");
    expect(storedKeyExtension("archive.tar.gz")).toBe("gz");
    expect(storedKeyExtension("README")).toBe("readme");
    expect(storedKeyExtension("odd.")).toBe("bin");
    expect(storedKeyExtension("x.ta-r")).toBe("tar");
  });

  test("urlKeyExtension reads the stored object's ending", () => {
    expect(urlKeyExtension(`${CDN}/attachments/${ALICE}/abc.exe`)).toBe("exe");
    expect(urlKeyExtension(`${CDN}/attachments/${ALICE}/abc.PNG?x=1`)).toBe("png");
    expect(urlKeyExtension(`${CDN}/attachments/${ALICE}/abc`)).toBe("");
  });
});

describe("content type vs extension", () => {
  test("media types need a media ending", () => {
    expect(mediaTypeMatchesExtension("image/png", "png")).toBe(true);
    expect(mediaTypeMatchesExtension("image/png", "jpg")).toBe(true); // mislabeled but a real image
    expect(mediaTypeMatchesExtension("image/png", "html")).toBe(false);
    expect(mediaTypeMatchesExtension("image/png", "svg")).toBe(false);
    expect(mediaTypeMatchesExtension("image/svg+xml", "svg")).toBe(false);
    expect(mediaTypeMatchesExtension("video/mp4", "exe")).toBe(false);
    expect(mediaTypeMatchesExtension("audio/ogg;codecs=opus", "ogg")).toBe(true);
    expect(mediaTypeMatchesExtension("video/webm", "webm")).toBe(true);
    expect(mediaTypeMatchesExtension("audio/mp4", "m4a")).toBe(true);
  });

  test("non-media types always match", () => {
    expect(mediaTypeMatchesExtension("application/pdf", "pdf")).toBe(true);
    expect(mediaTypeMatchesExtension("application/octet-stream", "exe")).toBe(true);
  });

  test("clamp downgrades spoofed and active types to a download", () => {
    expect(clampAttachmentContentType("image/png", "html", KNOWN)).toBe("application/octet-stream");
    expect(clampAttachmentContentType("image/png", "png", KNOWN)).toBe("image/png");
    expect(clampAttachmentContentType("text/html", "html", KNOWN)).toBe("application/octet-stream");
    expect(clampAttachmentContentType("image/svg+xml", "svg", KNOWN)).toBe("application/octet-stream");
    expect(clampAttachmentContentType("application/x-made-up", "bin", KNOWN)).toBe("application/octet-stream");
    expect(clampAttachmentContentType("application/pdf", "exe", KNOWN)).toBe("application/pdf");
  });
});

describe("file names", () => {
  test("sanitize strips bidi, zero-width, control characters and separators", () => {
    expect(sanitizeAttachmentFilename("invoice‮exe.pdf")).toBe("invoiceexe.pdf");
    expect(sanitizeAttachmentFilename("a​b\u0000c.txt")).toBe("abc.txt");
    expect(sanitizeAttachmentFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeAttachmentFilename("  lots   of   space .txt ")).toBe("lots of space .txt");
    expect(sanitizeAttachmentFilename(42)).toBe("");
    const long = sanitizeAttachmentFilename(`${"a".repeat(400)}.png`);
    expect(long.length).toBe(255);
    expect(long.endsWith(".png")).toBe(true);
  });

  test("display name always ends in the stored file's real extension", () => {
    expect(displayFilename("holiday.png", "png")).toBe("holiday.png");
    expect(displayFilename("README", "readme")).toBe("README");
    // A rename with the same extension is fine.
    expect(displayFilename("renamed.png", "png", "orig.png")).toBe("renamed.png");
    // A different extension falls back to the recorded upload name...
    expect(displayFilename("invoice.pdf", "exe", "setup.exe")).toBe("setup.exe");
    // ...or, with nothing recorded, shows the real ending.
    expect(displayFilename("invoice.pdf", "exe")).toBe("invoice.pdf.exe");
    expect(displayFilename("", "exe")).toBe("file.exe");
    expect(displayFilename("invoice‮fdp.exe", "exe")).toBe("invoicefdp.exe");
  });
});

describe("parseAttachmentRecord", () => {
  test("accepts a well-formed record and rejects junk", () => {
    const rec = { uploaderId: ALICE, filename: "a.png", contentType: "image/png", size: 10, width: 4, height: 3 };
    expect(parseAttachmentRecord(JSON.stringify(rec))).toEqual(rec);
    expect(parseAttachmentRecord(null)).toBeNull();
    expect(parseAttachmentRecord("not json")).toBeNull();
    expect(parseAttachmentRecord(JSON.stringify({ ...rec, size: -1 }))).toBeNull();
    expect(parseAttachmentRecord(JSON.stringify({ ...rec, contentType: 5 }))).toBeNull();
  });
});

describe("applyAttachmentTruth", () => {
  test("a record replaces name, type, size and dimensions", () => {
    const sent = att("k1.exe", { filename: "invoice.pdf", contentType: "application/pdf", size: 12 * 1024, width: 1, height: 1, spoiler: true });
    const out = applyAttachmentTruth(sent, {
      source: "record",
      record: { uploaderId: ALICE, filename: "setup.exe", contentType: "application/octet-stream", size: 48_000_000 },
    }, KNOWN);
    expect(out.filename).toBe("setup.exe");
    expect(out.contentType).toBe("application/octet-stream");
    expect(out.size).toBe(48_000_000);
    expect(out.width).toBeUndefined();
    expect(out.height).toBeUndefined();
    // Untouched fields stay.
    expect(out.spoiler).toBe(true);
    expect(out.url).toBe(sent.url);
    expect(out.id).toBe("1");
  });

  test("recorded image dimensions are applied", () => {
    const out = applyAttachmentTruth(att("k2.png", { width: 99999, height: 1 }), {
      source: "record",
      record: { uploaderId: ALICE, filename: "cat.png", contentType: "image/png", size: 500, width: 640, height: 480 },
    }, KNOWN);
    expect(out).toMatchObject({ contentType: "image/png", size: 500, width: 640, height: 480 });
  });

  test("bucket metadata is used when there is no record, still clamped", () => {
    const out = applyAttachmentTruth(att("k3.html", { filename: "cat.png", contentType: "image/png", size: 1 }), {
      source: "storage",
      contentType: "image/png", // an old upload stored under the client's label
      size: 2048,
      filename: "page.html",
    }, KNOWN);
    expect(out.contentType).toBe("application/octet-stream");
    expect(out.size).toBe(2048);
    expect(out.filename).toBe("page.html");
  });

  test("with nothing to look up, the client's values are clamped", () => {
    const spoof = applyAttachmentTruth(att("k4.html", { filename: "cat.png", contentType: "image/png", width: 100, height: 100 }), { source: "none" }, KNOWN);
    expect(spoof.contentType).toBe("application/octet-stream");
    expect(spoof.filename).toBe("cat.png.html");
    expect(spoof.width).toBeUndefined();

    const legit = applyAttachmentTruth(att("k5.png", { width: 100, height: 50 }), { source: "none" }, KNOWN);
    expect(legit).toMatchObject({ filename: "cat.png", contentType: "image/png", size: 1234, width: 100, height: 50 });

    const badSize = applyAttachmentTruth(att("k6.png", { size: Number.NaN }), { source: "none" }, KNOWN);
    expect(badSize.size).toBeUndefined();
  });

  test("encrypted blobs keep their opaque name and type", () => {
    const out = applyAttachmentTruth(att("k7.bin", { filename: "e2ee-abcdefghijklmnop.bin", contentType: "application/octet-stream", size: 5 }), {
      source: "record",
      record: { uploaderId: ALICE, filename: "e2ee-abcdefghijklmnop.bin", contentType: "application/octet-stream", size: 777 },
    }, KNOWN);
    expect(out).toMatchObject({ filename: "e2ee-abcdefghijklmnop.bin", contentType: "application/octet-stream", size: 777 });
  });

  test("voice fields pass through", () => {
    const out = applyAttachmentTruth(att("k8.ogg", { filename: "voice-message.ogg", contentType: "audio/ogg", durationSecs: 3, waveform: "AAAA" }), {
      source: "record",
      record: { uploaderId: ALICE, filename: "voice-message.ogg", contentType: "audio/ogg", size: 9000 },
    }, KNOWN);
    expect(out).toMatchObject({ contentType: "audio/ogg", durationSecs: 3, waveform: "AAAA", size: 9000 });
  });
});
