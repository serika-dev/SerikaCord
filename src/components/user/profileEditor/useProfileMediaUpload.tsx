"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useImageCropper } from "@/components/ui/useImageCropper";
import { useSelectImage } from "@/components/ui/useSelectImage";
import { applyRecentMedia } from "@/lib/profiles/recentMediaClient";

export type ProfileMediaKind = "avatar" | "banner";

interface PickTarget {
  kind: ProfileMediaKind;
  /**
   * Per-server profile; omitted for the main profile. Server images are only
   * uploaded (not applied): `onDone` puts them in the editor's draft and the
   * draft's Save applies them.
   */
  serverId?: string;
  /** Called with the uploaded URL. */
  onDone?: (url: string) => void;
}

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_GIF_BANNER = 50 * 1024 * 1024;

function endpointFor({ kind, serverId }: PickTarget): string {
  if (serverId) return `/api/servers/${serverId}/members/@me/profile-media/${kind}`;
  return kind === "avatar" ? "/api/upload/avatar" : "/api/upload/banner";
}

/**
 * Avatar / banner change for every profile surface (User Settings, the
 * profile editor, the full profile, mobile settings, server profiles):
 * the "Select an Image" dialog (useSelectImage) offers Upload Image, Choose
 * GIF and the recent avatars / banners (+ the linked Discord image). A file
 * (upload, GIF, Discord) is cropped when it isn't the right shape (animated
 * images can skip the crop to keep their animation) and uploaded to the
 * endpoint that also stores it (server profiles: upload only, see
 * PickTarget). A recent image is reused without uploading: the main profile
 * applies it at once, server profiles put it in the draft. The main profile
 * shows the new image at once and rolls back if the change fails.
 * Render `element` once; call `pick` from any button.
 */
export function useProfileMediaUpload(): {
  pick: (target: PickTarget) => void;
  uploading: Record<ProfileMediaKind, boolean>;
  element: ReactNode;
} {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const cropper = useImageCropper();
  const selectImage = useSelectImage();
  const [uploading, setUploading] = useState<Record<ProfileMediaKind, boolean>>({ avatar: false, banner: false });

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
      // Server images wait for the editor's Save; only the main profile is updated now.
      if (main) toast.success(gt("{type} updated!", { type: label }));
    } catch {
      if (main) updateUser(kind === "avatar" ? { avatar: previous } : { banner: previous });
      toast.error(gt("Failed to upload {type}", { type: label }));
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploading((u) => ({ ...u, [kind]: false }));
    }
  }, [user?.avatar, user?.banner, updateUser, gt]);

  // A recent image: main profile → applied now; server profile → the draft.
  const applyRecent = useCallback(async (target: PickTarget, url: string) => {
    const { kind, serverId } = target;
    if (serverId) {
      target.onDone?.(url);
      return;
    }
    const previous = kind === "avatar" ? user?.avatar : user?.banner;
    updateUser(kind === "avatar" ? { avatar: url } : { banner: url });
    setUploading((u) => ({ ...u, [kind]: true }));
    const label = kind === "avatar" ? gt("Avatar") : gt("Banner");
    const result = await applyRecentMedia(kind, url);
    setUploading((u) => ({ ...u, [kind]: false }));
    if ("url" in result) {
      updateUser(kind === "avatar" ? { avatar: result.url } : { banner: result.url });
      target.onDone?.(result.url);
      toast.success(gt("{type} updated!", { type: label }));
    } else {
      updateUser(kind === "avatar" ? { avatar: previous } : { banner: previous });
      toast.error(result.error || gt("Could not use that image"));
    }
  }, [user?.avatar, user?.banner, updateUser, gt]);

  const onFile = async (file: File | undefined, target: PickTarget) => {
    if (!file) return;
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

  const pick = (target: PickTarget) => {
    selectImage.open({
      recents: target.kind,
      onFile: (file) => void onFile(file, target),
      onRecent: (url) => void applyRecent(target, url),
    });
  };

  const element = (
    <>
      {selectImage.element}
      {cropper.element}
    </>
  );

  return { pick, uploading, element };
}
