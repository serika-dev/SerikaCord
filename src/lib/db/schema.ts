import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  serial,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────

const userStatusEnum = pgEnum('user_status', ['online', 'idle', 'dnd', 'offline', 'invisible']);
const channelTypeEnum = pgEnum('channel_type', [
  'text', 'voice', 'category', 'announcement', 'stage', 'forum',
  'public_thread', 'private_thread', 'dm', 'group_dm',
]);
const forumModeEnum = pgEnum('forum_mode', ['posts', 'tickets']);
const messageTypeEnum = pgEnum('message_type', [
  'default', 'reply', 'system', 'member_join', 'member_leave',
  'channel_pinned_message', 'user_premium_guild_subscription',
]);
const inviteTypeEnum = pgEnum('invite_type', ['normal', 'vanity']);
const applicationStatusEnum = pgEnum('application_status', ['pending', 'approved', 'rejected', 'interviewed']);
const verificationStatusEnum = pgEnum('verification_status', ['none', 'pending', 'approved', 'rejected']);
const instanceTypeEnum = pgEnum('instance_type', ['host', 'self_hosted']);
const instanceStatusEnum = pgEnum('instance_status', ['active', 'suspended', 'pending', 'offline', 'revoked']);
const experimentTypeEnum = pgEnum('experiment_type', ['feature_flag', 'ab_test', 'percentage_rollout', 'user_segment']);
const experimentStatusEnum = pgEnum('experiment_status', ['draft', 'running', 'paused', 'completed', 'archived']);
const adminActionTypeEnum = pgEnum('admin_action_type', [
  'ban_user', 'unban_user', 'edit_badges', 'delete_server', 'grant_partner',
  'revoke_partner', 'toggle_discovery', 'transfer_ownership', 'update_settings',
  'broadcast_announcement', 'resolve_report', 'dismiss_report', 'delete_message',
  'impersonate_user', 'create_experiment', 'update_experiment', 'delete_experiment',
  'approve_instance', 'revoke_instance', 'timeout_member',
]);
const adminTargetTypeEnum = pgEnum('admin_target_type', ['user', 'server', 'message', 'platform']);
const connectionProviderEnum = pgEnum('connection_provider', [
  'discord', 'twitch', 'youtube', 'github', 'spotify', 'website',
  'lastfm', 'steam', 'xbox', 'psn', 'roblox', 'twitter', 'instagram', 'battlenet', 'serika',
]);

// ─── Tables ───────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  isVerified: boolean('is_verified').default(false),
  verificationToken: text('verification_token'),
  verificationExpires: timestamp('verification_expires'),
  resetToken: text('reset_token'),
  resetExpires: timestamp('reset_expires'),
  discordId: text('discord_id').unique(),
  discordUsername: text('discord_username'),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  avatar: text('avatar'),
  banner: text('banner'),
  bio: text('bio'),
  pronouns: text('pronouns'),
  timezone: text('timezone'),
  showTimezone: boolean('show_timezone').default(false),
  status: userStatusEnum('status').default('offline'),
  customStatus: text('custom_status'),
  presenceLastHeartbeatAt: timestamp('presence_last_heartbeat_at').defaultNow(),
  presenceLastDisconnectAt: timestamp('presence_last_disconnect_at'),
  badges: text('badges').array().default([]),
  customization: jsonb('customization').default({}),
  gifFavorites: jsonb('gif_favorites').default([]),
  isBot: boolean('is_bot').default(false),
  isSystem: boolean('is_system').default(false),
  isPremium: boolean('is_premium').default(false),
  premiumSince: timestamp('premium_since'),
  premiumTier: text('premium_tier'),
  isBanned: boolean('is_banned').default(false),
  banReason: text('ban_reason'),
  isStaff: boolean('is_staff').default(false),
  staffRole: text('staff_role'),
  friends: uuid('friends').array().default([]),
  blockedUsers: uuid('blocked_users').array().default([]),
  pendingFriendRequests: jsonb('pending_friend_requests').default({ incoming: [], outgoing: [] }),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  emailIdx: index('users_email_idx').on(t.email),
  usernameIdx: index('users_username_idx').on(t.username),
  discordIdIdx: index('users_discord_id_idx').on(t.discordId),
  friendsIdx: index('users_friends_idx').on(t.friends),
}));

export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  banner: text('banner'),
  splash: text('splash'),
  ownerId: uuid('owner_id').notNull(),
  systemChannelId: uuid('system_channel_id'),
  rulesChannelId: uuid('rules_channel_id'),
  publicUpdatesChannelId: uuid('public_updates_channel_id'),
  afkChannelId: uuid('afk_channel_id'),
  afkTimeout: integer('afk_timeout').default(300),
  settings: jsonb('settings').default({}),
  joinMode: text('join_mode').default('invite_only'),
  soundboardSounds: jsonb('soundboard_sounds').default([]),
  features: text('features').array().default([]),
  verificationLevel: text('verification_level').default('none'),
  explicitContentFilter: text('explicit_content_filter').default('disabled'),
  defaultNotifications: text('default_notifications').default('only_mentions'),
  premiumTier: integer('premium_tier').default(0),
  premiumSubscriptionCount: integer('premium_subscription_count').default(0),
  isPartnered: boolean('is_partnered').default(false),
  partneredAt: timestamp('partnered_at'),
  isDiscoverable: boolean('is_discoverable').default(false),
  discoverableAt: timestamp('discoverable_at'),
  discoverySplash: text('discovery_splash'),
  discoveryDescription: text('discovery_description'),
  discoveryCategories: text('discovery_categories').array().default([]),
  isAgeGated: boolean('is_age_gated').default(false),
  vanityUrlCode: text('vanity_url_code').unique(),
  vanityUrlUses: integer('vanity_url_uses').default(0),
  mfaLevel: integer('mfa_level').default(0),
  memberCount: integer('member_count').default(1),
  onlineCount: integer('online_count').default(0),
  isTemplate: boolean('is_template').default(false),
  templateId: text('template_id'),
  welcomeScreen: jsonb('welcome_screen'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  ownerIdx: index('servers_owner_id_idx').on(t.ownerId),
  joinModeIdx: index('servers_join_mode_idx').on(t.joinMode),
  isPartneredIdx: index('servers_is_partnered_idx').on(t.isPartnered),
  isDiscoverableIdx: index('servers_is_discoverable_idx').on(t.isDiscoverable),
}));

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id'),
  name: text('name').notNull(),
  type: channelTypeEnum('type').notNull(),
  topic: text('topic'),
  position: integer('position').default(0),
  parentId: uuid('parent_id'),
  lastMessageId: uuid('last_message_id'),
  lastPinTimestamp: timestamp('last_pin_timestamp'),
  rateLimitPerUser: integer('rate_limit_per_user').default(0),
  nsfw: boolean('nsfw').default(false),
  bitrate: integer('bitrate').default(64000),
  userLimit: integer('user_limit').default(0),
  rtcRegion: text('rtc_region'),
  defaultAutoArchiveDuration: integer('default_auto_archive_duration').default(1440),
  defaultThreadRateLimitPerUser: integer('default_thread_rate_limit_per_user').default(0),
  availableTags: jsonb('available_tags').default([]),
  defaultReactionEmoji: jsonb('default_reaction_emoji'),
  defaultSortOrder: text('default_sort_order'),
  defaultForumLayout: text('default_forum_layout').default('not_set'),
  forumMode: forumModeEnum('forum_mode').default('posts'),
  ticketAccessRoleIds: uuid('ticket_access_role_ids').array().default([]),
  ownerId: uuid('owner_id'),
  archived: boolean('archived').default(false),
  locked: boolean('locked').default(false),
  threadMemberIds: uuid('thread_member_ids').array().default([]),
  appliedTags: text('applied_tags').array().default([]),
  messageCount: integer('message_count').default(0),
  recipientIds: uuid('recipient_ids').array().default([]),
  permissionOverwrites: jsonb('permission_overwrites').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('channels_server_id_idx').on(t.serverId),
  typeIdx: index('channels_type_idx').on(t.type),
  serverPosIdx: index('channels_server_id_position_idx').on(t.serverId, t.position),
  serverParentIdx: index('channels_server_id_parent_id_idx').on(t.serverId, t.parentId),
  parentArchivedIdx: index('channels_parent_id_archived_last_message_idx').on(t.parentId, t.archived, t.lastMessageId),
  recipientGinIdx: index('channels_recipient_ids_gin_idx').using('gin', t.recipientIds),
}));

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  channelId: uuid('channel_id').notNull(),
  serverId: uuid('server_id'),
  authorId: uuid('author_id').notNull(),
  content: text('content').default(''),
  type: messageTypeEnum('type').default('default'),
  referencedMessageId: uuid('referenced_message_id'),
  attachments: jsonb('attachments').default([]),
  embeds: jsonb('embeds').default([]),
  sticker: jsonb('sticker'),
  mentionEveryone: boolean('mention_everyone').default(false),
  mentionedUserIds: uuid('mentioned_user_ids').array().default([]),
  mentionedRoleIds: uuid('mentioned_role_ids').array().default([]),
  mentionedChannelIds: uuid('mentioned_channel_ids').array().default([]),
  reactions: jsonb('reactions').default([]),
  pinned: boolean('pinned').default(false),
  edited: boolean('edited').default(false),
  editedTimestamp: timestamp('edited_timestamp'),
  threadId: uuid('thread_id'),
  isDeleted: boolean('is_deleted').default(false),
  deletedAt: timestamp('deleted_at'),
  interaction: jsonb('interaction'),
  discordMessageId: text('discord_message_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  channelIdx: index('messages_channel_id_idx').on(t.channelId),
  serverIdx: index('messages_server_id_idx').on(t.serverId),
  authorIdx: index('messages_author_id_idx').on(t.authorId),
  channelCreatedIdx: index('messages_channel_id_created_at_idx').on(t.channelId, t.createdAt),
  serverCreatedIdx: index('messages_server_id_created_at_idx').on(t.serverId, t.createdAt),
  authorCreatedIdx: index('messages_author_id_created_at_idx').on(t.authorId, t.createdAt),
  channelPinnedIdx: index('messages_channel_id_pinned_idx').on(t.channelId, t.pinned),
  channelDeletedCreatedIdx: index('messages_channel_id_is_deleted_created_at_idx').on(t.channelId, t.isDeleted, t.createdAt),
  channelAuthorCreatedIdx: index('messages_channel_id_author_id_created_at_idx').on(t.channelId, t.authorId, t.createdAt),
  referencedIdx: index('messages_referenced_message_id_idx').on(t.referencedMessageId),
}));

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  name: text('name').notNull(),
  color: integer('color').default(0),
  hoist: boolean('hoist').default(false),
  icon: text('icon'),
  unicodeEmoji: text('unicode_emoji'),
  position: integer('position').default(0),
  permissions: text('permissions').default('0'),
  managed: boolean('managed').default(false),
  mentionable: boolean('mentionable').default(false),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('roles_server_id_idx').on(t.serverId),
  serverPosIdx: index('roles_server_id_position_idx').on(t.serverId, t.position),
  serverDefaultIdx: index('roles_server_id_is_default_idx').on(t.serverId, t.isDefault),
}));

export const serverMembers = pgTable('server_members', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  userId: uuid('user_id').notNull(),
  nickname: text('nickname'),
  avatar: text('avatar'),
  banner: text('banner'),
  roles: uuid('roles').array().default([]),
  communicationDisabledUntil: timestamp('communication_disabled_until'),
  deaf: boolean('deaf').default(false),
  mute: boolean('mute').default(false),
  pending: boolean('pending').default(false),
  joinedAt: timestamp('joined_at').defaultNow(),
  premiumSince: timestamp('premium_since'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_members_server_id_idx').on(t.serverId),
  userIdx: index('server_members_user_id_idx').on(t.userId),
  serverUserUnique: uniqueIndex('server_members_server_id_user_id_unique').on(t.serverId, t.userId),
  serverJoinedIdx: index('server_members_server_id_joined_at_idx').on(t.serverId, t.joinedAt),
}));

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  serverId: uuid('server_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  inviterId: uuid('inviter_id').notNull(),
  uses: integer('uses').default(0),
  maxUses: integer('max_uses').default(0),
  maxAge: integer('max_age').default(86400),
  temporary: boolean('temporary').default(false),
  type: inviteTypeEnum('type').default('normal'),
  isVanity: boolean('is_vanity').default(false),
  metadata: jsonb('metadata'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  codeIdx: index('invites_code_idx').on(t.code),
  serverIdx: index('invites_server_id_idx').on(t.serverId),
  vanityIdx: index('invites_is_vanity_idx').on(t.isVanity),
  codeVanityIdx: index('invites_code_is_vanity_idx').on(t.code, t.isVanity),
  expiresIdx: index('invites_expires_at_idx').on(t.expiresAt),
}));

export const serverEmojis = pgTable('server_emojis', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url').notNull(),
  animated: boolean('animated').default(false),
  available: boolean('available').default(true),
  managed: boolean('managed').default(false),
  requireColons: boolean('require_colons').default(true),
  roles: uuid('roles').array().default([]),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_emojis_server_id_idx').on(t.serverId),
  serverNameUnique: uniqueIndex('server_emojis_server_id_name_unique').on(t.serverId, t.name),
}));

// Globally-configured TTS sound triggers. When a chat message contains a
// trigger word (e.g. "meow"), clients play a random sound whose triggerWord
// matches instead of / alongside the spoken text. Managed from the admin panel.
export const ttsSounds = pgTable('tts_sounds', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  triggerWord: text('trigger_word').notNull(),
  path: text('path').notNull(),
  label: text('label'),
  enabled: boolean('enabled').default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  triggerIdx: index('tts_sounds_trigger_word_idx').on(t.triggerWord),
}));

// Globally-configured TTS custom voices. Admins can add Fish Audio model IDs
// or StreamElements voice names as presets (e.g. "miku" → fish model ID).
// Users reference them via /tts [fish:miku] or [se:Brian]. One voice can be
// marked as the platform default (used for Firefox fallback, etc.).
export const ttsVoices = pgTable('tts_voices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  referenceId: text('reference_id').notNull(),
  description: text('description'),
  enabled: boolean('enabled').default(true),
  isDefault: boolean('is_default').default(false),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  nameIdx: index('tts_voices_name_idx').on(t.name),
}));

export const serverStickers = pgTable('server_stickers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url').notNull(),
  tags: text('tags').array().default([]),
  available: boolean('available').default(true),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_stickers_server_id_idx').on(t.serverId),
  serverNameUnique: uniqueIndex('server_stickers_server_id_name_unique').on(t.serverId, t.name),
}));

export const serverBans = pgTable('server_bans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  userId: uuid('user_id').notNull(),
  bannedBy: uuid('banned_by').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_bans_server_id_idx').on(t.serverId),
  userIdx: index('server_bans_user_id_idx').on(t.userId),
  serverUserUnique: uniqueIndex('server_bans_server_id_user_id_unique').on(t.serverId, t.userId),
}));

export const serverMemberApplications = pgTable('server_member_applications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: applicationStatusEnum('status').default('pending'),
  answers: jsonb('answers').default([]),
  processedBy: uuid('processed_by'),
  processedAt: timestamp('processed_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_member_applications_server_id_idx').on(t.serverId),
  userIdx: index('server_member_applications_user_id_idx').on(t.userId),
  statusIdx: index('server_member_applications_status_idx').on(t.status),
  serverUserStatusIdx: index('server_member_applications_server_id_user_id_status_idx').on(t.serverId, t.userId, t.status),
}));

export const authorizedApps = pgTable('authorized_apps', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  scopes: text('scopes').array().default([]),
  approvedAt: timestamp('approved_at').defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('authorized_apps_user_id_idx').on(t.userId),
  userNameIdx: index('authorized_apps_user_id_name_idx').on(t.userId, t.name),
}));

export const userDeviceSessions = pgTable('user_device_sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  deviceName: text('device_name').notNull(),
  platform: text('platform').notNull(),
  browser: text('browser').notNull(),
  ipAddress: text('ip_address'),
  current: boolean('current').default(false),
  lastActiveAt: timestamp('last_active_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('user_device_sessions_user_id_idx').on(t.userId),
  userLastActiveIdx: index('user_device_sessions_user_id_last_active_at_idx').on(t.userId, t.lastActiveAt),
}));

export const userConnections = pgTable('user_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  provider: connectionProviderEnum('provider').notNull(),
  accountId: text('account_id').notNull(),
  username: text('username'),
  displayName: text('display_name'),
  visible: boolean('visible').default(true),
  avatar: text('avatar'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('user_connections_user_id_idx').on(t.userId),
  providerIdx: index('user_connections_provider_idx').on(t.provider),
  userProviderAccountUnique: uniqueIndex('user_connections_user_id_provider_account_id_unique').on(t.userId, t.provider, t.accountId),
}));

export const discordUsers = pgTable('discord_users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  discordId: text('discord_id').notNull().unique(),
  username: text('username'),
  displayName: text('display_name').notNull(),
  avatar: text('avatar'),
  isBot: boolean('is_bot').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  discordIdIdx: uniqueIndex('discord_users_discord_id_idx').on(t.discordId),
}));

export const adminLogs = pgTable('admin_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id').notNull(),
  action: adminActionTypeEnum('action').notNull(),
  targetType: adminTargetTypeEnum('target_type').notNull(),
  targetId: text('target_id').notNull(),
  details: jsonb('details'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  adminIdx: index('admin_logs_admin_id_idx').on(t.adminId),
  actionIdx: index('admin_logs_action_idx').on(t.action),
  targetIdx: index('admin_logs_target_id_idx').on(t.targetId),
  createdIdx: index('admin_logs_created_at_idx').on(t.createdAt),
  actionCreatedIdx: index('admin_logs_action_created_at_idx').on(t.action, t.createdAt),
}));

export const platformSettings = pgTable('platform_settings', {
  id: text('id').primaryKey().default('settings'),
  maintenanceMode: boolean('maintenance_mode').default(false),
  allowRegistration: boolean('allow_registration').default(true),
  connectionsEnabled: boolean('connections_enabled').default(true),
  disabledProviders: text('disabled_providers').array().default([]),
  globalAnnouncement: text('global_announcement'),
  announcementUpdatedAt: timestamp('announcement_updated_at'),
  encryptionKey: text('encryption_key').notNull(),
  oembedWhitelist: text('oembed_whitelist').array().default([]),
  allowedFileTypes: jsonb('allowed_file_types').default([]),
  warnOnUnknownFileTypes: boolean('warn_on_unknown_file_types').default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  key: text('key').notNull().unique(),
  description: text('description'),
  type: experimentTypeEnum('type').default('feature_flag'),
  status: experimentStatusEnum('status').default('draft'),
  rolloutPercentage: integer('rollout_percentage').default(0),
  variants: jsonb('variants').default([]),
  filters: jsonb('filters').default([]),
  userBuckets: jsonb('user_buckets').default({}),
  userOverrides: jsonb('user_overrides').default([]),
  excludedUsers: jsonb('excluded_users').default([]),
  metrics: jsonb('metrics').default({}),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  targetInstances: text('target_instances').array().default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  statusIdx: index('experiments_status_idx').on(t.status),
  typeIdx: index('experiments_type_idx').on(t.type),
  createdIdx: index('experiments_created_at_idx').on(t.createdAt),
}));

export const instances = pgTable('instances', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  instanceId: text('instance_id').notNull().unique(),
  type: instanceTypeEnum('type').default('self_hosted'),
  status: instanceStatusEnum('status').default('pending'),
  apiKey: text('api_key').notNull(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  secretKey: text('secret_key').notNull(),
  ownerId: uuid('owner_id'),
  ownerEmail: text('owner_email'),
  config: jsonb('config').default({}),
  stats: jsonb('stats').default({}),
  allowedIps: text('allowed_ips').array().default([]),
  lastSeenIp: text('last_seen_ip'),
  lastSeenAt: timestamp('last_seen_at'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  statusIdx: index('instances_status_idx').on(t.status),
  typeIdx: index('instances_type_idx').on(t.type),
  apiKeyPrefixIdx: index('instances_api_key_prefix_idx').on(t.apiKeyPrefix),
}));

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ownerId: uuid('owner_id').notNull(),
  teamId: uuid('team_id'),
  name: text('name').notNull(),
  description: text('description').default(''),
  icon: text('icon'),
  coverImage: text('cover_image'),
  botId: uuid('bot_id'),
  botToken: text('bot_token'),
  botPublic: boolean('bot_public').default(true),
  botRequireCodeGrant: boolean('bot_require_code_grant').default(false),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret').notNull(),
  redirectUris: text('redirect_uris').array().default([]),
  scopes: text('scopes').array().default(['identify']),
  installParams: jsonb('install_params'),
  customInstallUrl: text('custom_install_url'),
  rpcOrigins: text('rpc_origins').array().default([]),
  verified: boolean('verified').default(false),
  verificationStatus: verificationStatusEnum('verification_status').default('none'),
  serverCount: integer('server_count').default(0),
  tags: text('tags').array().default([]),
  termsOfServiceUrl: text('terms_of_service_url'),
  privacyPolicyUrl: text('privacy_policy_url'),
  flags: integer('flags').default(0),
  gatewayIntents: integer('gateway_intents').default(0),
  interactionsEndpointUrl: text('interactions_endpoint_url'),
  publicKey: text('public_key'),
  privateKeyPem: text('private_key_pem'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  ownerIdx: index('applications_owner_id_idx').on(t.ownerId),
  teamIdx: index('applications_team_id_idx').on(t.teamId),
  clientIdIdx: index('applications_client_id_idx').on(t.clientId),
  ownerCreatedIdx: index('applications_owner_id_created_at_idx').on(t.ownerId, t.createdAt),
}));

export const developerTeams = pgTable('developer_teams', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  icon: text('icon'),
  ownerId: uuid('owner_id').notNull(),
  members: jsonb('members').default([]),
  description: text('description'),
  verified: boolean('verified').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  ownerIdx: index('developer_teams_owner_id_idx').on(t.ownerId),
  ownerCreatedIdx: index('developer_teams_owner_id_created_at_idx').on(t.ownerId, t.createdAt),
}));

export const appWebhooks = pgTable('app_webhooks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  applicationId: uuid('application_id').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events').array().default([]),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  appIdx: index('app_webhooks_application_id_idx').on(t.applicationId),
  appCreatedIdx: index('app_webhooks_application_id_created_at_idx').on(t.applicationId, t.createdAt),
}));

export const appEmojis = pgTable('app_emojis', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  applicationId: uuid('application_id').notNull(),
  name: text('name').notNull(),
  image: text('image').notNull(),
  animated: boolean('animated').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  appIdx: index('app_emojis_application_id_idx').on(t.applicationId),
  appNameUnique: uniqueIndex('app_emojis_application_id_name_unique').on(t.applicationId, t.name),
}));

export const appCommands = pgTable('app_commands', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  applicationId: uuid('application_id').notNull(),
  guildId: uuid('guild_id'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  options: jsonb('options').default([]),
  defaultPermission: boolean('default_permission').default(true),
  type: integer('type').default(1),
  version: text('version').default('1'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  appIdx: index('app_commands_application_id_idx').on(t.applicationId),
  guildIdx: index('app_commands_guild_id_idx').on(t.guildId),
  appGuildNameUnique: uniqueIndex('app_commands_application_id_guild_id_name_unique').on(t.applicationId, t.guildId, t.name),
}));

export const richPresence = pgTable('rich_presence', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  type: text('type').default('other'),
  name: text('name').notNull(),
  details: text('details'),
  state: text('state'),
  largeImageUrl: text('large_image_url'),
  largeImageText: text('large_image_text'),
  smallImageUrl: text('small_image_url'),
  smallImageText: text('small_image_text'),
  startedAt: timestamp('started_at'),
  endsAt: timestamp('ends_at'),
  expiresAt: timestamp('expires_at').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('rich_presence_user_id_idx').on(t.userId),
  expiresIdx: index('rich_presence_expires_at_idx').on(t.expiresAt),
  userTypeNameUnique: uniqueIndex('rich_presence_user_id_type_name_unique').on(t.userId, t.type, t.name),
}));

export const channelWebhooks = pgTable('channel_webhooks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  channelId: uuid('channel_id').notNull(),
  serverId: uuid('server_id'),
  name: text('name').notNull(),
  avatar: text('avatar'),
  token: text('token').notNull(),
  url: text('url').notNull(),
  creatorId: uuid('creator_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  channelIdx: index('channel_webhooks_channel_id_idx').on(t.channelId),
  serverIdx: index('channel_webhooks_server_id_idx').on(t.serverId),
}));

// ─── Type Exports ─────────────────────────────────────────

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type ServerRow = typeof servers.$inferSelect;
export type ServerInsert = typeof servers.$inferInsert;
export type ChannelRow = typeof channels.$inferSelect;
export type ChannelInsert = typeof channels.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type RoleRow = typeof roles.$inferSelect;
export type RoleInsert = typeof roles.$inferInsert;
export type ServerMemberRow = typeof serverMembers.$inferSelect;
export type ServerMemberInsert = typeof serverMembers.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type InviteInsert = typeof invites.$inferInsert;
export type ServerEmojiRow = typeof serverEmojis.$inferSelect;
export type ServerEmojiInsert = typeof serverEmojis.$inferInsert;
export type ServerStickerRow = typeof serverStickers.$inferSelect;
export type ServerStickerInsert = typeof serverStickers.$inferInsert;
export type ServerBanRow = typeof serverBans.$inferSelect;
export type ServerBanInsert = typeof serverBans.$inferInsert;
export type ServerMemberApplicationRow = typeof serverMemberApplications.$inferSelect;
export type ServerMemberApplicationInsert = typeof serverMemberApplications.$inferInsert;
export type AuthorizedAppRow = typeof authorizedApps.$inferSelect;
export type AuthorizedAppInsert = typeof authorizedApps.$inferInsert;
export type UserDeviceSessionRow = typeof userDeviceSessions.$inferSelect;
export type UserDeviceSessionInsert = typeof userDeviceSessions.$inferInsert;
export type UserConnectionRow = typeof userConnections.$inferSelect;
export type UserConnectionInsert = typeof userConnections.$inferInsert;
export type DiscordUserRow = typeof discordUsers.$inferSelect;
export type DiscordUserInsert = typeof discordUsers.$inferInsert;
export type AdminLogRow = typeof adminLogs.$inferSelect;
export type AdminLogInsert = typeof adminLogs.$inferInsert;
export type PlatformSettingsRow = typeof platformSettings.$inferSelect;
export type PlatformSettingsInsert = typeof platformSettings.$inferInsert;
export type ExperimentRow = typeof experiments.$inferSelect;
export type ExperimentInsert = typeof experiments.$inferInsert;
export type InstanceRow = typeof instances.$inferSelect;
export type InstanceInsert = typeof instances.$inferInsert;
export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationInsert = typeof applications.$inferInsert;
export type DeveloperTeamRow = typeof developerTeams.$inferSelect;
export type DeveloperTeamInsert = typeof developerTeams.$inferInsert;
export type AppWebhookRow = typeof appWebhooks.$inferSelect;
export type AppWebhookInsert = typeof appWebhooks.$inferInsert;
export type AppEmojiRow = typeof appEmojis.$inferSelect;
export type AppEmojiInsert = typeof appEmojis.$inferInsert;
export type AppCommandRow = typeof appCommands.$inferSelect;
export type AppCommandInsert = typeof appCommands.$inferInsert;
export type RichPresenceRow = typeof richPresence.$inferSelect;
export type RichPresenceInsert = typeof richPresence.$inferInsert;
export type ChannelWebhookRow = typeof channelWebhooks.$inferSelect;
export type ChannelWebhookInsert = typeof channelWebhooks.$inferInsert;
