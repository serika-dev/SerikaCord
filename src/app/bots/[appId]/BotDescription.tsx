"use client";

import { ChatGtProvider } from "@/components/chat/ChatGtContext";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";

/**
 * An app's long description, rendered with the chat markdown renderer: React
 * text nodes only (no raw HTML), links limited to http(s)/mailto
 * (src/lib/chat/markdown.ts isSafeLinkHref).
 */
export function BotDescription({ content }: { content: string }) {
  return (
    <div className="text-[0.95rem] leading-relaxed text-[var(--hm-body)] [&_a]:break-words">
      <ChatGtProvider>
        <MarkdownRenderer content={content} />
      </ChatGtProvider>
    </div>
  );
}
