"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { Loader2 } from "lucide-react";
import { E2EE_LINK_INPUT_KEY } from "@/lib/e2ee/client/state";

/**
 * Where a device-linking QR code points (`/e2ee/link#<code>.<key>`), so a
 * phone's own camera app opens SerikaCord: the code stays on this device
 * (the fragment never reaches a server), and the app opens the "Link a new
 * device" dialog with it (E2eeHost), after sign-in if needed.
 */
export default function E2eeLinkPage() {
  const gt = useGT();
  const router = useRouter();

  useEffect(() => {
    try {
      if (location.hash.length > 1) sessionStorage.setItem(E2EE_LINK_INPUT_KEY, location.href);
    } catch {
      /* storage blocked: the user can type the code instead */
    }
    router.replace("/channels/me");
  }, [router]);

  return (
    <div className="min-h-dvh flex items-center justify-center gap-2 bg-[var(--app-bg)] text-[var(--app-muted)] text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      {gt("Opening SerikaCord…")}
    </div>
  );
}
