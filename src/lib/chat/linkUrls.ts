/** URL helpers for link previews (kept apart from the preview components so a message can decide without loading them). */

/** Loose URL comparison ignoring scheme, `www.`, trailing slash and hash. */
export function normalizeEmbedUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function extractUrls(text: string): string[] {
  // Skip URLs wrapped in <...> (Discord's no-embed syntax) via negative
  // lookbehind for <, and exclude > from URL chars so the closing bracket
  // doesn't get captured.
  const urlRegex = /(?<!<)(https?:\/\/[^\s<>]+[^<.,:;"')\]\s>])/g;
  return text.match(urlRegex) || [];
}

/**
 * The link a message previews: its first URL that a rich embed on the message
 * doesn't already show, or "" for none. `text` is the decoded message text.
 */
export function previewUrlOf(text: string, renderedEmbedUrls: string[]): string {
  const urls = extractUrls(text);
  if (urls.length === 0) return "";
  const skip = renderedEmbedUrls.map(normalizeEmbedUrl);
  return urls.find((u) => !skip.includes(normalizeEmbedUrl(u))) || "";
}
