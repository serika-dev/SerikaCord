#!/usr/bin/env node
/**
 * Merge a batch of translations into a target locale file.
 * Usage: node scripts/merge-translations.js <locale-file> <batch-file>
 * Example: node scripts/merge-translations.js nl-NL /tmp/batch-nl-1.json
 */
const fs = require("fs");
const path = require("path");

const targetFile = process.argv[2];
const batchFile = process.argv[3];

if (!targetFile || !batchFile) {
  console.error("Usage: node scripts/merge-translations.js <locale-file> <batch-file>");
  process.exit(1);
}

const targetPath = path.resolve(__dirname, "..", "public", "_gt", targetFile);
const batchData = JSON.parse(fs.readFileSync(batchFile, "utf8"));

let target = {};
if (fs.existsSync(targetPath)) {
  target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

const before = Object.keys(target).length;
Object.assign(target, batchData);
const after = Object.keys(target).length;

fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n");
console.log(`Merged ${Object.keys(batchData).length} keys into ${targetFile} (${before} → ${after})`);
