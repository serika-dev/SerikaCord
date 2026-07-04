import { User, type IUser } from '@/lib/models/User';
import { Types } from 'mongoose';

// System user IDs (using ObjectId format but predictable)
export const SYSTEM_USERS = {
  SERIKA_BROADCAST: '000000000000000000000001',
  SERIKA_SYSTEM: '000000000000000000000002',
  SERIKA_WELCOME: '000000000000000000000003',
  SERIKA_SUPPORT: '000000000000000000000004',
} as const;

export type SystemUserId = typeof SYSTEM_USERS[keyof typeof SYSTEM_USERS];

interface SystemUserConfig {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  badges: string[];
}

const SYSTEM_USER_CONFIGS: Record<string, SystemUserConfig> = {
  [SYSTEM_USERS.SERIKA_BROADCAST]: {
    id: SYSTEM_USERS.SERIKA_BROADCAST,
    username: 'serika',
    displayName: 'Serika',
    avatar: '/logo-icon.svg',
    bio: 'Official SerikaCord system account for announcements and updates.',
    badges: ['staff', 'admin', 'verified_bot_developer'],
  },
  [SYSTEM_USERS.SERIKA_SYSTEM]: {
    id: SYSTEM_USERS.SERIKA_SYSTEM,
    username: 'system',
    displayName: 'SerikaCord System',
    avatar: '/logo-icon.svg',
    bio: 'System messages from SerikaCord.',
    badges: ['staff'],
  },
  [SYSTEM_USERS.SERIKA_WELCOME]: {
    id: SYSTEM_USERS.SERIKA_WELCOME,
    username: 'welcome',
    displayName: 'Welcome Bot',
    avatar: '/logo-icon.svg',
    bio: 'Welcomes new users to servers.',
    badges: ['verified_bot_developer'],
  },
  [SYSTEM_USERS.SERIKA_SUPPORT]: {
    id: SYSTEM_USERS.SERIKA_SUPPORT,
    username: 'support',
    displayName: 'SerikaCord Support',
    avatar: '/logo-icon.svg',
    bio: 'Official SerikaCord support account.',
    badges: ['staff'],
  },
};

// Ensure system users exist in database
export async function ensureSystemUsers(): Promise<void> {
  for (const [id, config] of Object.entries(SYSTEM_USER_CONFIGS)) {
    try {
      const existingUser = await User.findById(id);
      
      if (!existingUser) {
        // Create system user
        await User.create({
          _id: new Types.ObjectId(id),
          username: config.username,
          displayName: config.displayName,
          avatar: config.avatar,
          bio: config.bio,
          badges: config.badges,
          isBot: true,
          isSystem: true,
          isVerified: true,
          isStaff: true,
          staffRole: 'admin',
          status: 'online',
          settings: {
            theme: 'dark',
            locale: 'en-US',
            notifications: {
              desktop: false,
              sounds: false,
              mentions: false,
            },
            privacy: {
              directMessages: 'everyone',
              friendRequests: 'none' as any,
            },
          },
        });
        
        console.log(`[System] Created system user: ${config.displayName}`);
      } else {
        // Update system user if needed
        let needsUpdate = false;
        
        if (existingUser.displayName !== config.displayName) {
          existingUser.displayName = config.displayName;
          needsUpdate = true;
        }
        
        if (existingUser.avatar !== config.avatar) {
          existingUser.avatar = config.avatar;
          needsUpdate = true;
        }
        
        if (!existingUser.isSystem) {
          existingUser.isSystem = true;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          await existingUser.save();
          console.log(`[System] Updated system user: ${config.displayName}`);
        }
      }
    } catch (error) {
      console.error(`[System] Failed to ensure system user ${config.displayName}:`, error);
    }
  }
}

// Get system user by ID
export function getSystemUserConfig(userId: string): SystemUserConfig | null {
  return SYSTEM_USER_CONFIGS[userId] || null;
}

// Check if user ID is a system user
export function isSystemUser(userId: string): boolean {
  return Object.values(SYSTEM_USERS).includes(userId as SystemUserId);
}

// Get broadcast user for sending announcements
export async function getBroadcastUser(): Promise<IUser | null> {
  await ensureSystemUsers();
  return User.findById(SYSTEM_USERS.SERIKA_BROADCAST);
}

// Get system user for automatic messages
export async function getSystemUser(): Promise<IUser | null> {
  await ensureSystemUsers();
  return User.findById(SYSTEM_USERS.SERIKA_SYSTEM);
}
