"use client";

import { memo } from "react";
import { renderMentionText } from "@/lib/chat/mentionText";
import { useMentionNames } from "@/hooks/useMentionNames";
import type { MentionRoleInfo, MentionUserInfo } from "@/lib/chat/mentionResolver";

interface MentionTextProps {
  /** Decoded plain text with mention markup (`<@id>`, `<@&id>`, `<#id>`). */
  text: string;
  users?: ReadonlyArray<MentionUserInfo>;
  roles?: ReadonlyArray<MentionRoleInfo>;
  /** Applied after names are filled in (strip markdown, truncate). Keep it stable. */
  format?: (text: string) => string;
}

/**
 * Plain-text preview with mentions shown as names, through the shared
 * resolver (server members incl. bots, the given users, then a cached
 * lookup). For one-line previews: thread rows, pins, the reply bar.
 */
export const MentionText = memo(function MentionText({ text, users, roles, format }: MentionTextProps) {
  const names = useMentionNames(text, { users, roles });
  const out = renderMentionText(text, names);
  return <>{format ? format(out) : out}</>;
});
