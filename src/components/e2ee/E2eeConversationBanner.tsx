"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { AlertTriangle, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { loadE2eeSession, openE2eeDialog } from "@/lib/e2ee/client/state";
import type { ConversationMeta } from "@/lib/e2ee/client/chatGlue";
import type { E2eeTarget } from "@/lib/e2ee/conversation";
import { useE2ee } from "@/hooks/useE2ee";

const SafetyNumberDialog = dynamic(() => import("./SafetyNumberDialog").then((m) => m.SafetyNumberDialog), { ssr: false });

interface MemberIssue {
  userId: string;
  kind: "changed" | "missing";
}

interface E2eeConversationBannerProps {
  /** From useChatSession: channel id + encryption state (null until loaded). */
  conversation: ConversationMeta | null;
  /** Sends are encrypted here (server flag or remembered on this device). */
  active: boolean;
  /** The other people in the conversation (names for the notices). */
  members: Array<{ id: string; name: string }>;
  /** Bots / system accounts: encryption is never offered. */
  unsupported?: boolean;
  /** What the page opened (URL): the key list is checked against it. */
  target?: E2eeTarget | null;
  /** Group DMs: ids of the members the group shows (null while loading). */
  memberIds?: string[] | null;
}

/**
 * The encryption strip above a DM / group DM composer: "Messages are end-to-
 * end encrypted" (with safety numbers), and the things that need the user —
 * a contact's security code changed (acknowledge / verify), someone without
 * keys, this device not set up, or the "Turn on encryption" button.
 */
export function E2eeConversationBanner({ conversation, active, members, unsupported = false, target = null, memberIds = null }: E2eeConversationBannerProps) {
  const gt = useGT();
  const e2ee = useE2ee();
  const channelId = conversation?.channelId ?? null;
  const [issues, setIssues] = useState<{ channelId: string; list: MemberIssue[]; everyoneHasKeys: boolean; mismatch: boolean } | null>(null);
  const [safetyUser, setSafetyUser] = useState<{ id: string; name: string } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const autoTriedRef = useRef<string | null>(null);
  const nameOf = (id: string) => members.find((m) => m.id.toLowerCase() === id.toLowerCase())?.name || gt("Someone");

  // Member key state (refreshed when trust pins change).
  useEffect(() => {
    if (!channelId || e2ee.phase !== "ready" || unsupported) return;
    let cancelled = false;
    void loadE2eeSession()
      .then(async (session) => {
        const keys = await session.getChannelKeys(channelId, true);
        // The key list must match what the user opened: exactly us + the
        // URL's person in a 1:1 DM; a group's must match the members shown.
        const check = target ? session.checkMembers(keys, target, memberIds) : null;
        return { keys, check };
      })
      .then(({ keys, check }) => {
        if (cancelled) return;
        const mismatch = !check || !target
          ? false
          : target.kind === "dm"
            ? !check.ok
            : check.ok && (check.hidden.length > 0 || check.missing.length > 0);
        const counted = check?.ok ? check.members : keys.members;
        const others = counted.filter((m) => m.trust !== "self");
        setIssues({
          channelId,
          list: others
            .filter((m) => m.trust === "changed" || m.trust === "missing" || m.recipients.length === 0)
            .map((m) => ({ userId: m.userId, kind: m.trust === "changed" ? "changed" : "missing" })),
          everyoneHasKeys: counted.every((m) => m.identityPub && m.recipients.length > 0),
          mismatch,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, e2ee.phase, e2ee.pinsVersion, unsupported, active, target, memberIds]);

  const current = issues && issues.channelId === channelId ? issues : null;

  const enable = async (auto = false) => {
    if (!channelId || enabling) return;
    setEnabling(true);
    try {
      const session = await loadE2eeSession();
      const result = await session.enableChannelEncryption(channelId);
      if (!auto) {
        toast.success(gt("End-to-end encryption is on for this conversation."));
        if (result.withoutRecovery.length > 0) {
          toast(gt("{names} hasn't set a recovery passphrase yet. Messages work, but they can't restore this conversation on a new device until they set one.", { names: result.withoutRecovery.join(", ") }), { duration: 8000 });
        }
      }
    } catch (err) {
      if (!auto) {
        const status = (err as { status?: number } | null)?.status;
        toast.error(
          status === 409
            ? gt("Everyone here needs to open SerikaCord on an updated app before encryption can be turned on.")
            : status === 400
              ? gt("Conversations with bots or system accounts can't be encrypted.")
              : status === 429
                ? gt("Too many attempts. Wait a moment and try again.")
                : gt("Couldn't turn on encryption."),
        );
      }
    } finally {
      setEnabling(false);
    }
  };

  // New conversations that started plain (someone had no keys yet) switch on
  // by themselves once everyone has keys.
  useEffect(() => {
    if (!channelId || active || !conversation?.e2eeAuto || !e2ee.enabled || !current?.everyoneHasKeys) return;
    if (autoTriedRef.current === channelId) return;
    autoTriedRef.current = channelId;
    void enable(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, active, conversation?.e2eeAuto, e2ee.enabled, current?.everyoneHasKeys]);

  if (!conversation || unsupported) return null;

  const acknowledge = async (userId: string) => {
    const session = await loadE2eeSession();
    await session.acknowledgeIdentityChange(userId);
  };

  const strip = "mx-2 sm:mx-4 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-1.5 text-xs";
  const linkButton = "font-medium text-[var(--app-accent)] hover:underline";

  return (
    <>
      {active ? (
        <div className="flex flex-col gap-1">
          {e2ee.phase === "needs-restore" || (e2ee.phase !== "ready" && e2ee.phase !== "idle") ? (
            <div className={`${strip} border border-amber-500/40 bg-amber-500/10 text-[var(--text-primary)]`} role="status">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="flex-1">
                {e2ee.phase === "unavailable"
                  ? gt("Encrypted messaging isn't available in this browser (storage is blocked), so you can't read or send messages here.")
                  : gt("This device doesn't have your encryption keys yet.")}
              </span>
              {e2ee.phase === "needs-restore" && (
                <button type="button" className={linkButton} onClick={() => openE2eeDialog("restore")}>
                  {gt("Restore")}
                </button>
              )}
            </div>
          ) : (
            <>
              {current?.mismatch && (
                <div className={`${strip} border border-red-500/40 bg-red-500/10 text-[var(--text-primary)]`} role="alert">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  <span className="flex-1">
                    {target?.kind === "dm"
                      ? gt("This conversation's encryption keys don't match the person you're talking to, so messages here can't be sent or read.")
                      : gt("The member list the server sent doesn't match this group. Messages are only encrypted for the members shown here.")}
                  </span>
                </div>
              )}
              {current?.list.map((issue) =>
                issue.kind === "changed" ? (
                  <div key={issue.userId} className={`${strip} border border-amber-500/40 bg-amber-500/10 text-[var(--text-primary)]`} role="alert">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="flex-1">
                      {gt("{name}'s security code changed. This happens when they reset encryption or reinstall. Messages won't send until you review it.", { name: nameOf(issue.userId) })}
                    </span>
                    <button type="button" className={linkButton} onClick={() => setSafetyUser({ id: issue.userId, name: nameOf(issue.userId) })}>
                      {gt("Verify")}
                    </button>
                    <button type="button" className={linkButton} onClick={() => void acknowledge(issue.userId)}>
                      {gt("Accept new code")}
                    </button>
                  </div>
                ) : (
                  <div key={issue.userId} className={`${strip} border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] text-[var(--text-secondary)]`} role="status">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="flex-1">
                      {gt("{name} hasn't set up encryption on any device yet, so they can't read new messages here.", { name: nameOf(issue.userId) })}
                    </span>
                  </div>
                ),
              )}
            </>
          )}
          <div className={`${strip} text-[var(--app-muted)]`}>
            <Lock className="h-3 w-3 shrink-0" />
            <span>{gt("Messages and calls are end-to-end encrypted.")}</span>
            {members.length === 1 ? (
              <button type="button" className={linkButton} onClick={() => setSafetyUser(members[0])}>
                {gt("Verify safety number")}
              </button>
            ) : (
              members.slice(0, 9).map((m) => (
                <button key={m.id} type="button" className={`${linkButton} inline-flex items-center gap-0.5`} onClick={() => setSafetyUser(m)}>
                  <ShieldCheck className="h-3 w-3" />
                  {m.name}
                </button>
              ))
            )}
          </div>
        </div>
      ) : e2ee.enabled && e2ee.phase === "ready" && !conversation.e2eeAuto ? (
        <div className={`${strip} text-[var(--app-muted)]`}>
          <LockOpen className="h-3 w-3 shrink-0" />
          <span>{gt("This conversation isn't end-to-end encrypted.")}</span>
          <button type="button" className={linkButton} disabled={enabling} onClick={() => void enable()}>
            {gt("Turn on encryption")}
          </button>
        </div>
      ) : e2ee.enabled && conversation.e2eeAuto && current && !current.everyoneHasKeys ? (
        <div className={`${strip} text-[var(--app-muted)]`}>
          <LockOpen className="h-3 w-3 shrink-0" />
          <span>{gt("Encryption turns on automatically once everyone here has opened an updated SerikaCord.")}</span>
        </div>
      ) : null}
      <MountWhenOpened open={safetyUser !== null}>
        <SafetyNumberDialog user={safetyUser} onClose={() => setSafetyUser(null)} />
      </MountWhenOpened>
    </>
  );
}
