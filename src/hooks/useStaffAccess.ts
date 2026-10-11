"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { StaffPermission } from "@/lib/staff/permissions";

export interface StaffAccess {
  permissions: StaffPermission[];
  isSuperAdmin: boolean;
  roles: { id: string; name: string }[];
}

const EMPTY_ACCESS: StaffAccess = { permissions: [], isSuperAdmin: false, roles: [] };

/** UI hints only: every staff API action independently checks fresh access. */
export function useStaffAccess(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id;
  const [result, setResult] = useState<{ userId: string; access: StaffAccess } | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/admin/access", { signal: controller.signal, cache: "no-store" });
        const access: StaffAccess = response.ok ? await response.json() : EMPTY_ACCESS;
        if (!controller.signal.aborted) setResult({ userId, access });
      } catch {
        if (!controller.signal.aborted) setResult({ userId, access: EMPTY_ACCESS });
      } finally {
        pending = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("serika:staff-access-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("serika:staff-access-changed", refresh);
    };
  }, [enabled, userId]);

  const access = result && result.userId === userId ? result.access : EMPTY_ACCESS;
  const can = useCallback((permission: StaffPermission) => access.permissions.includes(permission), [access]);
  return { ...access, can };
}
