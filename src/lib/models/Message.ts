import mongoose, { Schema, Document, Types } from 'mongoose';

export type MessageType = 
  | 'default'
  | 'reply'
  | 'system'
  | 'member_join'
  | 'member_leave'
  | 'channel_pinned_message'
  | 'user_premium_guild_subscription';

export interface IAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  proxyUrl?: string;
  width?: number;
  height?: number;
  duration?: number; // For audio/video
  waveform?: string; // For voice messages
}

export interface IEmbed {
  title?: string;
  type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link';
  description?: string;
  url?: string;
  timestamp?: Date;
  color?: number;
  footer?: {
    text: string;
    iconUrl?: string;
  };
  image?: {
    url: string;
    width?: number;
    height?: number;
  };
  thumbnail?: {
    url: string;
    width?: number;
    height?: number;
  };
  video?: {
    url: string;
    width?: number;
    height?: number;
  };
  provider?: {
    name?: string;
    url?: string;
  };
  author?: {
    name: string;
    url?: string;
    iconUrl?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

export interface ISticker {
  id: string;
  name: string;
  imageUrl: string;
  serverId?: string;
  serverName?: string;
}

export interface IReaction {
  emoji: {
    id?: string;
    name: string;
    animated?: boolean;
  };
  count: number;
  userIds: Types.ObjectId[];
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  channelId: Types.ObjectId;
  serverId?: Types.ObjectId;
  authorId: Types.ObjectId;
  
  content: string;
  type: MessageType;
  
  // Reply reference
  referencedMessageId?: Types.ObjectId;
  
  // Attachments, embeds & sticker
  attachments: IAttachment[];
  embeds: IEmbed[];
  sticker?: ISticker;
  
  // Mentions
  mentionEveryone: boolean;
  mentionedUserIds: Types.ObjectId[];
  mentionedRoleIds: Types.ObjectId[];
  mentionedChannelIds: Types.ObjectId[];
  
  // Reactions
  reactions: IReaction[];
  
  // Flags
  pinned: boolean;
  edited: boolean;
  editedTimestamp?: Date;
  
  // Thread
  threadId?: Types.ObjectId;
  
  // Deletion
  isDeleted: boolean;
  deletedAt?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IAttachment>({
  id: { type: String, required: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  url: { type: String, required: true },
  proxyUrl: String,
  width: Number,
  height: Number,
  duration: Number,
  waveform: String,
}, { _id: false });

const StickerSchema = new Schema<ISticker>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  imageUrl: { type: String, required: true },
  serverId: String,
  serverName: String,
}, { _id: false });

const EmbedSchema = new Schema<IEmbed>({
  title: String,
  type: {
    type: String,
    enum: ['rich', 'image', 'video', 'gifv', 'article', 'link'],
    default: 'rich',
  },
  description: String,
  url: String,
  timestamp: Date,
  color: Number,
  footer: {
    text: String,
    iconUrl: String,
  },
  image: {
    url: String,
    width: Number,
    height: Number,
  },
  thumbnail: {
    url: String,
    width: Number,
    height: Number,
  },
  video: {
    url: String,
    width: Number,
    height: Number,
  },
  provider: {
    name: String,
    url: String,
  },
  author: {
    name: String,
    url: String,
    iconUrl: String,
  },
  fields: [{
    name: String,
    value: String,
    inline: Boolean,
  }],
}, { _id: false });

const ReactionSchema = new Schema<IReaction>({
  emoji: {
    id: String,
    name: { type: String, required: true },
    animated: Boolean,
    url: String, // CDN URL for custom emoji reactions
  },
  count: { type: Number, default: 1 },
  userIds: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
}, { _id: false });

const MessageSchema = new Schema<IMessage>({
  channelId: {
    type: Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true,
  },
  serverId: {
    type: Schema.Types.ObjectId,
    ref: 'Server',
    index: true,
  },
  authorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  content: {
    type: String,
    maxlength: 16384,
    default: '',
  },
  type: {
    type: String,
    enum: ['default', 'reply', 'system', 'member_join', 'member_leave', 'channel_pinned_message', 'user_premium_guild_subscription'],
    default: 'default',
  },
  referencedMessageId: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
  },
  attachments: [AttachmentSchema],
  embeds: [EmbedSchema],
  sticker: StickerSchema,
  mentionEveryone: {
    type: Boolean,
    default: false,
  },
  mentionedUserIds: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  mentionedRoleIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Role',
  }],
  mentionedChannelIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Channel',
  }],
  reactions: [ReactionSchema],
  pinned: {
    type: Boolean,
    default: false,
  },
  edited: {
    type: Boolean,
    default: false,
  },
  editedTimestamp: Date,
  threadId: {
    type: Schema.Types.ObjectId,
    ref: 'Channel',
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: Date,
}, {
  timestamps: true,
});

// Indexes for efficient queries
MessageSchema.index({ channelId: 1, createdAt: -1 });
MessageSchema.index({ serverId: 1, createdAt: -1 });
MessageSchema.index({ authorId: 1, createdAt: -1 });
MessageSchema.index({ channelId: 1, pinned: 1 });
MessageSchema.index({ channelId: 1, isDeleted: 1, createdAt: -1 });

// Text search index
MessageSchema.index({ content: 'text' });

export const Message = mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);
