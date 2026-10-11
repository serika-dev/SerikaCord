/**
 * Which files can be attached, and with what stored content type.
 *
 * Which files may be attached comes from the platform whitelist (admin
 * settings). An entry is a MIME type ("application/zip"), a MIME family
 * ("video/*"), a file ending (".7z", ".001") or pattern (".7z.*" for every
 * split-archive part) or "*" for everything; files browsers send without a
 * type count as application/octet-stream; `safe: false` still allows the
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

// Browsers disagree on some names (Chrome now sends video/matroska for .mkv;
// whitelists usually list video/x-matroska). Compare on one canonical name.
const MIME_ALIASES: Record<string, string> = {
  "video/matroska": "video/x-matroska",
  "audio/matroska": "audio/x-matroska",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-flac": "audio/flac",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "application/x-zip-compressed": "application/zip",
  "application/x-zip": "application/zip",
  "application/x-gzip": "application/gzip",
  "application/x-7z": "application/x-7z-compressed",
  "text/x-markdown": "text/markdown",
  "application/x-pdf": "application/pdf",
};

/** Lowercase, drop parameters (";codecs=opus") and fold known aliases. */
export function canonicalMime(type: string | null | undefined): string {
  const t = (type ?? "").trim().toLowerCase().split(";")[0].trim();
  return MIME_ALIASES[t] ?? t;
}

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
  const c = canonicalMime(t);
  return knownTypes.some((k) => canonicalMime(k) === c) ? t : DOWNLOAD_CONTENT_TYPE;
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
  if (e.startsWith(".") || e.startsWith("*.")) {
    const ending = e.startsWith("*") ? e.slice(1) : e;
    // ".7z.*" covers every part of a split archive (.7z.001, .7z.002, ...).
    if (ending.includes("*")) {
      const re = new RegExp(`${ending.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/\\\\]*")}$`, "i");
      return re.test(name);
    }
    return name.toLowerCase().endsWith(ending);
  }
  if (!type) return false;
  if (e.endsWith("/*")) return type.startsWith(e.slice(0, -1));
  return type === canonicalMime(e);
}

/** Whether the whitelist allows this file, and whether to warn about it. */
export function checkAttachmentWhitelist(
  name: string,
  type: string | null | undefined,
  whitelist: readonly WhitelistEntry[] | null | undefined,
  builtIn: readonly string[],
): { allowed: boolean; warn: boolean } {
  // Browsers send no type for files they don't recognise (split archive parts
  // like .7z.001): that is application/octet-stream.
  const t = canonicalMime(type) || "application/octet-stream";
  const list = whitelist && whitelist.length > 0 ? whitelist : builtIn.map((b) => ({ type: b, safe: true }));
  const hits = list.filter((entry) => entryMatches(entry.type, name, t));
  if (hits.length === 0) return { allowed: false, warn: false };
  return { allowed: true, warn: hits.every((h) => !h.safe) || RISKY_EXTENSIONS.has(fileExtension(name)) };
}

/**
 * Whether an attachment should get the inline video player. Matroska (.mkv)
 * is shown as a file card instead: browsers only play some MKVs (codec
 * dependent), and a broken player is worse than a download button.
 */
export function isInlineVideo(contentType: string | null | undefined, filename?: string | null): boolean {
  const c = canonicalMime(contentType);
  if (!c.startsWith("video/")) return false;
  if (c === "video/x-matroska") return false;
  return !/\.(mkv|mka|mk3d)$/i.test(filename ?? "");
}
