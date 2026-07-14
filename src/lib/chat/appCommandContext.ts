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
      const opts = cmd.options ?? [];
      const subs = opts.filter(
        (o) => o.type === OPT.SUB_COMMAND || o.type === OPT.SUB_COMMAND_GROUP,
      );
      if (subs.length === 0) {
        leaves.push({
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

export interface AppCommandParamContext {
  leaf: AppLeafCommand;
  /** The option currently being filled, or null if all are satisfied. */
  option: AppCommandOption | null;
  /** Partial text typed for the current option value. */
  currentArg: string;
  /** Options already provided (by name). */
  filled: Set<string>;
  /** Leaf options not yet filled (in declaration order). */
  remaining: AppCommandOption[];
  /** True when typing the value of a `name:` option (show that option's picker). */
  valueMode: boolean;
}

/**
 * Given the text before the cursor and the flattened app leaf commands, work out
 * which command path is active and which option the user is currently filling.
 * Returns null when the text is not an app-command invocation past its name.
 */
export function parseAppCommandContext(
  beforeCursor: string,
  leaves: AppLeafCommand[],
): AppCommandParamContext | null {
  if (!beforeCursor.startsWith("/")) return null;
  const trailingSpace = /\s$/.test(beforeCursor);
  const tokens = tokenizeInput(beforeCursor.slice(1));
  if (tokens.length === 0) return null;

  // Longest matching command path wins (so "minigame leaderboard" beats "minigame").
  let matched: AppLeafCommand | null = null;
  for (const leaf of leaves) {
    const namePart = tokens.slice(0, leaf.path.length).map((t) => t.toLowerCase());
    if (
      namePart.length === leaf.path.length &&
      leaf.path.every((p, i) => p.toLowerCase() === namePart[i])
    ) {
      if (!matched || leaf.path.length > matched.path.length) matched = leaf;
    }
  }
  if (!matched) return null;

  // Must be past the command name (a space after the full path) to fill options.
  const afterName = tokens.slice(matched.path.length);
  if (afterName.length === 0 && !trailingSpace) return null;

  const leafOptions = matched.options.filter(
    (o) => o.type !== OPT.SUB_COMMAND && o.type !== OPT.SUB_COMMAND_GROUP,
  );

  // Determine current partial arg and which named options are already filled.
  const currentArg = trailingSpace ? "" : afterName[afterName.length - 1] ?? "";
  const completed = trailingSpace ? afterName : afterName.slice(0, -1);

  const filled = new Set<string>();
  let positional = 0;
  for (const tok of completed) {
    const sep = tok.indexOf(":");
    if (sep > 0 && leafOptions.some((o) => o.name.toLowerCase() === tok.slice(0, sep).toLowerCase())) {
      filled.add(tok.slice(0, sep).toLowerCase());
    } else {
      positional++;
    }
  }

  const remaining = leafOptions.filter((o) => !filled.has(o.name.toLowerCase()));

  // If the current arg is `name:partial`, the active option is that named one.
  const sep = currentArg.indexOf(":");
  if (sep > 0) {
    const key = currentArg.slice(0, sep).toLowerCase();
    const opt = leafOptions.find((o) => o.name.toLowerCase() === key) ?? null;
    if (opt) {
      return {
        leaf: matched,
        option: opt,
        currentArg: currentArg.slice(sep + 1),
        filled,
        remaining,
        valueMode: true,
      };
    }
  }

  // Otherwise the next unfilled option (skipping ones consumed positionally).
  const option = remaining[positional] ?? remaining[0] ?? null;
  return { leaf: matched, option, currentArg, filled, remaining, valueMode: false };
}
