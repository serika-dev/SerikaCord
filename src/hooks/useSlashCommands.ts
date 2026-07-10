"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import {
  parseSlashCommand,
  parseUserMention,
  parseDuration,
  type ParsedCommand,
} from "@/lib/chat/slashCommands";

interface UseSlashCommandsOptions {
  serverId?: string;
  channelId?: string;
  /** Clear visible messages client-side (for /clear) */
  clearMessages?: (count: number, userId?: string) => void;
}

interface SlashCommandResult {
  /** True if the message was consumed as a command (don't send to server) */
  handled: boolean;
  /** For TTS, the text to speak and then send as a normal message */
  ttsText?: string;
  /** For commands that produce a message to send (e.g. /me, /shrug, /8ball, /roll) */
  sendAsMessage?: string;
}

/**
 * Hook that provides handlers for built-in slash commands.
 * Returns a function that tries to execute a command from raw input.
 */
export function useSlashCommands({
  serverId,
  channelId,
  clearMessages,
}: UseSlashCommandsOptions) {
  const gt = useGT();
  const executeCommand = useCallback(
    async (rawInput: string): Promise<SlashCommandResult> => {
      const parsed = parseSlashCommand(rawInput);
      if (!parsed) return { handled: false };

      switch (parsed.name) {
        case "tts": {
          const text = parsed.args.join(" ");
          if (!text) {
            toast.error(gt("Usage: /tts '<message>'"));
            return { handled: true };
          }
          // Playback (speech + sound triggers) is handled centrally via
          // playTts in the chat view, for both the sender and every recipient.
          return { handled: true, ttsText: text };
        }

        case "clear": {
          if (!serverId || !channelId) {
            toast.error(gt("This command can only be used in a server channel"));
            return { handled: true };
          }
          let amount = 100;
          let targetUserId: string | undefined;

          for (const arg of parsed.args) {
            const mentionId = parseUserMention(arg);
            if (mentionId) {
              targetUserId = mentionId;
              continue;
            }
            if (arg.toLowerCase() === "all") {
              targetUserId = undefined;
              continue;
            }
            const num = parseInt(arg, 10);
            if (!isNaN(num) && num > 0 && num <= 100) {
              amount = num;
            }
          }

          try {
            const res = await fetch(
              `/api/channels/${channelId}/messages/bulk-delete`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ count: amount, userId: targetUserId }),
              },
            );
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              const deleted = data.deleted ?? amount;
              toast.success(gt("Cleared {count} messages", { count: deleted }));
              clearMessages?.(amount, targetUserId);
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to clear messages"));
            }
          } catch {
            toast.error(gt("Failed to clear messages"));
          }
          return { handled: true };
        }

        case "kick": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userArg = parsed.args[0];
          const userId = parseUserMention(userArg || "");
          if (!userId) {
            toast.error(gt("Usage: /kick @user [reason]"));
            return { handled: true };
          }
          const reason = parsed.args.slice(1).join(" ") || undefined;
          try {
            const res = await fetch(
              `/api/servers/${serverId}/members/${userId}/kick`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
              },
            );
            if (res.ok) {
              toast.success(gt("Member kicked"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to kick member"));
            }
          } catch {
            toast.error(gt("Failed to kick member"));
          }
          return { handled: true };
        }

        case "ban": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userArg = parsed.args[0];
          const userId = parseUserMention(userArg || "");
          if (!userId) {
            toast.error(gt("Usage: /ban @user [reason]"));
            return { handled: true };
          }
          const reason = parsed.args.slice(1).join(" ") || undefined;
          try {
            const res = await fetch(
              `/api/servers/${serverId}/bans/${userId}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
              },
            );
            if (res.ok) {
              toast.success(gt("Member banned"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to ban member"));
            }
          } catch {
            toast.error(gt("Failed to ban member"));
          }
          return { handled: true };
        }

        case "timeout": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userArg = parsed.args[0];
          const userId = parseUserMention(userArg || "");
          if (!userId) {
            toast.error(gt("Usage: /timeout @user '<duration>' '[reason]'"));
            return { handled: true };
          }
          const durationArg = parsed.args[1];
          const durationMs = parseDuration(durationArg || "");
          if (!durationMs) {
            toast.error(gt("Invalid duration. Use formats like 60s, 5m, 1h, 1d"));
            return { handled: true };
          }
          const reason = parsed.args.slice(2).join(" ") || undefined;
          try {
            const res = await fetch(
              `/api/servers/${serverId}/members/${userId}/timeout`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ durationMs, reason }),
              },
            );
            if (res.ok) {
              toast.success(gt("Member timed out"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to timeout member"));
            }
          } catch {
            toast.error(gt("Failed to timeout member"));
          }
          return { handled: true };
        }

        case "nick": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const nickname = parsed.args.join(" ") || "";
          try {
            const res = await fetch(
              `/api/servers/${serverId}/members/@me`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname: nickname || null }),
              },
            );
            if (res.ok) {
              toast.success(nickname ? gt("Nickname set to \"{nickname}\"", { nickname }) : gt("Nickname reset"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to change nickname"));
            }
          } catch {
            toast.error(gt("Failed to change nickname"));
          }
          return { handled: true };
        }

        case "unban": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userId = parsed.args[0];
          if (!userId) {
            toast.error(gt("Usage: /unban '<userId>'"));
            return { handled: true };
          }
          try {
            const res = await fetch(
              `/api/servers/${serverId}/bans/${userId}`,
              { method: "DELETE" },
            );
            if (res.ok) {
              toast.success(gt("User unbanned"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to unban user"));
            }
          } catch {
            toast.error(gt("Failed to unban user"));
          }
          return { handled: true };
        }

        case "warn": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userArg = parsed.args[0];
          const userId = parseUserMention(userArg || "");
          if (!userId) {
            toast.error(gt("Usage: /warn @user '<reason>'"));
            return { handled: true };
          }
          const reason = parsed.args.slice(1).join(" ");
          if (!reason) {
            toast.error(gt("Please provide a reason for the warning"));
            return { handled: true };
          }
          toast.success(gt("Warning sent to <@{userId}>: {reason}", { userId, reason }));
          return { handled: true };
        }

        case "slowmode": {
          if (!serverId || !channelId) {
            toast.error(gt("This command can only be used in a server channel"));
            return { handled: true };
          }
          const durationArg = parsed.args[0] || "off";
          let seconds = 0;
          if (durationArg.toLowerCase() !== "off") {
            const ms = parseDuration(durationArg);
            if (!ms) {
              toast.error(gt("Invalid duration. Use formats like 5s, 10s, 30s, 1m, 5m, 1h, 6h"));
              return { handled: true };
            }
            seconds = Math.floor(ms / 1000);
          }
          try {
            const res = await fetch(`/api/channels/${channelId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rateLimitPerUser: seconds }),
            });
            if (res.ok) {
              toast.success(seconds > 0 ? gt("Slowmode set to {seconds}s", { seconds }) : gt("Slowmode disabled"));
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(err.error || gt("Failed to set slowmode"));
            }
          } catch {
            toast.error(gt("Failed to set slowmode"));
          }
          return { handled: true };
        }

        case "serverinfo": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          try {
            const res = await fetch(`/api/servers/${serverId}`);
            if (res.ok) {
              const data = await res.json();
              const s = data.server || data;
              const created = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : gt("Unknown");
              toast.info(gt("Server: {name} | Members: {count} | Created: {created}", { name: s.name, count: s.memberCount || "?", created }));
            } else {
              toast.error(gt("Failed to fetch server info"));
            }
          } catch {
            toast.error(gt("Failed to fetch server info"));
          }
          return { handled: true };
        }

        case "userinfo": {
          if (!serverId) {
            toast.error(gt("This command can only be used in a server"));
            return { handled: true };
          }
          const userArg = parsed.args[0];
          const userId = userArg ? parseUserMention(userArg) : null;
          try {
            const endpoint = userId
              ? `/api/servers/${serverId}/members/${userId}`
              : `/api/servers/${serverId}/members/@me`;
            const res = await fetch(endpoint);
            if (res.ok) {
              const data = await res.json();
              const m = data.member || data;
              const joined = m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : gt("Unknown");
              toast.info(gt("User: {name} | Joined: {joined}", { name: m.displayName || m.username || gt("Unknown"), joined }));
            } else {
              toast.error(gt("Failed to fetch user info"));
            }
          } catch {
            toast.error(gt("Failed to fetch user info"));
          }
          return { handled: true };
        }

        case "avatar": {
          const userArg = parsed.args[0];
          const userId = userArg ? parseUserMention(userArg) : null;
          if (userId) {
            toast.info(gt("Avatar: <@{userId}>", { userId }));
          } else {
            toast.info(gt("Your avatar"));
          }
          return { handled: true };
        }

        case "roll": {
          const sidesArg = parsed.args[0];
          const sides = sidesArg ? parseInt(sidesArg, 10) : 6;
          if (isNaN(sides) || sides < 1) {
            toast.error(gt("Invalid number of sides"));
            return { handled: true };
          }
          const result = Math.floor(Math.random() * sides) + 1;
          return { handled: true, sendAsMessage: gt("🎲 You rolled a **{result}** (d{sides})", { result, sides }) };
        }

        case "8ball": {
          const question = parsed.args.join(" ");
          if (!question) {
            toast.error(gt("Usage: /8ball '<question>'"));
            return { handled: true };
          }
          const answers = [
            gt("It is certain."), gt("Without a doubt."), gt("Yes, definitely."), gt("You may rely on it."),
            gt("Most likely."), gt("Yes."), gt("Signs point to yes."), gt("Reply hazy, try again."),
            gt("Ask again later."), gt("Better not tell you now."), gt("Cannot predict now."),
            gt("Don't count on it."), gt("My reply is no."), gt("My sources say no."),
            gt("Outlook not so good."), gt("Very doubtful."),
          ];
          const answer = answers[Math.floor(Math.random() * answers.length)];
          return { handled: true, sendAsMessage: `🎱 **${answer}**` };
        }

        case "me": {
          const action = parsed.args.join(" ");
          if (!action) {
            toast.error(gt("Usage: /me '<action>'"));
            return { handled: true };
          }
          return { handled: true, sendAsMessage: `*${action}*` };
        }

        case "shrug": {
          const message = parsed.args.join(" ");
          const shrug = "¯\\_(ツ)_/¯";
          return { handled: true, sendAsMessage: message ? `${message} ${shrug}` : shrug };
        }

        default:
          return { handled: false };
      }
    },
    [serverId, channelId, clearMessages, gt],
  );

  return { executeCommand };
}
