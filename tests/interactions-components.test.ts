import { describe, expect, test } from "bun:test";
import { FormErrors } from "@/lib/botapi/formErrors";
import {
  ButtonStyle,
  ComponentType,
  IS_COMPONENTS_V2,
  buildModalSubmit,
  checkComponentClick,
  componentsPlainText,
  resolveAttachmentRefs,
  validateMessageComponents,
  validateModal,
  withAllDisabled,
  type MessageComponent,
} from "@/lib/botapi/components";

function validate(input: unknown, flags = 0) {
  const errors = new FormErrors();
  const result = validateMessageComponents(input, { flags, errors });
  return { result, errors };
}

const row = (...components: unknown[]) => ({ type: 1, components });
const button = (over: Record<string, unknown> = {}) => ({ type: 2, style: 1, label: "Go", custom_id: "go", ...over });

describe("message components v1", () => {
  test("accepts buttons and assigns ids", () => {
    const { result, errors } = validate([row(button(), button({ custom_id: "b", style: ButtonStyle.DANGER, label: "Stop" }))]);
    expect(errors.ok).toBeTrue();
    expect(result!.components[0].id).toBe(1);
    expect(result!.components[0].components![0].id).toBe(2);
    expect(result!.components[0].components![1]).toMatchObject({ custom_id: "b", style: 4 });
  });

  test("drops unknown fields", () => {
    const { result } = validate([row(button({ onclick: "alert(1)", __proto__x: 1 }))]);
    expect(Object.keys(result!.components[0].components![0])).not.toContain("onclick");
  });

  test("link buttons need an http(s) url and no custom_id", () => {
    expect(validate([row({ type: 2, style: 5, label: "Docs", url: "javascript:alert(1)" })]).errors.ok).toBeFalse();
    expect(validate([row({ type: 2, style: 5, label: "Docs", url: "https://serika.chat", custom_id: "x" })]).errors.ok).toBeFalse();
    const ok = validate([row({ type: 2, style: 5, label: "Docs", url: "https://serika.chat/docs" })]);
    expect(ok.errors.ok).toBeTrue();
    expect(ok.result!.components[0].components![0].url).toBe("https://serika.chat/docs");
  });

  test("premium buttons are rejected", () => {
    expect(validate([row({ type: 2, style: 6, sku_id: "1" })]).errors.ok).toBeFalse();
  });

  test("custom_id length and uniqueness", () => {
    const long = validate([row(button({ custom_id: "x".repeat(101) }))]);
    expect(long.errors.ok).toBeFalse();
    expect(JSON.stringify(long.errors.toBody().errors)).toContain("BASE_TYPE_MAX_LENGTH");
    const dup = validate([row(button({ custom_id: "a" }), button({ custom_id: "a" }))]);
    expect(dup.errors.ok).toBeFalse();
    expect(JSON.stringify(dup.errors.toBody())).toContain("COMPONENT_CUSTOM_ID_DUPLICATED");
  });

  test("layout limits: 5 rows, 5 buttons, one select per row", () => {
    expect(validate([row(button()), row(button({ custom_id: "2" })), row(button({ custom_id: "3" })), row(button({ custom_id: "4" })), row(button({ custom_id: "5" })), row(button({ custom_id: "6" }))]).errors.ok).toBeFalse();
    expect(validate([row(...[1, 2, 3, 4, 5, 6].map((i) => button({ custom_id: `b${i}` })))]).errors.ok).toBeFalse();
    const select = { type: 3, custom_id: "s", options: [{ label: "A", value: "a" }] };
    expect(validate([row(select, button())]).errors.ok).toBeFalse();
    expect(validate([row(select)]).errors.ok).toBeTrue();
  });

  test("top level must be action rows without the v2 flag", () => {
    expect(validate([{ type: 10, content: "hi" }]).errors.ok).toBeFalse();
  });

  test("string select checks options and max_values", () => {
    const bad = validate([row({ type: 3, custom_id: "s", max_values: 3, options: [{ label: "A", value: "a" }] })]);
    expect(bad.errors.ok).toBeFalse();
    const dupValues = validate([row({ type: 3, custom_id: "s", options: [{ label: "A", value: "a" }, { label: "B", value: "a" }] })]);
    expect(dupValues.errors.ok).toBeFalse();
  });

  test("error tree paths point at the field", () => {
    const { errors } = validate([row(button({ label: "x".repeat(81) }))]);
    const body = errors.toBody();
    expect(body.code).toBe(50035);
    const tree = body.errors as unknown as { components: Record<string, { components: Record<string, { label: { _errors: Array<{ code: string }> } }> }> };
    expect(tree.components["0"].components["0"].label._errors[0].code).toBe("BASE_TYPE_MAX_LENGTH");
  });

  test("strips control and bidi-override characters from labels", () => {
    const { result } = validate([row(button({ label: "Pay‮evil\u0007" }))]);
    expect(result!.components[0].components![0].label).toBe("Payevil");
  });
});

describe("message components v2", () => {
  const container = {
    type: 17,
    accent_color: 0xff0000,
    components: [
      { type: 10, content: "# Title" },
      { type: 9, components: [{ type: 10, content: "side" }], accessory: { type: 11, media: { url: "attachment://cat.png" } } },
      { type: 14, divider: true, spacing: 2 },
      { type: 12, items: [{ media: { url: "https://example.com/a.png" } }] },
      { type: 13, file: { url: "attachment://doc.pdf" } },
      row(button()),
    ],
  };

  test("accepts a full layout with the flag and collects attachment refs", () => {
    const { result, errors } = validate([container], IS_COMPONENTS_V2);
    expect(errors.ok).toBeTrue();
    expect(result!.attachmentRefs.sort()).toEqual(["cat.png", "doc.pdf"]);
    expect(componentsPlainText(result!.components)).toContain("# Title");
  });

  test("rejects v2 types without the flag", () => {
    expect(validate([container]).errors.ok).toBeFalse();
  });

  test("files must reference uploads; media must be http(s) or attachment://", () => {
    expect(validate([{ type: 13, file: { url: "https://example.com/x.pdf" } }], IS_COMPONENTS_V2).errors.ok).toBeFalse();
    expect(validate([{ type: 12, items: [{ media: { url: "file:///etc/passwd" } }] }], IS_COMPONENTS_V2).errors.ok).toBeFalse();
  });

  test("no nested containers, total component limit", () => {
    expect(validate([{ type: 17, components: [{ type: 17, components: [{ type: 10, content: "x" }] }] }], IS_COMPONENTS_V2).errors.ok).toBeFalse();
    const many = Array.from({ length: 41 }, (_, i) => ({ type: 10, content: `t${i}` }));
    expect(validate(many, IS_COMPONENTS_V2).errors.ok).toBeFalse();
  });

  test("resolves attachment:// against uploaded files", () => {
    const { result } = validate([container], IS_COMPONENTS_V2);
    const missing = resolveAttachmentRefs(result!.components, [{ id: "1", filename: "cat.png", url: "https://cdn/cat.png" }]);
    expect(missing.ok).toBeFalse();
    const ok = resolveAttachmentRefs(result!.components, [
      { id: "1", filename: "cat.png", url: "https://cdn/cat.png", contentType: "image/png" },
      { id: "2", filename: "doc.pdf", url: "https://cdn/doc.pdf" },
    ]);
    expect(ok.ok).toBeTrue();
    const json = JSON.stringify((ok as { components: MessageComponent[] }).components);
    expect(json).not.toContain("attachment://");
    expect(json).toContain('"attachment_id":"1"');
  });
});

describe("component clicks", () => {
  const { result } = validate([
    row(button({ custom_id: "ok" }), button({ custom_id: "off", disabled: true }), { type: 2, style: 5, label: "L", url: "https://x.y" }),
    row({ type: 3, custom_id: "pick", min_values: 1, max_values: 2, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }, { label: "C", value: "c" }] }),
    row({ type: 5, custom_id: "user" }),
  ]);
  const comps = result!.components;

  test("known enabled button", () => {
    expect(checkComponentClick(comps, { customId: "ok", componentType: 2 }).ok).toBeTrue();
  });

  test("unknown, disabled, wrong type", () => {
    expect(checkComponentClick(comps, { customId: "nope", componentType: 2 })).toMatchObject({ ok: false, reason: "unknown" });
    expect(checkComponentClick(comps, { customId: "off", componentType: 2 })).toMatchObject({ ok: false, reason: "disabled" });
    expect(checkComponentClick(comps, { customId: "ok", componentType: 3 })).toMatchObject({ ok: false, reason: "type" });
  });

  test("select values must be declared and within min/max", () => {
    expect(checkComponentClick(comps, { customId: "pick", componentType: 3, values: ["a", "b"] }).ok).toBeTrue();
    expect(checkComponentClick(comps, { customId: "pick", componentType: 3, values: ["z"] }).ok).toBeFalse();
    expect(checkComponentClick(comps, { customId: "pick", componentType: 3, values: ["a", "b", "c"] }).ok).toBeFalse();
    expect(checkComponentClick(comps, { customId: "pick", componentType: 3, values: [] }).ok).toBeFalse();
    expect(checkComponentClick(comps, { customId: "user", componentType: 5, values: ["u1"] }).ok).toBeTrue();
  });

  test("withAllDisabled keeps link buttons usable", () => {
    const disabled = withAllDisabled(comps);
    expect(disabled[0].components![0].disabled).toBeTrue();
    expect(disabled[0].components![2].disabled).toBeUndefined();
    expect(disabled[1].components![0].disabled).toBeTrue();
  });
});

describe("modals", () => {
  const modalInput = {
    custom_id: "feedback",
    title: "Feedback",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "short", style: 1, label: "Name", max_length: 10 }] },
      { type: 18, label: "Details", component: { type: 4, custom_id: "long", style: 2, required: false } },
      { type: 18, label: "Pick", component: { type: 3, custom_id: "kind", options: [{ label: "Bug", value: "bug" }, { label: "Idea", value: "idea" }] } },
      { type: 10, content: "Thanks!" },
    ],
  };

  test("validates and keeps the layout", () => {
    const errors = new FormErrors();
    const modal = validateModal(modalInput, errors);
    expect(errors.ok).toBeTrue();
    expect(modal!.components).toHaveLength(4);
  });

  test("title / custom_id limits", () => {
    const errors = new FormErrors();
    expect(validateModal({ ...modalInput, title: "x".repeat(46) }, errors)).toBeNull();
    expect(validateModal({ ...modalInput, components: [] }, new FormErrors())).toBeNull();
  });

  test("submission is checked against the modal", () => {
    const modal = validateModal(modalInput, new FormErrors())!;
    const ok = buildModalSubmit(modal, [
      { custom_id: "short", value: "Ann" },
      { custom_id: "kind", values: ["bug"] },
    ]);
    expect(ok.ok).toBeTrue();
    const json = JSON.stringify((ok as { components: unknown }).components);
    expect(json).toContain('"value":"Ann"');
    expect(json).toContain('"values":["bug"]');
    expect(buildModalSubmit(modal, [{ custom_id: "kind", values: ["bug"] }])).toMatchObject({ ok: false, field: "short", reason: "required" });
    expect(buildModalSubmit(modal, [{ custom_id: "short", value: "x".repeat(11) }, { custom_id: "kind", values: ["bug"] }])).toMatchObject({ ok: false, reason: "max_length" });
    expect(buildModalSubmit(modal, [{ custom_id: "short", value: "A" }, { custom_id: "kind", values: ["evil"] }])).toMatchObject({ ok: false, reason: "values" });
  });

  test("component type constants match Discord", () => {
    expect(ComponentType.CONTAINER).toBe(17);
    expect(ComponentType.LABEL).toBe(18);
    expect(IS_COMPONENTS_V2).toBe(32768);
  });
});
