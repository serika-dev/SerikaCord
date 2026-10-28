"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Info, LockOpen, ShieldAlert, X } from "lucide-react";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { loadE2eeSession, openE2eeDialog } from "@/lib/e2ee/client/state";
import type { ConversationMeta } from "@/lib/e2ee/client/chatGlue";
import type { E2eeTarget } from "@/lib/e2ee/conversation";
import { useE2ee } from "@/hooks/useE2ee";
import { cn } from "@/lib/utils";

const SafetyNumberDialog = dynamic(() => import("./SafetyNumberDialog").then((m) => m.SafetyNumberDialog), { ssr: false });

interface ChangedMember {
  userId: string;
  /** The new key the user is shown (accepting stores exactly this one). */
  pendingKey: string | null;
}

interface MemberIssues {
  channelId: string;
  changed: ChangedMember[];
  /** Members without encryption on any device (sorted ids). */
  missing: string[];
  everyoneHasKeys: boolean;
  mismatch: boolean;
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
  /** A member turned encryption off (verified on this device). */
  off?: { by: string; at: number } | null;
  /** The server says it's off, but no valid member-signed record: stays encrypted here. */
  unverifiedOff?: boolean;
  /** With `unverifiedOff`: the member the server's record names (null: no record). */
  unverifiedOffBy?: string | null;
}

const MISSING_DISMISS_PREFIX = "serika:e2ee-missing-dismissed:";

/** The member set whose "hasn't set up encryption" notice was dismissed here (per conversation). */
function readMissingDismissed(channelId: string): string | null {
  try {
    return localStorage.getItem(MISSING_DISMISS_PREFIX + channelId.toLowerCase());
  } catch {
    return null;
  }
}

function writeMissingDismissed(channelId: string, signature: string) {
  try {
    localStorage.setItem(MISSING_DISMISS_PREFIX + channelId.toLowerCase(), signature);
  } catch {
    /* private mode: it comes back next time */
  }
}

type Tone = "danger" | "warn" | "info";

const TONE_ICON: Record<Tone, string> = {
  danger: "text-red-500",
  warn: "text-amber-500",
  info: "text-[var(--app-muted)]",
};

const TONE_EDGE: Record<Tone, string> = {
  danger: "border-l-red-500",
  warn: "border-l-amber-500",
  info: "border-l-[var(--border-subtle)]",
};

interface NoticeRowProps {
  tone: Tone;
  icon?: ReactNode;
  role?: "alert" | "status";
  children: ReactNode;
  actions?: ReactNode;
  /** Shown under the row when expanded. */
  details?: ReactNode;
  detailsOpen?: boolean;
}

function NoticeRow({ tone, icon, role = "status", children, actions, details, detailsOpen = false }: NoticeRowProps) {
  return (
    <div role={role} className={cn("border-l-2 px-3 py-1.5", TONE_EDGE[tone])}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("flex h-4 w-3.5 shrink-0 items-center", TONE_ICON[tone])}>
          {icon ?? <AlertTriangle className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1 basis-48 text-[var(--text-primary)]">{children}</span>
        {actions && <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">{actions}</span>}
      </div>
      {details && detailsOpen && <div className="mt-1 pl-[22px] text-[var(--text-secondary)]">{details}</div>}
    </div>
  );
}

/**
 * One compact notice area above a DM / group DM composer, only when something
 * needs the user, most important first: keys that don't match the
 * conversation, this device not set up, security codes that changed (sending
 * is blocked until reviewed: Verify / Accept, or one Review list for several
 * people), an unverifiable "turned off", and one dismissible line for
 * everyone who hasn't set up encryption yet. With more than two notices the
 * rest fold behind "Show N more". When encryption is off it is a single muted
 * "Turn on encryption" line. That everything is encrypted is shown by the
 * lock next to the conversation's name (E2eeConversationLock).
 */
export function E2eeConversationBanner({
  conversation,
  active,
  members,
  unsupported = false,
  target = null,
  memberIds = null,
  off = null,
  unverifiedOff = false,
  unverifiedOffBy = null,
}: E2eeConversationBannerProps) {
  const gt = useGT();
  const e2ee = useE2ee();
  const confirm = useConfirm();
  const channelId = conversation?.channelId ?? null;
  const [issues, setIssues] = useState<MemberIssues | null>(null);
  const [safetyUser, setSafetyUser] = useState<{ id: string; name: string } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  /** userId → the key being accepted (hidden at once; shown again if saving fails). */
  const [accepting, setAccepting] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);
  const autoTriedRef = useRef<string | null>(null);
  const nameOf = (id: string) => members.find((m) => m.id.toLowerCase() === id.toLowerCase())?.name || gt("Someone");

  // Member key state: the cached key set at once (revalidated in the
  // background; a change bumps keysVersion and this runs again), refreshed
  // when trust pins change too.
  useEffect(() => {
    if (!channelId || e2ee.phase !== "ready" || unsupported) return;
    let cancelled = false;
    void loadE2eeSession()
      .then(async (session) => {
        let keys = await session.getChannelKeys(channelId);
        // The key list must match what the user opened: exactly us + the
        // URL's person in a 1:1 DM; a group's must match the members shown.
        let check = target ? session.checkMembers(keys, target, memberIds) : null;
        // A cached key set may predate a member change: confirm a mismatch with the server first.
        if (target && check && (!check.ok || check.hidden.length > 0 || check.missing.length > 0)) {
          keys = await session.getChannelKeys(channelId, true).catch(() => keys);
          check = session.checkMembers(keys, target, memberIds);
        }
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
          changed: others.filter((m) => m.trust === "changed").map((m) => ({ userId: m.userId, pendingKey: m.pendingKey })),
          missing: others
            .filter((m) => m.trust !== "changed" && (m.trust === "missing" || m.recipients.length === 0))
            .map((m) => m.userId)
            .sort(),
          everyoneHasKeys: counted.every((m) => m.identityPub && m.recipients.length > 0),
          mismatch,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, e2ee.phase, e2ee.pinsVersion, e2ee.keysVersion, unsupported, active, target, memberIds]);

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

  /** Accept the exact new key shown (never a newer one that arrived unseen). Never automatic. */
  const acceptCode = async (member: ChangedMember) => {
    if (!member.pendingKey) return;
    const name = nameOf(member.userId);
    setAccepting((prev) => ({ ...prev, [member.userId]: member.pendingKey! }));
    try {
      const session = await loadE2eeSession();
      await session.acknowledgeIdentityChange(member.userId, member.pendingKey);
      // Stays hidden: the re-check (pinsVersion) drops it from the list.
      toast.success(gt("Accepted {name}'s new security code.", { name }));
    } catch {
      setAccepting((prev) => {
        const next = { ...prev };
        delete next[member.userId];
        return next;
      });
      toast.error(gt("Couldn't save the new security code on this device. Try again."));
    }
  };

  const turnOffHere = async () => {
    if (!channelId || !target || turningOff) return;
    const ok = await confirm({
      title: gt("Turn off encryption on this device?"),
      description: gt("The server already reports encryption as off here. New messages you send won't be end-to-end encrypted, so they could be read on SerikaCord's servers. Messages sent before stay encrypted."),
      confirmLabel: gt("Turn off"),
    });
    if (!ok) return;
    setTurningOff(true);
    try {
      const session = await loadE2eeSession();
      await session.disableChannelEncryption(channelId, target);
      toast.success(gt("End-to-end encryption is off for this conversation."));
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const name = err instanceof Error ? err.name : "";
      toast.error(
        name === "E2eeSendBlockedError"
          ? gt("Set up encryption on this device first.")
          : status === 400
            ? gt("Your device's clock is off. Fix the date and time, then try again.")
            : status === 429
              ? gt("Too many attempts. Wait a moment and try again.")
              : gt("Couldn't turn off encryption."),
      );
    } finally {
      setTurningOff(false);
    }
  };

  const toggleDetails = (key: string) => setOpenDetails((prev) => ({ ...prev, [key]: !prev[key] }));
  const linkButton = "font-medium text-[var(--app-accent)] hover:underline disabled:opacity-50 disabled:no-underline";
  const detailsButton = (key: string) => (
    <button type="button" className={cn(linkButton, "inline-flex items-center gap-0.5")} aria-expanded={Boolean(openDetails[key])} onClick={() => toggleDetails(key)}>
      {gt("Details")}
      <ChevronDown className={cn("h-3 w-3 transition-transform", openDetails[key] && "rotate-180")} />
    </button>
  );

  if (!active) {
    if (e2ee.enabled && e2ee.phase === "ready" && !conversation.e2eeAuto) {
      return (
        <div className="mx-2 sm:mx-4 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 text-xs text-[var(--app-muted)]">
          <LockOpen className="h-3 w-3 shrink-0" />
          <span>
            {off
              ? gt("End-to-end encryption is off here. New messages aren't end-to-end encrypted.")
              : gt("This conversation isn't end-to-end encrypted.")}
          </span>
          <button type="button" className={linkButton} disabled={enabling} onClick={() => void enable()}>
            {gt("Turn on encryption")}
          </button>
        </div>
      );
    }
    if (e2ee.enabled && conversation.e2eeAuto && current && !current.everyoneHasKeys) {
      return (
        <div className="mx-2 sm:mx-4 mb-1 flex items-center gap-2 px-3 py-1 text-xs text-[var(--app-muted)]">
          <LockOpen className="h-3 w-3 shrink-0" />
          <span>{gt("Encryption turns on automatically once everyone here has opened an updated SerikaCord.")}</span>
        </div>
      );
    }
    return null;
  }

  const rows: Array<{ key: string; node: ReactNode }> = [];
  const keysHere = e2ee.phase === "ready";

  if (!keysHere && e2ee.phase !== "idle") {
    rows.push({
      key: "device",
      node: (
        <NoticeRow
          tone="warn"
          role="alert"
          actions={e2ee.phase === "needs-restore" ? (
            <button type="button" className={linkButton} onClick={() => openE2eeDialog(e2ee.hasPin ? "pin-unlock" : "restore")}>
              {e2ee.hasPin ? gt("Enter PIN") : gt("Set up")}
            </button>
          ) : undefined}
        >
          {e2ee.phase === "unavailable"
            ? gt("Encrypted messaging isn't available in this browser (storage is blocked), so you can't read or send messages here.")
            : gt("This device doesn't have your encryption keys yet.")}
        </NoticeRow>
      ),
    });
  }

  if (keysHere && current?.mismatch) {
    rows.push({
      key: "mismatch",
      node: (
        <NoticeRow tone="danger" role="alert" icon={<ShieldAlert className="h-3.5 w-3.5" />}>
          {target?.kind === "dm"
            ? gt("This conversation's encryption keys don't match the person you're talking to, so messages here can't be sent or read.")
            : gt("The member list the server sent doesn't match this group. Messages are only encrypted for the members shown here.")}
        </NoticeRow>
      ),
    });
  }

  // Security codes that changed: sending stays blocked until each is reviewed.
  const changed = keysHere ? (current?.changed ?? []).filter((m) => accepting[m.userId] !== m.pendingKey) : [];
  const offBy = unverifiedOff && unverifiedOffBy ? unverifiedOffBy.toLowerCase() : null;
  const offByChanged = offBy ? changed.some((m) => m.userId === offBy) : false;
  const whyCodesChange = gt("Security codes change when someone resets encryption or reinstalls the app. To be sure it's really them, compare the safety number with them in person or on a call. Accept the new code only if you trust the change.");
  if (changed.length === 1) {
    const m = changed[0];
    const name = nameOf(m.userId);
    rows.push({
      key: "changed",
      node: (
        <NoticeRow
          tone="warn"
          role="alert"
          actions={
            <>
              {detailsButton("changed")}
              <button type="button" className={linkButton} onClick={() => setSafetyUser({ id: m.userId, name })}>
                {gt("Verify")}
              </button>
              <button type="button" className={linkButton} disabled={!m.pendingKey} onClick={() => void acceptCode(m)}>
                {gt("Accept new code")}
              </button>
            </>
          }
          details={whyCodesChange}
          detailsOpen={Boolean(openDetails.changed)}
        >
          {offBy === m.userId
            ? gt("{name}'s security code changed, and they turned off encryption from their new device. If you accept the new code, encryption turns off here too.", { name })
            : gt("{name}'s security code changed. Review it to keep sending messages here.", { name })}
        </NoticeRow>
      ),
    });
  } else if (changed.length > 1) {
    rows.push({
      key: "changed",
      node: (
        <NoticeRow
          tone="warn"
          role="alert"
          actions={
            <button type="button" className={cn(linkButton, "inline-flex items-center gap-0.5")} aria-expanded={reviewOpen} onClick={() => setReviewOpen((v) => !v)}>
              {reviewOpen ? gt("Hide") : gt("Review")}
              <ChevronDown className={cn("h-3 w-3 transition-transform", reviewOpen && "rotate-180")} />
            </button>
          }
          detailsOpen={reviewOpen}
          details={
            <div className="flex flex-col gap-1">
              <p>{whyCodesChange}</p>
              <ul className="flex flex-col divide-y divide-[var(--border-subtle)] rounded border border-[var(--border-subtle)]">
                {changed.map((m) => {
                  const name = nameOf(m.userId);
                  return (
                    <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1">
                      <span className="min-w-0 flex-1 basis-32">
                        <span className="font-medium text-[var(--text-primary)]">{name}</span>
                        {offBy === m.userId && (
                          <span className="block">{gt("{name} turned off encryption from their new device. Accepting their code turns encryption off here too.", { name })}</span>
                        )}
                      </span>
                      <button type="button" className={linkButton} onClick={() => setSafetyUser({ id: m.userId, name })}>
                        {gt("Verify")}
                      </button>
                      <button type="button" className={linkButton} disabled={!m.pendingKey} onClick={() => void acceptCode(m)}>
                        {gt("Accept new code")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          }
        >
          {gt("{count} people's security codes changed. Review them to keep sending messages here.", { count: changed.length })}
        </NoticeRow>
      ),
    });
  }

  // "Turned off" by the server with no record that verifies here. When it is
  // signed by someone whose new code isn't accepted yet, the row above says so.
  if (unverifiedOff && !offByChanged) {
    rows.push({
      key: "unverified-off",
      node: (
        <NoticeRow
          tone="info"
          role="status"
          icon={<Info className="h-3.5 w-3.5" />}
          actions={
            <>
              {detailsButton("unverified-off")}
              {e2ee.enabled && keysHere && current?.everyoneHasKeys && (
                <button type="button" className={linkButton} disabled={enabling} onClick={() => void enable()}>
                  {gt("Turn on encryption")}
                </button>
              )}
              {keysHere && target && (
                <button type="button" className={linkButton} disabled={turningOff} onClick={() => void turnOffHere()}>
                  {gt("Turn off here too")}
                </button>
              )}
            </>
          }
          details={gt("This can mean the server switched it off, not a member. Ask someone here to turn encryption back on, or turn it off on this device too if you're fine with messages that aren't end-to-end encrypted.")}
          detailsOpen={Boolean(openDetails["unverified-off"])}
        >
          {gt("Encryption was turned off by the server, but no member's confirmation checks out on this device. Sending is paused.")}
        </NoticeRow>
      ),
    });
  }

  if (keysHere && e2ee.pinSetupElsewhere) {
    rows.push({
      key: "pin",
      node: (
        <NoticeRow tone="info">
          {gt("Create your 6-digit PIN on the device where you first set up encryption, so new devices can unlock your messages.")}
        </NoticeRow>
      ),
    });
  }

  // Everyone without encryption: one line, dismissible until the set changes.
  const missing = keysHere ? current?.missing ?? [] : [];
  const missingSignature = missing.join(",");
  // dismissTick: re-read after "Dismiss" writes it.
  const missingDismissed = missing.length > 0 && channelId && dismissTick >= 0 ? readMissingDismissed(channelId) === missingSignature : false;
  if (missing.length > 0 && !missingDismissed) {
    const names = missing.map(nameOf);
    rows.push({
      key: "missing",
      node: (
        <NoticeRow
          tone="info"
          icon={<Info className="h-3.5 w-3.5" />}
          actions={
            <>
              {missing.length > 1 && detailsButton("missing")}
              <button
                type="button"
                className="rounded p-0.5 text-[var(--app-muted)] hover:bg-[var(--app-surface)] hover:text-[var(--text-primary)]"
                aria-label={gt("Dismiss")}
                title={gt("Dismiss")}
                onClick={() => {
                  if (channelId) writeMissingDismissed(channelId, missingSignature);
                  setDismissTick((t) => t + 1);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          }
          details={
            <>
              <span className="font-medium text-[var(--text-primary)]">{names.join(", ")}</span>
              {" · "}
              {gt("Messages sent before they set up encryption will stay unreadable for them.")}
            </>
          }
          detailsOpen={missing.length > 1 && Boolean(openDetails.missing)}
        >
          {missing.length === 1
            ? gt("{name} hasn't set up encryption yet, so they can't read new messages here.", { name: names[0] })
            : gt("{count} people haven't set up encryption yet, so they can't read new messages here.", { count: missing.length })}
        </NoticeRow>
      ),
    });
  }

  if (rows.length === 0) {
    return (
      <MountWhenOpened open={safetyUser !== null}>
        <SafetyNumberDialog user={safetyUser} onClose={() => setSafetyUser(null)} />
      </MountWhenOpened>
    );
  }

  const COLLAPSED = 2;
  const folded = rows.length > COLLAPSED && !showAll;
  const visible = folded ? rows.slice(0, COLLAPSED) : rows;

  return (
    <>
      <div className="theme-solid mx-2 sm:mx-4 mb-1 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] text-xs">
        <div className="max-h-[40vh] divide-y divide-[var(--border-subtle)] overflow-y-auto overscroll-contain">
          {visible.map((r) => (
            <div key={r.key}>{r.node}</div>
          ))}
        </div>
        {rows.length > COLLAPSED && (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 border-t border-[var(--border-subtle)] py-0.5 text-[11px] text-[var(--app-muted)] hover:text-[var(--text-primary)]"
            aria-expanded={!folded}
            onClick={() => setShowAll((v) => !v)}
          >
            {folded ? gt("Show {count} more", { count: rows.length - COLLAPSED }) : gt("Show less")}
            <ChevronDown className={cn("h-3 w-3 transition-transform", !folded && "rotate-180")} />
          </button>
        )}
      </div>
      <MountWhenOpened open={safetyUser !== null}>
        <SafetyNumberDialog user={safetyUser} onClose={() => setSafetyUser(null)} />
      </MountWhenOpened>
    </>
  );
}
