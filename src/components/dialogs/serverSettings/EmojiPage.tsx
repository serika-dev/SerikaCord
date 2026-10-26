"use client";

import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Check, Pencil, Plus, Smile, Trash2, X } from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { cdnImage } from "@/lib/utils";
import { UploadRequirements } from "./UploadRequirements";
import type { ServerEmoji } from "./types";

const EMOJI_LIMIT = 500;

/** Inline rename field shared by the emoji table and the sticker grid. */
export function RenameField({
  initial,
  maxLength,
  onSubmit,
  onCancel,
  className,
}: {
  initial: string;
  maxLength: number;
  /** Resolves true when the rename was saved. */
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
  className?: string;
}) {
  const gt = useGT();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    const ok = await onSubmit(value.trim());
    setSaving(false);
    if (ok) onCancel();
  };
  return (
    <div className={className ?? "flex min-w-0 items-center gap-1"}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        autoFocus
        maxLength={maxLength}
        aria-label={gt("Name")}
        placeholder={gt("Name")}
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--app-accent)]/60 bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        aria-label={gt("Save")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--app-accent)] text-white hover:brightness-110 disabled:opacity-60"
      >
        {saving ? <Loader size={14} /> : <Check className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={gt("Cancel")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const EmojiRow = memo(function EmojiRow({
  emoji,
  editing,
  onEdit,
  onStopEdit,
  onRename,
  onDelete,
}: {
  emoji: ServerEmoji;
  editing: boolean;
  onEdit: (id: string) => void;
  onStopEdit: () => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const gt = useGT();
  return (
    <div
      data-settings-row
      className="group/emoji grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 transition-colors duration-(--motion-fast) sm:grid-cols-[48px_minmax(0,1fr)_100px_auto] [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60"
    >
      <span className="flex h-10 w-10 items-center justify-center">
        <img src={cdnImage(emoji.imageUrl)} alt={`:${emoji.name}:`} className="h-8 w-8 object-contain" loading="lazy" />
      </span>
      {editing ? (
        <RenameField initial={emoji.name} maxLength={32} onSubmit={(name) => onRename(emoji.id, name)} onCancel={onStopEdit} />
      ) : (
        <button
          type="button"
          onClick={() => onEdit(emoji.id)}
          className="min-w-0 truncate rounded-md px-2 py-1 -mx-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          title={gt("Rename")}
        >
          :{emoji.name}:
        </button>
      )}
      <span className="hidden sm:block">
        {emoji.animated ? <SettingsStatusPill tone="accent">{gt("Animated")}</SettingsStatusPill> : <span className="text-xs text-[var(--text-muted)]">{gt("Static")}</span>}
      </span>
      <div className="flex items-center gap-0.5 transition-opacity duration-(--motion-fast) [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/emoji:opacity-100 [@media(hover:hover)]:group-focus-within/emoji:opacity-100">
        {!editing && (
          <button
            type="button"
            onClick={() => onEdit(emoji.id)}
            aria-label={gt("Rename emoji {name}", { name: emoji.name })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(emoji.id)}
          aria-label={gt("Delete emoji {name}", { name: emoji.name })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

/** Server Settings → Emoji: requirements card, then a searchable table with inline rename. */
export const EmojiPage = memo(function EmojiPage({
  emojis,
  loading,
  uploading,
  onUpload,
  onRename,
  onDelete,
}: {
  emojis: ServerEmoji[];
  loading: boolean;
  uploading: boolean;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const gt = useGT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? emojis.filter((e) => e.name.toLowerCase().includes(needle)) : emojis;
  }, [emojis, search]);
  const stopEdit = useCallback(() => setEditingId(null), []);

  const uploadButton = (
    <SettingsButton variant="primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
      {uploading ? <Loader size={16} /> : <Plus />}
      {gt("Upload Emoji")}
    </SettingsButton>
  );

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={gt("Server Emoji")}
        description={gt("Add up to {limit} custom emoji that anyone can use in this server.", { limit: EMOJI_LIMIT })}
        className="mb-0"
      />
      <input
        type="file"
        ref={inputRef}
        onChange={onUpload}
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
      />

      <UploadRequirements
        title={gt("Upload requirements")}
        items={[
          gt("File type: JPEG, PNG, GIF, WEBP"),
          gt("Max file size: 256 KB"),
          gt("Recommended dimensions: 128x128"),
          gt("Naming: emoji names must be at least 2 characters long and can only contain letters, numbers and underscores"),
        ]}
        action={uploadButton}
      />

      <SettingsSection
        title={gt("Emoji")}
        action={<span className="text-xs text-[var(--text-muted)]">{gt("{count} slots available", { count: Math.max(0, EMOJI_LIMIT - emojis.length) })}</span>}
      >
        {emojis.length > 0 && (
          <SettingsToolbar>
            <SettingsSearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={gt("Search emoji by name...")}
              clearLabel={gt("Clear search")}
              className="w-full sm:w-72"
            />
          </SettingsToolbar>
        )}
        {loading && emojis.length === 0 ? (
          <SettingsSkeleton variant="list" count={6} />
        ) : emojis.length === 0 ? (
          <SettingsEmptyState
            icon={Smile}
            title={gt("No custom emoji yet")}
            description={gt("Upload emoji to use in your server")}
            action={uploadButton}
          />
        ) : visible.length === 0 ? (
          <SettingsEmptyState compact icon={Smile} title={gt("No emoji matching \"{query}\"", { query: search })} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)]">
            <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] gap-4 border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)] sm:grid-cols-[48px_minmax(0,1fr)_100px_auto]">
              <span>{gt("Image")}</span>
              <span>{gt("Name")}</span>
              <span className="hidden sm:block">{gt("Type")}</span>
              <span className="w-16" aria-hidden />
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {visible.map((emoji) => (
                <EmojiRow
                  key={emoji.id}
                  emoji={emoji}
                  editing={editingId === emoji.id}
                  onEdit={setEditingId}
                  onStopEdit={stopEdit}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
});
