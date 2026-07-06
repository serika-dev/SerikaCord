import mongoose, { Schema, Document, Types } from 'mongoose';

export type ConnectionProvider =
  | 'discord' | 'twitch' | 'youtube' | 'github' | 'spotify' | 'website'
  | 'lastfm' | 'steam' | 'xbox' | 'psn' | 'roblox'
  | 'twitter' | 'instagram' | 'battlenet';

export interface IUserConnection extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  provider: ConnectionProvider;
  accountId: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const UserConnectionSchema = new Schema<IUserConnection>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    enum: [
      'discord', 'twitch', 'youtube', 'github', 'spotify', 'website',
      'lastfm', 'steam', 'xbox', 'psn', 'roblox',
      'twitter', 'instagram', 'battlenet',
    ],
    required: true,
    index: true,
  },
  accountId: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    default: null,
  },
  displayName: {
    type: String,
    default: null,
  },
  avatar: {
    type: String,
    default: null,
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: null,
  },
}, {
  timestamps: true,
});

UserConnectionSchema.index({ userId: 1, provider: 1, accountId: 1 }, { unique: true });

export const UserConnection = mongoose.models.UserConnection || mongoose.model<IUserConnection>('UserConnection', UserConnectionSchema);
