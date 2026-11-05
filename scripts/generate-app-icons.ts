/**
 * Regenerates every app icon from the brand mark, public/logo-icon.svg
 * (bubble-chan, the same mascot as the web favicon, the in-app splash and the
 * iOS icon — see mobile/scripts/generate-ios-assets.ts for iOS):
 *
 *   bun scripts/generate-app-icons.ts
 *
 * Writes:
 *   - public/icons/icon-<n>x<n>.png, dm-icon.png, explore-icon.png   PWA / notification icons
 *   - src/app/favicon.ico                                            16–256, for /favicon.ico
 *   - desktop-QT/src/resources/icons/app-icon.png (512) + .ico        Qt window / installers (macOS .icns is built from the PNG in CI)
 *   - desktop-QT/src/resources/icons/logo-icon.png (144)              updater window
 *   - desktop-tauri/src-tauri/icons/icon.png (512) + icon.ico
 *   - mobile/android/.../mipmap-*  ic_launcher (rounded tile), ic_launcher_round (circle),
 *     ic_launcher_foreground (adaptive, mascot in the 66dp safe zone of 108dp) and the
 *     adaptive background colour.
 *
 * Uses sharp (librsvg) from the repo's root node_modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const LOGO = readFileSync(join(ROOT, "public", "logo-icon.svg"), "utf8");
/** Middle of the iOS icon's glow (#1c1236 → #0a0a0a): the adaptive icon's background. */
const ADAPTIVE_BG = "#120d22";

/** The mascot of logo-icon.svg without its rounded tile and border. */
function mascot(): { defs: string; body: string } {
  const defs = LOGO.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
  const body = LOGO.replace(/^[\s\S]*?<\/defs>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect[^>]*\/>/g, "");
  return { defs, body };
}

/** The mascot centred at `scale` on a transparent square, or on the iOS-style glow. */
function mascotSvg(scale: number, glow: boolean): string {
  const { defs, body } = mascot();
  const offset = (48 - 48 * scale) / 2;
  const glowDefs = `<radialGradient id="iconGlow" cx="24" cy="26" r="26" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#1c1236"/><stop offset="100%" stop-color="#0a0a0a"/></radialGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
  ${glow ? defs.replace("<defs>", `<defs>${glowDefs}`) : defs}
  ${glow ? '<rect width="48" height="48" fill="url(#iconGlow)"/>' : ""}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>
</svg>`;
}

const render = (svg: string, size: number) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
/** logo-icon.svg as it is: the rounded dark tile with transparent corners. */
const tile = (size: number) => render(LOGO, size);
/** Circle launcher icon: the glow square masked to a circle. */
async function round(size: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  return sharp(await render(mascotSvg(0.8, true), size)).composite([{ input: mask, blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
}

/** A Windows .ico holding PNG images (supported since Vista). */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const out = (rel: string, data: Buffer | string) => {
  writeFileSync(join(ROOT, rel), data);
  console.log(`✓ ${rel}`);
};
const icoOf = async (sizes: number[]) => ico(await Promise.all(sizes.map(async (size) => ({ size, png: await tile(size) }))));

// Web
for (const n of [72, 96, 128, 144, 152, 192, 384, 512]) out(`public/icons/icon-${n}x${n}.png`, await tile(n));
out("public/icons/dm-icon.png", await tile(96));
out("public/icons/explore-icon.png", await tile(96));
out("src/app/favicon.ico", await icoOf([16, 32, 48, 256]));

// Desktop
const desktopIco = await icoOf([16, 24, 32, 48, 64, 128, 256]);
out("desktop-QT/src/resources/icons/app-icon.png", await tile(512));
out("desktop-QT/src/resources/icons/app-icon.ico", desktopIco);
out("desktop-QT/src/resources/icons/logo-icon.png", await tile(144));
out("desktop-tauri/src-tauri/icons/icon.png", await tile(512));
out("desktop-tauri/src-tauri/icons/icon.ico", desktopIco);

// Android
const RES = "mobile/android/app/src/main/res";
for (const [dpi, scale] of [["mdpi", 1], ["hdpi", 1.5], ["xhdpi", 2], ["xxhdpi", 3], ["xxxhdpi", 4]] as const) {
  const launcher = Math.round(48 * scale);
  out(`${RES}/mipmap-${dpi}/ic_launcher.png`, await tile(launcher));
  out(`${RES}/mipmap-${dpi}/ic_launcher_round.png`, await round(launcher));
  // Adaptive foreground: 108dp canvas, the launcher mask shows the middle 72dp
  // and only the 66dp circle is safe, so the mascot fills ~60% of it.
  out(`${RES}/mipmap-${dpi}/ic_launcher_foreground.png`, await render(mascotSvg(0.6, false), Math.round(108 * scale)));
}
out(`${RES}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ADAPTIVE_BG}</color>
</resources>
`);
