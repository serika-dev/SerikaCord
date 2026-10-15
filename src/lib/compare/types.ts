/**
 * Types for the public comparison pages (/compare/*). Pure: no React, no
 * gt-next, so tests and the sitemap can import it.
 *
 * Every competitor has a content module in src/lib/compare/content/<id>.ts
 * exporting `sources` (pure, not translated) and `content()` (translated with
 * getGT, every string a literal). SerikaCord's own column lives in
 * content/serika.ts.
 */

export type CompareStatus = "yes" | "no" | "partial" | "notyet" | "unknown";

/** Competitors, in no particular order. The id is also the URL slug. */
export const APP_IDS = [
  "discord",
  "stoat",
  "fluxer",
  "root",
  "nerimity",
  "osmium",
  "valour",
  "spacebar",
  "kloak",
  "signal",
  "telegram",
  "simplex",
  "session",
  "jami",
  "teamspeak",
  "mumble",
  "gamevox",
  "discourse",
  "rocketchat",
  "matrix",
  "xmpp-movim",
  "sable",
  "commet",
] as const;

export type AppId = (typeof APP_IDS)[number];

/** Everything ranked on the tier list: the competitors plus SerikaCord. */
export type TierAppId = AppId | "serikacord";

export type AppKind = "community" | "messenger" | "voice" | "team" | "protocol";

export const APP_KINDS: AppKind[] = ["community", "messenger", "voice", "team", "protocol"];

export interface CompareSource {
  /** Stable key that fact cells and points refer to, unique within one app. */
  id: string;
  /** Shown as the link text; usually the page title (not translated). */
  title: string;
  url: string;
  /** Publisher shown after the title, e.g. "Discord" or "The Verge". */
  publisher: string;
  /** primary = the vendor's own site, docs, code or store listing; secondary = press, Wikipedia, researchers. */
  kind: "primary" | "secondary";
  /** Publication date of the source when known (YYYY, YYYY-MM or YYYY-MM-DD). */
  date?: string;
}

export interface CompareFaqItem {
  question: string;
  answer: string;
}

/** One cell of the fact table. At least one of `status` / `value` is set. */
export interface FactCell {
  status?: CompareStatus;
  /** Short value, e.g. "AGPL-3.0" or "Netherlands (EU)". Translated. */
  value?: string;
  /** One or two sentences of detail. Translated. */
  note?: string;
  /** Ids of entries in the app's `sources` (or SerikaCord's for its column). */
  src?: string[];
}

/** Rows of the fact table, grouped. Every app fills every row. */
export const FACT_GROUPS = [
  { id: "basics", rows: ["operator", "jurisdiction", "businessModel", "ads", "pricing", "maturity"] },
  {
    id: "privacy",
    rows: ["e2eeDms", "e2eeGroups", "e2eeCalls", "e2eeCommunity", "e2eeDefault", "audit", "metadata", "dataUse"],
  },
  { id: "account", rows: ["phone", "email", "ageChecks"] },
  { id: "community", rows: ["servers", "roles", "threadsForums", "onboarding"] },
  { id: "moderation", rows: ["modTools", "platformSafety"] },
  { id: "voice", rows: ["voiceChannels", "videoScreen", "streamingStage"] },
  { id: "bots", rows: ["botApi", "discordBots", "discordMigration"] },
  { id: "platforms", rows: ["desktop", "mobile", "web"] },
  { id: "openness", rows: ["license", "selfHost", "federation"] },
  { id: "limits", rows: ["uploads", "groupSize"] },
  { id: "record", rows: ["scale", "incidents"] },
] as const;

export type FactGroupId = (typeof FACT_GROUPS)[number]["id"];
export type RowId = (typeof FACT_GROUPS)[number]["rows"][number];

export const ROW_IDS: RowId[] = FACT_GROUPS.flatMap((g) => [...g.rows]);

export type Facts = Record<RowId, FactCell>;

export interface ComparePoint {
  title: string;
  text: string;
  src?: string[];
}

/** Everything translated on a competitor's page. Built by content() with getGT. */
export interface AppContent {
  /** One honest line for the card on /compare. */
  take: string;
  /** Opening paragraphs (2-3). */
  intro: string[];
  /** The short verdict shown in the hero. */
  verdict: string;
  facts: Facts;
  /** "Why pick SerikaCord over X": specific and evidence-based. */
  whyUs: ComparePoint[];
  /** "Why you might prefer X over SerikaCord": just as specific and fair. */
  whyThem: ComparePoint[];
  /** Short "pick X if..." completions. */
  pickThem: string[];
  pickUs: string[];
  faq: CompareFaqItem[];
  /** Things we looked for and couldn't confirm. */
  couldNotVerify: string[];
  /** Optional extra section, e.g. claims that conflict with the vendor's own documents. */
  notes?: { title: string; intro?: string; points: string[]; src?: string[] };
}

/** Pure, untranslated facts about a competitor (registry in apps.ts). */
export interface AppMeta {
  id: AppId;
  /** Product name; a proper noun, never translated. */
  name: string;
  /** Short name for chips on the tier list. */
  short: string;
  kind: AppKind;
  website: string;
  status: "active" | "beta" | "shutdown";
  /** English SEO title and description (used for <title>, Open Graph and JSON-LD). */
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  /** Hue (0-359) for the app's letter mark. */
  hue: number;
}

export const TIERS = ["S", "A", "B", "C", "D", "F"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_SECTIONS = [
  "privacy",
  "security",
  "community",
  "moderation",
  "voice",
  "bots",
  "apps",
  "ease",
  "openness",
  "scale",
  "business",
  "migration",
] as const;

export type TierSectionId = (typeof TIER_SECTIONS)[number];
