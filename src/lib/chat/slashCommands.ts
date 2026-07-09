export interface SlashCommandChoice {
  value: string;
  label: string;
  description?: string;
}

export interface SlashCommandParam {
  name: string;
  description: string;
  required?: boolean;
  /** If true, the param accepts a user mention or "all" */
  isUserTarget?: boolean;
  /** If true, the param accepts duration strings (60s, 5m, 1h, 1d) */
  isDuration?: boolean;
  /** Predefined choices for this param */
  choices?: SlashCommandChoice[];
  /** If true, this param is free-text (just show a hint) */
  isFreeText?: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  params: SlashCommandParam[];
  /** Category for grouping in the command list */
  category: "moderation" | "utility" | "fun";
  /** Whether this command requires server context (not available in DMs) */
  serverOnly?: boolean;
  /** Short hint shown in the autocomplete header */
  hint?: string;
}

export const DURATION_PRESETS: SlashCommandChoice[] = [
  { value: "60s", label: "1 minute", description: "60s" },
  { value: "5m", label: "5 minutes", description: "5m" },
  { value: "10m", label: "10 minutes", description: "10m" },
  { value: "30m", label: "30 minutes", description: "30m" },
  { value: "1h", label: "1 hour", description: "1h" },
  { value: "6h", label: "6 hours", description: "6h" },
  { value: "12h", label: "12 hours", description: "12h" },
  { value: "1d", label: "1 day", description: "1d" },
  { value: "7d", label: "7 days", description: "7d" },
  { value: "28d", label: "28 days", description: "28d" },
];

export const BUILT_IN_COMMANDS: SlashCommand[] = [
  // ── Moderation ──
  {
    name: "clear",
    description: "Delete recent messages in this channel",
    usage: "/clear [amount:100] [user:all]",
    category: "moderation",
    serverOnly: true,
    hint: "Bulk-deletes messages. You can target a specific user.",
    params: [
      {
        name: "amount",
        description: "Number of messages to clear (1-100)",
        required: false,
        isFreeText: true,
      },
      {
        name: "user",
        description: "Only clear messages from this user",
        required: false,
        isUserTarget: true,
      },
    ],
  },
  {
    name: "kick",
    description: "Kick a member from the server",
    usage: "/kick <@user> [reason]",
    category: "moderation",
    serverOnly: true,
    hint: "Removes a member from the server. They can rejoin with an invite.",
    params: [
      {
        name: "user",
        description: "The member to kick",
        required: true,
        isUserTarget: true,
      },
      {
        name: "reason",
        description: "Reason for the kick (shown in audit log)",
        required: false,
        isFreeText: true,
      },
    ],
  },
  {
    name: "ban",
    description: "Ban a member from the server",
    usage: "/ban <@user> [reason]",
    category: "moderation",
    serverOnly: true,
    hint: "Permanently bans a member. They cannot rejoin unless unbanned.",
    params: [
      {
        name: "user",
        description: "The member to ban",
        required: true,
        isUserTarget: true,
      },
      {
        name: "reason",
        description: "Reason for the ban (shown in audit log)",
        required: false,
        isFreeText: true,
      },
    ],
  },
  {
    name: "unban",
    description: "Revoke a ban from a user",
    usage: "/unban <userId>",
    category: "moderation",
    serverOnly: true,
    hint: "Lifts a ban so the user can rejoin the server.",
    params: [
      {
        name: "userId",
        description: "The ID of the banned user",
        required: true,
        isFreeText: true,
      },
    ],
  },
  {
    name: "timeout",
    description: "Temporarily prevent a member from sending messages",
    usage: "/timeout <@user> <duration> [reason]",
    category: "moderation",
    serverOnly: true,
    hint: "Mutes a member for a set duration. They can still read messages.",
    params: [
      {
        name: "user",
        description: "The member to timeout",
        required: true,
        isUserTarget: true,
      },
      {
        name: "duration",
        description: "How long to timeout the member",
        required: true,
        isDuration: true,
      },
      {
        name: "reason",
        description: "Reason for the timeout",
        required: false,
        isFreeText: true,
      },
    ],
  },
  {
    name: "warn",
    description: "Send a formal warning to a member",
    usage: "/warn <@user> <reason>",
    category: "moderation",
    serverOnly: true,
    hint: "Sends a DM warning to the member. Logged for moderators.",
    params: [
      {
        name: "user",
        description: "The member to warn",
        required: true,
        isUserTarget: true,
      },
      {
        name: "reason",
        description: "Why the member is being warned",
        required: true,
        isFreeText: true,
      },
    ],
  },
  {
    name: "slowmode",
    description: "Set the slowmode delay for this channel",
    usage: "/slowmode <duration|off>",
    category: "moderation",
    serverOnly: true,
    hint: "Limits how fast members can send messages.",
    params: [
      {
        name: "duration",
        description: "Slowmode delay or 'off' to disable",
        required: true,
        choices: [
          { value: "off", label: "Off", description: "Disable slowmode" },
          { value: "5s", label: "5 seconds" },
          { value: "10s", label: "10 seconds" },
          { value: "30s", label: "30 seconds" },
          { value: "1m", label: "1 minute" },
          { value: "5m", label: "5 minutes" },
          { value: "15m", label: "15 minutes" },
          { value: "1h", label: "1 hour" },
          { value: "6h", label: "6 hours" },
        ],
      },
    ],
  },
  // ── Utility ──
  {
    name: "nick",
    description: "Change your nickname in this server",
    usage: "/nick [new nickname]",
    category: "utility",
    serverOnly: true,
    hint: "Leave the nickname empty to reset to your username.",
    params: [
      {
        name: "nickname",
        description: "Your new nickname (leave empty to reset)",
        required: false,
        isFreeText: true,
      },
    ],
  },
  {
    name: "serverinfo",
    description: "Display information about this server",
    usage: "/serverinfo",
    category: "utility",
    serverOnly: true,
    hint: "Shows creation date, member count, channel count, and more.",
    params: [],
  },
  {
    name: "userinfo",
    description: "Display information about a member",
    usage: "/userinfo [@user]",
    category: "utility",
    serverOnly: true,
    hint: "Shows join date, roles, and account age. Defaults to you.",
    params: [
      {
        name: "user",
        description: "The member to inspect (defaults to you)",
        required: false,
        isUserTarget: true,
      },
    ],
  },
  {
    name: "avatar",
    description: "Show a member's avatar in full size",
    usage: "/avatar [@user]",
    category: "utility",
    serverOnly: true,
    hint: "Displays the full-resolution avatar. Defaults to you.",
    params: [
      {
        name: "user",
        description: "The member whose avatar to show (defaults to you)",
        required: false,
        isUserTarget: true,
      },
    ],
  },
  {
    name: "roll",
    description: "Roll a dice (1-6 or custom sides)",
    usage: "/roll [sides:6]",
    category: "fun",
    hint: "Rolls a die. Specify a number of sides, or default to 6.",
    params: [
      {
        name: "sides",
        description: "Number of sides on the die (default: 6)",
        required: false,
        isFreeText: true,
      },
    ],
  },
  // ── Fun ──
  {
    name: "tts",
    description: "Send a message that will be spoken aloud using text-to-speech",
    usage: "/tts <message>",
    category: "fun",
    hint: "Multi-speaker [m]/[f], speed [2x], volume [vol:50] up to [vol:500], bass boost [vol:BASS], ear rape [vol:EAR], personas [steven], accents [f-scottish], AI voices [fish:miku], auto-pause for sound triggers.",
    params: [
      {
        name: "message",
        description: "Text to speak. Stack modifiers anywhere: [f] female, [m] male, [2x] speed, [vol:50] volume (up to 500), [vol:BASS] bass boost, [vol:EAR] max loudness + distortion, [steven] robotic, [fish:miku] AI voice, [f-japanese] accent. Switch speakers mid-message: [m] hello [f] world.",
        required: true,
        isFreeText: true,
      },
    ],
  },
  {
    name: "8ball",
    description: "Ask the magic 8-ball a yes/no question",
    usage: "/8ball <question>",
    category: "fun",
    hint: "The magic 8-ball has answers to all your questions.",
    params: [
      {
        name: "question",
        description: "Your yes/no question",
        required: true,
        isFreeText: true,
      },
    ],
  },
  {
    name: "me",
    description: "Send an action message in italics",
    usage: "/me <action>",
    category: "fun",
    hint: "Displays your message as an action (e.g. *waves hello*).",
    params: [
      {
        name: "action",
        description: "The action to perform",
        required: true,
        isFreeText: true,
      },
    ],
  },
  {
    name: "shrug",
    description: "Append ¯\\_(ツ)_/¯ to your message",
    usage: "/shrug [message]",
    category: "fun",
    hint: "Sends your message with a shrug. Empty = just the shrug.",
    params: [
      {
        name: "message",
        description: "Optional message before the shrug",
        required: false,
        isFreeText: true,
      },
    ],
  },
];

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/**
 * Parse a raw message string into a command + arguments.
 * Returns null if the string doesn't start with `/` or the command is unknown.
 */
export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  // Split on whitespace but keep quoted strings together
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === " " && !inQuotes) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);

  if (parts.length === 0) return null;
  const name = parts[0].slice(1).toLowerCase();
  const command = BUILT_IN_COMMANDS.find((c) => c.name === name);
  if (!command) return null;

  return {
    name: command.name,
    args: parts.slice(1),
    raw: trimmed,
  };
}

/**
 * Extract a user ID from a mention token like `<@123>` or `<@!123>`.
 * Returns null if the string is not a valid mention.
 */
export function parseUserMention(text: string): string | null {
  const match = text.match(/^<@!?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>$/);
  return match ? match[1] : null;
}

/**
 * Parse a duration string like "60s", "5m", "1h", "1d" into milliseconds.
 * Returns null if the string is not a valid duration.
 */
export function parseDuration(text: string): number | null {
  const match = text.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

/**
 * Get filtered command suggestions based on a query string.
 * If query is empty, returns all commands.
 */
export function getCommandSuggestions(query: string, isServer: boolean): SlashCommand[] {
  const q = query.toLowerCase();
  return BUILT_IN_COMMANDS.filter((cmd) => {
    if (cmd.serverOnly && !isServer) return false;
    if (!q) return true;
    return cmd.name.startsWith(q) || cmd.description.toLowerCase().includes(q);
  });
}

export interface CommandParamContext {
  command: SlashCommand;
  /** Index of the param the user is currently filling */
  paramIndex: number;
  /** The param object being filled */
  param: SlashCommandParam | null;
  /** The text the user has typed for the current param */
  currentArg: string;
  /** All args parsed so far (excluding the current partial) */
  completedArgs: string[];
}

/**
 * Parse a raw input string to determine which parameter of a command
 * the user is currently filling. Returns null if the input doesn't
 * match a known command or the cursor isn't in a param position.
 */
export function parseCommandContext(input: string): CommandParamContext | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  // Split into command name + args (respecting quotes)
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === " " && !inQuotes) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  // The last partial (even if empty) represents the param being typed
  const hasTrailingSpace = trimmed.endsWith(" ") && !inQuotes;
  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) return null;
  const name = parts[0].slice(1).toLowerCase();
  const command = BUILT_IN_COMMANDS.find((c) => c.name === name);
  if (!command) return null;

  const allArgs = parts.slice(1);
  let paramIndex: number;
  let currentArg: string;
  let completedArgs: string[];

  if (hasTrailingSpace) {
    // Cursor is at the start of a new param
    paramIndex = allArgs.length;
    currentArg = "";
    completedArgs = allArgs;
  } else {
    // Cursor is in the middle of a param
    paramIndex = Math.max(0, allArgs.length - 1);
    currentArg = allArgs[allArgs.length - 1] || "";
    completedArgs = allArgs.slice(0, -1);
  }

  const param = paramIndex < command.params.length ? command.params[paramIndex] : null;

  return { command, paramIndex, param, currentArg, completedArgs };
}

/**
 * Get the category label for display.
 */
export function getCategoryLabel(category: string): string {
  switch (category) {
    case "moderation":
      return "Moderation";
    case "utility":
      return "Utility";
    case "fun":
      return "Fun";
    default:
      return category;
  }
}

/**
 * Get the category order for grouping.
 */
export const CATEGORY_ORDER = ["moderation", "utility", "fun"] as const;
