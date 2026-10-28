"use client";

import { useCallback } from "react";
import { useGT } from "gt-next";
import { useSlashCommands, type SlashCommandResult } from "@/hooks/useSlashCommands";
import { invokeAppCommandValues, type InvokeOutcome } from "@/lib/chat/appCommandInvoke";
import { builtinArgs, resolvedValues, serializeCommand, type CommandDraft, type CommandSpec } from "@/lib/chat/commandComposer";
import { waitForInteractionOutcome } from "@/lib/chat/interactionEvents";
import { playTts } from "@/lib/chat/tts";
import { ttsPlaybackOptions, type TtsPrefs } from "@/lib/chat/ttsPrefs";
import type { SendMessageInput } from "@/hooks/useChatSession";

/** What the command composer hands to the conversation when the user sends a command. */
export interface CommandInvocation {
  spec: CommandSpec;
  draft: CommandDraft;
  /** Attachment options → the picked file. */
  files: Record<string, File>;
}

export type CommandOutcome = { ok: true } | { ok: false; message: string; retryable: boolean };

/**
 * `ok` once the command was accepted (built-in ran, or the app interaction
 * was created). `outcome` resolves later with the app's ack or failure.
 */
export type CommandRunResult =
  | { ok: true; outcome?: Promise<CommandOutcome> }
  | { ok: false; message: string; retryable: boolean };

interface RunnerChat {
  sendMessage: (input?: SendMessageInput) => Promise<void>;
  addEphemeralMessage: (raw: Record<string, unknown>) => void;
  resetTyping: () => void;
}

interface RunnerUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  settings?: { accessibility?: TtsPrefs | null } | null;
}

/**
 * Runs slash commands for a conversation (server channel, DM, group DM):
 * built-ins (/tts, /me, /roll, moderation …) and app commands from the
 * command composer, plus typed built-ins from a plain send. One copy of the
 * result handling for every surface.
 */
export function useCommandRunner({
  chat,
  channelId,
  serverId,
  user,
  clearMessages,
}: {
  chat: RunnerChat;
  /** The conversation's channel id (DMs: the DM channel). */
  channelId: string | null | undefined;
  /** Server channels only (moderation built-ins). */
  serverId?: string;
  user: RunnerUser | null | undefined;
  clearMessages?: (count: number, userId?: string) => void;
}) {
  const gt = useGT();
  // The chat object is new every render; its callbacks are stable.
  const { sendMessage, addEphemeralMessage, resetTyping } = chat;
  const { executeCommand } = useSlashCommands({ serverId, channelId: serverId ? channelId ?? undefined : undefined, clearMessages });

  const applyBuiltinResult = useCallback(async (result: SlashCommandResult) => {
    if (result.ttsText) {
      // Sent with the /tts prefix so every other client hears it; own messages
      // don't come back through SSE, so play it here for the sender.
      void playTts({ content: result.ttsText, ...ttsPlaybackOptions(user?.settings?.accessibility) });
      await sendMessage({ contentOverride: `/tts ${result.ttsText}` });
    } else if (result.sendAsMessage) {
      if (result.ephemeral) {
        // Ephemeral built-ins (/roll, /8ball): only the invoker sees them.
        resetTyping();
        addEphemeralMessage({
          id: `eph-local-${Date.now()}`,
          content: result.sendAsMessage,
          authorId: user?.id,
          author: user
            ? { id: user.id, username: user.username, displayName: user.displayName || user.username, avatar: user.avatar }
            : null,
          channelId: channelId ?? undefined,
          createdAt: new Date().toISOString(),
          ephemeral: true,
          type: "default",
        });
      } else {
        // Public built-ins (/me, /shrug): a normal message.
        await sendMessage({ contentOverride: result.sendAsMessage });
      }
    } else {
      resetTyping();
    }
  }, [sendMessage, addEphemeralMessage, resetTyping, user, channelId]);

  /** A typed built-in (`/roll 20`) from a plain send. True when it was handled. */
  const runBuiltinText = useCallback(async (text: string, clearComposer: () => void): Promise<boolean> => {
    const result = await executeCommand(text);
    if (!result.handled) return false;
    clearComposer();
    await applyBuiltinResult(result);
    return true;
  }, [executeCommand, applyBuiltinResult]);

  const errorText = useCallback((r: Extract<InvokeOutcome, { status: "error" }>): { message: string; retryable: boolean } => {
    const option = r.option ?? "";
    if (r.reason === "missing") return { message: gt("Fill in the required option \"{option}\".", { option }), retryable: false };
    if (r.reason === "invalid") return { message: gt("The value for \"{option}\" isn't valid.", { option }), retryable: false };
    if (r.reason === "attachment") return { message: gt("Couldn't upload the file for \"{option}\".", { option }), retryable: true };
    switch (r.code) {
      case "command_forbidden": return { message: gt("You don't have permission to use this command here."), retryable: false };
      case "rate_limited": return { message: gt("You are doing that too fast."), retryable: true };
      case "unknown_command":
      case "unknown_application": return { message: gt("This command is no longer available here."), retryable: false };
      case "network": return { message: gt("Couldn't reach the server. Check your connection."), retryable: true };
      default: return { message: gt("Couldn't run that command."), retryable: true };
    }
  }, [gt]);

  const runCommand = useCallback(async (inv: CommandInvocation): Promise<CommandRunResult> => {
    const { spec, draft, files } = inv;
    if (spec.source === "builtin") {
      const result = await executeCommand({ name: spec.name, args: builtinArgs(spec, draft), raw: serializeCommand(spec, draft) });
      if (!result.handled) return { ok: false, message: gt("Couldn't run that command."), retryable: false };
      await applyBuiltinResult(result);
      return { ok: true };
    }
    if (!spec.leaf || !channelId) return { ok: false, message: gt("Couldn't run that command."), retryable: false };
    const r = await invokeAppCommandValues(channelId, spec.leaf, resolvedValues(spec, draft), files);
    if (r.status === "error") return { ok: false, ...errorText(r) };
    if (r.status !== "sent") return { ok: false, message: gt("Couldn't run that command."), retryable: true };
    resetTyping();
    const appName = spec.app?.name ?? "";
    const outcome = r.interactionId
      ? waitForInteractionOutcome(r.interactionId).then((o): CommandOutcome => {
          if (o.event !== "failed") return { ok: true };
          if (o.reason === "no_response") return { ok: false, message: gt("{app} didn't respond in time.", { app: appName }), retryable: true };
          if (o.reason === "rate_limited") return { ok: false, message: gt("You are doing that too fast."), retryable: true };
          return { ok: false, message: gt("{app} couldn't run that command.", { app: appName }), retryable: true };
        })
      : undefined;
    return { ok: true, outcome };
  }, [executeCommand, applyBuiltinResult, channelId, resetTyping, errorText, gt]);

  return { runCommand, runBuiltinText };
}
