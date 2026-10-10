"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { onUserAction, type UserActionRequest } from "@/lib/social/userActions";

const UserActionDialogs = dynamic(() => import("@/components/user/UserActionDialogs").then((m) => m.UserActionDialogs), { ssr: false });

/**
 * Hosts the dialogs opened from user context menus (profile, note, nickname,
 * kick, ban, timeout). Mounted once with the app shell; the dialog code loads
 * on first use.
 */
export function UserActionsHost() {
  const [request, setRequest] = useState<UserActionRequest | null>(null);
  // A fresh key per request remounts the dialog with that request's state.
  const [seq, setSeq] = useState(0);
  useEffect(() => onUserAction((req) => {
    setRequest(req);
    setSeq((n) => n + 1);
  }), []);
  return (
    <MountWhenOpened open={request !== null}>
      {request && <UserActionDialogs key={seq} request={request} onClose={() => setRequest(null)} />}
    </MountWhenOpened>
  );
}
