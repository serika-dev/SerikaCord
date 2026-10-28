"use client";

import type { useGT } from "gt-next";
import {
  Ban,
  CircleHelp,
  Dice5,
  Eraser,
  Gauge,
  Hash,
  Info,
  Megaphone,
  MessageSquare,
  ShieldCheck,
  Timer,
  UserCircle,
  UserMinus,
  Volume2,
} from "lucide-react";
import type { CommandOptionKind, CommandOptionSpec, OptionError } from "@/lib/chat/commandComposer";

type Gt = ReturnType<typeof useGT>;

/** Icons for the built-in commands (bot commands show their app icon). */
export const BUILTIN_COMMAND_ICONS: Record<string, React.ReactNode> = {
  clear: <Eraser className="w-4 h-4" />,
  kick: <UserMinus className="w-4 h-4" />,
  ban: <Ban className="w-4 h-4" />,
  unban: <ShieldCheck className="w-4 h-4" />,
  timeout: <Timer className="w-4 h-4" />,
  warn: <Megaphone className="w-4 h-4" />,
  slowmode: <Gauge className="w-4 h-4" />,
  nick: <Hash className="w-4 h-4" />,
  serverinfo: <Info className="w-4 h-4" />,
  userinfo: <UserCircle className="w-4 h-4" />,
  avatar: <UserCircle className="w-4 h-4" />,
  roll: <Dice5 className="w-4 h-4" />,
  tts: <Volume2 className="w-4 h-4" />,
  "8ball": <CircleHelp className="w-4 h-4" />,
  me: <MessageSquare className="w-4 h-4" />,
  shrug: <MessageSquare className="w-4 h-4" />,
};

/** Short type label shown next to an option ("number", "user" …). */
export function optionKindLabel(gt: Gt, kind: CommandOptionKind): string {
  switch (kind) {
    case "integer": return gt("whole number");
    case "number": return gt("number");
    case "boolean": return gt("true / false");
    case "user": return gt("member");
    case "role": return gt("role");
    case "channel": return gt("channel");
    case "mentionable": return gt("member or role");
    case "attachment": return gt("file");
    case "duration": return gt("duration");
    default: return gt("text");
  }
}

/** Why a value isn't accepted, in plain words. */
export function optionErrorText(gt: Gt, error: OptionError): string {
  const limit = error.limit ?? 0;
  switch (error.code) {
    case "integer": return gt("Use a whole number.");
    case "number": return gt("Use a number.");
    case "min": return gt("Must be at least {limit}.", { limit });
    case "max": return gt("Must be at most {limit}.", { limit });
    case "minLength": return gt("Use at least {limit} characters.", { limit });
    case "maxLength": return gt("Use at most {limit} characters.", { limit });
    case "choice": return gt("Pick one of the choices.");
    case "boolean": return gt("Pick true or false.");
    case "user": return gt("Pick a member from the list.");
    case "role": return gt("Pick a role from the list.");
    case "channel": return gt("Pick a channel from the list.");
    case "mentionable": return gt("Pick a member or role from the list.");
    case "duration": return gt("Use a duration like 10m, 1h or 1d.");
    default: return gt("This value isn't valid.");
  }
}

/** Placeholder inside an empty option field. */
export function optionPlaceholder(gt: Gt, opt: CommandOptionSpec): string {
  if (opt.choices?.length && !opt.allowCustom) return gt("Choose…");
  switch (opt.kind) {
    case "user": return gt("Pick a member…");
    case "role": return gt("Pick a role…");
    case "channel": return gt("Pick a channel…");
    case "mentionable": return gt("Member or role…");
    case "integer":
    case "number": return gt("Number…");
    case "duration": return gt("e.g. 10m");
    default: return gt("Type…");
  }
}
