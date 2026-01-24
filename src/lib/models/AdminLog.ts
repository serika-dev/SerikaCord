import mongoose, { Schema, Document, Types } from 'mongoose';

export type AdminActionType = 
  | 'ban_user'
  | 'unban_user'
  | 'edit_badges'
  | 'delete_server'
  | 'grant_partner'
  | 'revoke_partner'
  | 'toggle_discovery'
  | 'transfer_ownership'
  | 'update_settings'
  | 'broadcast_announcement'
  | 'resolve_report'
  | 'dismiss_report'
  | 'delete_message'
  | 'impersonate_user';

export interface IAdminLog extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  action: AdminActionType;
  targetType: 'user' | 'server' | 'message' | 'platform';
  targetId: string;
  details?: Record<string, unknown>;
  reason?: string;
  createdAt: Date;
}

const AdminLogSchema = new Schema<IAdminLog>({
  adminId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  action: {
    type: String,
    enum: [
      'ban_user',
      'unban_user', 
      'edit_badges',
      'delete_server',
      'grant_partner',
      'revoke_partner',
      'toggle_discovery',
      'transfer_ownership',
      'update_settings',
      'broadcast_announcement',
      'resolve_report',
      'dismiss_report',
      'delete_message',
      'impersonate_user',
    ],
    required: true,
    index: true,
  },
  targetType: {
    type: String,
    enum: ['user', 'server', 'message', 'platform'],
    required: true,
  },
  targetId: {
    type: String,
    required: true,
    index: true,
  },
  details: {
    type: Schema.Types.Mixed,
  },
  reason: String,
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

// Index for efficient log queries
AdminLogSchema.index({ createdAt: -1 });
AdminLogSchema.index({ action: 1, createdAt: -1 });

export const AdminLog = mongoose.models.AdminLog || mongoose.model<IAdminLog>('AdminLog', AdminLogSchema);
