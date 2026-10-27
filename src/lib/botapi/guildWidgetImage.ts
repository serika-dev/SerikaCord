/**
 * GET /guilds/{id}/widget.png: Discord's widget image styles (shield,
 * banner1-4) drawn into an RGBA pixel buffer with a built-in 5x7 pixel font,
 * so no system fonts or remote images are needed (the runtime image is
 * font-less). The route encodes the buffer as PNG with sharp. Pure; tested in
 * tests/guildparity-widget.test.ts.
 *
 * Text is upper-cased; accents are stripped and characters the font lacks are
 * dropped. The guild icon is drawn as its initials on the accent colour.
 */

export const WIDGET_STYLES = ['shield', 'banner1', 'banner2', 'banner3', 'banner4'] as const;
export type WidgetStyle = (typeof WIDGET_STYLES)[number];

export function widgetStyleOf(v: unknown): WidgetStyle {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (WIDGET_STYLES as readonly string[]).includes(s) ? (s as WidgetStyle) : 'shield';
}

type RGBA = readonly [number, number, number, number];

const BG: RGBA = [30, 31, 34, 255];
const PANEL: RGBA = [43, 45, 49, 255];
const ACCENT: RGBA = [124, 92, 255, 255];
const WHITE: RGBA = [255, 255, 255, 255];
const MUTED: RGBA = [181, 186, 193, 255];
const GREEN: RGBA = [35, 165, 90, 255];

// 5x7 glyphs, one 5-bit row per entry (top to bottom).
const GLYPHS: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], 1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], 3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], 5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], 7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], 9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0x0c, 0x0c], ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04], '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  '-': [0, 0, 0, 0x1f, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 0x1f], ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "'": [0x0c, 0x04, 0x08, 0, 0, 0, 0], '"': [0x0a, 0x0a, 0x0a, 0, 0, 0, 0], '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '#': [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a], '@': [0x0e, 0x11, 0x01, 0x0d, 0x15, 0x15, 0x0e],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '/': [0, 0x01, 0x02, 0x04, 0x08, 0x10, 0], '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '*': [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0], '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0], '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08], '$': [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03], '[': [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
  ']': [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e], '~': [0, 0, 0x08, 0x15, 0x02, 0, 0],
};

/** Text the pixel font can draw: upper-cased, accents stripped, unknown characters dropped. */
export function fontText(s: string): string {
  const out = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split('').filter((c) => GLYPHS[c] !== undefined).join('');
  return out.replace(/\s+/g, ' ').trim();
}

export class PixelCanvas {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height * 4);
  }

  private put(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = c[3];
  }

  /** A filled rectangle, optionally with rounded corners. */
  rect(x: number, y: number, w: number, h: number, c: RGBA, radius = 0) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (radius > 0) {
          const cx = xx < radius ? radius - xx - 0.5 : xx >= w - radius ? xx - (w - radius) + 0.5 : 0;
          const cy = yy < radius ? radius - yy - 0.5 : yy >= h - radius ? yy - (h - radius) + 0.5 : 0;
          if (cx > 0 && cy > 0 && cx * cx + cy * cy > radius * radius) continue;
        }
        this.put(x + xx, y + yy, c);
      }
    }
  }

  static textWidth(text: string, scale: number): number {
    return text.length === 0 ? 0 : text.length * 6 * scale - scale;
  }

  /** Draw already-fontText()'d text with its top-left at (x, y). Returns the width drawn. */
  text(x: number, y: number, text: string, scale: number, c: RGBA): number {
    let cx = x;
    for (const ch of text) {
      const g = GLYPHS[ch];
      if (g) {
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 5; col++) {
            if (g[row] & (1 << (4 - col))) this.rect(cx + col * scale, y + row * scale, scale, scale, c);
          }
        }
      }
      cx += 6 * scale;
    }
    return PixelCanvas.textWidth(text, scale);
  }
}

/** `text` cut (with "...") to fit `maxWidth` at `scale`. */
export function fitText(text: string, scale: number, maxWidth: number): string {
  if (PixelCanvas.textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && PixelCanvas.textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return t ? `${t.trimEnd()}...` : '';
}

/** Up to two initials for the icon tile. */
export function initials(name: string): string {
  const words = fontText(name).split(' ').filter((w) => /[A-Z0-9]/.test(w));
  return words.slice(0, 2).map((w) => w.match(/[A-Z0-9]/)![0]).join('') || '?';
}

function icon(cv: PixelCanvas, x: number, y: number, size: number, name: string) {
  cv.rect(x, y, size, size, ACCENT, Math.floor(size / 4));
  const label = initials(name);
  const scale = size >= 40 ? 3 : 2;
  const w = PixelCanvas.textWidth(label, scale);
  cv.text(x + Math.floor((size - w) / 2), y + Math.floor((size - 7 * scale) / 2), label, scale, WHITE);
}

function onlineLine(cv: PixelCanvas, x: number, y: number, online: number) {
  cv.rect(x, y + 1, 5, 5, GREEN, 2);
  cv.text(x + 9, y, fontText(`${online} Online`), 1, MUTED);
}

/** The widget image as raw RGBA pixels. */
export function renderWidgetImage(style: WidgetStyle, guild: { name: string; online: number; brand?: string }): { width: number; height: number; data: Uint8Array } {
  const brand = fontText(guild.brand ?? 'SerikaCord');
  const name = fontText(guild.name) || 'SERVER';
  if (style === 'shield') {
    const left = `${brand}`;
    const right = fontText(`${guild.online} online`);
    const lw = PixelCanvas.textWidth(left, 1) + 12;
    const rw = PixelCanvas.textWidth(right, 1) + 12;
    const cv = new PixelCanvas(lw + rw, 20);
    cv.rect(0, 0, lw + rw, 20, PANEL, 3);
    cv.rect(lw, 0, rw, 20, ACCENT, 3);
    cv.rect(lw, 0, 3, 20, ACCENT);
    cv.text(6, 7, left, 1, WHITE);
    cv.text(lw + 6, 7, right, 1, WHITE);
    return cv;
  }
  if (style === 'banner2') {
    const cv = new PixelCanvas(320, 64);
    cv.rect(0, 0, 320, 64, BG, 6);
    cv.rect(256, 0, 64, 64, ACCENT, 6);
    cv.rect(256, 0, 6, 64, ACCENT);
    icon(cv, 12, 12, 40, guild.name);
    cv.text(64, 16, fitText(name, 2, 184), 2, WHITE);
    onlineLine(cv, 64, 38, guild.online);
    const join = 'JOIN';
    cv.text(256 + Math.floor((64 - PixelCanvas.textWidth(join, 2)) / 2), 25, join, 2, WHITE);
    return cv;
  }
  if (style === 'banner4') {
    const cv = new PixelCanvas(320, 150);
    cv.rect(0, 0, 320, 150, BG, 6);
    cv.rect(0, 0, 320, 36, ACCENT, 6);
    cv.rect(0, 30, 320, 6, ACCENT);
    cv.text(Math.floor((320 - PixelCanvas.textWidth(brand, 2)) / 2), 11, brand, 2, WHITE);
    icon(cv, 16, 50, 44, guild.name);
    cv.text(72, 54, fitText(name, 2, 236), 2, WHITE);
    onlineLine(cv, 72, 76, guild.online);
    const label = 'JOIN MY SERVER';
    cv.rect(16, 110, 288, 28, GREEN, 4);
    cv.text(Math.floor((320 - PixelCanvas.textWidth(label, 2)) / 2), 117, label, 2, WHITE);
    return cv;
  }
  // banner1 / banner3: header with icon, name and count, then a footer strip.
  const cv = new PixelCanvas(320, 82);
  cv.rect(0, 0, 320, 82, BG, 6);
  icon(cv, 14, 10, 40, guild.name);
  cv.text(66, 16, fitText(name, 2, 240), 2, WHITE);
  onlineLine(cv, 66, 38, guild.online);
  cv.rect(0, 60, 320, 22, PANEL, 6);
  cv.rect(0, 60, 320, 6, PANEL);
  if (style === 'banner3') {
    cv.text(14, 68, brand, 1, MUTED);
    const chat = 'CHAT NOW';
    const w = PixelCanvas.textWidth(chat, 1) + 16;
    cv.rect(320 - w - 10, 64, w, 14, ACCENT, 3);
    cv.text(320 - w - 2, 68, chat, 1, WHITE);
  } else {
    const footer = fontText(`Powered by ${guild.brand ?? 'SerikaCord'}`);
    cv.text(Math.floor((320 - PixelCanvas.textWidth(footer, 1)) / 2), 68, footer, 1, MUTED);
  }
  return cv;
}
