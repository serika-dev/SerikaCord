"use client";

import { T } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InboxTab } from "@/lib/notifications/events";
import { InboxPanel } from "./InboxPanel";

export default function InboxDialog({
  open,
  onOpenChange,
  tab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: InboxTab;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle><T>Inbox</T></DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            <T>Mentions, unread conversations and missed calls.</T>
          </DialogDescription>
        </DialogHeader>
        {/* Remount per open so the requested tab is shown. */}
        {open && <InboxPanel key={tab} initialTab={tab} onNavigate={() => onOpenChange(false)} className="min-h-[40vh] flex-1" />}
      </DialogContent>
    </Dialog>
  );
}
