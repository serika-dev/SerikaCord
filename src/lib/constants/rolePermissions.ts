import { PERMISSION_BITS } from "@/lib/permissions/bits";

export interface RolePermissionDefinition {
  key: string;
  label: string;
  description: string;
  bit: bigint;
}

export interface RolePermissionCategory {
  id: string;
  label: string;
  permissions: RolePermissionDefinition[];
}

export const ROLE_PERMISSION_CATEGORIES: RolePermissionCategory[] = [
  {
    id: "general",
    label: "General Server Permissions",
    permissions: [
      {
        key: "view_channels",
        label: "View Channels",
        description: "Allows members to view channels by default (excluding private channels).",
        bit: PERMISSION_BITS.VIEW_CHANNEL,
      },
      {
        key: "manage_channels",
        label: "Manage Channels",
        description: "Allows members to create, edit, or delete channels.",
        bit: PERMISSION_BITS.MANAGE_CHANNELS,
      },
      {
        key: "manage_roles",
        label: "Manage Roles",
        description:
          "Allows members to create new roles and edit or delete roles lower than their highest role. Also allows changing permissions of individual channels they have access to.",
        bit: PERMISSION_BITS.MANAGE_ROLES,
      },
      {
        key: "create_expressions",
        label: "Create Expressions",
        description: "Allows members to add custom emoji, stickers, and sounds in this server.",
        bit: PERMISSION_BITS.CREATE_EXPRESSIONS,
      },
      {
        key: "manage_expressions",
        label: "Manage Expressions",
        description: "Allows members to edit or remove custom emoji, stickers, and sounds in this server.",
        bit: PERMISSION_BITS.MANAGE_EMOJIS_AND_STICKERS,
      },
      {
        key: "view_audit_log",
        label: "View Audit Log",
        description: "Allows members to view a record of who made which changes in this server.",
        bit: PERMISSION_BITS.VIEW_AUDIT_LOG,
      },
      {
        key: "view_server_insights",
        label: "View Server Insights",
        description: "Allows members to view Server Insights, which shows data on community growth and engagement.",
        bit: PERMISSION_BITS.VIEW_SERVER_INSIGHTS,
      },
      {
        key: "manage_webhooks",
        label: "Manage Webhooks",
        description: "Allows members to create, edit, or delete webhooks.",
        bit: PERMISSION_BITS.MANAGE_WEBHOOKS,
      },
      {
        key: "manage_server",
        label: "Manage Server",
        description:
          "Allow members to change this server's name, view all invites, add apps, and create or update AutoMod rules.",
        bit: PERMISSION_BITS.MANAGE_SERVER,
      },
    ],
  },
  {
    id: "membership",
    label: "Membership Permissions",
    permissions: [
      {
        key: "create_invite",
        label: "Create Invite",
        description: "Allows members to invite new people to this server.",
        bit: PERMISSION_BITS.CREATE_INVITE,
      },
      {
        key: "change_nickname",
        label: "Change Nickname",
        description: "Allows members to change their own nickname, a custom name for just this server.",
        bit: PERMISSION_BITS.CHANGE_NICKNAME,
      },
      {
        key: "manage_nicknames",
        label: "Manage Nicknames",
        description: "Allows members to change the nicknames of other members.",
        bit: PERMISSION_BITS.MANAGE_NICKNAMES,
      },
      {
        key: "kick_members",
        label: "Kick Members",
        description: "Allows members to remove other members from this server. Kicked members can rejoin with a new invite.",
        bit: PERMISSION_BITS.KICK_MEMBERS,
      },
      {
        key: "ban_members",
        label: "Ban Members",
        description: "Allows members to permanently ban and delete the message history of other members.",
        bit: PERMISSION_BITS.BAN_MEMBERS,
      },
      {
        key: "moderate_members",
        label: "Timeout Members",
        description:
          "When a user is in timeout they cannot send messages, reply in threads, react, or speak in voice channels.",
        bit: PERMISSION_BITS.MODERATE_MEMBERS,
      },
    ],
  },
  {
    id: "text",
    label: "Text Channel Permissions",
    permissions: [
      {
        key: "send_messages",
        label: "Send Messages and Create Posts",
        description: "Allow members to send messages in text channels and create posts in forum channels.",
        bit: PERMISSION_BITS.SEND_MESSAGES,
      },
      {
        key: "send_messages_in_threads",
        label: "Send Messages in Threads and Posts",
        description: "Allow members to send messages in threads and in posts on forum channels.",
        bit: PERMISSION_BITS.SEND_MESSAGES_IN_THREADS,
      },
      {
        key: "create_public_threads",
        label: "Create Public Threads",
        description: "Allow members to create threads that everyone in a channel can view.",
        bit: PERMISSION_BITS.CREATE_PUBLIC_THREADS,
      },
      {
        key: "create_private_threads",
        label: "Create Private Threads",
        description: "Allow members to create invite-only threads.",
        bit: PERMISSION_BITS.CREATE_PRIVATE_THREADS,
      },
      {
        key: "embed_links",
        label: "Embed Links",
        description: "Allows links that members share to show embedded content in text channels.",
        bit: PERMISSION_BITS.EMBED_LINKS,
      },
      {
        key: "attach_files",
        label: "Attach Files",
        description: "Allows members to upload files or media in text channels.",
        bit: PERMISSION_BITS.ATTACH_FILES,
      },
      {
        key: "add_reactions",
        label: "Add Reactions",
        description: "Allows members to add new emoji reactions to a message.",
        bit: PERMISSION_BITS.ADD_REACTIONS,
      },
      {
        key: "use_external_emojis",
        label: "Use External Emoji",
        description: "Allows members to use emoji from other servers.",
        bit: PERMISSION_BITS.USE_EXTERNAL_EMOJIS,
      },
      {
        key: "use_external_stickers",
        label: "Use External Stickers",
        description: "Allows members to use stickers from other servers.",
        bit: PERMISSION_BITS.USE_EXTERNAL_STICKERS,
      },
      {
        key: "mention_everyone",
        label: "Mention @everyone, @here, and All Roles",
        description: "Allows members to use @everyone and @here, and to mention all roles.",
        bit: PERMISSION_BITS.MENTION_EVERYONE,
      },
      {
        key: "manage_messages",
        label: "Manage Messages",
        description: "Allows members to delete or remove embeds from messages by other members.",
        bit: PERMISSION_BITS.MANAGE_MESSAGES,
      },
      {
        key: "pin_messages",
        label: "Pin Messages",
        description: "Allows members to pin or unpin any message.",
        bit: PERMISSION_BITS.PIN_MESSAGES,
      },
      {
        key: "manage_threads",
        label: "Manage Threads and Posts",
        description:
          "Allows members to rename, delete, close, and turn on slow mode for threads and posts. They can also view private threads.",
        bit: PERMISSION_BITS.MANAGE_THREADS,
      },
      {
        key: "read_message_history",
        label: "Read Message History",
        description: "Allows members to read previous messages sent in channels.",
        bit: PERMISSION_BITS.READ_MESSAGE_HISTORY,
      },
      {
        key: "send_tts_messages",
        label: "Send Text-to-Speech Messages",
        description: "Allows members to send text-to-speech messages by starting a message with /tts.",
        bit: PERMISSION_BITS.SEND_TTS_MESSAGES,
      },
      {
        key: "send_voice_messages",
        label: "Send Voice Messages",
        description: "Allows members to send voice messages.",
        bit: PERMISSION_BITS.SEND_VOICE_MESSAGES,
      },
      {
        key: "send_polls",
        label: "Create Polls",
        description: "Allows members to create polls.",
        bit: PERMISSION_BITS.SEND_POLLS,
      },
    ],
  },
  {
    id: "voice",
    label: "Voice Channel Permissions",
    permissions: [
      {
        key: "connect",
        label: "Connect",
        description: "Allows members to join voice channels and hear others.",
        bit: PERMISSION_BITS.CONNECT,
      },
      {
        key: "speak",
        label: "Speak",
        description: "Allows members to talk in voice channels.",
        bit: PERMISSION_BITS.SPEAK,
      },
      {
        key: "video",
        label: "Video",
        description: "Allows members to share their video, screen share, or stream a game in this server.",
        bit: PERMISSION_BITS.VIDEO,
      },
      {
        key: "use_soundboard",
        label: "Use Soundboard",
        description: "Allows members to send sounds from the server soundboard.",
        bit: PERMISSION_BITS.USE_SOUNDBOARD,
      },
      {
        key: "use_external_sounds",
        label: "Use External Sounds",
        description: "Allows members to use sounds from other servers.",
        bit: PERMISSION_BITS.USE_EXTERNAL_SOUNDS,
      },
      {
        key: "use_voice_activity",
        label: "Use Voice Activity",
        description: "Allows members to speak in voice channels by simply talking.",
        bit: PERMISSION_BITS.USE_VOICE_ACTIVITY,
      },
      {
        key: "priority_speaker",
        label: "Priority Speaker",
        description: "Allows members to be more easily heard in voice channels.",
        bit: PERMISSION_BITS.PRIORITY_SPEAKER,
      },
      {
        key: "mute_members",
        label: "Mute Members",
        description: "Allows members to mute other members in voice channels for everyone.",
        bit: PERMISSION_BITS.MUTE_MEMBERS,
      },
      {
        key: "deafen_members",
        label: "Deafen Members",
        description: "Allows members to deafen other members in voice channels.",
        bit: PERMISSION_BITS.DEAFEN_MEMBERS,
      },
      {
        key: "move_members",
        label: "Move Members",
        description: "Allows members to disconnect or move other members between voice channels.",
        bit: PERMISSION_BITS.MOVE_MEMBERS,
      },
      {
        key: "set_voice_channel_status",
        label: "Set Voice Channel Status",
        description: "Allows members to create and edit voice channel status.",
        bit: PERMISSION_BITS.SET_VOICE_CHANNEL_STATUS,
      },
    ],
  },
  {
    id: "apps",
    label: "Apps Permissions",
    permissions: [
      {
        key: "use_application_commands",
        label: "Use Application Commands",
        description: "Allows members to use commands from applications, including slash commands and context menu commands.",
        bit: PERMISSION_BITS.USE_APPLICATION_COMMANDS,
      },
      {
        key: "use_embedded_activities",
        label: "Use Activities",
        description: "Allows members to use Activities.",
        bit: PERMISSION_BITS.USE_EMBEDDED_ACTIVITIES,
      },
      {
        key: "use_external_apps",
        label: "Use External Apps",
        description: "Allows apps that members have added to their account to post messages.",
        bit: PERMISSION_BITS.USE_EXTERNAL_APPS,
      },
    ],
  },
  {
    id: "stage",
    label: "Stage Channel Permissions",
    permissions: [
      {
        key: "request_to_speak",
        label: "Request to Speak",
        description: "Allow requests to speak in Stage channels.",
        bit: PERMISSION_BITS.REQUEST_TO_SPEAK,
      },
    ],
  },
  {
    id: "events",
    label: "Events Permissions",
    permissions: [
      {
        key: "create_events",
        label: "Create Events",
        description: "Allows members to create events.",
        bit: PERMISSION_BITS.CREATE_EVENTS,
      },
      {
        key: "manage_events",
        label: "Manage Events",
        description: "Allows members to edit and cancel events.",
        bit: PERMISSION_BITS.MANAGE_EVENTS,
      },
    ],
  },
  {
    id: "advanced",
    label: "Advanced Permissions",
    permissions: [
      {
        key: "administrator",
        label: "Administrator",
        description:
          "Members with this permission have every permission and bypass all channel-specific restrictions. This is a dangerous permission to grant.",
        bit: PERMISSION_BITS.ADMINISTRATOR,
      },
    ],
  },
];
