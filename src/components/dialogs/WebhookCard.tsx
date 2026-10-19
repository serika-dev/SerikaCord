"use client";

import { useRef, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Camera, Pencil, Radio, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/Loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cdnImage } from "@/lib/utils";

export interface ChannelWebhookRow {
  id: string;
  name: string;
  avatar?: string | null;
  url?: string;
  channel_id?: string;
}

const AVATAR_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/**
 * One webhook in channel settings → Integrations (CORD-67): its avatar and
 * name, with an inline editor to rename it, upload or remove its avatar, and
 * move it to another channel. `urlField` is the masked, copyable URL.
 */
export function WebhookCard({
  webhook,
  channelId,
  channelOptions,
  urlField,
  onDelete,
  onChanged,
}: {
  webhook: ChannelWebhookRow;
  channelId: string;
  /** Channels this webhook may move to (text, announcement, forum). */
  channelOptions: Array<{ id: string; name: string }>;
  urlField: ReactNode;
  onDelete: () => void;
  /** Refresh the list (after an edit, or after it moved away). */
  onChanged: () => void;
}) {
  const gt = useGT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(webhook.name);
  const [targetChannel, setTargetChannel] = useState(channelId);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const base = `/api/channels/${channelId}/webhooks/${webhook.id}`;

  const startEditing = () => {
    setName(webhook.name);
    setTargetChannel(channelId);
    setEditing(true);
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || gt("Failed to update webhook"));
    }
  };

  const save = async () => {
    const body: Record<string, unknown> = {};
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed !== webhook.name) body.name = trimmed;
    if (targetChannel !== channelId) body.channelId = targetChannel;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await patch(body);
      toast.success(body.channelId ? gt("Webhook moved") : gt("Webhook updated"));
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to update webhook"));
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${base}/avatar`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || gt("Failed to upload avatar"));
      }
      toast.success(gt("Webhook avatar updated"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to upload avatar"));
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      await patch({ avatar: null });
      toast.success(gt("Webhook avatar removed"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to update webhook"));
    } finally {
      setUploading(false);
    }
  };

  const avatar = (
    <div className="relative w-10 h-10 shrink-0">
      <div className="w-10 h-10 rounded-full bg-[var(--bg-sidebar)] flex items-center justify-center border border-[var(--border-subtle)] overflow-hidden">
        {webhook.avatar ? (
          <img src={cdnImage(webhook.avatar)} alt={webhook.name} className="w-full h-full object-cover" />
        ) : (
          <Radio className="w-5 h-5 text-[var(--text-secondary)]" />
        )}
      </div>
    </div>
  );

  return (
    <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] hover:bg-[var(--bg-sidebar-elevated)] transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {avatar}
          <span className="font-semibold text-sm text-[var(--text-primary)] block truncate">{webhook.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => (editing ? setEditing(false) : startEditing())}
            className="p-2 max-md:p-3 rounded hover:bg-[var(--bg-sidebar)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={editing ? gt("Close") : gt("Edit Webhook")}
            aria-label={editing ? gt("Close") : gt("Edit Webhook")}
          >
            {editing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-2 max-md:p-3 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400 transition-colors"
            title={gt("Delete Webhook")}
            aria-label={gt("Delete Webhook")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {urlField}

      {editing && (
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] space-y-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="group relative w-16 h-16 rounded-full shrink-0 overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-center"
              aria-label={gt("Upload avatar")}
              title={gt("Upload avatar")}
            >
              {webhook.avatar ? (
                <img src={cdnImage(webhook.avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <Radio className="w-7 h-7 text-[var(--text-secondary)]" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                {uploading ? <Loader size={18} className="size-5" /> : <Camera className="w-5 h-5" />}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_TYPES}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadAvatar(file);
              }}
            />
            <div className="flex flex-col gap-1.5 text-xs text-[var(--text-muted)]">
              <span>{gt("JPEG, PNG, GIF or WebP. Shown next to every message this webhook sends.")}</span>
              {webhook.avatar && (
                <button
                  type="button"
                  onClick={() => void removeAvatar()}
                  disabled={uploading}
                  className="self-start text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                >
                  {gt("Remove avatar")}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Name")}</Label>
            <Input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
              className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] h-9 text-sm"
            />
          </div>

          {channelOptions.length > 1 && (
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Channel")}</Label>
              <Select value={targetChannel} onValueChange={setTargetChannel}>
                <SelectTrigger className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)]">
                  {channelOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-[var(--text-secondary)]">
                      #{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)} className="text-sm px-3 h-9">
              {gt("Cancel")}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="bg-[var(--app-accent)] hover:opacity-90 text-[var(--text-on-accent)] text-sm px-4 h-9"
            >
              {saving ? <Loader size={16} className="size-4" /> : gt("Save Changes")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
