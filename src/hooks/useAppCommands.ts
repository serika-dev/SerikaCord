"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { getJsonCached, peekJson } from "@/lib/swrJson";
import { invokeAppCommandText } from "@/lib/chat/appCommandInvoke";
import { contextMenuCommands, flattenAppCommands, type AppContextCommand, type AppLeafCommand } from "@/lib/chat/appCommandContext";
import type { AppCommandGroup } from "@/lib/services/appCommands";

type Payload = { groups?: AppCommandGroup[] };
const url = (channelId: string) => `/api/channels/${channelId}/application-commands`;
const EMPTY: AppCommandGroup[] = [];

/**
 * App commands this user may run in a channel (server channel, DM or group
 * DM): slash-command leaves for the composer palette and the user / message
 * context-menu commands. One cached request per channel (60 s), shared by the
 * composer and the context menus.
 */
export function useAppCommands(channelId: string | null | undefined): {
  groups: AppCommandGroup[];
  leaves: AppLeafCommand[];
  userCommands: AppContextCommand[];
  messageCommands: AppContextCommand[];
} {
  const [state, setState] = useState<{ channelId: string | null; groups: AppCommandGroup[] }>(() => ({
    channelId: channelId ?? null,
    groups: (channelId ? peekJson<Payload>(url(channelId))?.groups : undefined) ?? EMPTY,
  }));
  // A new channel starts from whatever is cached (render-time reset, no effect).
  if ((channelId ?? null) !== state.channelId) {
    setState({ channelId: channelId ?? null, groups: (channelId ? peekJson<Payload>(url(channelId))?.groups : undefined) ?? EMPTY });
  }
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    void getJsonCached<Payload>(url(channelId), 60_000).then((data) => {
      if (!cancelled && data) setState({ channelId, groups: data.groups ?? EMPTY });
    });
    return () => { cancelled = true; };
  }, [channelId]);
  const groups = state.channelId === (channelId ?? null) ? state.groups : EMPTY;
  return useMemo(() => ({
    groups,
    leaves: flattenAppCommands(groups),
    userCommands: contextMenuCommands(groups, 2),
    messageCommands: contextMenuCommands(groups, 3),
  }), [groups]);
}

/**
 * Composer send hook: when the text is one of `leaves`, run it as a typed app
 * command and report problems as toasts. Resolves true when it was handled
 * (sent or rejected), false when the caller should send the text normally.
 */
export function useAppCommandRunner(channelId: string | null | undefined, leaves: AppLeafCommand[]) {
  const gt = useGT();
  return useCallback(async (text: string, opts?: { applicationId?: string }): Promise<boolean> => {
    // A command picked from the palette runs on that app only, even when
    // another app (or a built-in) has the same name.
    const pool = opts?.applicationId ? leaves.filter((l) => l.application.id === opts.applicationId) : leaves;
    if (!channelId || pool.length === 0 || !text.startsWith("/")) return false;
    const outcome = await invokeAppCommandText(text, channelId, pool);
    if (outcome.status === "not_command") return false;
    if (outcome.status === "error") {
      const option = outcome.option ?? "";
      if (outcome.reason === "missing") toast.error(gt("Fill in the required option \"{option}\".", { option }));
      else if (outcome.reason === "invalid") toast.error(gt("The value for \"{option}\" isn't valid.", { option }));
      else if (outcome.reason === "attachment") toast.error(gt("Choose a file for \"{option}\".", { option }));
      else if (outcome.code === "command_forbidden") toast.error(gt("You don't have permission to use this command here."));
      else if (outcome.code === "rate_limited") toast.error(gt("You are doing that too fast."));
      else toast.error(gt("Couldn't run that command."));
    }
    return true;
  }, [channelId, leaves, gt]);
}
