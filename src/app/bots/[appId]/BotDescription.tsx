"use client";

import { useMemo } from "react";
import { ChatGtProvider } from "@/components/chat/ChatGtContext";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { parseDescriptionBlocks } from "@/lib/appDirectory/descriptionBlocks";

const ALIGN_CLASS = { left: "text-left", center: "text-center", right: "text-right" } as const;

/**
 * An app's long description, rendered with the chat markdown renderer: React
 * text nodes only (no raw HTML), links limited to http(s)/mailto
 * (src/lib/chat/markdown.ts isSafeLinkHref). Long-form blocks the chat
 * renderer doesn't know, `---` rules and tables, are split out first
 * (src/lib/appDirectory/descriptionBlocks.ts); table cells are markdown too.
 */
export function BotDescription({ content }: { content: string }) {
  const blocks = useMemo(() => parseDescriptionBlocks(content), [content]);
  return (
    <div className="text-[0.95rem] leading-relaxed text-[var(--hm-body)] [&_a]:break-words">
      <ChatGtProvider>
        {blocks.map((block, i) => {
          if (block.kind === "rule") {
            return <hr key={i} className="my-6 border-0 border-t border-[var(--hm-line)]" />;
          }
          if (block.kind === "table") {
            return (
              <div key={i} className="my-4 overflow-x-auto rounded-xl border border-[var(--hm-line)]">
                <table className="w-full border-collapse text-sm">
                  {block.header && (
                    <thead className="bg-[var(--hm-surface)]">
                      <tr>
                        {block.header.map((cell, c) => (
                          <th
                            key={c}
                            className={`border-b border-[var(--hm-line)] px-3 py-2 font-semibold text-[var(--hm-ink)] ${ALIGN_CLASS[block.align[c] ?? "left"]}`}
                          >
                            <MarkdownRenderer content={cell} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t border-[var(--hm-line)] first:border-t-0">
                        {row.map((cell, c) => (
                          <td key={c} className={`px-3 py-2 align-top ${c === 0 ? "whitespace-nowrap text-[var(--hm-ink)]" : ""} ${ALIGN_CLASS[block.align[c] ?? "left"]}`}>
                            <MarkdownRenderer content={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return <MarkdownRenderer key={i} content={block.text} />;
        })}
      </ChatGtProvider>
    </div>
  );
}
