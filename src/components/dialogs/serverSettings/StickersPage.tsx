"use client";

import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Pencil, Plus, Sticker, Trash2 } from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSearchInput } from "@/components/settings/blocks/SettingsSearchInput";
import { SettingsToolbar } from "@/components/settings/blocks/SettingsToolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { cdnImage } from "@/lib/utils";
import { RenameField } from "./EmojiPage";
import { UploadRequirements } from "./UploadRequirements";
import type { ServerSticker } from "./types";

const STICKER_LIMIT = 500;

const StickerTile = memo(function StickerTile({
  sticker,
  editing,
  onEdit,
  onStopEdit,
  onRename,
  onDelete,
}: {
  sticker: ServerSticker;
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
      className="group/sticker relative flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2 transition-colors duration-(--motion-fast) hover:border-[var(--border-strong)]"
      title={sticker.name}
    >
      <div className="flex aspect-square items-center justify-center rounded-md bg-[var(--bg-hover)]/40 p-2">
        <img src={cdnImage(sticker.imageUrl)} alt={sticker.name} className="h-full w-full object-contain" loading="lazy" />
      </div>
      {editing ? (
        <RenameField
          initial={sticker.name}
          maxLength={30}
          onSubmit={(name) => onRename(sticker.id, name)}
          onCancel={onStopEdit}
          className="mt-2 flex min-w-0 items-center gap-1"
        />
      ) : (
        <p className="mt-2 truncate px-0.5 text-center text-[13px] font-medium text-[var(--text-primary)]">{sticker.name}</p>
      )}
      {!editing && (
        <div className="absolute right-1.5 top-1.5 flex gap-1 transition-opacity duration-(--motion-fast) [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/sticker:opacity-100 [@media(hover:hover)]:group-focus-within/sticker:opacity-100">
          <button
            type="button"
            onClick={() => onEdit(sticker.id)}
            aria-label={gt("Rename sticker {name}", { name: sticker.name })}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-sm hover:text-[var(--text-primary)]"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(sticker.id)}
            aria-label={gt("Delete sticker {name}", { name: sticker.name })}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-sm hover:border-red-500/50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
});

/** Server Settings → Stickers: requirements card and a grid of sticker tiles. */
export const StickersPage = memo(function StickersPage({
  stickers,
  loading,
  uploading,
  onUpload,
  onRename,
  onDelete,
}: {
  stickers: ServerSticker[];
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
  const stopEdit = useCallback(() => setEditingId(null), []);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? stickers.filter((s) => s.name.toLowerCase().includes(needle)) : stickers;
  }, [stickers, search]);

  const uploadButton = (
    <SettingsButton variant="primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
      {uploading ? <Loader size={16} /> : <Plus />}
      {uploading ? gt("Uploading...") : gt("Upload Sticker")}
    </SettingsButton>
  );

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={gt("Server Stickers")}
        description={gt("Upload custom stickers for your server")}
        className="mb-0"
      />
      <input
        type="file"
        ref={inputRef}
        onChange={onUpload}
        accept="image/png,image/apng,image/gif,image/webp"
        className="hidden"
      />

      <UploadRequirements
        title={gt("Upload requirements")}
        items={[gt("File type: PNG, APNG, GIF, WEBP"), gt("Max file size: 512 KB"), gt("Recommended dimensions: 320x320")]}
        action={uploadButton}
      />

      <SettingsSection
        title={gt("Stickers")}
        action={<span className="text-xs text-[var(--text-muted)]">{gt("{count} slots available", { count: Math.max(0, STICKER_LIMIT - stickers.length) })}</span>}
      >
        {stickers.length > 0 && (
          <SettingsToolbar>
            <SettingsSearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={gt("Search stickers by name...")}
              clearLabel={gt("Clear search")}
              className="w-full sm:w-72"
            />
          </SettingsToolbar>
        )}
        {loading && stickers.length === 0 ? (
          <div aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
            ))}
          </div>
        ) : stickers.length === 0 ? (
          <SettingsEmptyState
            icon={Sticker}
            title={gt("No stickers yet")}
            description={gt("Upload stickers to use in messages")}
            action={uploadButton}
          />
        ) : visible.length === 0 ? (
          <SettingsEmptyState compact icon={Sticker} title={gt("No stickers matching \"{query}\"", { query: search })} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visible.map((sticker) => (
              <StickerTile
                key={sticker.id}
                sticker={sticker}
                editing={editingId === sticker.id}
                onEdit={setEditingId}
                onStopEdit={stopEdit}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
});
