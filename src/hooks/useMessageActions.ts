"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import type { ChatMessage } from "@/lib/chat/types";
import { applyReactionToMessages, decodeHtmlEntities, type EmojiLookupEntry } from "@/lib/chat/messages";

export interface MessageContextMenuState<M extends ChatMessage = ChatMessage> {
  message: M;
  x: number;
  y: number;
}

interface UseMessageActionsOptions<M extends ChatMessage> {
  /** REST base for message operations, e.g. `/api/channels/{id}` or `/api/dms/{id}`. */
  apiBase: string | null;
  setMessages: Dispatch<SetStateAction<M[]>>;
  userId?: string;
  /** Used to resolve custom emoji URLs when a reaction arrives as a token. */
  emojiLookup?: EmojiLookupEntry[];
  /** Called after a successful pin/unpin so callers can refresh pin lists. */
  onPinsChanged?: () => void;
}

/**
 * All per-message actions shared between channel chat and DMs:
 * optimistic edit/delete/pin/reactions with rollback, copy, reply target,
 * context-menu state, and the reaction picker.
 */
export function useMessageActions<M extends ChatMessage>({
  apiBase,
  setMessages,
  userId,
  emojiLookup,
  onPinsChanged,
}: UseMessageActionsOptions<M>) {
  const gt = useGT();
  const [editingMessage, setEditingMessage] = useState<M | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmMessage, setDeleteConfirmMessage] = useState<M | null>(null);
  const [contextMenu, setContextMenu] = useState<MessageContextMenuState<M> | null>(null);
  const [reactionPickerMessage, setReactionPickerMessage] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<M | null>(null);

  // Close the context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback((e: React.MouseEvent, message: M) => {
    e.preventDefault();
    setContextMenu({ message, x: e.clientX, y: e.clientY });
  }, []);

  const startEditing = useCallback((message: M) => {
    setEditingMessage(message);
    // Decode stored entities so editing doesn't re-encode them (e.g. `&amp;`).
    setEditContent(decodeHtmlEntities(message.content));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    setEditContent("");
  }, []);

  // Optimistic edit: apply immediately, roll back if the server rejects it.
  const submitEdit = useCallback(async () => {
    if (!apiBase || !editingMessage || !editContent.trim()) return;

    const messageId = editingMessage.id;
    const nextContent = editContent;
    let previous: M | undefined;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        previous = m;
        return { ...m, content: nextContent, edited: true };
      })
    );
    setEditingMessage(null);
    setEditContent("");

    const rollback = () => {
      if (!previous) return;
      const restored = previous;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? restored : m)));
    };

    try {
      const response = await fetch(`${apiBase}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        rollback();
        toast.error(data?.error || gt("Failed to edit message"));
      }
    } catch {
      rollback();
      toast.error(gt("Failed to edit message. Check your connection."));
    }
  }, [apiBase, editingMessage, editContent, setMessages]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submitEdit();
      }
      if (e.key === "Escape") {
        cancelEditing();
      }
    },
    [submitEdit, cancelEditing]
  );

  // Optimistic delete of a specific message: remove immediately, restore on failure.
  const deleteMessageNow = useCallback(async (message: M) => {
    if (!apiBase || !message) return;

    const messageId = message.id;
    let previousMessages: M[] = [];
    setMessages((prev) => {
      previousMessages = prev;
      return prev.filter((m) => m.id !== messageId);
    });
    setDeleteConfirmMessage(null);

    try {
      const response = await fetch(`${apiBase}/messages/${messageId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setMessages(previousMessages);
        toast.error(data?.error || gt("Failed to delete message"));
      }
    } catch {
      setMessages(previousMessages);
      toast.error(gt("Failed to delete message. Check your connection."));
    }
  }, [apiBase, setMessages]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmMessage) return;
    await deleteMessageNow(deleteConfirmMessage);
  }, [deleteConfirmMessage, deleteMessageNow]);

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success(gt("Copied to clipboard"));
  }, []);

  const togglePin = useCallback(
    async (message: M) => {
      if (!apiBase) return;
      try {
        const response = await fetch(`${apiBase}/messages/${message.id}/pin`, {
          method: message.pinned ? "DELETE" : "PUT",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          toast.error(data?.error || gt("Failed to update pin"));
          return;
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, pinned: !message.pinned } : m))
        );
        onPinsChanged?.();
        toast.success(message.pinned ? gt("Message unpinned") : gt("Message pinned"));
      } catch {
        toast.error(gt("Failed to update pin"));
      }
    },
    [apiBase, setMessages, onPinsChanged]
  );

  // Shared reducer used by both optimistic updates and SSE events.
  const applyReactionEvent = useCallback(
    (messageId: string, emoji: string, reactingUserId: string, isAdd: boolean) => {
      setMessages((prev) =>
        applyReactionToMessages(prev, messageId, emoji, reactingUserId, isAdd, emojiLookup)
      );
    },
    [setMessages, emojiLookup]
  );

  const addReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!apiBase || !userId) return;
      setReactionPickerMessage(null);
      applyReactionEvent(messageId, emoji, userId, true);
      try {
        const response = await fetch(
          `${apiBase}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
          { method: "PUT" }
        );
        if (!response.ok) {
          applyReactionEvent(messageId, emoji, userId, false);
          const data = await response.json().catch(() => null);
          toast.error(data?.error || gt("Failed to add reaction"));
        }
      } catch {
        applyReactionEvent(messageId, emoji, userId, false);
        toast.error(gt("Failed to add reaction. Check your connection."));
      }
    },
    [apiBase, userId, applyReactionEvent]
  );

  const removeReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!apiBase || !userId) return;
      applyReactionEvent(messageId, emoji, userId, false);
      try {
        const response = await fetch(
          `${apiBase}/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
          { method: "DELETE" }
        );
        if (!response.ok) {
          applyReactionEvent(messageId, emoji, userId, true);
          const data = await response.json().catch(() => null);
          toast.error(data?.error || gt("Failed to remove reaction"));
        }
      } catch {
        applyReactionEvent(messageId, emoji, userId, true);
        toast.error(gt("Failed to remove reaction. Check your connection."));
      }
    },
    [apiBase, userId, applyReactionEvent]
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string, hasReacted: boolean) => {
      if (hasReacted) void removeReaction(messageId, emoji);
      else void addReaction(messageId, emoji);
    },
    [addReaction, removeReaction]
  );

  return useMemo(
    () => ({
      editingMessage,
      editContent,
      setEditContent,
      startEditing,
      cancelEditing,
      submitEdit,
      handleEditKeyDown,
      deleteConfirmMessage,
      setDeleteConfirmMessage,
      confirmDelete,
      deleteMessageNow,
      contextMenu,
      setContextMenu,
      openContextMenu,
      reactionPickerMessage,
      setReactionPickerMessage,
      replyToMessage,
      setReplyToMessage,
      copyMessage,
      togglePin,
      applyReactionEvent,
      addReaction,
      removeReaction,
      toggleReaction,
    }),
    [
      editingMessage,
      editContent,
      setEditContent,
      startEditing,
      cancelEditing,
      submitEdit,
      handleEditKeyDown,
      deleteConfirmMessage,
      setDeleteConfirmMessage,
      confirmDelete,
      deleteMessageNow,
      contextMenu,
      setContextMenu,
      openContextMenu,
      reactionPickerMessage,
      setReactionPickerMessage,
      replyToMessage,
      setReplyToMessage,
      copyMessage,
      togglePin,
      applyReactionEvent,
      addReaction,
      removeReaction,
      toggleReaction,
    ]
  );
}
