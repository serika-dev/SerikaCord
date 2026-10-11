/**
 * Which files can be attached, and with what stored content type.
 *
 * Like Discord, any file can be uploaded (split archives such as `.7z.001`,
 * source files, executables...). Only the stored content type is restricted:
 * types that render as media or documents keep theirs; anything else, and
 * anything a browser could run as a page, is stored as a plain download.
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
