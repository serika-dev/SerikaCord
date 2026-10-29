/**
 * Regenerates the iOS app icon and launch image from the brand mark
 * (public/logo-icon.svg, the same mascot as the web favicon and the in-app
 * splash).
 *
 *   bun mobile/scripts/generate-ios-assets.ts
 *
 * Writes into mobile/ios/App/App/Assets.xcassets:
 *   - AppIcon.appiconset/AppIcon-512@2x.png  1024x1024, opaque (the App Store
 *     rejects icons with an alpha channel; iOS applies the rounded mask itself)
 *   - Splash.imageset/splash-2732x2732*.png  2732x2732, dark #05060a with a
 *     soft violet glow and the rounded logo tile in the middle, like the
 *     Android splash. The launch screen scales it aspect-fill, so only the
 *     centre is visible on phones.
 *
 * Uses sharp (librsvg) from the repo's root node_modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ASSETS = join(ROOT, "mobile", "ios", "App", "App", "Assets.xcassets");
const LOGO = readFileSync(join(ROOT, "public", "logo-icon.svg"), "utf8");

const SPLASH_BG = "#05060a";
const ICON_BG = "#0a0a0a";

/** The mascot artwork of logo-icon.svg without its rounded tile + border. */
function mascotMarkup(svg: string): { defs: string; body: string } {
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
  const body = svg
    .replace(/^[\s\S]*?<\/defs>/, "")
    .replace(/<\/svg>\s*$/, "")
    // Drop the tile background and its border (the first two <rect>s).
    .replace(/<rect[^>]*\/>/g, "");
  return { defs, body };
}

/** Full-bleed square icon: dark background, mascot centred at 80%. */
function iconSvg(): string {
  const { defs, body } = mascotMarkup(LOGO);
  const scale = 0.8;
  const offset = (48 - 48 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
  ${defs.replace("<defs>", `<defs>
    <radialGradient id="iconGlow" cx="24" cy="26" r="26" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1c1236"/>
      <stop offset="100%" stop-color="${ICON_BG}"/>
    </radialGradient>`)}
  <rect width="48" height="48" fill="url(#iconGlow)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>
</svg>`;
}

/** 2732x2732 launch image: glow + the rounded logo tile (as on Android). */
function splashSvg(): string {
  const size = 2732;
  const tile = 420;
  const at = (size - tile) / 2;
  const logo = LOGO.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" x="${at}" y="${at}" width="${tile}" height="${tile}" viewBox="0 0 48 48" fill="none">`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="glow" cx="${size / 2}" cy="${size / 2}" r="${size * 0.32}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1a1033"/>
      <stop offset="100%" stop-color="${SPLASH_BG}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${SPLASH_BG}"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>
  ${logo}
</svg>`;
}

async function render(svg: string, size: number, background: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .flatten({ background })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const icon = await render(iconSvg(), 1024, ICON_BG);
writeFileSync(join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), icon);

const splash = await render(splashSvg(), 2732, SPLASH_BG);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  writeFileSync(join(ASSETS, "Splash.imageset", name), splash);
}

console.log(`AppIcon ${icon.length} bytes, splash ${splash.length} bytes`);
