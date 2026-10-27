import { describe, expect, test } from "bun:test";
import { FormErrors } from "@/lib/botapi/formErrors";
import {
  COMPONENT_LIMITS,
  IS_COMPONENTS_V2,
  componentsToText,
  componentsV2Conflicts,
  countComponents,
  resolveAttachmentRefs,
  textDisplayLength,
  validateMessageComponents,
  type MessageComponent,
} from "@/lib/botapi/components";
import {
  accentHex,
  componentImageSrc,
  componentVideoSrc,
  galleryLayout,
  isComponentsV2Message,
  isTrustedMedia,
  isVideoMedia,
} from "@/lib/chat/componentsV2";

function v2(input: unknown) {
  const errors = new FormErrors();
  const result = validateMessageComponents(input, { flags: IS_COMPONENTS_V2, errors });
  return { result, errors, body: errors.toBody() };
}
const ok = (input: unknown) => {
  const r = v2(input);
  if (!r.errors.ok) throw new Error(r.errors.summary);
  return r.result!.components;
};
const bad = (input: unknown) => v2(input).errors.ok === false;
/** The error codes at a dotted path in the 50035 tree. */
function codesAt(body: { errors: unknown }, path: Array<string | number>): string[] {
  let node = body.errors as Record<string, unknown> | undefined;
  for (const seg of path) node = node?.[String(seg)] as Record<string, unknown> | undefined;
  return ((node?._errors as Array<{ code: string }>) ?? []).map((e) => e.code);
}

const text = (content = "hi", extra: Record<string, unknown> = {}) => ({ type: 10, content, ...extra });
const button = (custom_id = "b", extra: Record<string, unknown> = {}) => ({ type: 2, style: 1, label: "Go", custom_id, ...extra });
const link = (url = "https://serika.chat") => ({ type: 2, style: 5, label: "Open", url });
const thumb = (url = "https://example.com/t.png", extra: Record<string, unknown> = {}) => ({ type: 11, media: { url }, ...extra });
const section = (texts: unknown[], accessory: unknown = thumb()) => ({ type: 9, components: texts, accessory });
const gallery = (n: number, url = "https://example.com/g.png") => ({ type: 12, items: Array.from({ length: n }, () => ({ media: { url } })) });
const file = (url = "attachment://report.pdf", extra: Record<string, unknown> = {}) => ({ type: 13, file: { url }, ...extra });
const sep = (extra: Record<string, unknown> = {}) => ({ type: 14, ...extra });
const container = (components: unknown[], extra: Record<string, unknown> = {}) => ({ type: 17, components, ...extra });
const row = (...components: unknown[]) => ({ type: 1, components });

describe("components v2: valid payloads", () => {
  test("a full Discord-style layout validates and normalizes", () => {
    const out = ok([
      container([
        text("# Release notes"),
        section([text("New build is out"), text("Download below")], thumb("attachment://cover.png", { description: "Cover", spoiler: true })),
        sep({ divider: false, spacing: 2 }),
        gallery(3),
        file("attachment://notes.pdf", { spoiler: true }),
        section([text("Docs")], link("https://serika.chat/docs")),
        row(button("approve"), button("deny", { style: 4, label: "Deny" })),
      ], { accent_color: 0x5865f2, spoiler: false }),
      text("Footer, outside the container"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: 17, accent_color: 0x5865f2 });
    expect(out[0].spoiler).toBeUndefined();
    expect(out[0].components![2]).toMatchObject({ type: 14, divider: false, spacing: 2 });
    expect(out[0].components![1].accessory).toMatchObject({ type: 11, description: "Cover", spoiler: true });
  });

  test("every top-level type in the spec is accepted (thumbnail only as an accessory)", () => {
    for (const block of [row(button()), section([text()]), text(), gallery(1), file(), sep(), container([text()])]) {
      expect(bad([block])).toBeFalse();
    }
  });

  test("separator defaults: divider true, spacing 1", () => {
    expect(ok([sep()])[0]).toMatchObject({ divider: true, spacing: 1 });
  });

  test("unknown keys are dropped, media keeps only the url", () => {
    const out = ok([container([thumbSection()], { onclick: "x", style: "color:red" })]);
    expect(Object.keys(out[0])).not.toContain("onclick");
    expect(Object.keys(out[0])).not.toContain("style");
    const media = out[0].components![0].accessory!.media!;
    expect(media).toEqual({ url: "https://example.com/t.png" });
  });

  test("accent_color null and no accent are fine", () => {
    expect(ok([container([text()], { accent_color: null })])[0].accent_color).toBeNull();
    expect(ok([container([text()])])[0].accent_color).toBeUndefined();
  });

  function thumbSection() {
    // Bots can't smuggle attachment ids or sizes into media.
    return section([text()], { type: 11, media: { url: "https://example.com/t.png", attachment_id: "x", width: 9999, proxy_url: "https://evil" } });
  }
});

describe("components v2: nesting rules", () => {
  test("v2 types need the IS_COMPONENTS_V2 flag", () => {
    const errors = new FormErrors();
    expect(validateMessageComponents([text()], { flags: 0, errors })).toBeNull();
    expect(errors.ok).toBeFalse();
  });

  test("thumbnails are only section accessories", () => {
    expect(bad([thumb()])).toBeTrue();
    expect(bad([container([thumb()])])).toBeTrue();
  });

  test("containers cannot nest", () => {
    const r = v2([container([container([text()])])]);
    expect(r.errors.ok).toBeFalse();
    expect(codesAt(r.body, ["components", 0, "components", 0, "type"])).toContain("BASE_TYPE_CHOICES");
  });

  test("containers need children and only take layout / content components", () => {
    expect(bad([container([])])).toBeTrue();
    expect(bad([{ type: 17 }])).toBeTrue();
    for (const child of [row(button()), section([text()]), text(), gallery(1), file(), sep()]) {
      expect(bad([container([child])])).toBeFalse();
    }
    expect(bad([container([{ type: 4, custom_id: "t", style: 1 }])])).toBeTrue();
    expect(bad([container([{ type: 18, label: "x" }])])).toBeTrue();
  });

  test("sections hold 1-3 text displays and need a button or thumbnail accessory", () => {
    expect(bad([section([])])).toBeTrue();
    expect(bad([section([text("a"), text("b"), text("c")])])).toBeFalse();
    expect(bad([section([text("a"), text("b"), text("c"), text("d")])])).toBeTrue();
    expect(bad([section([button()])])).toBeTrue();
    expect(bad([section([text()], null)])).toBeTrue();
    expect(bad([section([text()], button("acc"))])).toBeFalse();
    expect(bad([section([text()], link())])).toBeFalse();
    expect(bad([section([text()], text("not an accessory"))])).toBeTrue();
    expect(bad([section([text()], gallery(1))])).toBeTrue();
  });

  test("action rows inside v2 keep the v1 rules", () => {
    expect(bad([row(...[1, 2, 3, 4, 5, 6].map((i) => button(`b${i}`)))])).toBeTrue();
    expect(bad([row({ type: 3, custom_id: "s", options: [{ label: "A", value: "a" }] }, button())])).toBeTrue();
    expect(bad([row(text())])).toBeTrue();
  });

  test("unknown component types are rejected with the allowed set", () => {
    const r = v2([{ type: 99 }]);
    expect(codesAt(r.body, ["components", 0, "type"])).toEqual(["BASE_TYPE_CHOICES"]);
  });
});

describe("components v2: limits", () => {
  test("40 components in total, counting nested ones and accessories", () => {
    const thirtyNine = Array.from({ length: 39 }, (_, i) => text(`t${i}`));
    expect(bad([container(thirtyNine)])).toBeFalse(); // 1 container + 39 = 40
    expect(bad([container([...thirtyNine, text("x")])])).toBeTrue(); // 41
    // 13 sections = 13 + 13 texts + 13 thumbnails = 39, plus one text = 40.
    const sections = Array.from({ length: 13 }, (_, i) => section([text(`s${i}`)]));
    expect(bad([...sections, text()])).toBeFalse();
    expect(bad([...sections, text(), text()])).toBeTrue();
    expect(countComponents(ok([...sections, text()]))).toBe(COMPONENT_LIMITS.TOTAL_V2);
  });

  test("text displays: 4000 characters in total across the message", () => {
    expect(bad([text("x".repeat(4000))])).toBeFalse();
    expect(bad([text("x".repeat(4001))])).toBeTrue();
    expect(bad([text("x".repeat(2000)), container([text("y".repeat(2000))])])).toBeFalse();
    const over = v2([text("x".repeat(2000)), section([text("y".repeat(2001))])]);
    expect(over.errors.ok).toBeFalse();
    expect(codesAt(over.body, ["components"])).toContain("BASE_TYPE_MAX_LENGTH");
    expect(textDisplayLength(ok([text("ab"), section([text("cde")])]))).toBe(5);
  });

  test("text display content is required", () => {
    expect(bad([text("")])).toBeTrue();
    expect(bad([{ type: 10 }])).toBeTrue();
    expect(bad([{ type: 10, content: 5 }])).toBeTrue();
  });

  test("media gallery: 1-10 items, descriptions up to 1024", () => {
    expect(bad([gallery(0)])).toBeTrue();
    expect(bad([gallery(10)])).toBeFalse();
    expect(bad([gallery(11)])).toBeTrue();
    expect(bad([{ type: 12, items: [{ media: { url: "https://e.x/a.png" }, description: "d".repeat(1024) }] }])).toBeFalse();
    expect(bad([{ type: 12, items: [{ media: { url: "https://e.x/a.png" }, description: "d".repeat(1025) }] }])).toBeTrue();
    expect(bad([{ type: 12, items: [{}] }])).toBeTrue();
  });

  test("thumbnail: media required, description up to 1024", () => {
    expect(bad([section([text()], { type: 11 })])).toBeTrue();
    expect(bad([section([text()], thumb(undefined, { description: "d".repeat(1025) }))])).toBeTrue();
  });

  test("separator spacing is 1 or 2, divider a boolean", () => {
    expect(bad([sep({ spacing: 2 })])).toBeFalse();
    expect(bad([sep({ spacing: 0 })])).toBeTrue();
    expect(bad([sep({ spacing: 3 })])).toBeTrue();
    expect(bad([sep({ divider: "yes" })])).toBeTrue();
  });

  test("container accent_color is 0x000000-0xFFFFFF", () => {
    expect(bad([container([text()], { accent_color: 0 })])).toBeFalse();
    expect(bad([container([text()], { accent_color: 0xffffff })])).toBeFalse();
    expect(bad([container([text()], { accent_color: 0x1000000 })])).toBeTrue();
    expect(bad([container([text()], { accent_color: -1 })])).toBeTrue();
    expect(bad([container([text()], { accent_color: 1.5 })])).toBeTrue();
    expect(bad([container([text()], { accent_color: "#ff0000" })])).toBeTrue();
  });
});

describe("components v2: ids", () => {
  test("missing ids are assigned sequentially, depth-first, skipping explicit ones", () => {
    const out = ok([container([text("a", { id: 2 }), section([text("b")])]), text("c")]);
    expect(out[0].id).toBe(1);
    expect(out[0].components![0].id).toBe(2);
    expect(out[0].components![1].id).toBe(3);
    expect(out[0].components![1].components![0].id).toBe(4);
    expect(out[0].components![1].accessory!.id).toBe(5);
    expect(out[1].id).toBe(6);
  });

  test("id 0 counts as empty and gets an id", () => {
    expect(ok([text("a", { id: 0 })])[0].id).toBe(1);
  });

  test("ids are unique 32-bit non-negative integers", () => {
    const dup = v2([text("a", { id: 7 }), container([text("b", { id: 7 })])]);
    expect(dup.errors.ok).toBeFalse();
    expect(codesAt(dup.body, ["components", 1, "components", 0, "id"])).toEqual(["COMPONENT_CUSTOM_ID_DUPLICATED"]);
    expect(bad([text("a", { id: 2147483647 })])).toBeFalse();
    expect(bad([text("a", { id: 2147483648 })])).toBeTrue();
    expect(bad([text("a", { id: -1 })])).toBeTrue();
    expect(bad([text("a", { id: "5" })])).toBeTrue();
    expect(bad([text("a", { id: 1.5 })])).toBeTrue();
  });
});

describe("components v2: interactive components", () => {
  test("custom_id is unique across rows, containers and section accessories", () => {
    expect(bad([row(button("x")), container([section([text()], button("x"))])])).toBeTrue();
    expect(bad([row(button("x")), container([section([text()], button("y"))])])).toBeFalse();
  });

  test("custom_id is required on non-link buttons and up to 100 characters", () => {
    expect(bad([section([text()], { type: 2, style: 1, label: "x" })])).toBeTrue();
    expect(bad([section([text()], button("c".repeat(100)))])).toBeFalse();
    expect(bad([section([text()], button("c".repeat(101)))])).toBeTrue();
  });

  test("link buttons need an http(s) url and no custom_id", () => {
    expect(bad([section([text()], { ...link(), custom_id: "x" })])).toBeTrue();
    expect(bad([section([text()], link("javascript:alert(1)"))])).toBeTrue();
  });
});

describe("components v2: media URLs", () => {
  test("http(s) and attachment:// are accepted, the rest is not", () => {
    expect(bad([gallery(1, "http://example.com/a.png")])).toBeFalse();
    expect(bad([gallery(1, "attachment://a.png")])).toBeFalse();
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///etc/passwd", "ftp://e.x/a.png", "//e.x/a.png", "https://user:pw@e.x/a.png", "attachment://a/b.png", ""]) {
      expect(bad([gallery(1, url)])).toBeTrue();
    }
    const r = v2([container([section([text()], thumb("javascript:x"))])]);
    expect(codesAt(r.body, ["components", 0, "components", 0, "accessory", "media", "url"])).toEqual(["URL_TYPE_INVALID_SCHEME"]);
  });

  test("media URLs are at most 2048 characters", () => {
    expect(bad([gallery(1, `https://e.x/${"a".repeat(2030)}`)])).toBeFalse();
    expect(bad([gallery(1, `https://e.x/${"a".repeat(2040)}`)])).toBeTrue();
  });

  test("file components only take attachment:// references", () => {
    expect(bad([file("https://example.com/a.pdf")])).toBeTrue();
    expect(bad([file("attachment://a.pdf")])).toBeFalse();
  });

  test("attachment refs resolve to uploads, with proxy_url, and file name / size", () => {
    const { result } = v2([section([text()], thumb("attachment://cover.png")), file("attachment://notes.pdf")]);
    expect(result!.attachmentRefs.sort()).toEqual(["cover.png", "notes.pdf"]);
    const r = resolveAttachmentRefs(result!.components, [
      { id: "a1", filename: "cover.png", url: "https://cdn.serika.chat/a/cover.png", contentType: "image/png", width: 64, height: 64, size: 1000 },
      { id: "a2", filename: "notes.pdf", url: "https://cdn.serika.chat/a/notes.pdf", contentType: "application/pdf", size: 2048 },
    ]);
    expect(r.ok).toBeTrue();
    if (!r.ok) return;
    expect(r.components[0].accessory!.media).toEqual({
      url: "https://cdn.serika.chat/a/cover.png", proxy_url: "https://cdn.serika.chat/a/cover.png", attachment_id: "a1", content_type: "image/png", width: 64, height: 64,
    });
    expect(r.components[1]).toMatchObject({ type: 13, name: "notes.pdf", size: 2048, file: { attachment_id: "a2" } });
    expect(resolveAttachmentRefs(result!.components, []).ok).toBeFalse();
  });
});

describe("components v2: message-level rules", () => {
  test("content, embeds, poll and stickers must be absent", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ content: "hi" }, "content"],
      [{ embeds: [{ title: "x" }] }, "embeds"],
      [{ embed: { title: "x" } }, "embeds"],
      [{ poll: { question: { text: "q" } } }, "poll"],
      [{ sticker_ids: ["1"] }, "sticker_ids"],
    ];
    for (const [body, field] of cases) {
      const errors = new FormErrors();
      componentsV2Conflicts(errors, body);
      expect(codesAt(errors.toBody(), [field])).toEqual(["COMPONENT_INVALID"]);
    }
    const empty = new FormErrors();
    componentsV2Conflicts(empty, { content: "", embeds: [], poll: null, sticker_ids: [] });
    expect(empty.ok).toBeTrue();
  });

  test("an edit can't leave old text or embeds behind, unless it clears them", () => {
    const keep = new FormErrors();
    componentsV2Conflicts(keep, {}, { content: true, embeds: true });
    expect(keep.count).toBe(2);
    const cleared = new FormErrors();
    componentsV2Conflicts(cleared, { content: "", embeds: [] }, { content: true, embeds: true });
    expect(cleared.ok).toBeTrue();
  });

  test("app bodies (webhooks, interaction responses) follow the same rules", async () => {
    const { parseOutgoingMessage, isEmptyOutgoing } = await import("@/lib/services/outgoingMessage");
    const comps = [container([text("hi")])];
    expect(parseOutgoingMessage({ flags: IS_COMPONENTS_V2, components: comps, sticker_ids: ["1"] }, { mode: "create" }).ok).toBeFalse();
    expect(parseOutgoingMessage({ flags: IS_COMPONENTS_V2, components: comps, embeds: [{ title: "x" }] }, { mode: "create" }).ok).toBeFalse();
    const created = parseOutgoingMessage({ flags: IS_COMPONENTS_V2, components: comps }, { mode: "create" });
    expect(created.ok).toBeTrue();
    if (!created.ok) return;
    expect(created.message.flags & IS_COMPONENTS_V2).toBe(IS_COMPONENTS_V2);
    expect(isEmptyOutgoing(created.message, 0)).toBeFalse();
    // Without components a v2 message shows nothing, even with files.
    const none = parseOutgoingMessage({ flags: IS_COMPONENTS_V2 }, { mode: "create" });
    expect(none.ok && isEmptyOutgoing(none.message, 2)).toBeTrue();

    // Edits: the flag can't be removed, and components validate as v2 without resending it.
    const edit = parseOutgoingMessage({ flags: 0, components: comps }, { mode: "edit", existingFlags: IS_COMPONENTS_V2 });
    expect(edit.ok && (edit.message.flags & IS_COMPONENTS_V2)).toBe(IS_COMPONENTS_V2);
    const noFlags = parseOutgoingMessage({ components: comps }, { mode: "edit", existingFlags: IS_COMPONENTS_V2 });
    expect(noFlags.ok).toBeTrue();
    expect(parseOutgoingMessage({ content: "new text" }, { mode: "edit", existingFlags: IS_COMPONENTS_V2 }).ok).toBeFalse();
    // Turning v2 on while the message still has text fails until the text is cleared.
    expect(parseOutgoingMessage({ flags: IS_COMPONENTS_V2, components: comps }, { mode: "edit", existingContent: true }).ok).toBeFalse();
    expect(parseOutgoingMessage({ flags: IS_COMPONENTS_V2, components: comps, content: "" }, { mode: "edit", existingContent: true }).ok).toBeTrue();
  });
});

describe("components v2: text fallback (Discord bridge)", () => {
  test("text displays, link buttons and external media become text; uploads and junk are skipped", () => {
    const list = [
      container([
        text("# Title"),
        section([text("Body")], link("https://serika.chat/docs")),
        { type: 12, items: [{ media: { url: "https://e.x/a.png" } }, { media: { url: "https://cdn.discordapp.com/x.png", attachment_id: "1" } }, { media: { url: "javascript:alert(1)" } }] },
        section([text("Again")], { type: 11, media: { url: "https://e.x/a.png" } }),
      ]),
    ] as MessageComponent[];
    expect(componentsToText(list)).toBe("# Title\nBody\nOpen: https://serika.chat/docs\nhttps://e.x/a.png\nAgain");
    expect(componentsToText([text("x".repeat(50))] as MessageComponent[], 10)).toHaveLength(10);
    expect(componentsToText(null)).toBe("");
  });
});

describe("components v2: client rendering helpers", () => {
  test("gallery layouts match Discord", () => {
    expect(galleryLayout(0)).toEqual({ feature: false, rows: [] });
    expect(galleryLayout(1)).toEqual({ feature: false, rows: [1] });
    expect(galleryLayout(2)).toEqual({ feature: false, rows: [2] });
    expect(galleryLayout(3)).toEqual({ feature: true, rows: [1, 2] });
    expect(galleryLayout(4).rows).toEqual([2, 2]);
    expect(galleryLayout(5).rows).toEqual([2, 3]);
    expect(galleryLayout(6).rows).toEqual([3, 3]);
    expect(galleryLayout(7).rows).toEqual([1, 3, 3]);
    expect(galleryLayout(8).rows).toEqual([2, 3, 3]);
    expect(galleryLayout(9).rows).toEqual([3, 3, 3]);
    expect(galleryLayout(10).rows).toEqual([1, 3, 3, 3]);
    expect(galleryLayout(25).rows.reduce((a, b) => a + b, 0)).toBe(10);
  });

  test("external images go through the image proxy; uploads and our CDN load directly", () => {
    const ext = componentImageSrc({ url: "https://evil.example/pixel.gif" }, { width: 200 })!;
    expect(new URL(ext).hostname).toBe("wsrv.nl");
    expect(new URL(ext).searchParams.get("url")).toBe("https://evil.example/pixel.gif");
    expect(new URL(ext).searchParams.get("w")).toBe("200");
    expect(new URL(ext).searchParams.get("n")).toBe("-1");
    expect(componentImageSrc({ url: "https://cdn.serika.chat/a/b.png" })).toBe("https://cdn.serika.chat/a/b.png?format=webp");
    expect(componentImageSrc({ url: "https://files.example/b.png", attachment_id: "a1" })).toBe("https://files.example/b.png");
    expect(isTrustedMedia({ url: "https://serika.chat.evil.example/a.png" })).toBeFalse();
    expect(isTrustedMedia({ url: "https://media.serika.chat/a.png" })).toBeTrue();
  });

  test("only http(s) media is ever rendered", () => {
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AA", "attachment://a.png", "https://u:p@e.x/a.png", ""]) {
      expect(componentImageSrc({ url })).toBeNull();
      expect(componentVideoSrc({ url })).toBeNull();
    }
    expect(componentImageSrc(undefined)).toBeNull();
  });

  test("videos are detected by content type, else extension", () => {
    expect(isVideoMedia({ url: "https://e.x/a", content_type: "video/mp4" })).toBeTrue();
    expect(isVideoMedia({ url: "https://e.x/a.mp4", content_type: "image/png" })).toBeFalse();
    expect(isVideoMedia({ url: "https://e.x/clip.webm?x=1" })).toBeTrue();
    expect(isVideoMedia({ url: "https://e.x/a.png" })).toBeFalse();
  });

  test("accent colors and the message flag", () => {
    expect(accentHex(0x5865f2)).toBe("#5865f2");
    expect(accentHex(0)).toBe("#000000");
    expect(accentHex(null)).toBeUndefined();
    expect(accentHex(0x1000000)).toBeUndefined();
    expect(isComponentsV2Message(IS_COMPONENTS_V2 | 4)).toBeTrue();
    expect(isComponentsV2Message(4)).toBeFalse();
    expect(isComponentsV2Message(undefined)).toBeFalse();
  });
});

describe("component emoji", () => {
  test("a pasted <:name:id> mention in emoji.name is split into name and id", () => {
    const errors = new FormErrors();
    const r = validateMessageComponents(
      [{ type: 1, components: [{ type: 2, style: 5, url: "https://serika.art", label: "art", emoji: { name: "<:suisei_shook:2b8af1a3-cdc1-46e9-9123-a07af804546e>" } }] }],
      { errors },
    );
    expect(errors.count).toBe(0);
    const json = JSON.stringify(r);
    expect(json).toContain('"id":"2b8af1a3-cdc1-46e9-9123-a07af804546e"');
    expect(json).toContain('"name":"suisei_shook"');
  });
  test("an animated mention keeps animated, a plain long name still fails", () => {
    const ok = new FormErrors();
    const r = validateMessageComponents([{ type: 1, components: [{ type: 2, style: 5, url: "https://x.y", emoji: { name: "<a:dance:123456789012345678>" } }] }], { errors: ok });
    expect(ok.count).toBe(0);
    expect(JSON.stringify(r)).toContain('"animated":true');
    const bad = new FormErrors();
    validateMessageComponents([{ type: 1, components: [{ type: 2, style: 5, url: "https://x.y", emoji: { name: "x".repeat(40) } }] }], { errors: bad });
    expect(bad.count).toBeGreaterThan(0);
  });
});
