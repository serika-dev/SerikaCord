"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGT } from "gt-next";

// Global offline/online feedback. Mounted once in the root layout.
export function NetworkStatus() {
  const offlineToastId = useRef<string | number | null>(null);
  const gt = useGT();

  useEffect(() => {
    const handleOffline = () => {
      offlineToastId.current = toast.error(gt("You're offline"), {
        description: gt("Messages can't be sent until your connection returns."),
        duration: Infinity,
      });
    };
    const handleOnline = () => {
      if (offlineToastId.current !== null) {
        toast.dismiss(offlineToastId.current);
        offlineToastId.current = null;
      }
      toast.success(gt("Back online"), { duration: 2500 });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      handleOffline();
    }
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [gt]);

  return null;
}
