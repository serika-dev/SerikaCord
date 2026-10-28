"use client";

import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadE2eeSession } from "@/lib/e2ee/client/state";
import { useE2ee } from "@/hooks/useE2ee";
import { toast } from "sonner";

interface SafetyNumberDialogProps {
  /** The contact to compare with (null = closed). */
  user: { id: string; name: string } | null;
  onClose: () => void;
}

/**
 * The 60-digit safety number shared with one contact. Compare it in person or
 * over another channel; if it matches, mark the contact verified. When their
 * security code changed it shows the number for the new code, and marking it
 * verified accepts that exact code.
 */
export function SafetyNumberDialog({ user, onClose }: SafetyNumberDialogProps) {
  const gt = useGT();
  const { pinsVersion } = useE2ee();
  const [result, setResult] = useState<{ userId: string; groups: string[] | null; identityPub: string | null; verified: boolean; changed: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const session = await loadE2eeSession();
      await session.getUserKeys(userId).catch(() => null);
      const code = await session.safetyCodeFor(userId).catch(() => null);
      if (!cancelled) setResult({ userId, groups: code?.groups ?? null, identityPub: code?.identityPub ?? null, verified: Boolean(code?.verified), changed: Boolean(code?.changed) });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, pinsVersion]);

  const current = result && result.userId === userId ? result : null;

  const toggleVerified = async () => {
    if (!userId || !current?.identityPub || saving) return;
    setSaving(true);
    try {
      const session = await loadE2eeSession();
      // The key whose number is shown (a changed code is accepted as verified).
      await session.markVerified(userId, !current.verified, current.identityPub);
    } catch {
      toast.error(gt("Couldn't save that on this device. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--app-accent)]" />
            {gt("Safety number with {name}", { name: user?.name ?? "" })}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Compare these numbers with {name} in person or on a call. If they match on both devices, your conversation is end-to-end encrypted with no one in the middle.", { name: user?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        {current?.changed && (
          <p className="flex items-start gap-1.5 text-sm text-[var(--text-secondary)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {gt("{name}'s security code changed. This is the safety number for their new code: marking it as verified also accepts it.", { name: user?.name ?? "" })}
          </p>
        )}
        {current?.groups ? (
          <div className="grid grid-cols-4 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] p-3 font-mono text-base tracking-wider text-center select-all">
            {current.groups.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">
            {current ? gt("No safety number yet: one of you hasn't set up encryption.") : gt("Loading...")}
          </p>
        )}
        {current?.verified && (
          <p className="flex items-center gap-1.5 text-sm text-green-500">
            <ShieldCheck className="h-4 w-4" />
            {gt("You marked this contact as verified.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {gt("Close")}
          </Button>
          {current?.groups && (
            <Button disabled={saving} onClick={() => void toggleVerified()}>
              {current.verified ? gt("Clear verification") : gt("Mark as verified")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
