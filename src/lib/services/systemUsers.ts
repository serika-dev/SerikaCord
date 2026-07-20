import { User, type IUser } from '@/lib/models/User';

// System user IDs (fixed UUIDs for consistency)
export const SYSTEM_USERS = {
  SERIKA_BROADCAST: '00000000-0000-0000-0000-000000000001',
  SERIKA_SYSTEM: '00000000-0000-0000-0000-000000000002',
  SERIKA_WELCOME: '00000000-0000-0000-0000-000000000003',
  SERIKA_SUPPORT: '00000000-0000-0000-0000-000000000004',
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
    avatar: '/serika-avatar.png',
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
        // Check if a user with the same username already exists (from migration)
        const migratedUser = await User.findOne({ username: config.username });
        if (migratedUser) {
          // Update the migrated user to be a system user
          await User.updateById(migratedUser.id, {
            isBot: true,
            isSystem: true,
            isVerified: true,
            isStaff: true,
            staffRole: 'admin',
            displayName: config.displayName,
            avatar: config.avatar,
            bio: config.bio,
            badges: config.badges,
            status: 'online',
          });
          console.log(`[System] Updated migrated user to system user: ${config.displayName} (id: ${migratedUser.id})`);
        } else {
          // Create new system user
          await User.create({
            id,
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
                friendRequests: 'none',
              },
            },
          });
          console.log(`[System] Created system user: ${config.displayName}`);
        }
      } else {
        // Update system user if needed
        const updateFields: Record<string, any> = {};
        
        if (existingUser.displayName !== config.displayName) {
          updateFields.displayName = config.displayName;
        }
        
        if (existingUser.avatar !== config.avatar) {
          updateFields.avatar = config.avatar;
        }
        
        if (!existingUser.isSystem) {
          updateFields.isSystem = true;
        }
        
        if (Object.keys(updateFields).length > 0) {
          await User.updateById(id, updateFields);
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
