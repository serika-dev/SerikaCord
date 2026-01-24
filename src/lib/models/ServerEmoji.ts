import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IServerEmoji extends Document {
  _id: Types.ObjectId;
  serverId: Types.ObjectId;
  name: string;
  imageUrl: string;
  animated: boolean;
  available: boolean;
  managed: boolean;
  requireColons: boolean;
  roles: Types.ObjectId[]; // Roles that can use this emoji
  uploadedBy: Types.ObjectId;
  
  createdAt: Date;
  updatedAt: Date;
}

const ServerEmojiSchema = new Schema<IServerEmoji>({
  serverId: {
    type: Schema.Types.ObjectId,
    ref: 'Server',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 32,
    match: /^[a-zA-Z0-9_]+$/,
  },
  imageUrl: {
    type: String,
    required: true,
  },
  animated: {
    type: Boolean,
    default: false,
  },
  available: {
    type: Boolean,
    default: true,
  },
  managed: {
    type: Boolean,
    default: false,
  },
  requireColons: {
    type: Boolean,
    default: true,
  },
  roles: [{
    type: Schema.Types.ObjectId,
    ref: 'Role',
  }],
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Compound index
ServerEmojiSchema.index({ serverId: 1, name: 1 }, { unique: true });

export const ServerEmoji = mongoose.models.ServerEmoji || mongoose.model<IServerEmoji>('ServerEmoji', ServerEmojiSchema);
