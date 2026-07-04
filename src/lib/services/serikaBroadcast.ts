import { User } from '@/lib/models/User';
import { connectDB } from '@/lib/db';
import mongoose from 'mongoose';

// Serika Broadcast system user ID - fixed ObjectId
export const SERIKA_BROADCAST_ID = new mongoose.Types.ObjectId('000000000000000000000001');

export interface ISerikaBroadcast {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isSystem: boolean;
  isBot: boolean;
  badges: string[];
}

export const SERIKA_BROADCAST_USER: ISerikaBroadcast = {
  id: SERIKA_BROADCAST_ID.toString(),
  username: 'serika',
  displayName: 'Serika',
  avatar: '/serika-broadcast.svg', // System avatar
  isSystem: true,
  isBot: true,
  badges: ['staff', 'admin'],
};

/**
 * Ensure the Serika Broadcast system user exists in the database
 */
export async function ensureSerikaBroadcastUser(): Promise<void> {
  try {
    await connectDB();
    
    const existingUser = await User.findById(SERIKA_BROADCAST_ID);
    
    if (!existingUser) {
      try {
        await User.create({
          _id: SERIKA_BROADCAST_ID,
          username: 'serika',
          displayName: 'Serika',
          avatar: '/serika-broadcast.svg',
          isSystem: true,
          isBot: true,
          isVerified: true,
          badges: ['staff', 'admin'],
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
              directMessages: 'friends',
              friendRequests: 'friends',
            },
          },
        });
        console.log('✅ Serika Broadcast system user created');
      } catch (createError: any) {
        // Handle duplicate key error - user exists but wasn't found (race condition)
        if (createError.code === 11000) {
          console.log('ℹ️ Serika Broadcast user already exists');
        } else {
          throw createError;
        }
      }
    } else {
      // Update existing user if name changed
      let needsUpdate = false;
      if (existingUser.displayName !== 'Serika') {
        existingUser.displayName = 'Serika';
        needsUpdate = true;
      }
      if (existingUser.username !== 'serika') {
        existingUser.username = 'serika';
        needsUpdate = true;
      }
      if (!existingUser.isSystem) {
        existingUser.isSystem = true;
        needsUpdate = true;
      }
      if (needsUpdate) {
        await existingUser.save();
        console.log('✅ Serika Broadcast system user updated');
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to ensure Serika Broadcast user:', error);
    // Don't throw - this shouldn't break the app startup
  }
}

/**
 * Get the Serika Broadcast user data for API responses
 */
export function getSerikaBroadcastUser(): ISerikaBroadcast {
  return SERIKA_BROADCAST_USER;
}

/**
 * Check if a user ID is the Serika Broadcast system user
 */
export function isSerikaBroadcast(userId: string): boolean {
  return userId === SERIKA_BROADCAST_ID.toString();
}
