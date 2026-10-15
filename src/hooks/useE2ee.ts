"use client";

import { useSyncExternalStore } from "react";
import {
  getE2eeSnapshot,
  getServerE2eeSnapshot,
  subscribeE2ee,
  type E2eeSnapshot,
} from "@/lib/e2ee/client/state";

/** Live end-to-end encryption state of this device (no crypto loaded). */
export function useE2ee(): E2eeSnapshot {
  return useSyncExternalStore(subscribeE2ee, getE2eeSnapshot, getServerE2eeSnapshot);
}
