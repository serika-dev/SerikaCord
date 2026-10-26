"use client";

import { useId, useRef, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { toast } from "sonner";
import { Camera, ChevronDown, Copy, Radio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkWebhookName, WEBHOOK_NAME_MAX } from "@/lib/chat/webhook";
import { cdnImage, cn } from "@/lib/utils";

/** A webhook as the settings routes return it (GET /api/channels/:id/webhooks). */
export interface ChannelWebhookRow {
  id: string;
  name: string;
  avatar?: string | null;
  /** Execute URL (contains the secret token); absent for an app's own webhook. */
  url?: string;
  channel_id: string;
  application_id?: string | null;
  created_at?: string | null;
  user?: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null;
}

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Server default (config.MAX_AVATAR_SIZE); the server has the final say. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * One webhook in settings, Discord style: a row (avatar, name, who made it)
 * that expands into an editor with the avatar on the left (click to upload,
 * remove), name and channel on the right, then Copy Webhook URL and Delete.
 * Avatar changes apply at once with an instant preview; name and channel
 * changes wait for Save in the card's unsaved-changes strip.
 */
export function WebhookCard({
  webhook,
  channelOptions,
  defaultOpen = false,
  onUpdated,
  onDeleted,
}: {
  webhook: ChannelWebhookRow;
  /** Channels this webhook may move to (text, announcement, forum). */
  channelOptions: Array<{ id: string; name: string }>;
  /** Start expanded (a webhook that was just created). */
  defaultOpen?: boolean;
  /** The saved webhook (its channel_id differs when it moved). */
  onUpdated: (row: ChannelWebhookRow) => void;
  onDeleted: (id: string) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const confirmDialog = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const [open, setOpen] = useState(defaultOpen);
  // Drafts are null until edited, so a saved change shows through without syncing state.
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftChannel, setDraftChannel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Optimistic avatar: a local preview while uploading, or null while removing.
  const [pendingAvatar, setPendingAvatar] = useState<string | null | undefined>(undefined);

  const base = `/api/channels/${webhook.channel_id}/webhooks/${webhook.id}`;
  const appOwned = Boolean(webhook.application_id);
  const name = draftName ?? webhook.name;
  const channelId = draftChannel ?? webhook.channel_id;
  const nameCheck = checkWebhookName(name);
  const nameError = nameCheck.ok
    ? null
    : nameCheck.reason === "blocked"
      ? gt("Webhook names can't contain \"{word}\".", { word: nameCheck.word ?? "" })
      : gt("Names must be between 1 and {max} characters.", { max: WEBHOOK_NAME_MAX });
  const dirty = (nameCheck.ok ? nameCheck.name !== webhook.name : draftName !== null) || channelId !== webhook.channel_id;
  // A webhook can sit in a channel it can't move to (e.g. a voice channel's chat): keep it selectable.
  const selectOptions = channelOptions.some((c) => c.id === webhook.channel_id)
    ? channelOptions.map((c) => ({ id: c.id, label: `#${c.name}` }))
    : [{ id: webhook.channel_id, label: gt("Current channel") }, ...channelOptions.map((c) => ({ id: c.id, label: `#${c.name}` }))];
  const shownAvatar = pendingAvatar !== undefined ? pendingAvatar : webhook.avatar ?? null;
  const creatorName = webhook.user ? webhook.user.displayName || webhook.user.username : null;
  const createdOn = webhook.created_at ? new Date(webhook.created_at).toLocaleDateString(locale || undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  const reset = () => {
    setDraftName(null);
    setDraftChannel(null);
  };

  const save = async () => {
    if (!dirty || saving) return;
    if (!nameCheck.ok) {
      toast.error(nameError);
      return;
    }
    const body: Record<string, unknown> = {};
    if (nameCheck.name !== webhook.name) body.name = nameCheck.name;
    if (channelId !== webhook.channel_id) body.channelId = channelId;
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorOf(res, gt("Failed to update webhook")));
      const row = (await res.json()) as ChannelWebhookRow;
      reset();
      onUpdated(row);
      toast.success(body.channelId ? gt("Webhook moved") : gt("Webhook updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to update webhook"));
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!AVATAR_TYPES.includes(file.type)) {
      toast.error(gt("Use a JPG, PNG, GIF or WebP image."));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(gt("That image is too big. The limit is 5 MB."));
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingAvatar(preview);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${base}/avatar`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await errorOf(res, gt("Failed to upload avatar")));
      const data = (await res.json()) as { avatar?: string };
      onUpdated({ ...webhook, avatar: data.avatar ?? null });
      toast.success(gt("Webhook avatar updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to upload avatar"));
    } finally {
      setPendingAvatar(undefined);
      setUploading(false);
      URL.revokeObjectURL(preview);
    }
  };

  const removeAvatar = async () => {
    setPendingAvatar(null);
    setUploading(true);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: null }),
      });
      if (!res.ok) throw new Error(await errorOf(res, gt("Failed to update webhook")));
      onUpdated({ ...webhook, avatar: null });
      toast.success(gt("Webhook avatar removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to update webhook"));
    } finally {
      setPendingAvatar(undefined);
      setUploading(false);
    }
  };

  const copyUrl = async () => {
    if (!webhook.url) return;
    try {
      await navigator.clipboard.writeText(webhook.url);
      toast.success(gt("Webhook URL copied"));
    } catch {
      toast.error(gt("Couldn't copy the webhook URL"));
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({
      title: gt("Delete {name}?", { name: webhook.name }),
      description: gt("Anything posting with its URL will stop working. This can't be undone."),
      confirmLabel: gt("Delete Webhook"),
    }))) return;
    setDeleting(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorOf(res, gt("Failed to delete webhook")));
      onDeleted(webhook.id);
      toast.success(gt("Webhook deleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to delete webhook"));
      setDeleting(false);
    }
  };

  const avatarFace = (size: "sm" | "lg") => (
    shownAvatar ? (
      <img
        src={shownAvatar.startsWith("blob:") ? shownAvatar : cdnImage(shownAvatar)}
        alt=""
        className="w-full h-full object-cover"
      />
    ) : (
      <Radio className={cn("text-[var(--text-secondary)]", size === "sm" ? "w-5 h-5" : "w-8 h-8")} />
    )
  );

  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--bg-app)] transition-colors duration-150",
        open ? "border-[var(--border-subtle)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-sidebar-elevated)]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
      >
        <span className="w-10 h-10 shrink-0 rounded-full bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] overflow-hidden flex items-center justify-center">
          {avatarFace("sm")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-sm text-[var(--text-primary)]">{webhook.name}</span>
          {(createdOn || creatorName) && (
            <span className="block truncate text-xs text-[var(--text-muted)]">
              {createdOn && creatorName
                ? gt("Created on {date} by {name}", { date: createdOn, name: creatorName })
                : createdOn
                  ? gt("Created on {date}", { date: createdOn })
                  : gt("Created by {name}", { name: creatorName ?? "" })}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-3 sm:px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          <div className="pt-4 border-t border-[var(--border-subtle)]">
            {appOwned ? (
              <p className="text-xs text-[var(--text-muted)] mb-4">
                {gt("This webhook belongs to an application. Only the application can change it, but you can delete it.")}
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-5">
                <div className="flex flex-col items-center gap-2 shrink-0 sm:w-28">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="group relative w-20 h-20 rounded-full overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                    aria-label={gt("Upload avatar")}
                    title={gt("Upload avatar")}
                  >
                    {avatarFace("lg")}
                    <span
                      className={cn(
                        "absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 text-white text-[10px] font-semibold uppercase tracking-wide transition-opacity duration-150",
                        uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                      )}
                    >
                      {uploading ? <Loader size={18} className="size-5" /> : (
                        <>
                          <Camera className="w-5 h-5" />
                          {gt("Change")}
                        </>
                      )}
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={AVATAR_TYPES.join(",")}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void uploadAvatar(file);
                    }}
                  />
                  {shownAvatar && (
                    <button
                      type="button"
                      onClick={() => void removeAvatar()}
                      disabled={uploading}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline disabled:opacity-50"
                    >
                      {gt("Remove")}
                    </button>
                  )}
                  <p className="text-[11px] leading-snug text-center text-[var(--text-muted)]">
                    {gt("128×128 or larger. JPG, PNG, GIF or WebP, up to 5 MB.")}
                  </p>
                </div>

                <div className="flex-1 min-w-0 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor={nameId} className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Name")}</Label>
                    <Input
                      id={nameId}
                      value={name}
                      maxLength={WEBHOOK_NAME_MAX}
                      aria-invalid={Boolean(nameError)}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void save();
                        }
                      }}
                      className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] h-9 text-sm"
                    />
                    {nameError && <p className="text-xs text-red-400">{nameError}</p>}
                  </div>

                  {channelOptions.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">{gt("Channel")}</Label>
                      <Select value={channelId} onValueChange={setDraftChannel}>
                        <SelectTrigger className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)]">
                          {selectOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-[var(--text-secondary)]">
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
              {webhook.url ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyUrl()}
                  className="h-9 text-sm px-3"
                >
                  <Copy className="w-4 h-4" />
                  {gt("Copy Webhook URL")}
                </Button>
              ) : <span />}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void remove()}
                disabled={deleting}
                className="h-9 text-sm px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                {deleting ? <Loader size={16} className="size-4" /> : <Trash2 className="w-4 h-4" />}
                {gt("Delete Webhook")}
              </Button>
            </div>

            {dirty && !appOwned && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3 py-2 animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
              >
                <span className="text-sm font-medium text-[var(--text-primary)] min-w-0">{gt("Careful — you have unsaved changes!")}</span>
                <div className="flex gap-2 max-md:w-full max-md:justify-end">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={saving}
                    className="px-3 py-1.5 max-md:py-2.5 text-sm text-[var(--text-primary)] hover:underline disabled:opacity-50"
                  >
                    {gt("Reset")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || Boolean(nameError)}
                    className="px-4 py-1.5 max-md:py-2.5 bg-[#23A559] hover:bg-[#1f9150] disabled:opacity-50 text-white text-sm font-medium rounded transition-colors flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]"
                  >
                    {saving && <Loader size={16} />}
                    {gt("Save Changes")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
