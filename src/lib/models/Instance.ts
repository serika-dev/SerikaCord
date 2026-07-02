import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

export type InstanceType = 'host' | 'self_hosted';
export type InstanceStatus = 'active' | 'suspended' | 'pending' | 'offline';

// Official host domains
export const HOST_DOMAINS = ['serika.chat', 'waifu.ws', 'serika.dev'];

export interface IInstanceStats {
  totalUsers: number;
  activeUsers: number;
  totalServers: number;
  totalMessages: number;
  lastSyncAt?: Date;
}

export interface IInstance extends Document {
  _id: Types.ObjectId;
  
  // Identification
  name: string;
  domain: string;
  instanceId: string; // Unique instance identifier
  
  // Type & Status
  type: InstanceType;
  status: InstanceStatus;
  
  // Authentication
  apiKey: string; // Hashed API key for instance auth
  apiKeyPrefix: string; // First 8 chars for identification
  secretKey: string; // For signing requests between instances
  
  // Owner (for self-hosted)
  ownerId?: Types.ObjectId;
  ownerEmail?: string;
  
  // Configuration
  config: {
    allowFederation: boolean; // Allow users to interact with other instances
    allowExternalEmojis: boolean;
    shareUserData: boolean; // Share basic user info for federation
    maxUsers?: number;
    maxServers?: number;
  };
  
  // Stats
  stats: IInstanceStats;
  
  // Security
  allowedIps: string[]; // IP whitelist for this instance
  lastSeenIp?: string;
  lastSeenAt?: Date;
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
}

const InstanceStatsSchema = new Schema({
  totalUsers: { type: Number, default: 0 },
  activeUsers: { type: Number, default: 0 },
  totalServers: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  lastSyncAt: Date,
}, { _id: false });

const InstanceSchema = new Schema<IInstance>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  domain: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  instanceId: {
    type: String,
    required: true,
    unique: true,
    default: () => `inst_${crypto.randomBytes(16).toString('hex')}`,
  },
  type: {
    type: String,
    required: true,
    enum: ['host', 'self_hosted'],
    default: 'self_hosted',
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'suspended', 'pending', 'offline'],
    default: 'pending',
  },
  apiKey: {
    type: String,
    required: true,
    select: false, // Don't return by default
  },
  apiKeyPrefix: {
    type: String,
    required: true,
  },
  secretKey: {
    type: String,
    required: true,
    select: false,
  },
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  ownerEmail: {
    type: String,
    trim: true,
    lowercase: true,
  },
  config: {
    allowFederation: { type: Boolean, default: true },
    allowExternalEmojis: { type: Boolean, default: true },
    shareUserData: { type: Boolean, default: false },
    maxUsers: { type: Number },
    maxServers: { type: Number },
  },
  stats: {
    type: InstanceStatsSchema,
    default: () => ({}),
  },
  allowedIps: [{
    type: String,
  }],
  lastSeenIp: String,
  lastSeenAt: Date,
  approvedAt: Date,
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Indexes
// Note: domain and instanceId already have unique:true which creates indexes
InstanceSchema.index({ status: 1 });
InstanceSchema.index({ type: 1 });
InstanceSchema.index({ apiKeyPrefix: 1 });

export const Instance = mongoose.models.Instance || mongoose.model<IInstance>('Instance', InstanceSchema);

// Helper to check if domain is a host domain
export function isHostDomain(domain: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return HOST_DOMAINS.some(host => 
    normalizedDomain === host || normalizedDomain.endsWith(`.${host}`)
  );
}

// Generate secure API key and hash it
export function generateInstanceApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sk_inst_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 16);
  return { key, hash, prefix };
}

// Generate secret key for signing
export function generateSecretKey(): string {
  return crypto.randomBytes(64).toString('hex');
}

// Verify API key
export async function verifyInstanceApiKey(apiKey: string): Promise<IInstance | null> {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const prefix = apiKey.substring(0, 16);
  
  const instance = await Instance.findOne({ 
    apiKeyPrefix: prefix,
    status: 'active',
  }).select('+apiKey');
  
  if (!instance || instance.apiKey !== hash) {
    return null;
  }
  
  // Update last seen
  instance.lastSeenAt = new Date();
  await instance.save();
  
  return instance;
}

// Get current instance info
let cachedInstance: IInstance | null = null;

export async function getCurrentInstance(): Promise<IInstance | null> {
  if (cachedInstance) {
    return cachedInstance;
  }
  
  const domain = process.env.INSTANCE_DOMAIN || 'localhost';
  
  // Check if this is a host domain
  if (isHostDomain(domain)) {
    // Create or get host instance
    let instance = await Instance.findOne({ domain, type: 'host' });
    
    if (!instance) {
      const { key, hash, prefix } = generateInstanceApiKey();
      const secretKey = generateSecretKey();
      
      instance = await Instance.create({
        name: 'SerikaCord Host',
        domain,
        type: 'host',
        status: 'active',
        apiKey: hash,
        apiKeyPrefix: prefix,
        secretKey,
        config: {
          allowFederation: true,
          allowExternalEmojis: true,
          shareUserData: true,
        },
      });
      
      console.log(`[Instance] Created host instance. API Key (save this!): ${key}`);
    }
    
    cachedInstance = instance;
    return instance;
  }
  
  // Self-hosted instance
  let instance = await Instance.findOne({ domain, type: 'self_hosted' });
  cachedInstance = instance;
  return instance;
}
