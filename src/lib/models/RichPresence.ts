/**
 * Rich Presence — game / application statuses reported by the SerikaCord desktop
 * app. Stored per-user+activity with a short TTL (cleared when the app goes offline).
 * Multiple active activities are allowed per user.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRichPresence extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  name: string;
  details?: string | null;
  state?: string | null;
  largeImageUrl?: string | null;
  largeImageText?: string | null;
  smallImageUrl?: string | null;
  smallImageText?: string | null;
  startedAt?: Date | null;
  endsAt?: Date | null;
  expiresAt: Date;
  updatedAt: Date;
}

const RichPresenceSchema = new Schema<IRichPresence>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, default: 'other', trim: true },
  name: { type: String, required: true, trim: true },
  details: { type: String, default: null },
  state: { type: String, default: null },
  largeImageUrl: { type: String, default: null },
  largeImageText: { type: String, default: null },
  smallImageUrl: { type: String, default: null },
  smallImageText: { type: String, default: null },
  startedAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, {
  timestamps: { createdAt: false, updatedAt: true },
});

RichPresenceSchema.index({ userId: 1, type: 1, name: 1 }, { unique: true });

export const RichPresence = mongoose.models.RichPresence || mongoose.model<IRichPresence>('RichPresence', RichPresenceSchema);
