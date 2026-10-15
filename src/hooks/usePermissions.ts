"use client";

import { sharedGet } from "@/lib/bootFetch";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { PERMISSIONS, bitfieldHas, type PermissionKey } from "@/lib/roles/permissions";
import { PermissionsStore, type PermissionsSnapshot } from "@/lib/roles/permissionsStore";

/** The server's verification-level gate for the current member (Discord). */
export interface VerificationState {
  level: string;
  blocked: boolean;
  reason: "email" | "account_age" | "member_age" | "connection" | null;
  /** When a time-based restriction lifts on its own (ISO). */
  until: string | null;
  /** What stays locked while blocked (older servers: missing, meaning everything). */
  restrict?: VerificationAction[];
  /** The server's waits, in minutes. */
  accountAgeMinutes?: number;
  memberAgeMinutes?: number;
}

export type VerificationAction = "send" | "attach" | "links" | "react" | "voice" | "threads";

/**
 * One snapshot per server shared by every mounted consumer (sidebar, chat,
 * voice menus...). Each of them used to fetch on its own and start from
 * "no permissions, loading" on every mount, so every channel switch re-asked
 * the server and briefly hid owner/moderator controls. Now a revisit paints
 * the last answer at once and refetches only once it is a few seconds old.
 */
const store = new PermissionsStore<VerificationState>();

const NO_SERVER: PermissionsSnapshot<VerificationState> = { isOwner: false, bitfield: 0n, verification: null };

async function loadPermissions(serverId: string): Promise<void> {
  try {
    const res = await sharedGet(`/api/servers/${serverId}/members/@me/permissions`);
    const data = res.ok ? await res.json() : null;
    if (data && typeof data.permissions === "string") {
      store.set(serverId, {
        isOwner: Boolean(data.isOwner),
        bitfield: BigInt(data.permissions || "0"),
        verification: data.verification && typeof data.verification === "object" ? (data.verification as VerificationState) : null,
      });
    } else {
      store.set(serverId, NO_SERVER);
    }
  } catch {
    store.set(serverId, NO_SERVER);
  }
}

/**
 * Loads the current user's effective permissions for a server so the UI can
 * hide controls they can't use. Returns `can(key)` plus `isOwner`/`isAdmin`,
 * and the verification-level state the composer banner uses.
 *
 * This is UX only — the server independently authorizes every mutation, so a
 * user who forges a request still can't perform an action they lack.
 */
export function usePermissions(serverId: string | null | undefined) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => (serverId ? store.get(serverId) : NO_SERVER),
    () => (serverId ? undefined : NO_SERVER),
  );

  useEffect(() => {
    if (!serverId) return;
    const pending = store.claimRefresh(serverId);
    if (pending) void loadPermissions(serverId).finally(pending);
  }, [serverId]);

  const state = snapshot ?? NO_SERVER;
  const loading = snapshot === undefined;
  const can = useCallback(
    (key: PermissionKey) => state.isOwner || bitfieldHas(state.bitfield, PERMISSIONS[key]),
    [state.isOwner, state.bitfield]
  );

  return {
    can,
    isOwner: state.isOwner,
    isAdmin: state.isOwner || bitfieldHas(state.bitfield, PERMISSIONS.ADMINISTRATOR),
    loading,
    verification: state.verification,
  };
}
