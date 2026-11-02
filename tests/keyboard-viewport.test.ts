import { describe, expect, test } from "bun:test";
import { KEYBOARD_SHRINK_PX, measureKeyboard, remainingKeyboardInset, type ViewportBaseline, type ViewportSample } from "../src/lib/layout/keyboardViewport";

const phone = (s: Partial<ViewportSample>): ViewportSample => ({ width: 412, innerHeight: 800, vvHeight: 800, vvOffsetTop: 0, editableFocused: false, ...s });

function run(samples: Array<Partial<ViewportSample>>) {
  let base: ViewportBaseline | null = null;
  return samples.map((s) => {
    const m = measureKeyboard(phone(s), base);
    base = m.baseline;
    return m;
  });
}

describe("keyboard detection from the visual viewport", () => {
  test("Chrome / Samsung Internet with resizes-content: the layout shrinks, overlay stays 0, still detected", () => {
    const [closed, focused, open, closedAgain] = run([
      {},
      { editableFocused: true },
      { editableFocused: true, innerHeight: 470, vvHeight: 470 },
      { editableFocused: true, innerHeight: 800, vvHeight: 800 },
    ]);
    expect(closed.open).toBe(false);
    expect(focused.open).toBe(false);
    expect(open).toMatchObject({ open: true, inset: 0, shrink: 330 });
    expect(closedAgain.open).toBe(false);
  });

  test("Samsung's suggestion strip / toolbar growing the keyboard keeps it open and the shrink follows", () => {
    const r = run([{}, { editableFocused: true, innerHeight: 520, vvHeight: 520 }, { editableFocused: true, innerHeight: 470, vvHeight: 470 }]);
    expect(r[1].shrink).toBe(280);
    expect(r[2].shrink).toBe(330);
    expect(r[2].open).toBe(true);
  });

  test("iOS / resizes-visual: only the visual viewport shrinks", () => {
    const [, open] = run([{}, { editableFocused: true, vvHeight: 500, vvOffsetTop: 0 }]);
    expect(open).toMatchObject({ open: true, inset: 300 });
  });

  test("browser toolbars showing or hiding are not a keyboard", () => {
    const r = run([{ vvHeight: 744, innerHeight: 744 }, { vvHeight: 800, innerHeight: 800, editableFocused: true }, { vvHeight: 744, innerHeight: 744, editableFocused: true }]);
    expect(r[2].shrink).toBe(56);
    expect(r[2].shrink).toBeLessThan(KEYBOARD_SHRINK_PX);
    expect(r[2].open).toBe(false);
  });

  test("a shorter window with nothing focused (split screen) just moves the baseline", () => {
    const r = run([{}, { innerHeight: 500, vvHeight: 500 }, { innerHeight: 500, vvHeight: 500, editableFocused: true }]);
    expect(r[1].open).toBe(false);
    expect(r[2].open).toBe(false);
    expect(r[2].baseline.height).toBe(500);
  });

  test("rotation resets the baseline", () => {
    const r = run([{}, { width: 915, innerHeight: 380, vvHeight: 380 }, { width: 915, innerHeight: 200, vvHeight: 200, editableFocused: true }]);
    expect(r[1].open).toBe(false);
    expect(r[2].open).toBe(true);
  });

  test("the baseline never learns the keyboard-open height while focused", () => {
    const r = run([{}, { editableFocused: true, innerHeight: 470, vvHeight: 470 }, { editableFocused: true, innerHeight: 470, vvHeight: 470 }]);
    expect(r[2].baseline.height).toBe(800);
    expect(r[2].open).toBe(true);
  });
});

describe("the app: keyboard padding left after the WebView's own handling", () => {
  test("WebView 140+ edge to edge shrinks its viewport: nothing left to pad (no double gap)", () => {
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: true, closedHeight: 800, vvHeight: 470 })).toBe(0);
  });
  test("view resized by adjustResize / Capacitor margins: the native overlap is already 0", () => {
    expect(remainingKeyboardInset({ keyboard: 0, keyboardVisible: true, closedHeight: 800, vvHeight: 470 })).toBe(0);
  });
  test("nothing handled it: pad by the whole keyboard", () => {
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: true, closedHeight: 800, vvHeight: 800 })).toBe(330);
  });
  test("partly handled (strip still animating): pad the rest; tiny leftovers are 0", () => {
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: true, closedHeight: 800, vvHeight: 520 })).toBe(50);
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: true, closedHeight: 800, vvHeight: 474 })).toBe(0);
  });
  test("keyboard hidden or no baseline yet", () => {
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: false, closedHeight: 800, vvHeight: 470 })).toBe(0);
    expect(remainingKeyboardInset({ keyboard: 330, keyboardVisible: true, closedHeight: 0, vvHeight: 470 })).toBe(330);
  });
});
