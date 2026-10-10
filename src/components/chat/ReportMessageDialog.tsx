"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import type { MessageReportReason } from "@/lib/chat/messageReport";
import type { ChatMessage } from "@/lib/chat/types";

interface ReportMessageDialogProps {
  message: ChatMessage | null;
  onClose: () => void;
}

/** "Report Message": pick a reason, optionally add details, send to staff. */
export function ReportMessageDialog({ message, onClose }: ReportMessageDialogProps) {
  const gt = useGT();
  const [reason, setReason] = useState<MessageReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);

  const reasons: Array<{ id: MessageReportReason; label: string }> = [
    { id: "spam", label: gt("Spam or scam") },
    { id: "harassment", label: gt("Harassment or bullying") },
    { id: "hate", label: gt("Hate speech") },
    { id: "nsfw", label: gt("Sexual or graphic content") },
    { id: "self_harm", label: gt("Self-harm or suicide") },
    { id: "illegal", label: gt("Illegal activity") },
    { id: "impersonation", label: gt("Impersonation") },
    { id: "other", label: gt("Something else") },
  ];

  const close = () => {
    setReason(null);
    setDetails("");
    onClose();
  };

  const submit = async () => {
    if (!message || !reason) return;
    setSending(true);
    try {
      const res = await fetch(`/api/channels/${message.channelId}/messages/${message.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Failed to send the report"));
        return;
      }
      toast.success(gt("Thanks for the report. Our team will review it."));
      close();
    } catch {
      toast.error(gt("Failed to send the report"));
    } finally {
      setSending(false);
    }
  };

  const preview = message ? decodeHtmlEntities(message.content || "").slice(0, 280) : "";

  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-red-500" />
            {gt("Report Message")}
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Tell us what's wrong with this message. Reports are sent to the SerikaCord safety team.")}
          </DialogDescription>
        </DialogHeader>
        {message && (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] px-3 py-2 text-sm">
            <div className="mb-0.5 text-xs font-semibold text-[var(--app-muted)]">
              {message.author?.displayName || message.author?.username}
            </div>
            <div className="line-clamp-4 whitespace-pre-wrap break-words">{preview || gt("(attachment)")}</div>
          </div>
        )}
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={gt("Reason")}>
          {reasons.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={reason === r.id}
              onClick={() => setReason(r.id)}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                reason === r.id
                  ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)]"
                  : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 shrink-0 rounded-full border-2",
                  reason === r.id ? "border-[var(--app-accent)] bg-[var(--app-accent)]" : "border-[var(--app-muted)]",
                )}
              />
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          placeholder={gt("Anything else we should know? (optional)")}
          rows={3}
          className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--app-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={sending}>
            {gt("Cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!reason || sending} className="bg-red-600 text-white hover:bg-red-700">
            {gt("Report")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
