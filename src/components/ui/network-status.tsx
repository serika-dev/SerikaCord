"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Global offline/online feedback. Mounted once in the root layout.
export function NetworkStatus() {
  const offlineToastId = useRef<string | number | null>(null);

  useEffect(() => {
    const handleOffline = () => {
      offlineToastId.current = toast.error("You're offline", {
        description: "Messages can't be sent until your connection returns.",
        duration: Infinity,
      });
    };
    const handleOnline = () => {
      if (offlineToastId.current !== null) {
        toast.dismiss(offlineToastId.current);
        offlineToastId.current = null;
      }
      toast.success("Back online", { duration: 2500 });
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
  }, []);

  return null;
}
