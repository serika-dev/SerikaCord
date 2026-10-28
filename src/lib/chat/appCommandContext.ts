import type { AppCommandGroup, AppCommandOption } from "@/lib/services/appCommands";

export const OPT = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
  ATTACHMENT: 11,
} as const;

/**
 * A single invokable command path — a top-level command or a concrete
 * subcommand — flattened so `/amq start` and `/minigame leaderboard` each become
 * one selectable entry in the palette.
 */
export interface AppLeafCommand {
  /** The registered command's id (what /api/interactions/commands takes). */
  commandId: string;
  /** Full space-joined name, e.g. "amq start". */
  fullName: string;
  /** Path tokens, e.g. ["amq", "start"]. */
  path: string[];
  description: string;
  /** Leaf (non-subcommand) options for this path. */
  options: AppCommandOption[];
  application: AppCommandGroup["application"];
}

/** Flatten grouped app commands into individually-invokable leaf commands. */
export function flattenAppCommands(groups: AppCommandGroup[]): AppLeafCommand[] {
  const leaves: AppLeafCommand[] = [];
  for (const group of groups) {
    for (const cmd of group.commands) {
      // User / message context menu commands (types 2 and 3) aren't slash commands.
      if ((cmd.type ?? 1) !== 1) continue;
      const opts = cmd.options ?? [];
      const subs = opts.filter(
        (o) => o.type === OPT.SUB_COMMAND || o.type === OPT.SUB_COMMAND_GROUP,
      );
      if (subs.length === 0) {
        leaves.push({
          commandId: cmd.id,
          fullName: cmd.name,
          path: [cmd.name],
          description: cmd.description,
          options: opts,
          application: group.application,
        });
        continue;
      }
      for (const sub of subs) {
        if (sub.type === OPT.SUB_COMMAND) {
          leaves.push({
            commandId: cmd.id,
            fullName: `${cmd.name} ${sub.name}`,
            path: [cmd.name, sub.name],
            description: sub.description || cmd.description,
            options: sub.options ?? [],
            application: group.application,
          });
        } else if (sub.type === OPT.SUB_COMMAND_GROUP) {
          for (const leaf of sub.options ?? []) {
            if (leaf.type !== OPT.SUB_COMMAND) continue;
            leaves.push({
              commandId: cmd.id,
              fullName: `${cmd.name} ${sub.name} ${leaf.name}`,
              path: [cmd.name, sub.name, leaf.name],
              description: leaf.description || sub.description || cmd.description,
              options: leaf.options ?? [],
              application: group.application,
            });
          }
        }
      }
    }
  }
  return leaves;
}

/** A user (type 2) or message (type 3) context-menu command. */
export interface AppContextCommand {
  commandId: string;
  name: string;
  application: AppCommandGroup["application"];
}

/** Context-menu commands of one type, for the user / message right-click menus. */
export function contextMenuCommands(groups: AppCommandGroup[], type: 2 | 3): AppContextCommand[] {
  const out: AppContextCommand[] = [];
  for (const group of groups) {
    for (const cmd of group.commands) {
      if ((cmd.type ?? 1) === type) out.push({ commandId: cmd.id, name: cmd.name, application: group.application });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Split a string into tokens, keeping quoted values together. */
export function tokenizeInput(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (/\s/.test(char) && !inQuotes) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}
