import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IApplication extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  teamId?: Types.ObjectId | null;
  name: string;
  description: string;
  icon?: string | null;
  coverImage?: string | null;
  botId?: Types.ObjectId | null;
  botToken?: string | null;
  botPublic: boolean;
  botRequireCodeGrant: boolean;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  scopes: string[];
  installParams?: {
    scopes: string[];
    permissions: string;
  } | null;
  customInstallUrl?: string | null;
  rpcOrigins?: string[];
  verified: boolean;
  verificationStatus: 'none' | 'pending' | 'approved' | 'rejected';
  serverCount: number;
  tags: string[];
  termsOfServiceUrl?: string | null;
  privacyPolicyUrl?: string | null;
  flags: number;
  gatewayIntents: number;
  // Interactions (HTTP) — bot receives signed POSTs at this URL for slash commands.
  interactionsEndpointUrl?: string | null;
  // Ed25519 keypair. `publicKey` is shown to the developer so they can verify our
  // request signatures; `privateKeyPem` is used server-side to sign interaction POSTs.
  publicKey?: string | null;
  privateKeyPem?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  teamId: { type: Schema.Types.ObjectId, ref: 'DeveloperTeam', default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 32 },
  description: { type: String, default: '', maxlength: 4000 },
  icon: { type: String, default: null },
  coverImage: { type: String, default: null },
  botId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  botToken: { type: String, default: null },
  botPublic: { type: Boolean, default: true },
  botRequireCodeGrant: { type: Boolean, default: false },
  clientId: { type: String, required: true, unique: true, index: true },
  clientSecret: { type: String, required: true },
  redirectUris: { type: [String], default: [] },
  scopes: { type: [String], default: ['identify'] },
  installParams: {
    scopes: { type: [String], default: ['bot', 'applications.commands'] },
    permissions: { type: String, default: '0' },
  },
  customInstallUrl: { type: String, default: null },
  rpcOrigins: { type: [String], default: [] },
  verified: { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  serverCount: { type: Number, default: 0 },
  tags: { type: [String], default: [] },
  termsOfServiceUrl: { type: String, default: null },
  privacyPolicyUrl: { type: String, default: null },
  flags: { type: Number, default: 0 },
  gatewayIntents: { type: Number, default: 0 },
  interactionsEndpointUrl: { type: String, default: null },
  publicKey: { type: String, default: null },
  privateKeyPem: { type: String, default: null, select: false },
}, {
  timestamps: true,
});

ApplicationSchema.index({ ownerId: 1, createdAt: -1 });

export const Application = mongoose.models.Application || mongoose.model<IApplication>('Application', ApplicationSchema);
