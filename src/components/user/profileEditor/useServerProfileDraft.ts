"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  copyMainIntoOverrides,
  diffOverrides,
  mainValueOf,
  overridesPatch,
  type MainProfileLike,
  type MemberOverrideField,
  type MemberProfileOverrides,
} from "@/lib/profiles/memberProfile";
import { emitMemberProfileChanged } from "@/lib/profiles/memberProfileEvents";

type Updater<T> = T | ((prev: T) => T);

export interface ServerProfileDraft {
  serverId: string | null;
  loading: boolean;
  /** Loading failed (not a member any more, offline...). */
  failed: boolean;
  saved: MemberProfileOverrides;
  draft: MemberProfileOverrides;
  canChangeNickname: boolean;
  /** Fields that differ from what is saved. */
  dirtyFields: MemberOverrideField[];
  dirty: boolean;
  saving: boolean;
  /** Field error from the last save (server validation). */
  fieldError: { field?: MemberOverrideField; message: string } | null;
  /** Set (or with undefined: remove) one override in the draft. */
  setField: <K extends MemberOverrideField>(field: K, value: MemberProfileOverrides[K] | undefined) => void;
  /**
   * A setter for style editors (`Dispatch<SetStateAction>` shaped): the
   * updater gets the value shown now (the override, else the main value), so
   * the first change starts from the main profile.
   */
  updater: <K extends MemberOverrideField>(field: K) => (next: Updater<NonNullable<MemberProfileOverrides[K]>>) => void;
  /** Back to the main profile for one field (in the draft). */
  clearField: (field: MemberOverrideField) => void;
  copyFromMain: () => void;
  /** Remove every override (in the draft; Save applies it). */
  clearAll: () => void;
  discard: () => void;
  save: () => Promise<boolean>;
  /** Load again after a failed load. */
  reload: () => void;
  /** Timed out in this server until then (the server refuses profile changes). */
  timedOutUntil: string | null;
}

const EMPTY: MemberProfileOverrides = {};

/** The main-profile fields of the signed-in user, for fallbacks and "copy from main". */
export function mainProfileOf(user: ReturnType<typeof useAuth>["user"]): MainProfileLike {
  return {
    displayName: user?.displayName ?? null,
    username: user?.username ?? null,
    avatar: user?.avatar ?? null,
    banner: user?.banner ?? null,
    bio: user?.bio ?? null,
    pronouns: user?.pronouns ?? null,
    customization: (user?.customization ?? null) as Record<string, unknown> | null,
  };
}

/**
 * Draft of your server profile in `serverId` (null = idle). Loads the saved
 * overrides, keeps edits local until `save()` (one PATCH with only the
 * changed fields), and tells the rest of the app when it saved.
 */
export function useServerProfileDraft(serverId: string | null, opts: { onSaved?: (serverId: string, saved: MemberProfileOverrides) => void } = {}): ServerProfileDraft {
  const gt = useGT();
  const { user } = useAuth();
  const { onSaved } = opts;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<MemberProfileOverrides>(EMPTY);
  const [draft, setDraft] = useState<MemberProfileOverrides>(EMPTY);
  const [canChangeNickname, setCanChangeNickname] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<ServerProfileDraft["fieldError"]>(null);
  const [timedOutUntil, setTimedOutUntil] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A different server: start from scratch (adjusted during render, not in an effect).
  const [prevServerId, setPrevServerId] = useState(serverId);
  if (prevServerId !== serverId) {
    setPrevServerId(serverId);
    setLoadedFor(null);
    setFailed(false);
    setSaved(EMPTY);
    setDraft(EMPTY);
    setFieldError(null);
    setCanChangeNickname(true);
    setTimedOutUntil(null);
  }

  useEffect(() => {
    if (!serverId) return;
    let active = true;
    fetch(`/api/servers/${serverId}/members/@me/profile`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { profile?: MemberProfileOverrides; canChangeNickname?: boolean; timedOutUntil?: string | null }) => {
        if (!active) return;
        const profile = data.profile ?? {};
        setSaved(profile);
        setDraft(profile);
        setCanChangeNickname(data.canChangeNickname !== false);
        setTimedOutUntil(data.timedOutUntil ?? null);
        setLoadedFor(serverId);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoadedFor(serverId);
      });
    return () => {
      active = false;
    };
  }, [serverId, attempt]);

  const reload = useCallback(() => {
    setFailed(false);
    setLoadedFor(null);
    setAttempt((n) => n + 1);
  }, []);

  const main = useMemo(() => mainProfileOf(user), [user]);
  const dirtyFields = useMemo(() => diffOverrides(saved, draft), [saved, draft]);

  const setField = useCallback(<K extends MemberOverrideField>(field: K, value: MemberProfileOverrides[K] | undefined) => {
    setFieldError(null);
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined || value === "") delete next[field];
      else next[field] = value;
      return next;
    });
  }, []);

  const updater = useCallback(<K extends MemberOverrideField>(field: K) => (next: Updater<NonNullable<MemberProfileOverrides[K]>>) => {
    setFieldError(null);
    setDraft((d) => {
      const current = (d[field] ?? mainValueOf(main, field)) as NonNullable<MemberProfileOverrides[K]>;
      const value = typeof next === "function" ? (next as (p: NonNullable<MemberProfileOverrides[K]>) => NonNullable<MemberProfileOverrides[K]>)(current) : next;
      return { ...d, [field]: value };
    });
  }, [main]);

  const clearField = useCallback((field: MemberOverrideField) => setField(field, undefined), [setField]);

  const copyFromMain = useCallback(() => {
    setFieldError(null);
    setDraft((d) => {
      const next = copyMainIntoOverrides(main, d);
      if (!canChangeNickname) {
        if (d.nickname) next.nickname = d.nickname;
        else delete next.nickname;
      }
      return next;
    });
  }, [main, canChangeNickname]);

  const clearAll = useCallback(() => {
    setFieldError(null);
    // Without Change Nickname the nickname stays (the server keeps it anyway).
    setDraft((d) => (!canChangeNickname && d.nickname ? { nickname: d.nickname } : {}));
  }, [canChangeNickname]);

  const discard = useCallback(() => {
    setFieldError(null);
    setDraft(saved);
  }, [saved]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!serverId) return false;
    const body = overridesPatch(saved, draft);
    if (Object.keys(body).length === 0) return true;
    setSaving(true);
    setFieldError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/members/@me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : gt("Failed to save server profile");
        setFieldError({ field: data?.field, message });
        toast.error(message);
        return false;
      }
      const stored = (data?.profile ?? draft) as MemberProfileOverrides;
      setSaved(stored);
      setDraft(stored);
      toast.success(gt("Server profile saved!"));
      if (user?.id) emitMemberProfileChanged(serverId, user.id);
      onSaved?.(serverId, stored);
      return true;
    } catch {
      toast.error(gt("Failed to save server profile"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [serverId, saved, draft, gt, user?.id, onSaved]);

  return {
    serverId,
    loading: Boolean(serverId) && loadedFor !== serverId,
    failed,
    saved,
    draft,
    canChangeNickname,
    dirtyFields,
    dirty: dirtyFields.length > 0,
    saving,
    fieldError,
    setField,
    updater,
    clearField,
    copyFromMain,
    clearAll,
    discard,
    save,
    reload,
    timedOutUntil,
  };
}

/**
 * Which of your servers have a server profile (server id → overridden
 * fields), for the picker's "customised" marks. Loaded once while enabled.
 */
export function useServerProfileIndex(enabled: boolean): {
  profiles: Record<string, string[]>;
  setProfile: (serverId: string, fields: string[]) => void;
} {
  const [profiles, setProfiles] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/servers/@me/profiles")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { profiles?: Record<string, string[]> } | null) => {
        if (active && data?.profiles) setProfiles(data.profiles);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled]);
  const setProfile = useCallback((serverId: string, fields: string[]) => {
    setProfiles((p) => {
      const next = { ...p };
      if (fields.length > 0) next[serverId] = fields;
      else delete next[serverId];
      return next;
    });
  }, []);
  return { profiles, setProfile };
}
