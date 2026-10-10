/** Pure colour helpers for theming the native status / navigation bars. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse a computed CSS colour (`rgb()`, `rgba()`, `#rgb`, `#rrggbb`). */
export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (fn) {
    let a = 1;
    if (fn[4] !== undefined) a = fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return { r: clamp(+fn[1]), g: clamp(+fn[2]), b: clamp(+fn[3]), a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** WCAG relative luminance below the midpoint = dark background (use light icons). */
export function isDarkColor({ r, g, b }: Rgba): boolean {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return l < 0.4;
}

/** First opaque colour from a list of computed values (transparent ones skipped). */
export function firstOpaque(values: Array<string | null | undefined>): Rgba | null {
  for (const v of values) {
    const c = parseCssColor(v);
    if (c && c.a > 0.5) return c;
  }
  return null;
}
