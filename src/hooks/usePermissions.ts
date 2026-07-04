"use client";

import { useCallback, useEffect, useState } from "react";
import { PERMISSIONS, bitfieldHas, type PermissionKey } from "@/lib/roles/permissions";

interface PermissionsState {
  isOwner: boolean;
  bitfield: bigint;
  loading: boolean;
}

/**
 * Loads the current user's effective permissions for a server so the UI can
 * hide controls they can't use. Returns `can(key)` plus `isOwner`/`isAdmin`.
 *
 * This is UX only — the server independently authorizes every mutation, so a
 * user who forges a request still can't perform an action they lack.
 */
export function usePermissions(serverId: string | null | undefined) {
  const [state, setState] = useState<PermissionsState>({
    isOwner: false,
    bitfield: 0n,
    loading: true,
  });

  useEffect(() => {
    if (!serverId) {
      setState({ isOwner: false, bitfield: 0n, loading: false });
      return;
    }
    let active = true;
    setState((prev) => ({ ...prev, loading: true }));
    fetch(`/api/servers/${serverId}/members/@me/permissions`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (data && typeof data.permissions === "string") {
          setState({
            isOwner: Boolean(data.isOwner),
            bitfield: BigInt(data.permissions || "0"),
            loading: false,
          });
        } else {
          setState({ isOwner: false, bitfield: 0n, loading: false });
        }
      })
      .catch(() => active && setState({ isOwner: false, bitfield: 0n, loading: false }));
    return () => {
      active = false;
    };
  }, [serverId]);

  const can = useCallback(
    (key: PermissionKey) => state.isOwner || bitfieldHas(state.bitfield, PERMISSIONS[key]),
    [state.isOwner, state.bitfield]
  );

  return {
    can,
    isOwner: state.isOwner,
    isAdmin: state.isOwner || bitfieldHas(state.bitfield, PERMISSIONS.ADMINISTRATOR),
    loading: state.loading,
  };
}
