import { eq, sql, and, type SQL } from 'drizzle-orm';
import { normalizeId, buildCondition } from '../db/normalizeId';
import { db, schema } from '../db/postgres';

export type BadgeId =
  | 'staff' | 'admin' | 'moderator'
  | 'partner' | 'serika_plus' | 'early_supporter'
  | 'verified_bot_developer' | 'bug_hunter' | 'bug_hunter_gold'
  | 'server_owner' | 'active_developer'
  | 'serikacord_developer' | 'serikacord_contributor' | 'serikacord_tester';

export interface IUserDisplayNameStyle {
  font?: 'default' | 'serif' | 'mono' | 'rounded' | 'cursive' | 'bold';
  effect?: 'solid' | 'gradient' | 'neon' | 'toon' | 'pop';
  color?: string;
  gradient?: string[];
}

export interface IUserNameplate {
  type?: 'none' | 'color' | 'gradient' | 'preset';
  color?: string;
  gradient?: string[];
  presetId?: string;
}

export interface IUserCustomization {
  profileColor?: string;
  profileAccentColor?: string;
  profileGradient?: string[];
  profileGradientAngle?: number;
  profileGradientType?: 'linear' | 'radial';
  profileGradientRadialPosition?: string;
  profileCardEffect?: 'normal' | 'glassmorphism' | 'glow' | 'holographic' | 'neon';
  profileCardBlur?: number;
  profileCardOpacity?: number;
  profileCardBorderColor?: string;
  profileCardBorderGlow?: boolean;
  profileCardBorderWidth?: number;
  aboutMeStyle?: 'default' | 'card' | 'minimal';
  bannerAnimation?: 'none' | 'parallax' | 'pulse' | 'gradient';
  displayNameStyle?: IUserDisplayNameStyle;
  nameplate?: IUserNameplate;
  theme?: 'dark' | 'light' | 'oled' | 'custom';
  customTheme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}

export interface IUserSettings {
  theme: 'dark' | 'light' | 'system';
  locale: string;
  appearance: {
    theme: 'dark' | 'midnight' | 'light';
    themeStyle?: 'dark' | 'midnight' | 'light';
    accentColor: string;
    fontSize: number;
    compactMode: boolean;
    showRoleColors: boolean;
    enableAnimations: boolean;
    saturation: number;
  };
  notifications: {
    desktop: boolean;
    sounds: boolean;
    /** Sound volume 0–100. Default 50. */
    soundVolume?: number;
    /** Sound preset. Default 'chime'. */
    soundType?: 'chime' | 'ding' | 'pop' | 'coin' | 'none';
    mentions: boolean;
    directMessages: boolean;
    friendRequests: boolean;
    muteEveryone: boolean;
    /** When true, notify on all messages instead of just mentions. */
    notifyAllMessages?: boolean;
    /** Do Not Disturb — suppresses all sounds, desktop notifications, and toasts. */
    dnd?: boolean;
    /** Scheduled DND (quiet hours). Active when current time is within range. */
    dndSchedule?: {
      enabled: boolean;
      /** Start time HH:MM (24h). */
      start: string;
      /** End time HH:MM (24h). */
      end: string;
      /** Days of week 0=Sun…6=Sat. Empty = every day. */
      days?: number[];
    };
    /** Focus mode — suppress everything except direct @mentions and DMs. */
    focusMode?: boolean;
    /** Show message content in desktop notifications. Default true. */
    showPreview?: boolean;
    /** Suppress in-app toast notifications. */
    suppressToasts?: boolean;
    /** Suppress notification sound when the tab is focused/visible. Default true. */
    suppressSoundWhenFocused?: boolean;
  };
  privacy: {
    directMessages: 'everyone' | 'friends' | 'servers';
    friendRequests: 'everyone' | 'friends' | 'none';
    showActivity: boolean;
    allowDataCollection: boolean;
  };
  accessibility: {
    reducedMotion: boolean;
    highContrast: boolean;
    dyslexicFont: boolean;
    messageSpacing: 'compact' | 'cozy';
    tts: boolean;
    /** Reading speed for TTS playback (0.5–2.0). Default 1. */
    ttsRate?: number;
    /** Preferred TTS voice gender. Default 'auto'. */
    ttsVoice?: 'auto' | 'female' | 'male';
  };
  voiceVideo: {
    inputVolume: number;
    outputVolume: number;
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    pushToTalk: boolean;
    pushToTalkKey: string;
    streamPreview: boolean;
  };
  textImages: {
    inlineMedia: boolean;
    inlineEmbeds: boolean;
    gifAutoplay: boolean;
    emojiPicker: boolean;
    stickerSuggestions: boolean;
  };
  keybinds: {
    enabled: boolean;
    preset: 'default' | 'gaming' | 'vim';
    custom: Record<string, string>;
  };
  language: {
    locale: string;
    spellcheck: boolean;
  };
  friendRequests: {
    allowEveryone: boolean;
    allowFriendsOfFriends: boolean;
    allowServerMembers: boolean;
  };
  contentSocial: {
    explicitFilter: 'disabled' | 'moderate' | 'strict';
    showSensitiveMedia: boolean;
  };
  dataPrivacy: {
    allowPersonalization: boolean;
    allowCrashReports: boolean;
  };
  advanced: {
    developerMode: boolean;
  };
}

export interface IGifFavorite {
  url: string;
  title?: string;
  source?: string;
  addedAt: number;
}

export interface IEmojiFavorite {
  emoji: string;
  name?: string;
  customEmojiId?: string | null;
  url?: string | null;
  addedAt: number;
}

export interface IPendingFriendRequests {
  incoming: string[];
  outgoing: string[];
}

export type IUser = typeof schema.users.$inferSelect;

export const User = {
  table: schema.users,

  async findById(id: string) {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, normalizeId(id))).limit(1);
    return row || null;
  },

  async findOne(filter: Record<string, unknown>) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.users.id, value, true)); break;
        case 'username': conditions.push(eq(schema.users.username, value as string)); break;
        case 'email': conditions.push(eq(schema.users.email, value as string)); break;
        case 'discordId': conditions.push(eq(schema.users.discordId, normalizeId(value as string))); break;
        case 'verificationToken': conditions.push(eq(schema.users.verificationToken, value as string)); break;
        case 'resetToken': conditions.push(eq(schema.users.resetToken, value as string)); break;
        case 'isBot': conditions.push(eq(schema.users.isBot, value as boolean)); break;
        case 'isSystem': conditions.push(eq(schema.users.isSystem, value as boolean)); break;
        case 'isStaff': conditions.push(eq(schema.users.isStaff, value as boolean)); break;
        case 'isBanned': conditions.push(eq(schema.users.isBanned, value as boolean)); break;
      }
    }
    let query = db.select().from(schema.users);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    const [row] = await query.limit(1);
    return row || null;
  },

  async find(filter: Record<string, unknown> = {}) {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case 'id': conditions.push(buildCondition(schema.users.id, value, true)); break;
        case 'isBot': conditions.push(eq(schema.users.isBot, value as boolean)); break;
        case 'isSystem': conditions.push(eq(schema.users.isSystem, value as boolean)); break;
        case 'isStaff': conditions.push(eq(schema.users.isStaff, value as boolean)); break;
        case 'isBanned': conditions.push(eq(schema.users.isBanned, value as boolean)); break;
      }
    }
    let query = db.select().from(schema.users);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query;
  },

  async create(data: typeof schema.users.$inferInsert) {
    const [row] = await db.insert(schema.users).values(data).returning();
    return row;
  },

  async createMany(data: (typeof schema.users.$inferInsert)[]) {
    return db.insert(schema.users).values(data).returning();
  },

  async updateById(id: string, data: Partial<typeof schema.users.$inferInsert>) {
    const [row] = await db.update(schema.users).set({ ...data, updatedAt: new Date() }).where(eq(schema.users.id, normalizeId(id))).returning();
    return row || null;
  },

  async deleteById(id: string) {
    await db.delete(schema.users).where(eq(schema.users.id, normalizeId(id)));
  },

  async count() {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
    return result[0]?.count ?? 0;
  },
};
