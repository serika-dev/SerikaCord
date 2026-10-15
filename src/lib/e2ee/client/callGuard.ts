"use client";

// Whether a DM / group DM call must be end-to-end verified (signed DTLS
// fingerprints), decided before any peer's SDP is applied — wherever the call
// was joined from (ring overlay, another page, mobile). Crypto-free.
import { e2eeTargetForCallRoom } from "@/lib/e2ee/conversation";
import { conversationMetaOf, isRememberedEncrypted, rememberEncrypted } from "./chatGlue";

const SERVER_FLAG_TIMEOUT_MS = 5000;

/**
 * True when this device has seen the call's conversation encrypted (the
 * server can't undo that) or the server flags it encrypted (first call on a
 * new device). A DM room we can't place, or unreadable local storage, counts
 * as encrypted (fail closed). Server channels' rooms are never encrypted.
 */
export async function isCallRoomEncrypted(roomId: string, selfId: string): Promise<boolean> {
  if (!/^g?dm:/.test(roomId)) return false;
  const target = selfId ? e2eeTargetForCallRoom(roomId, selfId) : null;
  if (!target) return true;
  try {
    if (await isRememberedEncrypted(selfId, target)) return true;
  } catch {
    return true;
  }
  const base = target.kind === "dm" ? `/api/dms/${target.recipientId}` : `/api/group-dms/${target.channelId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_FLAG_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/messages?limit=1`, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (res.ok && conversationMetaOf(await res.json())?.e2ee) {
      void rememberEncrypted(selfId, target).catch(() => {});
      return true;
    }
  } catch {
    /* the local memory decides */
  } finally {
    clearTimeout(timer);
  }
  return false;
}
