"use client";

import type { ReactNode } from "react";
import { ServerProvider } from "@/contexts/ServerContext";
import { UnreadProvider } from "@/contexts/UnreadContext";

export default function AppShellProviders({ children }: { children: ReactNode }) {
  return (
    <ServerProvider>
      <UnreadProvider>{children}</UnreadProvider>
    </ServerProvider>
  );
}
