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

const IMAGE_EXTENSIONS = /\.(gif|jpg|jpeg|png|webp|svg|bmp|avif)(\?.*)?$/i;
const IMAGE_HOSTS =
  /^https?:\/\/(gifs\.serika\.dev|cdn\.ado\.wtf|i\.imgur\.com|media\.tenor\.com|media\.giphy\.com|cdn\.discordapp\.com|images-ext-\d+\.discordapp\.net)/i;
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;

export function isImageLikeUrl(url: string): boolean {
  if (!url) return false;
  return IMAGE_EXTENSIONS.test(url) || IMAGE_HOSTS.test(url);
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
