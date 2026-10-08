"use client";

import { useState, type ReactNode } from "react";

/**
 * Renders its children only once `open` has been true, then keeps them
 * mounted (so close animations and internal state still work). A closed
 * next/dynamic dialog that is merely rendered still downloads its chunk, so
 * this keeps heavy dialogs out of the startup bundle until first use.
 */
export function MountWhenOpened({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted ? <>{children}</> : null;
}
