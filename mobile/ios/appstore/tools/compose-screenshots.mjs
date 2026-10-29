#!/usr/bin/env node
/**
 * Composes App Store marketing screenshots from raw app captures.
 *
 * Input: raw captures of the real app UI, taken at the device's CSS viewport
 * and pixel ratio (iPhone 6.9": 440x956 @3x = 1320x2868, iPad 13":
 * 1032x1376 @2x = 2064x2752), with the safe areas set to the device's
 * (--native-inset-top/bottom: 62/34 pt on iPhone, 24/20 pt on iPad) so the
 * top of each capture is the empty status-bar band.
 *
 * Output: brand gradient + short headline + the capture inside a simple
 * drawn device frame (no Apple artwork), with a clean status bar (9:41, full
 * battery) drawn into the status-bar band. Flattened to opaque sRGB PNG at
 * the exact App Store size.
 *
 * Usage (from the repo root):
 *   node mobile/ios/appstore/tools/compose-screenshots.mjs <rawDir> \
 *     [--display-font Outfit.woff2] [--ui-font Inter.woff2]
 *   <rawDir>/iphone/<name>.png and <rawDir>/ipad/<name>.png, names as in SHOTS below.
 *
 * Needs playwright-core (in the repo or the current directory) with a Chromium
 * (`PLAYWRIGHT_BROWSERS_PATH=... bunx playwright-core install chromium`) and sharp
 * (already a dependency of the web app). Fonts are optional: without them the
 * captions fall back to the system sans-serif.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const require = createRequire(path.join(repoRoot, "package.json"));
const sharp = require("sharp");
// playwright-core isn't a repo dependency: it resolves from the repo, then
// from the current directory (e.g. a scratch folder with `bun add playwright-core`).
let chromium;
for (const req of [require, createRequire(path.join(process.cwd(), "noop.js"))]) {
  try {
    ({ chromium } = req("playwright-core"));
    break;
  } catch {
    /* try the next location */
  }
}
if (!chromium) {
  console.error("playwright-core not found: run this from a folder where `bun add playwright-core` was run.");
  process.exit(1);
}

/** Headline + supporting line per screenshot (keep headlines to ~6 words). */
export const SHOTS = {
  iphone: [
    { name: "01-chat", title: "Your servers. Your vibe.", sub: "Channels, roles, replies and reactions" },
    { name: "02-voice", title: "Drop into voice anytime", sub: "See who's hanging out and join in a tap" },
    { name: "03-dm", title: "Chat with your friends", sub: "DMs and group chats. Free, with no ads" },
    { name: "04-profile", title: "Make your profile yours", sub: "Banners, nameplates, colours and bios" },
    { name: "05-messages", title: "All your chats in one place", sub: "Unread badges and push notifications" },
    { name: "06-themes", title: "Themes that match your mood", sub: "Dark, Midnight, Light and app gradients" },
    { name: "07-bots", title: "Add bots to your server", sub: "Music, moderation, games and more" },
  ],
  ipad: [
    { name: "01-chat", title: "Your servers. Your vibe.", sub: "Channels, roles, replies and reactions" },
    { name: "02-dm", title: "Chat with your friends", sub: "DMs and group chats. Free, with no ads" },
    { name: "03-profile", title: "Make your profile yours", sub: "Banners, nameplates, colours and bios" },
    { name: "04-themes", title: "Themes that match your mood", sub: "Dark, Midnight, Light and app gradients" },
    { name: "05-bots", title: "Add bots to your server", sub: "Music, moderation, games and more" },
  ],
};

/** Canvas, frame and screen geometry (canvas pixels; screen in device points). */
const DEVICES = {
  iphone: {
    out: "iphone-6.9", canvas: [1320, 2868], screenPt: [440, 956], screenWidth: 1040, frameTop: 486,
    bezel: 22, radiusPt: 55, statusPt: 62, titleSize: 92, subSize: 44, titleTop: 150,
  },
  ipad: {
    out: "ipad-13", canvas: [2064, 2752], screenPt: [1032, 1376], screenWidth: 1680, frameTop: 400,
    bezel: 30, radiusPt: 18, statusPt: 24, titleSize: 104, subSize: 50, titleTop: 120,
  },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function statusBar(device) {
  // Drawn in device points inside the scaled screen box.
  const white = "#ffffff";
  const wifi = `<svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2C13.9 1.6 11.3.5 8.5.5S3.1 1.6 1 3.6l1.2 1.2C3.9 3.2 6.1 2.3 8.5 2.3zm0 3.4c1.5 0 2.9.6 3.9 1.5l1.2-1.2C12.3 4.8 10.5 4 8.5 4S4.7 4.8 3.4 6l1.2 1.2c1-.9 2.4-1.5 3.9-1.5zm0 3.4c.6 0 1.2.2 1.6.6L8.5 11.3 6.9 9.7c.4-.4 1-.6 1.6-.6z" fill="${white}"/></svg>`;
  const signal = `<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="${white}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${white}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${white}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${white}"/></svg>`;
  const battery = `<svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="${white}" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="${white}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="${white}" fill-opacity="0.4"/></svg>`;
  if (device === "iphone") {
    return `
      <div style="position:absolute;left:0;top:0;width:440px;height:62px;font-family:'UI',system-ui,sans-serif;color:#fff;">
        <div style="position:absolute;left:0;width:160px;top:21px;text-align:center;font-weight:600;font-size:17px;letter-spacing:-0.2px;">9:41</div>
        <div style="position:absolute;left:157px;top:11px;width:126px;height:37px;border-radius:19px;background:#000;"></div>
        <div style="position:absolute;right:28px;top:23px;display:flex;gap:6px;align-items:center;">${signal}${wifi}${battery}</div>
      </div>`;
  }
  return `
    <div style="position:absolute;left:0;top:0;width:1032px;height:24px;font-family:'UI',system-ui,sans-serif;color:#fff;font-size:13px;font-weight:600;">
      <div style="position:absolute;left:22px;top:5px;">9:41&nbsp;&nbsp;Thu Oct 29</div>
      <div style="position:absolute;right:20px;top:5px;display:flex;gap:6px;align-items:center;">${wifi}<span>100%</span>${battery}</div>
    </div>`;
}

function html(device, shot, rawPath, fonts) {
  const d = DEVICES[device];
  const [cw, ch] = d.canvas;
  const [spw, sph] = d.screenPt;
  const k = d.screenWidth / spw;
  const sw = d.screenWidth;
  const sh = Math.round(sph * k);
  const fw = sw + d.bezel * 2;
  const fh = sh + d.bezel * 2;
  const fl = Math.round((cw - fw) / 2);
  const r = Math.round(d.radiusPt * k);
  const img = `data:image/png;base64,${fs.readFileSync(rawPath).toString("base64")}`;
  const face = (name, file, weight) =>
    file ? `@font-face{font-family:'${name}';src:url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}) format('woff2');font-weight:${weight};}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${face("Display", fonts.display, "100 900")}
    ${face("UI", fonts.ui, "100 900")}
    html,body{margin:0;padding:0;}
    body{width:${cw}px;height:${ch}px;overflow:hidden;position:relative;
      background:
        radial-gradient(ellipse 70% 40% at 15% 8%, rgba(236,72,153,0.35), transparent 70%),
        radial-gradient(ellipse 80% 45% at 90% 30%, rgba(167,139,250,0.45), transparent 70%),
        radial-gradient(ellipse 90% 50% at 50% 105%, rgba(56,189,248,0.22), transparent 70%),
        linear-gradient(165deg, #12052e 0%, #2e1065 45%, #4c1d95 75%, #1e1b4b 100%);}
    .cap{position:absolute;left:${Math.round(cw * 0.07)}px;right:${Math.round(cw * 0.07)}px;top:${d.titleTop}px;text-align:center;color:#fff;}
    .t{font-family:'Display','UI',system-ui,sans-serif;font-weight:700;font-size:${d.titleSize}px;line-height:1.08;letter-spacing:-0.02em;}
    .s{font-family:'UI',system-ui,sans-serif;font-weight:500;font-size:${d.subSize}px;line-height:1.3;margin-top:${Math.round(d.subSize * 0.55)}px;color:rgba(237,233,254,0.86);}
    .frame{position:absolute;left:${fl}px;top:${d.frameTop}px;width:${fw}px;height:${fh}px;border-radius:${r + d.bezel}px;
      background:linear-gradient(160deg,#2a2440,#0b0a12 40%,#16131f);box-shadow:0 40px 120px rgba(8,4,24,0.65), inset 0 0 0 2px rgba(255,255,255,0.10);}
    .screen{position:absolute;left:${d.bezel}px;top:${d.bezel}px;width:${sw}px;height:${sh}px;border-radius:${r}px;overflow:hidden;background:#05060a;}
    .inner{position:absolute;left:0;top:0;width:${spw}px;height:${sph}px;transform:scale(${k});transform-origin:0 0;}
    .inner > img{position:absolute;left:0;top:0;width:${spw}px;height:${sph}px;}
  </style></head><body>
    <div class="cap"><div class="t">${esc(shot.title)}</div><div class="s">${esc(shot.sub)}</div></div>
    <div class="frame"><div class="screen"><div class="inner"><img src="${img}">${statusBar(device)}</div></div></div>
  </body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const rawDir = args.find((a) => !a.startsWith("--"));
  if (!rawDir) {
    console.error("usage: compose-screenshots.mjs <rawDir> [--display-font f.woff2] [--ui-font f.woff2]");
    process.exit(1);
  }
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const fonts = { display: opt("--display-font"), ui: opt("--ui-font") };
  const outRoot = path.join(here, "..", "screenshots");
  const browser = await chromium.launch();
  try {
    for (const device of Object.keys(SHOTS)) {
      const d = DEVICES[device];
      const page = await browser.newPage({ viewport: { width: d.canvas[0], height: d.canvas[1] }, deviceScaleFactor: 1 });
      for (const shot of SHOTS[device]) {
        const raw = path.join(rawDir, device, `${shot.name}.png`);
        if (!fs.existsSync(raw)) {
          console.warn(`skip ${device}/${shot.name}: no ${raw}`);
          continue;
        }
        await page.setContent(html(device, shot, raw, fonts), { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot({ type: "png" });
        const out = path.join(outRoot, d.out, `${shot.name}.png`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        // Opaque sRGB, no alpha channel (App Store requirement).
        await sharp(png).flatten({ background: "#12052e" }).removeAlpha().toColourspace("srgb").png({ compressionLevel: 9 }).toFile(out);
        console.log("wrote", path.relative(repoRoot, out));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
