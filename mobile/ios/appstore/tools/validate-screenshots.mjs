#!/usr/bin/env node
/**
 * Checks the App Store screenshots against Apple's upload rules:
 * exact size per display type, PNG/JPEG, no alpha channel, sRGB (or
 * untagged), under 10 MB, 1-10 per set. Exits non-zero on any problem.
 *
 *   node mobile/ios/appstore/tools/validate-screenshots.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../../../package.json"));
const sharp = require("sharp");

const SETS = {
  // APP_IPHONE_67 accepts 1290x2796 and 1320x2868 (6.9"); we ship 1320x2868.
  "iphone-6.9": [[1320, 2868]],
  // APP_IPAD_PRO_3GEN_129 accepts 2048x2732 and 2064x2752 (13"); we ship 2064x2752.
  "ipad-13": [[2064, 2752]],
};
const MAX_BYTES = 10 * 1024 * 1024;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error("FAIL", msg);
};

for (const [dir, sizes] of Object.entries(SETS)) {
  const full = path.join(here, "..", "screenshots", dir);
  const files = fs.existsSync(full) ? fs.readdirSync(full).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort() : [];
  if (files.length < 1 || files.length > 10) fail(`${dir}: ${files.length} screenshots (need 1-10)`);
  for (const f of files) {
    const p = path.join(full, f);
    const bytes = fs.statSync(p).size;
    const meta = await sharp(p).metadata();
    const okSize = sizes.some(([w, h]) => meta.width === w && meta.height === h);
    const problems = [];
    if (!okSize) problems.push(`size ${meta.width}x${meta.height}`);
    if (meta.hasAlpha || meta.channels !== 3) problems.push(`channels=${meta.channels} alpha=${meta.hasAlpha}`);
    if (meta.space && meta.space !== "srgb") problems.push(`colour space ${meta.space}`);
    if (bytes > MAX_BYTES) problems.push(`${(bytes / 1048576).toFixed(1)} MB`);
    if (!["png", "jpeg"].includes(meta.format)) problems.push(`format ${meta.format}`);
    // Guard against blank captures: the screen area must not be one flat colour.
    const stats = await sharp(p).stats();
    const spread = Math.max(...stats.channels.map((c) => c.stdev));
    if (spread < 12) problems.push(`looks blank (stdev ${spread.toFixed(1)})`);
    if (problems.length) fail(`${dir}/${f}: ${problems.join(", ")}`);
    else console.log(`ok   ${dir}/${f}  ${meta.width}x${meta.height} ${meta.format} ${meta.channels}ch ${(bytes / 1048576).toFixed(2)} MB`);
  }
}

if (failures) {
  console.error(`${failures} problem(s)`);
  process.exit(1);
}
