"use client";

import { Fragment, memo, useMemo, useState } from "react";
import { renderMentionText } from "@/lib/chat/mentionText";
import { protectEmojiTokens, splitEmojiSegments } from "@/lib/chat/emojiSegments";
import { useMentionNames } from "@/hooks/useMentionNames";
import { cdnImage } from "@/lib/utils";
import { twemojiSvgUrl } from "@/lib/twemoji-helpers";
import { useAnimatedMedia } from "@/hooks/useAnimatedMedia";
import type { MentionRoleInfo, MentionUserInfo } from "@/lib/chat/mentionResolver";

interface PreviewEmoji {
  id?: string;
  _id?: string;
  url?: string;
  imageUrl?: string;
}

interface MentionTextProps {
  /** Decoded plain text with mention markup (`<@id>`, `<@&id>`, `<#id>`). */
  text: string;
  users?: ReadonlyArray<MentionUserInfo>;
  roles?: ReadonlyArray<MentionRoleInfo>;
  /** Applied after names are filled in (strip markdown, truncate). Keep it stable. */
  format?: (text: string) => string;
  /** Custom emoji the text may use (shown as images; unknown ones as `:name:`). */
  emojis?: ReadonlyArray<PreviewEmoji>;
}

// One-line previews: emoji sit in the text line at the text's size.
const EMOJI_CLASS = "inline-block h-[1.2em] w-[1.2em] align-[-0.2em] mx-[0.05em] object-contain";

function UnicodeEmoji({ char }: { char: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{char}</>;
  return <img src={twemojiSvgUrl(char)} alt={char} draggable={false} className={EMOJI_CLASS} onError={() => setFailed(true)} />;
}

/**
 * Plain-text preview with mentions shown as names, through the shared
 * resolver (server members incl. bots, the given users, then a cached
 * lookup), and emoji as small images. For one-line previews: thread rows,
 * pins, the reply bar.
 */
export const MentionText = memo(function MentionText({ text, users, roles, format, emojis }: MentionTextProps) {
  const names = useMentionNames(text, { users, roles });
  const animate = useAnimatedMedia();
  const segments = useMemo(() => {
    const protectedText = protectEmojiTokens(renderMentionText(text, names, { keepEmoji: true }));
    const formatted = format ? format(protectedText.text) : protectedText.text;
    return splitEmojiSegments(formatted, protectedText.tokens);
  }, [text, names, format]);
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of emojis ?? []) {
      const id = e.id || e._id;
      const url = e.url || e.imageUrl;
      if (id && url && !map.has(id)) map.set(id, url);
    }
    return map;
  }, [emojis]);

  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "text") return <Fragment key={i}>{s.text}</Fragment>;
        if (s.kind === "unicode") return <UnicodeEmoji key={i} char={s.char} />;
        const url = urls.get(s.id);
        if (!url) return <Fragment key={i}>{`:${s.name}:`}</Fragment>;
        return (
          <img
            key={i}
            src={cdnImage(url, { still: s.animated && !animate })}
            alt={`:${s.name}:`}
            title={`:${s.name}:`}
            draggable={false}
            className={EMOJI_CLASS}
            // Copying the preview keeps the emoji (lib/chat/emojiClipboard).
            data-emoji-id={s.id}
            data-emoji-name={s.name}
            data-emoji-url={url}
            data-emoji-animated={s.animated ? "true" : undefined}
          />
        );
      })}
    </>
  );
});
