"use client";

import { useEffect, useRef } from "react";
import { useGT } from "gt-next";
import { RichComposer, type RichComposerHandle } from "@/components/chat/RichComposer";

interface EditEmoji {
  id?: string;
  _id?: string;
  url?: string;
  imageUrl?: string;
}

interface MessageEditFormProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCancel: () => void;
  onSave: () => void;
  /** Custom emoji the message may use (its own first): shown as images while editing. */
  emojis?: readonly EditEmoji[];
}

/**
 * Inline message edit box with escape/enter hints. The same rich composer as
 * the message bar, so custom emoji show as images (not `<:name:id>` markup)
 * and are saved back as exactly the token they were.
 */
export function MessageEditForm({ value, onChange, onKeyDown, onCancel, onSave, emojis }: MessageEditFormProps) {
  const gt = useGT();
  const composerRef = useRef<RichComposerHandle>(null);
  // Fill the box once, when it opens (it is uncontrolled afterwards).
  const initialRef = useRef({ value, emojis });
  useEffect(() => {
    const { value: text, emojis: list } = initialRef.current;
    const urls = new Map<string, string>();
    for (const e of list ?? []) {
      const id = e.id || e._id;
      const url = e.url || e.imageUrl;
      if (id && url && !urls.has(id)) urls.set(id, url);
    }
    composerRef.current?.setContent(text, (id) => urls.get(id));
  }, []);

  return (
    <div className="mt-1" data-message-edit-form="true">
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-sidebar-elevated)] text-sm focus-within:ring-1 focus-within:ring-[var(--app-accent)]">
        <RichComposer
          ref={composerRef}
          compact
          aria-label={gt("Edit message")}
          onChange={(text) => onChange(text)}
          onKeyDown={onKeyDown}
          className="text-base sm:text-sm max-h-[50dvh]"
        />
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-1">
        {gt("escape to")}{" "}
        <button onClick={onCancel} className="text-[var(--app-accent)] hover:underline">
          {gt("cancel")}
        </button>
        {" • "}{gt("enter to")}{" "}
        <button onClick={onSave} className="text-[var(--app-accent)] hover:underline">
          {gt("save")}
        </button>
      </div>
    </div>
  );
}
