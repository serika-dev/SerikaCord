/**
 * Onerror handler for twemoji.parse() that retries failed emoji SVGs
 * with fe0f (variation selector-16) inserted at different positions.
 *
 * The jdecked/twemoji CDN uses fully-qualified Unicode form for filenames,
 * which includes U+FE0F in specific positions within ZWJ sequences.
 * If the source text lacks FE0F, the generated URL will 404.
 * This handler tries inserting FE0F at the end and before the first ZWJ.
 */
export function twemojiOnError(this: HTMLImageElement) {
  const src = this.getAttribute("src");
  if (!src) return;

  const original = this.dataset.twemojiOriginal || src;
  const attempt = parseInt(this.dataset.twemojiAttempt || "0", 10);
  const base = original.replace(/\.svg$/, "");

  if (attempt === 0) {
    // Try with fe0f appended at end: X-200d-Y → X-200d-Y-fe0f
    this.dataset.twemojiOriginal = original;
    this.dataset.twemojiAttempt = "1";
    this.setAttribute("src", base + "-fe0f.svg");
  } else if (attempt === 1) {
    // Try with fe0f before first ZWJ: X-200d-Y → X-fe0f-200d-Y
    this.dataset.twemojiAttempt = "2";
    this.setAttribute("src", base.replace(/-200d-/, "-fe0f-200d-") + ".svg");
  } else if (attempt === 2) {
    // Try both: X-200d-Y → X-fe0f-200d-Y-fe0f
    this.dataset.twemojiAttempt = "3";
    this.setAttribute("src", base.replace(/-200d-/, "-fe0f-200d-") + "-fe0f.svg");
  } else {
    // Give up — replace with text
    if (this.parentNode) {
      this.parentNode.replaceChild(document.createTextNode(this.alt), this);
    }
  }
}

const TWEMOJI_SVG_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/";

/**
 * Twemoji SVG for a Unicode emoji, named the way twemoji names its files:
 * U+FE0F is dropped unless the emoji is a ZWJ sequence. Pair it with
 * `twemojiOnError` for the few files named otherwise.
 */
export function twemojiSvgUrl(emoji: string): string {
  const source = emoji.includes("‍") ? emoji : emoji.replace(/️/g, "");
  const codePoints = Array.from(source).map((c) => (c.codePointAt(0) ?? 0).toString(16));
  return `${TWEMOJI_SVG_BASE}${codePoints.join("-")}.svg`;
}
