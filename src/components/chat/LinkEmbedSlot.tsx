"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { previewUrlOf } from "@/lib/chat/linkUrls";
import { getRenderedEmbedUrls } from "@/components/chat/RichEmbed";
import type { MessageEmbed } from "@/lib/chat/types";

// The preview cards and players (YouTube, Twitch, Spotify, GIF providers,
// oEmbed cards…) are their own chunk: most messages have no link, so opening a
// channel doesn't wait for them, and the first link loads them.
const LinkPreview = dynamic(() => import("@/components/chat/LinkEmbed").then((m) => m.LinkPreview), { ssr: false });

interface LinkEmbedProps {
  content: string;
  /** Opens a GIF in the in-app image viewer instead of the provider website. */
  onMediaClick?: (src: string, alt?: string) => void;
  onSuppress?: () => void;
  /** Rich embeds rendered for this message (e.g. Discord's own unfurls on
   *  bridged messages) — their URLs are skipped so a link isn't previewed twice. */
  embeds?: MessageEmbed[];
}

// Memoized: embeds fetch previews and must not re-run while unrelated chat
// state (composer text, typing indicators) changes.
export const LinkEmbed = memo(function LinkEmbed({ content, onMediaClick, onSuppress, embeds }: LinkEmbedProps) {
  // Decode entities (e.g. `&amp;` in query strings) so URLs resolve correctly.
  const url = previewUrlOf(decodeHtmlEntities(content), getRenderedEmbedUrls(embeds));
  if (!url) return null;
  // Keyed by URL so an edit that changes the link starts from an empty preview.
  return <LinkPreview key={url} url={url} onMediaClick={onMediaClick} onSuppress={onSuppress} />;
});
