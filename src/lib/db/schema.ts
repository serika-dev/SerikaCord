import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  smallint,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  serial,
  primaryKey,
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
  // DM call log row. Added at boot by ensureCallMessageSchema() (see
  // drizzle/manual_call_messages.sql).
  'call',
  // Group DM system rows ("X added Y", "X left", "X changed the group name").
  // Added at boot by ensureGroupDmSchema() (see drizzle/manual_group_dms.sql).
  'recipient_add', 'recipient_remove', 'channel_name_change', 'channel_icon_change',
  // "X started a thread: name" row in a text channel (thread created from the
  // header, not from a message). Added at boot by ensureThreadSchema() (see
  // drizzle/manual_threads.sql).
  'thread_created',
  // "Poll results" row posted when a poll closes. Added at boot by
  // ensureMessageExtrasSchema() (see drizzle/manual_polls_forwarding.sql).
  'poll_result',
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
// A report can be either a bug report or a piece of feedback / feature request.
const bugReportKindEnum = pgEnum('bug_report_kind', ['bug', 'feedback']);
const bugReportPriorityEnum = pgEnum('bug_report_priority', ['low', 'medium', 'high', 'critical']);
const bugReportStatusEnum = pgEnum('bug_report_status', ['open', 'acknowledged', 'resolved', 'wont_fix']);
const bugReportCategoryEnum = pgEnum('bug_report_category', [
  // Bug categories
  'crash', 'visual', 'functionality', 'performance', 'security',
  'audio', 'network', 'ui_ux', 'other',
  // Feedback categories
  'feature_request', 'improvement', 'praise', 'general',
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
  emojiFavorites: jsonb('emoji_favorites').default([]),
  // Ordered list of widgets the user has placed on their profile. Built-in
  // game-library widgets carry no applicationId; app widgets reference one.
  // See docs/social-sdk-design.md §1.4.
  profileWidgets: jsonb('profile_widgets').default([]),
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
  // Threads in text channels (added at boot by ensureThreadSchema(), see
  // drizzle/manual_threads.sql): minutes of inactivity before auto-archive
  // (null = never, e.g. forum posts), when it was archived, and the channel
  // message it was started from.
  autoArchiveDuration: integer('auto_archive_duration'),
  archiveTimestamp: timestamp('archive_timestamp'),
  starterMessageId: uuid('starter_message_id'),
  recipientIds: uuid('recipient_ids').array().default([]),
  // Group DM icon (CDN URL). Added at boot by ensureGroupDmSchema().
  icon: text('icon'),
  // DM / group DM is end-to-end encrypted (one-way switch). Added at boot by
  // ensureE2eeSchema() (drizzle/manual_e2ee.sql). Null = false.
  e2ee: boolean('e2ee').default(false),
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
  suppressEmbeds: boolean('suppress_embeds').default(false),
  // Call metadata for type 'call' (CallMessageData in lib/voice/callMessage).
  // Added at boot by ensureCallMessageSchema().
  call: jsonb('call'),
  // Poll (StoredPoll) on a poll message, or the frozen outcome (PollResultData)
  // on a 'poll_result' row — see lib/chat/polls. Added at boot by
  // ensureMessageExtrasSchema().
  poll: jsonb('poll'),
  // Forwarded message copy (StoredForward in lib/chat/forward). Added at boot
  // by ensureMessageExtrasSchema().
  messageSnapshot: jsonb('message_snapshot'),
  // Discord message flags (lib/chat/messageFlags): 1<<12 = @silent. Added at
  // boot by ensureMessageFlagsSchema() (drizzle/manual_message_flags.sql).
  flags: integer('flags').notNull().default(0),
  // End-to-end encrypted envelope (lib/e2ee Envelope; content is then ''), or
  // { v: 1, notice: 'enabled' } on the "turned on encryption" system row.
  // Nullable, no default (metadata-only add on the big table). Added at boot by
  // ensureE2eeSchema() (drizzle/manual_e2ee.sql).
  e2ee: jsonb('e2ee'),
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

// One row per (poll message, voter, answer). Added at boot by
// ensureMessageExtrasSchema() (see drizzle/manual_polls_forwarding.sql).
export const pollVotes = pgTable('poll_votes', {
  messageId: uuid('message_id').notNull(),
  userId: uuid('user_id').notNull(),
  answerId: integer('answer_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('poll_votes_message_user_answer_idx').on(t.messageId, t.userId, t.answerId),
  messageAnswerIdx: index('poll_votes_message_answer_idx').on(t.messageId, t.answerId),
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

// Rules Screening (Discord "Membership Screening"): one row per server. While
// enabled, members who join get server_members.pending = true and can't talk
// until they accept the rules. Added at boot by ensureCommunitySchema()
// (src/lib/services/serverCommunity.ts, drizzle/manual_server_community.sql).
export const serverScreening = pgTable('server_screening', {
  serverId: uuid('server_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  rules: jsonb('rules').notNull().default([]),
  // Pending members only see these channels/categories (restrictChannels on).
  restrictChannels: boolean('restrict_channels').notNull().default(false),
  accessibleChannelIds: jsonb('accessible_channel_ids').notNull().default([]),
  // Submitting the rules queues a server_member_applications row to approve.
  manualApproval: boolean('manual_approval').notNull().default(false),
  questions: jsonb('questions').notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Server Onboarding + Server Guide (OnboardingConfig, src/lib/servers/onboarding.ts)
// and the owner's connections the server shows. One row per server. Added at
// boot by ensureCommunitySchema() (drizzle/manual_server_onboarding.sql).
export const serverOnboarding = pgTable('server_onboarding', {
  serverId: uuid('server_id').primaryKey(),
  config: jsonb('config').notNull().default({}),
  linkedConnectionIds: jsonb('linked_connection_ids').notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// A member's onboarding picks and Server Guide progress. rolesApplied stays
// false while rules screening still blocks them (roles would bypass it).
export const serverOnboardingResponses = pgTable('server_onboarding_responses', {
  serverId: uuid('server_id').notNull(),
  userId: uuid('user_id').notNull(),
  optionIds: jsonb('option_ids').notNull().default([]),
  completedAt: timestamp('completed_at'),
  rolesApplied: boolean('roles_applied').notNull().default(false),
  todosDone: jsonb('todos_done').notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.serverId, t.userId] }),
}));

// Accounts that belong to a server itself rather than to its owner's profile:
// a DNS-verified domain or an account linked through an OAuth sign-in made
// for the server. Survives ownership transfers; deleted with the server.
// `metadata` holds the domain challenge ({ domainVerification }) and never
// any OAuth tokens. Added at boot by ensureCommunitySchema()
// (drizzle/manual_server_owned_connections.sql).
export const serverOwnedConnections = pgTable('server_owned_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  provider: text('provider').notNull(),
  accountId: text('account_id').notNull(),
  username: text('username'),
  displayName: text('display_name'),
  avatar: text('avatar'),
  metadata: jsonb('metadata').notNull().default({}),
  verified: boolean('verified').notNull().default(false),
  visible: boolean('visible').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('server_owned_connections_server_id_idx').on(t.serverId),
  providerAccountIdx: index('server_owned_connections_provider_account_idx').on(t.provider, t.accountId),
  serverProviderAccountUnique: uniqueIndex('server_owned_connections_server_provider_account_unique').on(t.serverId, t.provider, t.accountId),
}));

// Server templates (one per server, Discord-style). `serialized` is a
// ServerSnapshot (src/lib/servers/community.ts). Added at boot by
// ensureCommunitySchema().
export const serverTemplates = pgTable('server_templates', {
  code: text('code').primaryKey(),
  serverId: uuid('server_id').notNull(),
  creatorId: uuid('creator_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  usageCount: integer('usage_count').notNull().default(0),
  serialized: jsonb('serialized').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverUnique: uniqueIndex('server_templates_server_id_unique').on(t.serverId),
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

// Badge definitions (staff-editable from the admin panel). users.badges holds
// these ids. Created + seeded idempotently at boot by ensureBadgesTable()
// (src/lib/services/badgeRegistry.ts); see also drizzle/manual_badges.sql.
// `icon` is a lucide name from BADGE_ICON_NAMES; `icon_url` (https or /path)
// overrides it. `automatic` badges are assigned by recalculateUserBadges.
export const badges = pgTable('badges', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon'),
  iconUrl: text('icon_url'),
  color: text('color').notNull().default('#8B5CF6'),
  priority: integer('priority').notNull().default(0),
  automatic: boolean('automatic').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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
  // Consent for Serika to process this Discord user's message data when it is
  // relayed from a bridged guild. One of: 'pending' | 'granted' | 'denied'.
  // Until this is 'granted' the bridge MUST NOT store or forward their messages.
  consentStatus: text('consent_status').default('pending'),
  consentUpdatedAt: timestamp('consent_updated_at'),
  // Rate-limits the "please consent" DM the bridge bot sends.
  lastConsentDmAt: timestamp('last_consent_dm_at'),
  // Tracks the last time a weekly restriction timeout was applied in a guild
  // that has enabled "restrict unconsented members".
  lastTimeoutAt: timestamp('last_timeout_at'),
  // Guild IDs where a restriction timeout is currently applied, so it can be
  // lifted when the user consents (the consent DM button fires in a DM, where
  // the originating guild is unknown).
  restrictedGuildIds: text('restricted_guild_ids').array().default([]),
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
  // Id format the bot API shows this app: 'snowflake' (Discord-style numeric
  // ids) or NULL (legacy UUIDs). Added at boot by ensureApiSnowflakeSchema()
  // (drizzle/manual_api_snowflakes.sql).
  apiIdFormat: text('api_id_format'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  ownerIdx: index('applications_owner_id_idx').on(t.ownerId),
  teamIdx: index('applications_team_id_idx').on(t.teamId),
  clientIdIdx: index('applications_client_id_idx').on(t.clientId),
  ownerCreatedIdx: index('applications_owner_id_created_at_idx').on(t.ownerId, t.createdAt),
}));

// Public snowflake ids for the bot API (src/lib/botapi/snowflakeStore.ts):
// one row per entity a snowflake-format bot has seen. Added at boot by
// ensureApiSnowflakeSchema() (drizzle/manual_api_snowflakes.sql).
export const apiSnowflakes = pgTable('api_snowflakes', {
  snowflake: bigint('snowflake', { mode: 'bigint' }).primaryKey(),
  kind: smallint('kind').notNull().default(0),
  uuid: uuid('uuid').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  uuidUnique: uniqueIndex('api_snowflakes_uuid_unique').on(t.uuid),
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
  // Serika RPC extensions (see docs/social-sdk-design.md §1.5). Nullable so the
  // existing presence path keeps working unchanged.
  applicationId: uuid('application_id'),
  assets: jsonb('assets'),
  buttons: jsonb('buttons'),
  partyId: text('party_id'),
  partySize: jsonb('party_size'),
  startedAt: timestamp('started_at'),
  endsAt: timestamp('ends_at'),
  expiresAt: timestamp('expires_at').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('rich_presence_user_id_idx').on(t.userId),
  expiresIdx: index('rich_presence_expires_at_idx').on(t.expiresAt),
  userTypeNameUnique: uniqueIndex('rich_presence_user_id_type_name_unique').on(t.userId, t.type, t.name),
}));

// Persistent log of a user's recently-played games / used apps, populated from
// rich-presence reports. Unlike `rich_presence` (which is ephemeral, TTL'd
// live state) this survives across sessions so we can show a "recent activity"
// list. Gated by the user's `privacy.storeActivityHistory` setting.
export const activityHistory = pgTable('activity_history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  type: text('type').default('game'),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  /** Cumulative seconds observed active across all sessions. */
  durationSeconds: integer('duration_seconds').default(0).notNull(),
  /** Number of distinct sessions the activity was seen in. */
  sessions: integer('sessions').default(1).notNull(),
}, (t) => ({
  userIdx: index('activity_history_user_id_idx').on(t.userId),
  lastSeenIdx: index('activity_history_last_seen_at_idx').on(t.lastSeenAt),
  userTypeNameUnique: uniqueIndex('activity_history_user_type_name_unique').on(t.userId, t.type, t.name),
}));

export type ActivityHistoryRow = typeof activityHistory.$inferSelect;
export type ActivityHistoryInsert = typeof activityHistory.$inferInsert;

// ─── Social SDK / Profile widgets (docs/social-sdk-design.md) ───────────────

// Per-user game library backing the built-in profile widgets. Category limits
// (favorite ≤1, liked ≤20, rotation ≤5, wishlist ≤20) are enforced in the
// service layer, not the DB.
export const userGames = pgTable('user_games', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  igdbId: integer('igdb_id'),
  steamAppId: text('steam_app_id'),
  name: text('name').notNull(),
  coverUrl: text('cover_url'),
  category: text('category').notNull(), // favorite | liked | rotation | wishlist
  tags: jsonb('tags').default([]),
  note: text('note'),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userIdx: index('user_games_user_id_idx').on(t.userId),
  userCategoryIdx: index('user_games_user_id_category_idx').on(t.userId, t.category),
  userCategoryIgdbUnique: uniqueIndex('user_games_user_category_igdb_unique').on(t.userId, t.category, t.igdbId),
}));

export type UserGameRow = typeof userGames.$inferSelect;
export type UserGameInsert = typeof userGames.$inferInsert;

// Application-authored widget definition (Discord "widget config"): the surface
// designs + field bindings. One published config per application.
export const widgetConfigs = pgTable('widget_configs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  applicationId: uuid('application_id').notNull(),
  name: text('name').notNull(), // display_name
  status: text('status').default('draft').notNull(), // draft | published
  // surfaces: map[surfaceType, { layout, components: map[compKey, { fields: map[fieldKey, {value_type, presentation_type, value, fallback}] }] }]
  surfaces: jsonb('surfaces').default({}),
  resolvedAssets: jsonb('resolved_assets').default([]),
  sampleData: jsonb('sample_data').default({}),
  version: integer('version').default(1).notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  applicationUnique: uniqueIndex('widget_configs_application_id_unique').on(t.applicationId),
}));

export type WidgetConfigRow = typeof widgetConfigs.$inferSelect;
export type WidgetConfigInsert = typeof widgetConfigs.$inferInsert;

// Per-user dynamic values for a widget (Discord "User Data"). `data` stores the
// { dynamic: [{ type, name, value }] } shape used by the widget renderer.
export const widgetUserData = pgTable('widget_user_data', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  applicationId: uuid('application_id').notNull(),
  userId: uuid('user_id').notNull(),
  data: jsonb('data').default({}),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  appUserUnique: uniqueIndex('widget_user_data_application_user_unique').on(t.applicationId, t.userId),
  userIdx: index('widget_user_data_user_id_idx').on(t.userId),
}));

export type WidgetUserDataRow = typeof widgetUserData.$inferSelect;
export type WidgetUserDataInsert = typeof widgetUserData.$inferInsert;

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

export const bugReports = pgTable('bug_reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  reporterId: uuid('reporter_id').notNull(),
  kind: bugReportKindEnum('kind').default('bug'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: bugReportCategoryEnum('category').default('other'),
  priority: bugReportPriorityEnum('priority').default('low'),
  status: bugReportStatusEnum('status').default('open'),
  stepsToReproduce: text('steps_to_reproduce'),
  expectedBehavior: text('expected_behavior'),
  actualBehavior: text('actual_behavior'),
  attachments: jsonb('attachments').default([]),
  browserInfo: text('browser_info'),
  osInfo: text('os_info'),
  appVersion: text('app_version'),
  assignedTo: uuid('assigned_to'),
  adminNotes: text('admin_notes'),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: uuid('resolved_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  reporterIdx: index('bug_reports_reporter_id_idx').on(t.reporterId),
  kindIdx: index('bug_reports_kind_idx').on(t.kind),
  statusIdx: index('bug_reports_status_idx').on(t.status),
  priorityIdx: index('bug_reports_priority_idx').on(t.priority),
  categoryIdx: index('bug_reports_category_idx').on(t.category),
  createdIdx: index('bug_reports_created_at_idx').on(t.createdAt),
  priorityCreatedIdx: index('bug_reports_priority_created_at_idx').on(t.priority, t.createdAt),
}));

// Per-user, per-channel read markers. One row per (user, channel). Drives
// cross-device unread/mention state for both DMs and server channels — the
// authoritative source the localStorage cache is reconciled against.
export const channelReadStates = pgTable('channel_read_states', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  lastReadMessageId: uuid('last_read_message_id'),
  // createdAt of the last read message (or ack time) — used for unread/mention
  // counting without a clock-skew-sensitive "now" comparison.
  lastReadAt: timestamp('last_read_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  userChannelUnique: uniqueIndex('channel_read_states_user_channel_unique').on(t.userId, t.channelId),
  userIdx: index('channel_read_states_user_id_idx').on(t.userId),
}));

// Per-user notification settings for servers, channels, categories and DMs
// (level, mute-until, @everyone / role suppression), one JSON document per
// user — see src/lib/notifications/levels.ts for the shape. Added at boot by
// ensureNotificationSettingsSchema() (mirrors
// drizzle/manual_user_notification_settings.sql).
export const userNotificationSettings = pgTable('user_notification_settings', {
  userId: uuid('user_id').primaryKey(),
  settings: jsonb('settings').notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Mobile push devices (FCM registration tokens from the Capacitor app). One
// row per token; a token that signs in as someone else moves to that user.
// Added at boot by ensurePushSchema() (mirrors drizzle/manual_push_devices.sql).
export const pushDevices = pgTable('push_devices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  token: text('token').notNull(),
  platform: text('platform').notNull().default('android'),
  // The E2EE notification key this phone holds (e2ee_notify_keys.id): encrypted
  // DM pushes carry that key's wrap entry so the app can show the real text.
  // ensurePushSchema() / drizzle/manual_e2ee_notify.sql.
  e2eeNotifyId: text('e2ee_notify_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  tokenUnique: uniqueIndex('push_devices_token_unique').on(t.token),
  userIdx: index('push_devices_user_id_idx').on(t.userId),
}));

// Blind search index for message content (which is encrypted at rest). One row
// per message: `terms` holds short keyed hashes (HMAC) of the normalized words
// and word prefixes, never plaintext; `flags` carries content-derived `has:`
// bits (link / image URL / ...). Written on send/edit, removed on delete, and
// backfilled for old history. Added at boot by ensureMessageSearchSchema()
// (mirrors drizzle/manual_message_search_index.sql). See
// src/lib/services/messageSearch.ts.
export const messageSearchIndex = pgTable('message_search_index', {
  messageId: uuid('message_id').primaryKey(),
  channelId: uuid('channel_id').notNull(),
  terms: text('terms').array().notNull().default([]),
  flags: integer('flags').notNull().default(0),
  version: integer('version').notNull().default(1),
  indexedAt: timestamp('indexed_at').defaultNow(),
}, (t) => ({
  termsGinIdx: index('message_search_index_terms_gin_idx').using('gin', t.terms),
  channelIdx: index('message_search_index_channel_id_idx').on(t.channelId),
}));

// Private notes one user keeps about another ("Note — only visible to you").
// Added at boot by ensureUserNotesSchema() (mirrors
// drizzle/manual_user_notes_message_requests.sql).
export const userNotes = pgTable('user_notes', {
  ownerId: uuid('owner_id').notNull(),
  targetId: uuid('target_id').notNull(),
  note: text('note').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ownerId, t.targetId] }),
}));

// Server scheduled events (Discord "Events"). entity_type: voice | stage |
// external; status: scheduled | active | completed | canceled (lib/chat/
// scheduledEvents). Added at boot by ensureScheduledEventSchema() (mirrors
// drizzle/manual_scheduled_events_announcements.sql).
export const serverScheduledEvents = pgTable('server_scheduled_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  creatorId: uuid('creator_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  entityType: text('entity_type').notNull().default('voice'),
  channelId: uuid('channel_id'),
  location: text('location'),
  image: text('image'),
  status: text('status').notNull().default('scheduled'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at'),
  startedAt: timestamp('started_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverStatusIdx: index('server_scheduled_events_server_status_idx').on(t.serverId, t.status),
  statusStartIdx: index('server_scheduled_events_status_start_idx').on(t.status, t.startAt),
}));

// "Interested" users of a scheduled event. Same boot ensure as above.
export const serverScheduledEventUsers = pgTable('server_scheduled_event_users', {
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.eventId, t.userId] }),
  userIdx: index('server_scheduled_event_users_user_idx').on(t.userId),
}));

// Announcement channel follows: published messages from source_channel_id are
// posted into target_channel_id by webhook_id ("Server #channel"). Same boot
// ensure as above.
export const channelFollows = pgTable('channel_follows', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sourceChannelId: uuid('source_channel_id').notNull(),
  sourceServerId: uuid('source_server_id').notNull(),
  targetChannelId: uuid('target_channel_id').notNull(),
  targetServerId: uuid('target_server_id').notNull(),
  webhookId: uuid('webhook_id').notNull(),
  creatorId: uuid('creator_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  sourceTargetIdx: uniqueIndex('channel_follows_source_target_idx').on(t.sourceChannelId, t.targetChannelId),
  targetIdx: index('channel_follows_target_idx').on(t.targetChannelId),
}));

// DM Message Requests: one row per (1:1 DM channel, recipient) with status
// pending | accepted | ignored. Added at boot by ensureMessageRequestSchema()
// (mirrors drizzle/manual_user_notes_message_requests.sql).
export const dmMessageRequests = pgTable('dm_message_requests', {
  channelId: uuid('channel_id').notNull(),
  userId: uuid('user_id').notNull(),
  requesterId: uuid('requester_id').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.userId] }),
  userStatusIdx: index('dm_message_requests_user_status_idx').on(t.userId, t.status),
}));

// Server audit log (Discord-style). One row per moderation / settings action;
// `action_type` uses Discord's AuditLogEvent numbers (src/lib/audit/auditLog.ts)
// and `changes` holds [{ key, old, new }]. Added at boot by
// ensureAuditLogSchema() (mirrors drizzle/manual_server_audit_logs.sql).
export const serverAuditLogs = pgTable('server_audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  userId: uuid('user_id'),
  actionType: integer('action_type').notNull(),
  targetId: text('target_id'),
  changes: jsonb('changes').default([]),
  options: jsonb('options'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  serverCreatedIdx: index('server_audit_logs_server_created_idx').on(t.serverId, t.createdAt),
  serverActionIdx: index('server_audit_logs_server_action_idx').on(t.serverId, t.actionType, t.createdAt),
  serverUserIdx: index('server_audit_logs_server_user_idx').on(t.serverId, t.userId, t.createdAt),
}));

// AutoMod rules (Discord-style). trigger_type: keyword | spam | mention_spam |
// links; trigger_metadata / actions hold the shapes in src/lib/automod/rules.ts.
// Added at boot by ensureAutoModSchema() (mirrors drizzle/manual_automod_rules.sql).
export const automodRules = pgTable('automod_rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serverId: uuid('server_id').notNull(),
  name: text('name').notNull(),
  creatorId: uuid('creator_id'),
  enabled: boolean('enabled').notNull().default(true),
  triggerType: text('trigger_type').notNull(),
  triggerMetadata: jsonb('trigger_metadata').default({}),
  actions: jsonb('actions').default([]),
  exemptRoles: jsonb('exempt_roles').default([]),
  exemptChannels: jsonb('exempt_channels').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  serverIdx: index('automod_rules_server_idx').on(t.serverId, t.createdAt),
}));

// ─── Type Exports ─────────────────────────────────────────

export type ChannelReadStateRow = typeof channelReadStates.$inferSelect;
export type ChannelReadStateInsert = typeof channelReadStates.$inferInsert;
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
export type ServerAuditLogRow = typeof serverAuditLogs.$inferSelect;
export type ServerAuditLogInsert = typeof serverAuditLogs.$inferInsert;
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
export type BugReportRow = typeof bugReports.$inferSelect;
export type BugReportInsert = typeof bugReports.$inferInsert;

export { staffRoles, staffRoleAssignments } from './staffSchema';

export { changelogAnnouncements, changelogReceipts } from './changelogSchema';

// ─── Trust & Safety (drizzle/manual_trust_safety.sql, ensureTrustSafetySchema) ─
// Account strikes, temporary restrictions, automated safety incidents
// (PhotoDNA / scam-image matches), appeals and the scam image hash list.
export const accountStrikes = pgTable('account_strikes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  category: text('category').notNull().default('other'),
  reason: text('reason').notNull(),
  source: text('source').notNull().default('staff'),
  issuedBy: uuid('issued_by'),
  incidentId: uuid('incident_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  revokedBy: uuid('revoked_by'),
  revokeReason: text('revoke_reason'),
}, (t) => ({
  userIdx: index('account_strikes_user_id_idx').on(t.userId),
}));

export const accountRestrictions = pgTable('account_restrictions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull().default('chat'),
  reason: text('reason').notNull(),
  source: text('source').notNull().default('staff'),
  issuedBy: uuid('issued_by'),
  incidentId: uuid('incident_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  until: timestamp('until').notNull(),
  liftedAt: timestamp('lifted_at'),
  liftedBy: uuid('lifted_by'),
}, (t) => ({
  userIdx: index('account_restrictions_user_id_idx').on(t.userId),
}));

export const safetyIncidents = pgTable('safety_incidents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('open'),
  isTest: boolean('is_test').notNull().default(false),
  details: jsonb('details').notNull().default({}),
  fileName: text('file_name'),
  contentType: text('content_type'),
  fileSize: integer('file_size'),
  sha256: text('sha256'),
  uploadCategory: text('upload_category'),
  channelId: uuid('channel_id'),
  ip: text('ip'),
  hashId: uuid('hash_id'),
  actionTaken: text('action_taken'),
  notes: text('notes'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  ncmecReportedAt: timestamp('ncmec_reported_at'),
  ncmecReportId: text('ncmec_report_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('safety_incidents_user_id_idx').on(t.userId),
  statusIdx: index('safety_incidents_status_idx').on(t.status, t.createdAt),
}));

export const accountAppeals = pgTable('account_appeals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id'),
  message: text('message').notNull(),
  status: text('status').notNull().default('open'),
  staffNote: text('staff_note'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('account_appeals_user_id_idx').on(t.userId),
  statusIdx: index('account_appeals_status_idx').on(t.status, t.createdAt),
}));

export const scamImageHashes = pgTable('scam_image_hashes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  hash: text('hash').notNull(),
  label: text('label').notNull(),
  maxDistance: integer('max_distance').notNull().default(6),
  addedBy: uuid('added_by'),
  matchCount: integer('match_count').notNull().default(0),
  lastMatchedAt: timestamp('last_matched_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  hashUnique: uniqueIndex('scam_image_hashes_hash_unique').on(t.hash),
}));

// ─── Message reports (drizzle/manual_message_reports.sql, ensureMessageReportsSchema) ─
// "Report Message" submissions, one row per report (duplicates of a message
// are grouped in the staff queue). `content` is the reported version: the
// stored text for ordinary messages, the franking-verified plaintext for
// end-to-end encrypted ones. details / content / staff_note are encrypted at
// rest (fieldEncryption), attachments / attachment_notes as sealed JSON.
export const messageReports = pgTable('message_reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  messageId: uuid('message_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  serverId: uuid('server_id'),
  channelType: text('channel_type'),
  channelName: text('channel_name'),
  reporterId: uuid('reporter_id').notNull(),
  reportedUserId: uuid('reported_user_id').notNull(),
  category: text('category').notNull().default('other'),
  details: text('details'),
  content: text('content'),
  attachments: jsonb('attachments').notNull().default([]),
  attachmentNotes: jsonb('attachment_notes').notNull().default([]),
  encrypted: boolean('encrypted').notNull().default(false),
  frankingVerified: boolean('franking_verified').notNull().default(false),
  messageSentAt: timestamp('message_sent_at'),
  status: text('status').notNull().default('open'),
  staffNote: text('staff_note'),
  actions: jsonb('actions').notNull().default([]),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  reporterNotifiedAt: timestamp('reporter_notified_at'),
  legacyBugReportId: uuid('legacy_bug_report_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('message_reports_status_idx').on(t.status, t.createdAt),
  messageIdx: index('message_reports_message_id_idx').on(t.messageId),
  reporterIdx: index('message_reports_reporter_id_idx').on(t.reporterId),
  reportedIdx: index('message_reports_reported_user_id_idx').on(t.reportedUserId),
  legacyUnique: uniqueIndex('message_reports_legacy_bug_report_unique').on(t.legacyBugReportId),
}));

// ─── End-to-end encryption (drizzle/manual_e2ee.sql, ensureE2eeSchema) ───────
// Public keys only, plus the passphrase-sealed key backup. See
// docs/architecture/e2ee.md.
export const e2eeIdentities = pgTable('e2ee_identities', {
  userId: uuid('user_id').primaryKey(),
  identityPub: text('identity_pub').notNull(),
  backupPub: text('backup_pub').notNull(),
  // Identity-key signature over the backup key (clients only wrap to a backup
  // key that verifies).
  backupSig: text('backup_sig').notNull(),
  backupBlob: text('backup_blob'),
  backupSalt: text('backup_salt'),
  backupIters: integer('backup_iters'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Revoked devices are kept (revoked_at set) so signatures on messages they
// sent can still be verified (history, franking reports).
export const e2eeDevices = pgTable('e2ee_devices', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  ecdhPub: text('ecdh_pub').notNull(),
  signPub: text('sign_pub').notNull(),
  deviceSig: text('device_sig').notNull(),
  // The identity key that signed device_sig (changes on "Reset encryption").
  identityPub: text('identity_pub').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow(),
  lastSeenAt: timestamp('last_seen_at').defaultNow(),
  revokedAt: timestamp('revoked_at'),
}, (t) => ({
  userIdx: index('e2ee_devices_user_id_idx').on(t.userId),
}));

// Envelopes replaced by edits of encrypted messages, so a franking report can
// name (by signature) the version the reporter saw. Capped per message by the
// app. ensureE2eeSchema() / drizzle/manual_e2ee.sql.
// Notification keys (one per Android install / E2EE device): an ECDH key whose
// private half lives only in the app's native storage, signed by the owning
// device's signing key. Senders wrap message keys to it too, so pushes can
// carry a preview only that phone can decrypt. Revoked rows are kept.
// ensureE2eeSchema() / drizzle/manual_e2ee_notify.sql.
export const e2eeNotifyKeys = pgTable('e2ee_notify_keys', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  ecdhPub: text('ecdh_pub').notNull(),
  sig: text('sig').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  revokedAt: timestamp('revoked_at'),
}, (t) => ({
  userIdx: index('e2ee_notify_keys_user_id_idx').on(t.userId),
}));

// 6-digit PIN key backup (lib/e2ee/pin.ts, pinVault.ts; drizzle/manual_e2ee_pin.sql,
// ensureE2eeSchema). The bundle needs the PIN AND the server secret S; S and
// the verifier are only stored in pepper-protected form (E2EE_PIN_PEPPER is
// an environment secret, never in the database). One row per user; a wiped
// backup (too many wrong PINs, reset, removal) keeps the row with NULLs.
export const e2eePinBackups = pgTable('e2ee_pin_backups', {
  userId: uuid('user_id').primaryKey(),
  // The identity key the bundle belongs to (a reset invalidates it).
  identityPub: text('identity_pub'),
  salt: text('salt'),
  iterations: integer('iterations'),
  bundle: text('bundle'),
  verifierHash: text('verifier_hash'),
  secretEnc: text('secret_enc'),
  // Secret handed out by /pin/begin, waiting for /pin/commit (short TTL).
  pendingSecretEnc: text('pending_secret_enc'),
  pendingExpiresAt: timestamp('pending_expires_at'),
  attempts: integer('attempts').notNull().default(0),
  lockedAt: timestamp('locked_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Per-conversation "encryption turned off" state (lib/e2ee/conversationState.ts):
// the member-signed record clients verify before accepting plaintext there.
// state = 'off' (record set) or 'on' (turned on again; record kept for history).
export const e2eeConversationStates = pgTable('e2ee_conversation_states', {
  channelId: uuid('channel_id').primaryKey(),
  state: text('state').notNull(),
  record: jsonb('record'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const e2eeEnvelopeHistory = pgTable('e2ee_envelope_history', {
  messageId: uuid('message_id').notNull(),
  sig: text('sig').notNull(),
  envelope: jsonb('envelope').notNull(),
  replacedAt: timestamp('replaced_at').defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.sig] }),
}));

