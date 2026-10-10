"use client";

import { useRef, useState } from "react";
import { ImagePlus, Smile, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { RoleIcon } from "@/components/chat/RoleIcon";
import { isValidUnicodeEmoji } from "@/lib/roles/roleIcon";
import { Loader } from "@/components/ui/Loader";

const MAX_ROLE_ICON_BYTES = 256 * 1024;
const QUICK_EMOJIS = ["⭐", "🛡️", "👑", "🔥", "💎", "🎨", "🎮", "🎵", "🌸", "⚡", "🤖", "❤️"];

/**
 * Discord's "Role Icon" section of the role editor: upload a small image or
 * pick a unicode emoji; the icon then shows next to members' names.
 */
export function RoleIconEditor({
  roleName,
  roleColor,
  icon,
  unicodeEmoji,
  disabled,
  onChange,
}: {
  roleName: string;
  roleColor?: string;
  icon?: string | null;
  unicodeEmoji?: string | null;
  disabled?: boolean;
  onChange: (next: { icon: string | null; unicodeEmoji: string | null }) => void;
}) {
  const gt = useGT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [emojiInput, setEmojiInput] = useState("");

  const upload = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      toast.error(gt("Role icons must be PNG, JPEG, GIF or WebP images"));
      return;
    }
    if (file.size > MAX_ROLE_ICON_BYTES) {
      toast.error(gt("Role icons must be smaller than 256 KB"));
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/emoji", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || gt("Failed to upload role icon"));
      onChange({ icon: data.url as string, unicodeEmoji: null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to upload role icon"));
    } finally {
      setUploading(false);
    }
  };

  const applyEmoji = (value: string) => {
    const v = value.trim();
    if (!isValidUnicodeEmoji(v)) {
      toast.error(gt("Enter a single emoji"));
      return;
    }
    onChange({ icon: null, unicodeEmoji: v });
    setEmojiInput("");
  };

  const hasIcon = Boolean(icon || unicodeEmoji);

  return (
    <div className="space-y-2">
      <label className="block text-xs text-[var(--text-secondary)]">{gt("Role Icon")}</label>
      <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-[var(--app-surface-alt)] flex items-center justify-center shrink-0">
            {hasIcon ? (
              <RoleIcon role={{ name: roleName, icon, unicodeEmoji }} size={32} />
            ) : (
              <ImagePlus className="w-5 h-5 text-[var(--text-muted)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--text-muted)]">
              {gt("Members show the icon of their highest role that has one, next to their name.")}
            </p>
            <p className="mt-1 text-sm font-medium flex items-center gap-1 truncate" style={roleColor ? { color: roleColor } : undefined}>
              <span className="truncate">{roleName}</span>
              {hasIcon && <RoleIcon role={{ name: roleName, icon, unicodeEmoji }} size={16} />}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader size={12} /> : <ImagePlus className="w-3.5 h-3.5" />}
            {gt("Upload Image")}
          </button>
          {hasIcon && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ icon: null, unicodeEmoji: null })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {gt("Remove Icon")}
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Smile className="w-3.5 h-3.5" />
            {gt("Or choose an emoji")}
          </div>
          <div className="flex flex-wrap gap-1">
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ icon: null, unicodeEmoji: e })}
                className={
                  "w-8 h-8 rounded-md text-lg leading-none flex items-center justify-center hover:bg-[var(--bg-hover)] disabled:opacity-50 " +
                  (unicodeEmoji === e ? "ring-2 ring-[var(--app-accent)]" : "")
                }
                aria-label={e}
              >
                {e}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              applyEmoji(emojiInput);
            }}
          >
            <input
              value={emojiInput}
              onChange={(e) => setEmojiInput(e.target.value)}
              disabled={disabled}
              maxLength={16}
              placeholder={gt("Paste any emoji")}
              aria-label={gt("Paste any emoji")}
              className="w-36 px-2 py-1.5 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]"
            />
            <button
              type="submit"
              disabled={disabled || !emojiInput.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-surface-alt)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              {gt("Use")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
