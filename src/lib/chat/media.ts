export interface GalleryItem {
  src: string;
  alt?: string;
  messageId?: string;
}

export interface GalleryLookupTarget {
  src: string;
  messageId?: string;
}

type AttachmentLike =
  | string
  | {
      id?: string;
      _id?: string;
      url?: string;
      imageUrl?: string;
      filename?: string;
      contentType?: string;
      type?: string;
    };

type AttachmentObject = {
  id?: string;
  _id?: string;
  url?: string;
  imageUrl?: string;
  filename?: string;
  contentType?: string;
  type?: string;
};

export interface GalleryMessageLike {
  id?: string;
  _id?: string;
  content?: string;
  attachments?: AttachmentLike[] | null;
}

const IMAGE_EXTENSIONS = /\.(gif|jpg|jpeg|png|webp|svg|bmp|avif)(?:$|[?#])/i;
const GIF_EXTENSIONS = /\.gif(?:$|[?#])/i;
const IMAGE_HOSTS =
  /^https?:\/\/(gifs\.serika\.dev|cdn\.ado\.wtf|i\.imgur\.com|media\d*\.tenor\.com|media\.giphy\.com|i\.giphy\.com|cdn\.discordapp\.com|images-ext-\d+\.discordapp\.net|cdn\.discordapp\.net)/i;
const GIF_HOSTS =
  /^https?:\/\/(gifs\.serika\.dev|media\d*\.tenor\.com|media\.giphy\.com|i\.giphy\.com|klipy\.com|klipy\.dev)/i;
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;

const IMAGE_QUERY_HINTS = ["gif", "jpg", "jpeg", "png", "webp", "svg", "bmp", "avif", "image/"];

function hasImageQueryHint(url: URL): boolean {
  const paramsToCheck = ["format", "fm", "ext", "type", "mime", "content-type"];
  for (const key of paramsToCheck) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const normalized = value.toLowerCase();
    if (IMAGE_QUERY_HINTS.some((hint) => normalized.includes(hint))) {
      return true;
    }
  }
  return false;
}

export function isImageLikeUrl(url: string): boolean {
  if (!url) return false;
  if (IMAGE_EXTENSIONS.test(url) || IMAGE_HOSTS.test(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    if (IMAGE_EXTENSIONS.test(parsed.pathname)) {
      return true;
    }
    if (hasImageQueryHint(parsed)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function isGifUrl(url: string): boolean {
  if (!url) return false;
  if (GIF_EXTENSIONS.test(url) || GIF_HOSTS.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (GIF_EXTENSIONS.test(parsed.pathname)) return true;
    if (GIF_HOSTS.test(url)) return true;
    const format = parsed.searchParams.get("format") || parsed.searchParams.get("fm") || "";
    if (format.toLowerCase().includes("gif")) return true;
  } catch {
    return false;
  }
  return false;
}

function toAttachmentObject(attachment: AttachmentLike): AttachmentObject {
  if (typeof attachment === "string") {
    return { url: attachment };
  }
  return attachment || {};
}

function getMessageId(message: GalleryMessageLike): string | undefined {
  return message.id || message._id;
}

function extractInlineMedia(content: string | undefined, messageId?: string): GalleryItem[] {
  if (!content?.trim()) return [];
  const items: GalleryItem[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(URL_REGEX)) {
    const url = (match[0] || "").trim();
    if (!isImageLikeUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({
      src: url,
      alt: "Image",
      messageId,
    });
  }

  return items;
}

function extractAttachmentMedia(attachments: AttachmentLike[] | null | undefined, messageId?: string): GalleryItem[] {
  if (!attachments?.length) return [];
  const items: GalleryItem[] = [];
  const seen = new Set<string>();

  for (const rawAttachment of attachments) {
    const attachment = toAttachmentObject(rawAttachment);
    const src = attachment.url || attachment.imageUrl;
    if (!src) continue;

    const contentType = attachment.contentType || attachment.type;
    const isImageAttachment = typeof contentType === "string" ? contentType.startsWith("image/") : false;
    if (!isImageAttachment && !isImageLikeUrl(src)) continue;

    const signature = `${messageId || "unknown"}::${src}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    items.push({
      src,
      alt: attachment.filename || "Image",
      messageId,
    });
  }

  return items;
}

export function extractMediaFromMessage(message: GalleryMessageLike): GalleryItem[] {
  const messageId = getMessageId(message);
  return [
    ...extractInlineMedia(message.content, messageId),
    ...extractAttachmentMedia(message.attachments, messageId),
  ];
}

export function buildGalleryFromMessages(messages: GalleryMessageLike[]): GalleryItem[] {
  const gallery: GalleryItem[] = [];
  const seen = new Set<string>();

  for (const message of messages || []) {
    for (const item of extractMediaFromMessage(message)) {
      const signature = `${item.messageId || "unknown"}::${item.src}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      gallery.push(item);
    }
  }

  return gallery;
}

export function findGalleryIndex(items: GalleryItem[], target: GalleryLookupTarget): number {
  if (!items.length) return -1;

  if (target.messageId) {
    const exactIndex = items.findIndex(
      (item) => item.src === target.src && item.messageId === target.messageId
    );
    if (exactIndex >= 0) return exactIndex;
  }

  return items.findIndex((item) => item.src === target.src);
}
