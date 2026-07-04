"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { useIsMobile } from "@/hooks/useIsMobile";

export function ToasterWrapper() {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || isMobile) return null;
  return (
    <Toaster
      theme="system"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--bg-card)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        },
      }}
    />
  );
}
