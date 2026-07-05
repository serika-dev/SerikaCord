import mongoose, { Schema, Document, Types } from 'mongoose';

/** A registered application (slash) command — global or guild-scoped. */
export interface IAppCommand extends Document {
  _id: Types.ObjectId;
  applicationId: Types.ObjectId;
  guildId?: Types.ObjectId | null;
  name: string;
  description: string;
  options: unknown[];
  defaultPermission: boolean;
  type: number;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppCommandSchema = new Schema<IAppCommand>({
  applicationId: { type: Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
  guildId: { type: Schema.Types.ObjectId, ref: 'Server', default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 32 },
  description: { type: String, required: true, maxlength: 100 },
  options: { type: Schema.Types.Mixed, default: [] },
  defaultPermission: { type: Boolean, default: true },
  type: { type: Number, default: 1 },
  version: { type: String, default: '1' },
}, { timestamps: true });

AppCommandSchema.index({ applicationId: 1, guildId: 1, name: 1 }, { unique: true });

export const AppCommand =
  (mongoose.models.AppCommand as mongoose.Model<IAppCommand>) ||
  mongoose.model<IAppCommand>('AppCommand', AppCommandSchema);
