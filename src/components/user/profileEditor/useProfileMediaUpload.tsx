"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useImageCropper } from "@/components/ui/useImageCropper";

export type ProfileMediaKind = "avatar" | "banner";

interface PickTarget {
  kind: ProfileMediaKind;
  /** Per-server profile; omitted for the main profile. */
  serverId?: string;
  /** Called with the stored URL (server profile tiles keep their own state). */
  onDone?: (url: string) => void;
}

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_GIF_BANNER = 50 * 1024 * 1024;

function endpointFor({ kind, serverId }: PickTarget): string {
  if (serverId) return kind === "avatar" ? `/api/upload/server/${serverId}/avatar` : `/api/upload/server/${serverId}/member-banner`;
  return kind === "avatar" ? "/api/upload/avatar" : "/api/upload/banner";
}

/**
 * Avatar / banner upload for the profile editor, the same flow as User
 * Settings: pick a file, crop it when it isn't the right shape (animated
 * images can skip the crop to keep their animation), upload to the endpoint
 * that also stores it. The main profile
 * shows the cropped image at once and rolls back if the upload fails.
 * Render `element` once; call `pick` from any button.
 */
export function useProfileMediaUpload(): {
  pick: (target: PickTarget) => void;
  uploading: Record<ProfileMediaKind, boolean>;
  element: ReactNode;
} {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<PickTarget | null>(null);
  const cropper = useImageCropper();
  const [uploading, setUploading] = useState<Record<ProfileMediaKind, boolean>>({ avatar: false, banner: false });

  const pick = useCallback((target: PickTarget) => {
    targetRef.current = target;
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const upload = useCallback(async (target: PickTarget, file: Blob, filename: string) => {
    const { kind, serverId } = target;
    const main = !serverId;
    const previous = kind === "avatar" ? user?.avatar : user?.banner;
    const localUrl = URL.createObjectURL(file);
    if (main) updateUser(kind === "avatar" ? { avatar: localUrl } : { banner: localUrl });
    setUploading((u) => ({ ...u, [kind]: true }));
    const form = new FormData();
    form.append("file", file, filename);
    const label = kind === "avatar" ? gt("Avatar") : gt("Banner");
    try {
      const res = await fetch(endpointFor(target), { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.url !== "string") {
        if (main) updateUser(kind === "avatar" ? { avatar: previous } : { banner: previous });
        toast.error(data?.error || gt("Failed to upload {type}", { type: label }));
        return;
      }
      if (main) updateUser(kind === "avatar" ? { avatar: data.url } : { banner: data.url });
      target.onDone?.(data.url);
      toast.success(gt("{type} updated!", { type: label }));
    } catch {
      if (main) updateUser(kind === "avatar" ? { avatar: previous } : { banner: previous });
      toast.error(gt("Failed to upload {type}", { type: label }));
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploading((u) => ({ ...u, [kind]: false }));
    }
  }, [user?.avatar, user?.banner, updateUser, gt]);

  const onFile = async (file: File | undefined) => {
    const target = targetRef.current;
    if (!file || !target) return;
    if (!file.type.startsWith("image/")) {
      toast.error(gt("Please select an image file"));
      return;
    }
    const ready = await cropper.prepare(file, target.kind === "banner" ? "profileBanner" : "avatar");
    if (!ready) return;
    if (target.kind === "banner" && ready.type === "image/gif") {
      if (ready.size > MAX_GIF_BANNER) {
        toast.error(gt("GIF must be less than 50MB"));
        return;
      }
    } else if (ready.size > MAX_IMAGE) {
      toast.error(gt("Image must be less than 8MB"));
      return;
    }
    void upload(target, ready, ready.name);
  };

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {cropper.element}
    </>
  );

  return { pick, uploading, element };
}
