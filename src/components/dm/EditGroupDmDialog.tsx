"use client";

import { useRef, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { GROUP_DM_NAME_MAX } from "@/lib/chat/groupDm";
import { GroupDmIcon, type GroupIconMember } from "./GroupDmIcon";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Discord's "Edit Group": the group's name and icon (any member may change them). */
export function EditGroupDmDialog({
  open,
  onOpenChange,
  channelId,
  name,
  icon,
  members,
  placeholderName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  name: string | null;
  icon: string | null;
  members: GroupIconMember[];
  /** What the group is called without a name of its own (its members). */
  placeholderName: string;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<{ open: boolean; value: string }>({ open, value: name ?? "" });
  // Reset the draft whenever the dialog is (re)opened — during render, not in an effect.
  if (draft.open !== open) setDraft({ open, value: name ?? "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (saving) return;
    const next = draft.value.trim();
    if (next === (name ?? "")) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/group-dms/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Couldn't rename the group"));
        return;
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const uploadIcon = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error(gt("Only JPEG, PNG, GIF and WebP images can be used."));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/group-dms/${channelId}/icon`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) toast.error(data?.error || gt("Couldn't change the group icon"));
    } finally {
      setUploading(false);
    }
  };

  const removeIcon = async () => {
    setUploading(true);
    try {
      const res = await fetch(`/api/group-dms/${channelId}/icon`, { method: "DELETE" });
      if (!res.ok) toast.error(gt("Couldn't remove the group icon"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{gt("Edit Group")}</DialogTitle>
          <DialogDescription className="text-[var(--text-muted)]">
            {gt("Everyone in the group can see these changes.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
            aria-label={gt("Change group icon")}
            title={gt("Change group icon")}
          >
            <GroupDmIcon icon={icon} members={members} size={72} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
              {uploading ? <Loader size={20} /> : <Camera className="h-6 w-6" />}
            </span>
          </button>
          <div className="flex flex-col gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-md bg-[var(--app-accent)] px-3 py-1.5 font-medium text-[var(--text-on-accent)] hover:opacity-90 disabled:opacity-50"
            >
              {gt("Upload Icon")}
            </button>
            {icon && (
              <button
                type="button"
                onClick={() => void removeIcon()}
                disabled={uploading}
                className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {gt("Remove Icon")}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadIcon(file);
            }}
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Group Name")}</span>
          <input
            value={draft.value}
            maxLength={GROUP_DM_NAME_MAX}
            onChange={(e) => setDraft({ open, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={placeholderName}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--app-accent)]"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-4 py-2 text-sm text-[var(--text-primary)] hover:underline"
          >
            {gt("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-[var(--text-on-accent)] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader size={16} /> : gt("Save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EditGroupDmDialog;
