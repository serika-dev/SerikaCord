/**
 * Which files can be attached, and with what stored content type.
 *
 * Which files may be attached comes from the platform whitelist (admin
 * settings). An entry is a MIME type ("application/zip"), a MIME family
 * ("video/*"), a file ending (".7z", ".001", ".7z.001", for files browsers
 * send without a type) or "*" for everything; `safe: false` still allows the
 * file but warns. With no whitelist, the built-in media/document types apply.
 *
 * The stored content type is restricted separately: types that render as
 * media or documents keep theirs; anything else, and anything a browser could
 * run as a page, is stored as a plain download.
 */

// Executables and scripts: allowed, but flagged so the client can warn.
const RISKY_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "hta", "jar", "apk", "app", "dmg", "pkg", "deb", "rpm", "sh", "run", "lnk", "reg", "dll", "sys",
]);

// Never keep these types: served from the CDN they would render as a page.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|application\/xml|text\/xml|text\/javascript|application\/javascript|application\/x-javascript|image\/svg\+xml|application\/x-shockwave-flash)\b/i;

export const DOWNLOAD_CONTENT_TYPE = "application/octet-stream";

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * The content type to store an attachment under. `knownTypes` are the types we
 * render inline (config.ALLOWED_FILE_TYPES); everything else becomes a download.
 */
export function storedAttachmentType(type: string | null | undefined, knownTypes: readonly string[]): string {
  const t = (type ?? "").trim().toLowerCase().split(";")[0].trim();
  if (!t || ACTIVE_TYPES.test(t)) return DOWNLOAD_CONTENT_TYPE;
  return knownTypes.includes(t) ? t : DOWNLOAD_CONTENT_TYPE;
}

/** Whether to show a "this file could be harmful" warning. */
export function isRiskyAttachment(name: string, flaggedTypes: readonly string[] = [], type = ""): boolean {
  return RISKY_EXTENSIONS.has(fileExtension(name)) || (type !== "" && flaggedTypes.includes(type.toLowerCase()));
}

export interface WhitelistEntry {
  type: string;
  safe: boolean;
}

function entryMatches(entry: string, name: string, type: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e === "*" || e === "*/*") return true;
  if (e.startsWith(".")) return name.toLowerCase().endsWith(e);
  if (e.startsWith("*.")) return name.toLowerCase().endsWith(e.slice(1));
  if (!type) return false;
  if (e.endsWith("/*")) return type.startsWith(e.slice(0, -1));
  return type === e;
}

/** Whether the whitelist allows this file, and whether to warn about it. */
export function checkAttachmentWhitelist(
  name: string,
  type: string | null | undefined,
  whitelist: readonly WhitelistEntry[] | null | undefined,
  builtIn: readonly string[],
): { allowed: boolean; warn: boolean } {
  const t = (type ?? "").trim().toLowerCase().split(";")[0].trim();
  const list = whitelist && whitelist.length > 0 ? whitelist : builtIn.map((b) => ({ type: b, safe: true }));
  const hits = list.filter((entry) => entryMatches(entry.type, name, t));
  if (hits.length === 0) return { allowed: false, warn: false };
  return { allowed: true, warn: hits.every((h) => !h.safe) || RISKY_EXTENSIONS.has(fileExtension(name)) };
}
