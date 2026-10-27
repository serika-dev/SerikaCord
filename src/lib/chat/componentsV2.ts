/**
 * Client helpers for rendering components v2 (container, section, text
 * display, thumbnail, media gallery, file, separator). Pure, no React, so the
 * layout and URL rules are unit tested (tests/components-v2.test.ts).
 *
 * Media URLs: uploads (media with `attachment_id`, resolved from
 * `attachment://` on the server) and our own CDN are loaded directly (CDN
 * images as WebP via cdnImage). Any other http(s) image goes through the
 * wsrv.nl image proxy our CDN already uses (as wishlist thumbnails do), so a
 * bot can't make every viewer's browser contact a host it picked. External
 * videos can't be proxied: they render with no referrer and `preload="none"`,
 * so nothing is fetched until the viewer presses play.
 */
import { cdnImage } from "@/lib/utils";
import { IS_COMPONENTS_V2, type UnfurledMedia } from "@/lib/botapi/components";

export { IS_COMPONENTS_V2 };

/** True when the message flags have IS_COMPONENTS_V2 (only components are shown). */
export function isComponentsV2Message(flags: number | null | undefined): boolean {
  return typeof flags === "number" && (flags & IS_COMPONENTS_V2) !== 0;
}

const OWN_HOSTS = ["serika.chat", "serika.dev"];

function parseHttp(url: unknown): URL | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

function isOwnHost(host: string): boolean {
  const h = host.toLowerCase();
  return OWN_HOSTS.some((own) => h === own || h.endsWith(`.${own}`));
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** Whether gallery media is a video (by content type, else by file extension). */
export function isVideoMedia(media: Pick<UnfurledMedia, "url" | "content_type"> | null | undefined): boolean {
  if (!media) return false;
  if (typeof media.content_type === "string" && media.content_type) return media.content_type.toLowerCase().startsWith("video/");
  const u = parseHttp(media.url);
  return Boolean(u && VIDEO_EXT.test(u.pathname));
}

/** Uploaded with the message, or on one of our own hosts: safe to load directly. */
export function isTrustedMedia(media: Pick<UnfurledMedia, "url" | "attachment_id"> | null | undefined): boolean {
  const u = parseHttp(media?.url);
  if (!u) return false;
  return Boolean(media?.attachment_id) || isOwnHost(u.hostname);
}

/**
 * The `src` to show an image from a component, or null for anything that
 * isn't a plain http(s) URL. `width` asks the proxy / CDN for a smaller
 * rendition (thumbnails, gallery tiles); omit it for the full-size viewer.
 */
export function componentImageSrc(
  media: Pick<UnfurledMedia, "url" | "attachment_id"> | null | undefined,
  opts: { width?: number } = {},
): string | null {
  const u = parseHttp(media?.url);
  if (!u) return null;
  if (isTrustedMedia(media)) return cdnImage(u.toString());
  const params = new URLSearchParams({ url: u.toString(), n: "-1", output: "webp" });
  if (opts.width && Number.isFinite(opts.width) && opts.width > 0) {
    params.set("w", String(Math.round(opts.width)));
    params.set("we", "");
  }
  return `https://wsrv.nl/?${params.toString()}`;
}

/** The `src` for a video in a gallery (http(s) only; never proxied). */
export function componentVideoSrc(media: Pick<UnfurledMedia, "url"> | null | undefined): string | null {
  const u = parseHttp(media?.url);
  return u ? u.toString() : null;
}

/**
 * Discord's media gallery layouts. `feature` (3 items) is one large tile on
 * the left with two stacked on the right; otherwise `rows` lists how many
 * tiles each row holds, top to bottom: 1, 2, 2+2, then rows of three with the
 * remainder (1 or 2 wide) on top: 5 = 2+3, 7 = 1+3+3, 10 = 1+3+3+3.
 */
export function galleryLayout(count: number): { feature: boolean; rows: number[] } {
  const n = Math.max(0, Math.min(10, Math.floor(count)));
  if (n === 0) return { feature: false, rows: [] };
  if (n <= 2) return { feature: false, rows: [n] };
  if (n === 3) return { feature: true, rows: [1, 2] };
  if (n === 4) return { feature: false, rows: [2, 2] };
  const rem = n % 3;
  const rows: number[] = rem ? [rem] : [];
  for (let i = 0; i < Math.floor(n / 3); i++) rows.push(3);
  return { feature: false, rows };
}

/** Accent color (0xRRGGBB) as CSS hex, or undefined for none / invalid. */
export function accentHex(n: number | null | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 0xffffff) return undefined;
  return `#${n.toString(16).padStart(6, "0")}`;
}
