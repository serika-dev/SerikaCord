import { describe, expect, test } from "bun:test";
import {
  computeTooltipPlacement,
  findTitleTarget,
  hasAccessibleName,
  isTitleElementEligible,
  parseShortcut,
  splitTitleShortcut,
  type TitleNodeLike,
} from "@/lib/ui/titleTooltip";

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

interface FakeOpts {
  attrs?: Record<string, string>;
  ns?: string;
  text?: string;
  children?: FakeEl[];
  hasNamedDescendant?: boolean;
}

class FakeEl implements TitleNodeLike {
  tagName: string;
  namespaceURI: string;
  parentElement: FakeEl | null = null;
  children: FakeEl[];
  textContent: string;
  private attrs: Record<string, string>;
  private named: boolean;
  constructor(tag: string, opts: FakeOpts = {}) {
    this.tagName = tag.toUpperCase();
    this.namespaceURI = opts.ns ?? HTML_NS;
    this.attrs = opts.attrs ?? {};
    this.children = opts.children ?? [];
    this.named = opts.hasNamedDescendant ?? false;
    for (const c of this.children) c.parentElement = this;
    this.textContent = opts.text ?? this.children.map((c) => c.textContent).join("");
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null;
  }
  querySelector(): unknown {
    return this.named ? {} : null;
  }
}

const el = (tag: string, opts?: FakeOpts) => new FakeEl(tag, opts);

describe("findTitleTarget", () => {
  test("nearest element with a title wins", () => {
    const icon = el("svg", { ns: SVG_NS });
    const button = el("button", { attrs: { title: "Mute" }, children: [icon] });
    el("div", { attrs: { title: "Outer" }, children: [button] });
    expect(findTitleTarget(icon)).toBe(button);
    expect(findTitleTarget(button)).toBe(button);
  });

  test("returns null without any title", () => {
    const span = el("span");
    el("div", { children: [span] });
    expect(findTitleTarget(span)).toBeNull();
    expect(findTitleTarget(null)).toBeNull();
  });

  test("empty title suppresses ancestors", () => {
    const inner = el("span", { attrs: { title: "  " } });
    el("div", { attrs: { title: "Outer" }, children: [inner] });
    expect(findTitleTarget(inner)).toBeNull();
  });

  test("skips form fields and iframes", () => {
    const input = el("input", { attrs: { title: "Name" } });
    el("div", { attrs: { title: "Outer" }, children: [input] });
    expect(findTitleTarget(input)).toBeNull();
    expect(findTitleTarget(el("textarea", { attrs: { title: "x" } }))).toBeNull();
    expect(findTitleTarget(el("select", { attrs: { title: "x" } }))).toBeNull();
    expect(findTitleTarget(el("iframe", { attrs: { title: "embed" } }))).toBeNull();
  });

  test("SVG <title> child owns the tooltip", () => {
    const path = el("path", { ns: SVG_NS });
    const svg = el("svg", { ns: SVG_NS, children: [el("title", { ns: SVG_NS, text: "Chart" }), path] });
    el("button", { attrs: { title: "Open" }, children: [svg] });
    expect(findTitleTarget(path)).toBeNull();
  });

  test("opt-outs anywhere on the path", () => {
    const a = el("span", { attrs: { title: "x" } });
    el("div", { attrs: { "data-native-title": "" }, children: [a] });
    expect(findTitleTarget(a)).toBeNull();

    const b = el("span", { attrs: { title: "x" } });
    el("div", { attrs: { contenteditable: "true" }, children: [b] });
    expect(findTitleTarget(b)).toBeNull();

    const c = el("span", { attrs: { title: "x" } });
    el("div", { attrs: { contenteditable: "false" }, children: [c] });
    expect(findTitleTarget(c)).toBe(c);

    // A Radix tooltip trigger already shows its own tooltip.
    const d = el("button", { attrs: { title: "x", "data-slot": "tooltip-trigger" } });
    expect(findTitleTarget(d)).toBeNull();
    const e = el("span", { attrs: { title: "x" } });
    el("button", { attrs: { "data-slot": "tooltip-trigger" }, children: [e] });
    expect(findTitleTarget(e)).toBeNull();
  });

  test("matches the active (title already moved) element by identity", () => {
    const child = el("span");
    const active = el("button", { attrs: { "data-tooltip-title": "Mute" }, children: [child] });
    expect(findTitleTarget(child, active)).toBe(active);
    expect(findTitleTarget(child)).toBeNull();
    // A titled child inside the active element takes over.
    const titled = el("span", { attrs: { title: "Inner" } });
    const active2 = el("button", { children: [titled] });
    expect(findTitleTarget(titled, active2)).toBe(titled);
  });
});

describe("isTitleElementEligible", () => {
  test("html elements yes, svg/mathml and fields no", () => {
    expect(isTitleElementEligible(el("button"))).toBeTrue();
    expect(isTitleElementEligible(el("time"))).toBeTrue();
    expect(isTitleElementEligible(el("svg", { ns: SVG_NS }))).toBeFalse();
    expect(isTitleElementEligible(el("math", { ns: "http://www.w3.org/1998/Math/MathML" }))).toBeFalse();
    expect(isTitleElementEligible(el("option"))).toBeFalse();
  });
});

describe("hasAccessibleName", () => {
  test("icon-only button has none", () => {
    expect(hasAccessibleName(el("button", { children: [el("svg", { ns: SVG_NS })] }))).toBeFalse();
  });
  test("aria-label, labelledby, text, img alt count", () => {
    expect(hasAccessibleName(el("button", { attrs: { "aria-label": "Mute" } }))).toBeTrue();
    expect(hasAccessibleName(el("button", { attrs: { "aria-labelledby": "lbl" } }))).toBeTrue();
    expect(hasAccessibleName(el("span", { text: "12:04" }))).toBeTrue();
    expect(hasAccessibleName(el("img", { attrs: { alt: "avatar" } }))).toBeTrue();
    expect(hasAccessibleName(el("button", { hasNamedDescendant: true }))).toBeTrue();
    expect(hasAccessibleName(el("button", { attrs: { "aria-label": " " } }))).toBeFalse();
  });
});

describe("shortcuts", () => {
  test("parseShortcut", () => {
    expect(parseShortcut("Ctrl+Shift+Z")).toEqual(["Ctrl", "Shift", "Z"]);
    expect(parseShortcut("⌘ + K")).toEqual(["⌘", "K"]);
    expect(parseShortcut("Esc")).toEqual(["Esc"]);
    expect(parseShortcut("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(parseShortcut("A")).toBeNull();
    expect(parseShortcut("beta")).toBeNull();
    expect(parseShortcut("Click+Ctrl+Z")).toBeNull();
    expect(parseShortcut("")).toBeNull();
  });

  test("splitTitleShortcut", () => {
    expect(splitTitleShortcut("Undo (Ctrl+Z)")).toEqual({ label: "Undo", keys: ["Ctrl", "Z"] });
    expect(splitTitleShortcut("Mark as read (Esc)")).toEqual({ label: "Mark as read", keys: ["Esc"] });
    expect(splitTitleShortcut("Members (3)")).toEqual({ label: "Members (3)", keys: null });
    expect(splitTitleShortcut("Server (beta)")).toEqual({ label: "Server (beta)", keys: null });
    expect(splitTitleShortcut("Plain")).toEqual({ label: "Plain", keys: null });
  });
});

describe("computeTooltipPlacement", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 100, height: 30 };

  test("centred above the anchor by default", () => {
    const p = computeTooltipPlacement({ left: 450, top: 400, width: 100, height: 20 }, size, vp);
    expect(p).toEqual({ left: 450, top: 362, side: "top", arrow: 50 });
  });

  test("flips below when there's no room above", () => {
    const p = computeTooltipPlacement({ left: 450, top: 10, width: 100, height: 20 }, size, vp);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(38);
  });

  test("stays on the preferred side when neither fits but it has more room", () => {
    const p = computeTooltipPlacement({ left: 450, top: 30, width: 100, height: 760 }, size, vp);
    expect(p.side).toBe("top");
    expect(p.top).toBe(8);
  });

  test("shifts inside the viewport and keeps the arrow on the anchor", () => {
    const left = computeTooltipPlacement({ left: 0, top: 400, width: 20, height: 20 }, size, vp);
    expect(left.left).toBe(8);
    expect(left.arrow).toBe(10);
    const right = computeTooltipPlacement({ left: 985, top: 400, width: 10, height: 20 }, size, vp);
    expect(right.left).toBe(892);
    expect(right.arrow).toBe(90);
  });

  test("side placements and flip", () => {
    const r = computeTooltipPlacement({ left: 10, top: 100, width: 40, height: 40 }, size, vp, { side: "right" });
    expect(r).toEqual({ left: 58, top: 105, side: "right", arrow: 15 });
    const l = computeTooltipPlacement({ left: 10, top: 100, width: 40, height: 40 }, size, vp, { side: "left" });
    expect(l.side).toBe("right");
  });

  test("tooltip wider than the viewport pins to the padding", () => {
    const p = computeTooltipPlacement({ left: 100, top: 400, width: 20, height: 20 }, { width: 400, height: 30 }, { width: 300, height: 800 });
    expect(p.left).toBe(8);
  });
});
