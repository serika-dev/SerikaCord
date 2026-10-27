"use client";

import { useState } from "react";
import { Lock, Plus, Tag } from "lucide-react";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { cn } from "@/lib/utils";
import { MAX_FORUM_TAGS, MAX_FORUM_TAG_NAME, forumTagNameError, type ForumTagDraft } from "@/lib/servers/channelSettings";

type Editing = { index: number; name: string; moderated: boolean } | null;

/**
 * Forum tags (Discord): chips that open an editor, a round "+" that creates
 * one. Each tag has a name (20 characters) and an optional "moderators only"
 * flag. Edits go into the settings draft; nothing is saved until Save Changes.
 */
export function ForumTagsEditor({
  tags,
  onChange,
  disabled,
}: {
  tags: ForumTagDraft[];
  onChange: (tags: ForumTagDraft[]) => void;
  disabled?: boolean;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState<Editing>(null);
  const full = tags.length >= MAX_FORUM_TAGS;
  const isNew = editing?.index === -1;
  const error = editing ? forumTagNameError(editing.name, tags, editing.index) : null;

  const errorText =
    error === "duplicate"
      ? gt("A tag with this name already exists.")
      : error === "too_long"
        ? gt("Tag names can be up to 20 characters.")
        : null;

  const save = () => {
    if (!editing || error) return;
    const next = [...tags];
    if (editing.index === -1) {
      next.push({ name: editing.name.trim(), moderated: editing.moderated });
    } else {
      next[editing.index] = { ...next[editing.index], name: editing.name.trim(), moderated: editing.moderated };
    }
    onChange(next);
    setEditing(null);
  };

  const remove = () => {
    if (!editing || editing.index < 0) return;
    onChange(tags.filter((_, i) => i !== editing.index));
    setEditing(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag, i) => (
          <button
            key={tag.id ?? `new-${i}`}
            type="button"
            disabled={disabled}
            onClick={() => setEditing({ index: i, name: tag.name, moderated: tag.moderated })}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-3 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-active)] disabled:pointer-events-none disabled:opacity-60"
          >
            {tag.emojiName && <span aria-hidden>{tag.emojiName}</span>}
            {tag.name}
            {tag.moderated && <Lock className="h-3 w-3 text-[var(--text-muted)]" aria-label={gt("Moderators only")} />}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => setEditing({ index: -1, name: "", moderated: false })}
          title={full ? gt("A forum can have up to 20 tags.") : gt("Create Tag")}
          aria-label={gt("Create Tag")}
          className={cn(
            "inline-flex h-8 items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent)] transition-[filter,opacity] hover:brightness-110 disabled:pointer-events-none disabled:opacity-50",
            tags.length === 0 ? "gap-1.5 px-3.5 text-[13px] font-medium" : "w-8",
          )}
        >
          <Plus className="h-4 w-4" />
          {tags.length === 0 && gt("Create Tag")}
        </button>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent showCloseButton={false} className="max-w-sm gap-0 overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-card)] p-0 text-[var(--text-primary)]">
          {editing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="space-y-4 p-5">
                <div>
                  <DialogTitle className="text-lg font-semibold">{isNew ? gt("Create Tag") : gt("Edit Tag")}</DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-[var(--text-secondary)]">
                    {gt("Help people organise their posts. Tag names can be up to 20 characters.")}
                  </DialogDescription>
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      autoFocus
                      value={editing.name}
                      maxLength={MAX_FORUM_TAG_NAME}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value.slice(0, MAX_FORUM_TAG_NAME) })}
                      placeholder={gt("Tag name")}
                      aria-label={gt("Tag name")}
                      aria-invalid={Boolean(errorText) || undefined}
                      className={cn(
                        "h-10 w-full rounded-md border bg-[var(--bg-input)] pl-9 pr-12 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--app-accent)]/25 max-md:text-base",
                        errorText ? "border-red-500" : "border-[var(--border-subtle)] focus:border-[var(--app-accent)]",
                      )}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-[var(--text-muted)]">
                      {MAX_FORUM_TAG_NAME - editing.name.length}
                    </span>
                  </div>
                  {errorText && <p className="text-xs text-red-500">{errorText}</p>}
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{gt("Only allow moderators to apply this tag")}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{gt("Members with Manage Threads can still use it.")}</span>
                  </span>
                  <ToggleSwitch
                    size="sm"
                    checked={editing.moderated}
                    onCheckedChange={(checked) => setEditing({ ...editing, moderated: checked })}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] px-5 py-3">
                {!isNew && (
                  <SettingsButton variant="danger" onClick={remove}>
                    {gt("Delete")}
                  </SettingsButton>
                )}
                <div className="ml-auto flex gap-2">
                  <SettingsButton variant="ghost" onClick={() => setEditing(null)}>
                    {gt("Cancel")}
                  </SettingsButton>
                  <SettingsButton type="submit" variant="primary" disabled={Boolean(error)}>
                    {gt("Save")}
                  </SettingsButton>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
