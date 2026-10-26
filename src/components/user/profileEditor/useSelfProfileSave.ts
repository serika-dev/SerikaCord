"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { applyProfilePatch } from "@/components/user/profileEditor/selfProfile";

export interface SelfProfilePatch {
  displayName?: string;
  bio?: string;
  pronouns?: string;
  customStatus?: string;
  customization?: Record<string, unknown>;
}

type AuthUser = NonNullable<ReturnType<typeof useAuth>["user"]>;

function snapshot(user: AuthUser): Partial<AuthUser> {
  return {
    displayName: user.displayName,
    bio: user.bio,
    pronouns: user.pronouns,
    customStatus: user.customStatus,
    customization: user.customization,
  };
}

/**
 * Saves your main profile through the same PUT /api/users/me the settings
 * dialog uses. Updates AuthContext first (everything that reads your user
 * re-renders at once), rolls back with a toast if the server refuses.
 * `saveDebounced` is for colour pickers that fire on every drag step.
 */
export function useSelfProfileSave() {
  const gt = useGT();
  const { user, updateUser } = useAuth();
  const debounce = useRef<{ timer: ReturnType<typeof setTimeout> | null; patch: Record<string, unknown>; before: Partial<AuthUser> | null }>({
    timer: null,
    patch: {},
    before: null,
  });

  const send = useCallback(async (patch: SelfProfilePatch, before: Partial<AuthUser>): Promise<boolean> => {
    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) return true;
      const data = await res.json().catch(() => null);
      updateUser(before);
      toast.error(data?.error || gt("Couldn't save your profile"));
      return false;
    } catch {
      updateUser(before);
      toast.error(gt("Couldn't save your profile. Check your connection."));
      return false;
    }
  }, [updateUser, gt]);

  const save = useCallback(async (patch: SelfProfilePatch): Promise<boolean> => {
    if (!user) return false;
    const before = snapshot(user);
    updateUser(applyProfilePatch(user, patch));
    return send(patch, before);
  }, [user, updateUser, send]);

  const saveDebounced = useCallback((customization: Record<string, unknown>) => {
    if (!user) return;
    const pending = debounce.current;
    // Roll back to how things were before the first step of this burst.
    if (!pending.before) pending.before = snapshot(user);
    pending.patch = { ...pending.patch, ...customization };
    updateUser(applyProfilePatch(user, { customization }));
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const body = { customization: pending.patch };
      const before = pending.before ?? {};
      pending.patch = {};
      pending.before = null;
      pending.timer = null;
      void send(body, before);
    }, 400);
  }, [user, updateUser, send]);

  // Flush a pending colour change when the editor goes away.
  useEffect(() => {
    const pending = debounce.current;
    return () => {
      if (!pending.timer) return;
      clearTimeout(pending.timer);
      const body = { customization: pending.patch };
      pending.timer = null;
      pending.patch = {};
      pending.before = null;
      void fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  return { save, saveDebounced };
}
