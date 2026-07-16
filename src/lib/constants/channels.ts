// Channel types and configurations

export const CHANNEL_TYPES = {
  TEXT: {
    id: 'text',
    name: 'Text',
    description: 'Send messages, images, GIFs, emoji, opinions, and puns',
    icon: 'hash',
    color: '#B5BAC1',
    available: true,
  },
  VOICE: {
    id: 'voice',
    name: 'Voice',
    description: 'Hang out together with voice, video, and screen share',
    icon: 'volume-2',
    color: '#B5BAC1',
    available: false, // Coming soon
    comingSoon: true,
  },
  ANNOUNCEMENT: {
    id: 'announcement',
    name: 'Announcement',
    description: 'Important updates users can follow for their own servers',
    icon: 'megaphone',
    color: '#B5BAC1',
    available: true,
    requiresCommunity: true,
  },
  STAGE: {
    id: 'stage',
    name: 'Stage',
    description: 'Host events with an audience',
    icon: 'radio',
    color: '#B5BAC1',
    available: false,
    comingSoon: true,
    requiresCommunity: true,
  },
  FORUM: {
    id: 'forum',
    name: 'Forum',
    description: 'Create organized discussions around specific topics',
    icon: 'message-square',
    color: '#B5BAC1',
    available: true,
    requiresCommunity: true,
  },
  CATEGORY: {
    id: 'category',
    name: 'Category',
    description: 'Organize channels into collapsible groups',
    icon: 'folder',
    color: '#B5BAC1',
    available: true,
  },
} as const;

export type ChannelTypeId = keyof typeof CHANNEL_TYPES;
export type ChannelTypeConfig = typeof CHANNEL_TYPES[ChannelTypeId];

// DM Channel Types
export const DM_TYPES = {
  DM: {
    id: 'dm',
    name: 'Direct Message',
    description: 'Private conversation with one person',
    maxRecipients: 1,
  },
  GROUP_DM: {
    id: 'group_dm',
    name: 'Group DM',
    description: 'Private conversation with up to 10 people',
    maxRecipients: 10,
  },
} as const;

// Channel permissions - bit positions match PERMISSION_BITS in bits.ts.
// Using 2**n (not 1<<n) to avoid signed 32-bit overflow for bits >= 31.
export const CHANNEL_PERMISSIONS = {
  // General
  VIEW_CHANNEL: { flag: 2 ** 10, name: 'View Channel' },
  MANAGE_CHANNELS: { flag: 2 ** 4, name: 'Manage Channels' },
  MANAGE_PERMISSIONS: { flag: 2 ** 28, name: 'Manage Permissions' },
  
  // Text
  SEND_MESSAGES: { flag: 2 ** 11, name: 'Send Messages' },
  SEND_MESSAGES_IN_THREADS: { flag: 2 ** 38, name: 'Send Messages in Threads' },
  CREATE_PUBLIC_THREADS: { flag: 2 ** 35, name: 'Create Public Threads' },
  CREATE_PRIVATE_THREADS: { flag: 2 ** 36, name: 'Create Private Threads' },
  EMBED_LINKS: { flag: 2 ** 14, name: 'Embed Links' },
  ATTACH_FILES: { flag: 2 ** 15, name: 'Attach Files' },
  ADD_REACTIONS: { flag: 2 ** 6, name: 'Add Reactions' },
  USE_EXTERNAL_EMOJI: { flag: 2 ** 18, name: 'Use External Emoji' },
  USE_EXTERNAL_STICKERS: { flag: 2 ** 37, name: 'Use External Stickers' },
  MENTION_EVERYONE: { flag: 2 ** 17, name: 'Mention @everyone' },
  MANAGE_MESSAGES: { flag: 2 ** 13, name: 'Manage Messages' },
  MANAGE_THREADS: { flag: 2 ** 34, name: 'Manage Threads' },
  READ_MESSAGE_HISTORY: { flag: 2 ** 16, name: 'Read Message History' },
  USE_APPLICATION_COMMANDS: { flag: 2 ** 31, name: 'Use Application Commands' },
  
  // Voice
  CONNECT: { flag: 2 ** 20, name: 'Connect' },
  SPEAK: { flag: 2 ** 21, name: 'Speak' },
  STREAM: { flag: 2 ** 9, name: 'Video' },
  USE_SOUNDBOARD: { flag: 2 ** 44, name: 'Use Soundboard' },
  USE_VOICE_ACTIVITY: { flag: 2 ** 25, name: 'Use Voice Activity' },
  PRIORITY_SPEAKER: { flag: 2 ** 8, name: 'Priority Speaker' },
  MUTE_MEMBERS: { flag: 2 ** 22, name: 'Mute Members' },
  DEAFEN_MEMBERS: { flag: 2 ** 23, name: 'Deafen Members' },
  MOVE_MEMBERS: { flag: 2 ** 24, name: 'Move Members' },
  
  // Stage
  REQUEST_TO_SPEAK: { flag: 2 ** 32, name: 'Request to Speak' },
} as const;

// Default permission overrides for channel types
export const DEFAULT_CHANNEL_PERMISSIONS = {
  text: {
    allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS', 'ATTACH_FILES', 'EMBED_LINKS'],
    deny: [],
  },
  voice: {
    allow: ['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'USE_VOICE_ACTIVITY'],
    deny: [],
  },
  announcement: {
    allow: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY'],
    deny: ['SEND_MESSAGES'], // Only people with manage can post
  },
  stage: {
    allow: ['VIEW_CHANNEL', 'CONNECT'],
    deny: ['SPEAK'], // Must be invited to speak
  },
  forum: {
    allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'CREATE_PUBLIC_THREADS'],
    deny: [],
  },
} as const;

export function getChannelIcon(type: string): string {
  const channelType = CHANNEL_TYPES[type.toUpperCase() as ChannelTypeId];
  return channelType?.icon || 'hash';
}

export function isChannelAvailable(type: string): boolean {
  const channelType = CHANNEL_TYPES[type.toUpperCase() as ChannelTypeId];
  return channelType?.available ?? false;
}

export function isComingSoon(type: string): boolean {
  const channelType = CHANNEL_TYPES[type.toUpperCase() as ChannelTypeId];
  return ('comingSoon' in channelType) ? !!channelType.comingSoon : false;
}
