#!/usr/bin/env bun
/**
 * Pushes the SerikaCord App Store listing (mobile/ios/appstore/) to App Store
 * Connect through the App Store Connect API. Nothing outside the listing is
 * touched (no builds, no submission for review).
 *
 *   bun mobile/ios/appstore/tools/upload.ts --dry-run          # show the plan, write nothing
 *   bun mobile/ios/appstore/tools/upload.ts                    # apply it
 *   bun mobile/ios/appstore/tools/upload.ts --skip-screenshots # metadata only
 *   bun mobile/ios/appstore/tools/upload.ts --only=screenshots # screenshots only
 *
 * Environment:
 *   ASC_KEY_ID, ASC_ISSUER_ID   App Store Connect API key (App Manager role or higher)
 *   ASC_KEY_PATH                path to the AuthKey_<KEYID>.p8 (never printed)
 *   ASC_CONTACT_FIRST_NAME, ASC_CONTACT_LAST_NAME, ASC_CONTACT_EMAIL, ASC_CONTACT_PHONE
 *                               optional App Review contact; only the ones set are sent
 *   DEMO_USERNAME, DEMO_PASSWORD
 *                               optional. The demo account is normally entered by hand in
 *                               App Store Connect: demoAccountName / demoAccountPassword /
 *                               demoAccountRequired are only sent when BOTH are set.
 *
 * With --dry-run and no credentials it prints the plan from the local files;
 * with credentials it also reads the current values (GET only) and shows a
 * field-by-field diff.
 *
 * Screenshots: the 6.9" iPhone set (1320x2868) goes to display type
 * APP_IPHONE_67 and the 13" iPad set (2064x2752) to APP_IPAD_PRO_3GEN_129
 * (App Store Connect has no separate 6.9"/13" types). Existing screenshots in
 * those two sets of the en-US localization are replaced: each file is
 * reserved, uploaded with the returned upload operations, committed with its
 * MD5 checksum, and finally the set is put in file-name order.
 *
 * Only fetch and node:crypto are used (no extra dependencies).
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.appstoreconnect.apple.com";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const ONLY = [...args].find((a) => a.startsWith("--only="))?.slice("--only=".length);
const SKIP_SCREENSHOTS = args.has("--skip-screenshots");
const doMeta = !ONLY || ONLY === "metadata";
const doShots = !SKIP_SCREENSHOTS && (!ONLY || ONLY === "screenshots");

// ─── Listing ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
interface Listing {
  app: { bundleId: string; appleId: string; primaryLocale: string };
  version: { platform: string; versionString: string; copyright: string };
  categories: { primary: string; secondary: string };
  localizations: Record<string, {
    name: string; subtitle: string; privacyPolicyUrl: string; promotionalText: string;
    description: string; keywords: string; supportUrl: string; marketingUrl: string; whatsNew: string;
  }>;
  ageRatingDeclaration: Json;
  review: { notesFile: string; demoAccountRequired: boolean };
  screenshots: Record<string, unknown>;
}

const listing = JSON.parse(readFileSync(join(ROOT, "listing.json"), "utf8")) as Listing;
const LOCALE = listing.app.primaryLocale;
const loc = listing.localizations[LOCALE];
// The en-US/*.txt files are the source of truth for the long texts.
const text = (f: string) => readFileSync(join(ROOT, LOCALE, f), "utf8");
loc.description = text("description.txt");
loc.keywords = text("keywords.txt");
loc.promotionalText = text("promotional_text.txt");
loc.subtitle = text("subtitle.txt");
const reviewNotes = readFileSync(join(ROOT, listing.review.notesFile), "utf8");
const ageRating = Object.fromEntries(Object.entries(listing.ageRatingDeclaration).filter(([k]) => !k.startsWith("$")));
const screenshotSets = Object.fromEntries(
  Object.entries(listing.screenshots).filter(([k]) => !k.startsWith("$")) as [string, string[]][],
);

const LIMITS: [string, string, number][] = [
  ["name", loc.name, 30], ["subtitle", loc.subtitle, 30], ["promotionalText", loc.promotionalText, 170],
  ["description", loc.description, 4000], ["keywords", loc.keywords, 100], ["review notes", reviewNotes, 4000],
];
for (const [field, value, max] of LIMITS) {
  if ([...value].length > max) throw new Error(`${field} is ${[...value].length} characters (max ${max})`);
}

// ─── Auth ───────────────────────────────────────────────────────────────────

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_KEY_PATH;
const haveCreds = Boolean(KEY_ID && ISSUER && KEY_PATH);
if (!haveCreds && !DRY) {
  console.error("Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (or use --dry-run).");
  process.exit(1);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
let cachedToken: { token: string; exp: number } | null = null;
function token(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  const exp = now + 15 * 60; // Apple allows at most 20 minutes.
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp, aud: "appstoreconnect-v1" }));
  const key = createPrivateKey(readFileSync(KEY_PATH!, "utf8"));
  // JWS ES256 wants the raw r||s signature, not DER.
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  cachedToken = { token: `${header}.${payload}.${b64url(sig)}`, exp };
  return cachedToken.token;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

interface Resource { id: string; type: string; attributes?: Json; relationships?: Json }
interface Doc { data: Resource | Resource[] | null; links?: { next?: string } }

async function api(method: string, path: string, body?: unknown): Promise<Doc | null> {
  const write = method !== "GET";
  if (write && DRY) throw new Error(`BUG: write ${method} ${path} during --dry-run`);
  const url = path.startsWith("http") ? path : `${API}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 204) return null;
    const textBody = await res.text();
    if (!res.ok) {
      if (method === "GET" && res.status === 404) return null;
      throw new Error(`${method} ${path} -> ${res.status}\n${textBody.slice(0, 2000)}`);
    }
    return textBody ? (JSON.parse(textBody) as Doc) : null;
  }
}
const one = (d: Doc | null) => (d && !Array.isArray(d.data) ? d.data : null);
async function many(path: string): Promise<Resource[]> {
  const out: Resource[] = [];
  let next: string | undefined = path;
  while (next) {
    const d = await api("GET", next);
    if (!d) break;
    out.push(...((Array.isArray(d.data) ? d.data : []) as Resource[]));
    next = d.links?.next;
  }
  return out;
}

// ─── Plan / diff output ─────────────────────────────────────────────────────

const SECRET = new Set(["demoAccountPassword"]);
const show = (k: string, v: unknown) => {
  if (v === undefined || v === null) return "(unset)";
  if (SECRET.has(k)) return "********";
  if (typeof v !== "string") return JSON.stringify(v);
  return v.length > 80 ? `${JSON.stringify(v.slice(0, 77))}... (${v.length} chars)` : JSON.stringify(v);
};
/** Fields of `want` that differ from `have` (all of them when `have` is unknown). */
function changed(want: Json, have: Json | undefined): Json {
  return Object.fromEntries(Object.entries(want).filter(([k, v]) => !have || JSON.stringify(have[k]) !== JSON.stringify(v)));
}
function report(label: string, want: Json, have: Json | undefined) {
  const diff = changed(want, have);
  const keys = Object.keys(diff);
  console.log(`\n${label}: ${keys.length ? `${keys.length} field(s) ${DRY ? "would change" : "to change"}` : "up to date"}`);
  for (const k of keys) console.log(`  ${k}: ${have ? `${show(k, have[k])} -> ` : ""}${show(k, diff[k])}`);
  return diff;
}

// ─── Steps ──────────────────────────────────────────────────────────────────

async function findApp(): Promise<Resource> {
  const apps = await many(`/v1/apps?filter[bundleId]=${encodeURIComponent(listing.app.bundleId)}`);
  const app = apps.find((a) => a.attributes?.bundleId === listing.app.bundleId);
  if (!app) throw new Error(`No app with bundle id ${listing.app.bundleId} in this team`);
  if (app.id !== listing.app.appleId) console.warn(`note: app id ${app.id} differs from listing.json appleId ${listing.app.appleId}`);
  return app;
}

async function findOrCreateVersion(appId: string): Promise<Resource | null> {
  const v = listing.version;
  const versions = await many(`/v1/apps/${appId}/appStoreVersions?filter[platform]=${v.platform}&filter[versionString]=${encodeURIComponent(v.versionString)}`);
  if (versions[0]) return versions[0];
  console.log(`\nappStoreVersion ${v.platform} ${v.versionString}: missing, ${DRY ? "would create" : "creating"}`);
  if (DRY) return null;
  return one(await api("POST", "/v1/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: v.platform, versionString: v.versionString, copyright: v.copyright },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  }));
}

/** The app info that is still editable (the one for the upcoming version). */
async function editableAppInfo(appId: string): Promise<Resource> {
  const infos = await many(`/v1/apps/${appId}/appInfos`);
  const live = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_INFO"]);
  const info = infos.find((i) => !live.has(String(i.attributes?.state ?? i.attributes?.appStoreState ?? ""))) ?? infos[0];
  if (!info) throw new Error("No appInfo found");
  return info;
}

async function upsert(label: string, listPath: string, type: string, want: Json, create: () => Json) {
  const rows = await many(listPath);
  const row = rows.find((r) => r.attributes?.locale === LOCALE);
  const diff = report(label, want, row?.attributes);
  if (DRY || !Object.keys(diff).length) return row;
  if (row) return one(await api("PATCH", `/v1/${type}/${row.id}`, { data: { type, id: row.id, attributes: diff } }));
  return one(await api("POST", `/v1/${type}`, { data: { type, attributes: { locale: LOCALE, ...want }, relationships: create() } }));
}

async function metadata(appId: string, version: Resource | null) {
  // Version: copyright.
  if (version) {
    const diff = report("appStoreVersion", { copyright: listing.version.copyright }, version.attributes);
    if (!DRY && Object.keys(diff).length) await api("PATCH", `/v1/appStoreVersions/${version.id}`, { data: { type: "appStoreVersions", id: version.id, attributes: diff } });
  } else {
    report("appStoreVersion", { copyright: listing.version.copyright }, undefined);
  }

  // App info: categories, localization (name, subtitle, privacy policy), age rating.
  const info = haveCreds ? await editableAppInfo(appId) : null;
  const cats = { primaryCategory: listing.categories.primary, secondaryCategory: listing.categories.secondary };
  let haveCats: Json | undefined;
  if (info) {
    const [p, s] = await Promise.all([
      api("GET", `/v1/appInfos/${info.id}/primaryCategory`),
      api("GET", `/v1/appInfos/${info.id}/secondaryCategory`),
    ]);
    haveCats = { primaryCategory: one(p)?.id ?? null, secondaryCategory: one(s)?.id ?? null };
  }
  const catDiff = report("appInfo categories", cats, haveCats);
  if (info && !DRY && Object.keys(catDiff).length) {
    await api("PATCH", `/v1/appInfos/${info.id}`, {
      data: {
        type: "appInfos", id: info.id,
        relationships: {
          primaryCategory: { data: { type: "appCategories", id: cats.primaryCategory } },
          secondaryCategory: { data: { type: "appCategories", id: cats.secondaryCategory } },
        },
      },
    });
  }

  const infoLoc = { name: loc.name, subtitle: loc.subtitle, privacyPolicyUrl: loc.privacyPolicyUrl };
  if (info) {
    await upsert(`appInfoLocalization ${LOCALE}`, `/v1/appInfos/${info.id}/appInfoLocalizations`, "appInfoLocalizations", infoLoc,
      () => ({ appInfo: { data: { type: "appInfos", id: info.id } } }));
  } else report(`appInfoLocalization ${LOCALE}`, infoLoc, undefined);

  const age = info ? one(await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)) : null;
  const ageDiff = report("ageRatingDeclaration", ageRating, age?.attributes);
  if (age && !DRY && Object.keys(ageDiff).length) {
    await api("PATCH", `/v1/ageRatingDeclarations/${age.id}`, { data: { type: "ageRatingDeclarations", id: age.id, attributes: ageDiff } });
  }

  // Version localization. whatsNew is rejected for an app's first version.
  const isFirstVersion = listing.version.versionString === "1.0";
  const verLoc: Json = {
    description: loc.description, keywords: loc.keywords, promotionalText: loc.promotionalText,
    supportUrl: loc.supportUrl, marketingUrl: loc.marketingUrl,
    ...(isFirstVersion ? {} : { whatsNew: loc.whatsNew }),
  };
  if (version) {
    await upsert(`appStoreVersionLocalization ${LOCALE}`, `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
      "appStoreVersionLocalizations", verLoc, () => ({ appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } }));
  } else report(`appStoreVersionLocalization ${LOCALE}`, verLoc, undefined);

  // App Review details. Only fields we actually have are sent; the demo
  // account is left alone unless DEMO_USERNAME and DEMO_PASSWORD are both set.
  const env = process.env;
  const review: Json = { notes: reviewNotes };
  if (env.ASC_CONTACT_FIRST_NAME) review.contactFirstName = env.ASC_CONTACT_FIRST_NAME;
  if (env.ASC_CONTACT_LAST_NAME) review.contactLastName = env.ASC_CONTACT_LAST_NAME;
  if (env.ASC_CONTACT_EMAIL) review.contactEmail = env.ASC_CONTACT_EMAIL;
  if (env.ASC_CONTACT_PHONE) review.contactPhone = env.ASC_CONTACT_PHONE;
  const missingContact = ["ASC_CONTACT_FIRST_NAME", "ASC_CONTACT_LAST_NAME", "ASC_CONTACT_EMAIL", "ASC_CONTACT_PHONE"].filter((k) => !env[k]);
  if (missingContact.length) console.log(`\nappStoreReviewDetail: not set, left untouched: ${missingContact.join(", ")}`);
  if (env.DEMO_USERNAME && env.DEMO_PASSWORD) {
    review.demoAccountName = env.DEMO_USERNAME;
    review.demoAccountPassword = env.DEMO_PASSWORD;
    review.demoAccountRequired = listing.review.demoAccountRequired;
  } else {
    console.log("\nappStoreReviewDetail: demo account fields left untouched (DEMO_USERNAME / DEMO_PASSWORD not both set)");
  }
  const detail = version ? one(await api("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)) : null;
  const reviewDiff = report("appStoreReviewDetail", review, detail?.attributes ?? (version && haveCreds ? {} : undefined));
  if (version && !DRY && Object.keys(reviewDiff).length) {
    if (detail) {
      await api("PATCH", `/v1/appStoreReviewDetails/${detail.id}`, { data: { type: "appStoreReviewDetails", id: detail.id, attributes: reviewDiff } });
    } else {
      await api("POST", "/v1/appStoreReviewDetails", {
        data: { type: "appStoreReviewDetails", attributes: review, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } },
      });
    }
  }
}

const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");

async function uploadScreenshot(setId: string, file: string): Promise<string> {
  const bytes = readFileSync(file);
  const reserved = one(await api("POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: basename(file), fileSize: bytes.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  }));
  if (!reserved) throw new Error(`reservation failed for ${file}`);
  const ops = (reserved.attributes?.uploadOperations ?? []) as {
    method: string; url: string; offset: number; length: number; requestHeaders?: { name: string; value: string }[];
  }[];
  for (const op of ops) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`upload part of ${basename(file)} failed: ${res.status} ${await res.text()}`);
  }
  await api("PATCH", `/v1/appScreenshots/${reserved.id}`, {
    data: { type: "appScreenshots", id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: md5(bytes) } },
  });
  return reserved.id;
}

async function screenshots(version: Resource | null) {
  let locId: string | null = null;
  if (version) {
    const locs = await many(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    locId = locs.find((l) => l.attributes?.locale === LOCALE)?.id ?? null;
    if (!locId && !DRY) throw new Error(`No ${LOCALE} version localization (run without --only=screenshots first)`);
  }
  const sets = locId ? await many(`/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`) : [];

  for (const [displayType, rel] of Object.entries(screenshotSets)) {
    const files = rel.map((r) => join(ROOT, r));
    for (const f of files) statSync(f); // fail early on a missing file
    const set = sets.find((s) => s.attributes?.screenshotDisplayType === displayType);
    const existing = set ? await many(`/v1/appScreenshotSets/${set.id}/appScreenshots`) : [];
    console.log(`\n${displayType}: ${DRY ? "would replace" : "replacing"} ${existing.length} existing with ${files.length}`);
    for (const e of existing) console.log(`  - ${e.attributes?.fileName ?? e.id}`);
    for (const f of files) console.log(`  + ${basename(f)} (${(statSync(f).size / 1048576).toFixed(2)} MB)`);
    if (DRY || !locId) continue;

    const setId = set?.id ?? one(await api("POST", "/v1/appScreenshotSets", {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locId } } },
      },
    }))!.id;
    for (const e of existing) await api("DELETE", `/v1/appScreenshots/${e.id}`);
    const ids: string[] = [];
    for (const f of files) {
      ids.push(await uploadScreenshot(setId, f));
      console.log(`  uploaded ${basename(f)}`);
    }
    await api("PATCH", `/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: "appScreenshots", id })),
    });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`SerikaCord App Store listing ${DRY ? "(dry run: no writes)" : ""}`);
  let appId = listing.app.appleId;
  let version: Resource | null = null;
  if (haveCreds) {
    const app = await findApp();
    appId = app.id;
    version = await findOrCreateVersion(appId);
    if (version) console.log(`app ${appId}, version ${version.attributes?.versionString} (${version.attributes?.appStoreState ?? version.attributes?.appVersionState ?? "?"})`);
  } else {
    console.log("No ASC credentials: showing the plan from the local files only.");
  }
  if (doMeta) await metadata(appId, version);
  if (doShots) await screenshots(version);
  console.log(DRY ? "\nDry run finished. Nothing was written." : "\nDone. Review the listing in App Store Connect before submitting.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
