"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { T, useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";

interface DeleteMessageDialogProps<M extends ChatMessage> {
  message: M | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog before deleting a message. */
export function DeleteMessageDialog<M extends ChatMessage>({
  message,
  onCancel,
  onConfirm,
}: DeleteMessageDialogProps<M>) {
  const gt = useGT();
  return (
    <Dialog open={!!message} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle><T>Delete Message</T></DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            <T>Are you sure you want to delete this message? This action cannot be undone.</T>
          </DialogDescription>
        </DialogHeader>
        {message && (
          <div className="bg-[var(--bg-sidebar-elevated)] rounded-md p-3 text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] max-h-32 overflow-y-auto">
            <p className="truncate">{message.content || gt("(attachment)")}</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {gt("Cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white">
            {gt("Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
