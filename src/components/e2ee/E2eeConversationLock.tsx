"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useE2ee } from "@/hooks/useE2ee";
import { loadE2eeSession } from "@/lib/e2ee/client/state";
import type { ConversationMeta } from "@/lib/e2ee/client/chatGlue";
import type { E2eeTarget } from "@/lib/e2ee/conversation";

const SafetyNumberDialog = dynamic(() => import("./SafetyNumberDialog").then((m) => m.SafetyNumberDialog), { ssr: false });

interface E2eeConversationLockProps {
  /** From useChatSession: channel id + encryption state (null until loaded). */
  conversation: ConversationMeta | null;
  /** Sends are encrypted here. */
  active: boolean;
  /** A member turned encryption off (verified on this device). */
  off: { by: string; at: number } | null;
  /** The other people in the conversation. */
  members: Array<{ id: string; name: string }>;
  /** What the page opened (URL). */
  target: E2eeTarget | null;
  /** Bots / system accounts: never encrypted. */
  unsupported?: boolean;
}

/**
 * The lock next to a DM / group DM's name. It opens a small panel (a popover
 * on desktop, a bottom sheet on phones): what is encrypted, safety numbers to
 * verify each member, and turning encryption off (or back on).
 */
export function E2eeConversationLock({ conversation, active, off, members, target, unsupported = false }: E2eeConversationLockProps) {
  const gt = useGT();
  const e2ee = useE2ee();
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [safetyUser, setSafetyUser] = useState<{ id: string; name: string } | null>(null);
  const channelId = conversation?.channelId ?? null;

  if (!conversation || unsupported || (!active && !off)) return null;

  const canToggle = e2ee.enabled && e2ee.phase === "ready" && Boolean(channelId && target);
  const label = active ? gt("End-to-end encrypted") : gt("Not end-to-end encrypted");
  const offBy = off ? (off.by === e2ee.userId?.toLowerCase() ? gt("You") : members.find((m) => m.id.toLowerCase() === off.by)?.name || gt("Someone")) : null;

  const turnOff = async () => {
    if (!channelId || !target) return;
    setOpen(false);
    const ok = await confirm({
      title: gt("Turn off end-to-end encryption?"),
      description: gt("New messages here won't be end-to-end encrypted, so they could be read on SerikaCord's servers. Messages sent before stay encrypted and readable. Everyone here will see that you turned it off, and anyone can turn it back on."),
      confirmLabel: gt("Turn off"),
    });
    if (!ok) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  const turnOn = async () => {
    if (!channelId) return;
    setOpen(false);
    setBusy(true);
    try {
      const session = await loadE2eeSession();
      await session.enableChannelEncryption(channelId);
      toast.success(gt("End-to-end encryption is on for this conversation."));
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      toast.error(
        status === 409
          ? gt("Everyone here needs to open SerikaCord on an updated app before encryption can be turned on.")
          : status === 429
            ? gt("Too many attempts. Wait a moment and try again.")
            : gt("Couldn't turn on encryption."),
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = (m: { id: string; name: string }) => {
    setOpen(false);
    setSafetyUser(m);
  };

  const body: ReactNode = (
    <div className="flex flex-col gap-3 text-sm">
      {active ? (
        <>
          <p className="text-xs text-[var(--text-secondary)]">
            {gt("Only the people in this conversation can read its messages and join its calls. Not even SerikaCord can.")}
          </p>
          {members.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label={gt("Safety numbers")}>
              {members.slice(0, 12).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--app-surface-alt)]">
                  <span className="truncate text-[var(--text-primary)]">{m.name}</span>
                  <button
                    type="button"
                    onClick={() => verify(m)}
                    className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-[var(--app-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    {gt("Verify safety number")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canToggle && (
            <Button variant="ghost" size="sm" className="justify-start text-red-500 hover:text-red-500" disabled={busy} onClick={() => void turnOff()}>
              <LockOpen className="h-4 w-4" aria-hidden />
              {gt("Turn off encryption")}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-[var(--text-secondary)]">
            {gt("{name} turned off end-to-end encryption. New messages here aren't end-to-end encrypted; earlier encrypted messages stay encrypted.", { name: offBy ?? "" })}
          </p>
          {canToggle && (
            <Button size="sm" disabled={busy} onClick={() => void turnOn()}>
              <Lock className="h-4 w-4" aria-hidden />
              {gt("Turn on encryption")}
            </Button>
          )}
        </>
      )}
    </div>
  );

  const heading = active ? gt("Messages and calls are end-to-end encrypted.") : gt("End-to-end encryption is off");

  const trigger = (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
    >
      {active ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <LockOpen className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );

  return (
    <>
      {isMobile ? (
        <>
          {trigger}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-sm">
              <DialogTitle className="flex items-center gap-2 text-base">
                {active ? <Lock className="h-4 w-4 text-green-500" aria-hidden /> : <LockOpen className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />}
                {heading}
              </DialogTitle>
              <DialogDescription className="sr-only">{label}</DialogDescription>
              {body}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-80 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {active ? <Lock className="h-4 w-4 text-green-500" aria-hidden /> : <LockOpen className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />}
              {heading}
            </p>
            {body}
          </PopoverContent>
        </Popover>
      )}
      <MountWhenOpened open={safetyUser !== null}>
        <SafetyNumberDialog user={safetyUser} onClose={() => setSafetyUser(null)} />
      </MountWhenOpened>
    </>
  );
}

export default E2eeConversationLock;
