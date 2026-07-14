/**
 * Shared chat message types used by both server channels (ChatArea) and DMs.
 */

export interface MessageAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  badges?: string[];
  status?: "online" | "idle" | "dnd" | "offline";
  isPremium?: boolean;
  isOwner?: boolean;
  isSystem?: boolean;
  isBot?: boolean;
  isVerified?: boolean;
  isDiscord?: boolean;
  customization?: {
    profileColor?: string;
    profileAccentColor?: string;
    profileGradient?: string[];
    displayNameStyle?: {
      font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
      effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
      color?: string;
      gradient?: string[];
    };
  } | null;
}

export interface MessageAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size?: number;
}

export interface MessageReaction {
  emoji: {
    id?: string;
    name: string;
    animated?: boolean;
    url?: string;
  };
  count: number;
  userIds: string[];
}

export interface MessageCustomEmoji {
  id: string;
  name: string;
  animated?: boolean;
  url: string;
}

export interface MessageSticker {
  id: string;
  name: string;
  imageUrl: string;
  serverId?: string;
  serverName?: string;
}

export interface ReferencedMessage {
  id: string;
  content: string;
  author?: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
    isBot?: boolean;
    isVerified?: boolean;
  };
  createdAt?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  type?: "default" | "reply" | "system";
  authorId: string;
  author: MessageAuthor;
  channelId: string;
  createdAt: string;
  updatedAt?: string;
  edited?: boolean;
  pinned?: boolean;
  referencedMessageId?: string;
  referencedMessage?: ReferencedMessage;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  customEmojis?: MessageCustomEmoji[];
  sticker?: MessageSticker;
  mentionEveryone?: boolean;
  mentionedUserIds?: string[];
  mentionedRoleIds?: string[];
  mentionedChannelIds?: string[];
  /** True while the message is an optimistic send awaiting server confirmation. */
  pending?: boolean;
  /** Ephemeral messages are only visible to the invoking user and are not persisted. */
  ephemeral?: boolean;
  /** Set on a bot's slash-command response: who invoked which command. */
  interaction?: { name: string; user: { id: string; username: string } };
}

export interface MessageGroupData<M extends ChatMessage = ChatMessage> {
  author: MessageAuthor;
  timestamp: string;
  messages: M[];
}

/** Builds the emoji identifier the reactions API expects. */
export function reactionEmojiIdentifier(emoji: MessageReaction["emoji"]): string {
  return emoji.id ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.name;
}
