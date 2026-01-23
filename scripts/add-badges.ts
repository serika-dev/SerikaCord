#!/usr/bin/env bun
/**
 * Script to add all badges to a specific user
 * Usage: bun run scripts/add-badges.ts
 */

import mongoose from 'mongoose';

// All available badges
const ALL_BADGES = [
  'serikacord_developer',
  'staff',
  'admin',
  'moderator',
  'partner',
  'serika_plus',
  'early_supporter',
  'verified_bot_developer',
  'bug_hunter',
  'bug_hunter_gold',
  'server_owner',
  'active_developer',
  'hypesquad_bravery',
  'hypesquad_brilliance',
  'hypesquad_balance',
] as const;

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:3233/serikacord';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'serikacord';
const TARGET_EMAIL = 'noabolk@schoolsquid.xyz';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI, { dbName: MONGO_DB_NAME });
  console.log('Connected!');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database not connected');
  }

  const usersCollection = db.collection('users');
  
  // Find the user
  const user = await usersCollection.findOne({ email: TARGET_EMAIL });
  
  if (!user) {
    console.log(`User with email ${TARGET_EMAIL} not found.`);
    console.log('\nSearching for similar users...');
    
    // Try to find by username instead
    const users = await usersCollection.find({}).limit(10).toArray();
    console.log('Found users:');
    users.forEach(u => {
      console.log(`  - ${u.email || 'no email'} (${u.username})`);
    });
    
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound user: ${user.username} (${user.email})`);
  console.log(`Current badges: ${user.badges?.join(', ') || 'none'}`);

  // Update with all badges
  const result = await usersCollection.updateOne(
    { email: TARGET_EMAIL },
    { 
      $set: { 
        badges: [...ALL_BADGES],
        isPremium: true,
        premiumTier: 'lifetime',
        premiumSince: new Date(),
        isStaff: true,
        staffRole: 'admin',
      }
    }
  );

  if (result.modifiedCount > 0) {
    console.log('\n✅ Successfully updated user with all badges!');
    console.log('Badges added:', ALL_BADGES.join(', '));
    console.log('\nAlso set:');
    console.log('  - isPremium: true');
    console.log('  - premiumTier: lifetime');
    console.log('  - isStaff: true');
    console.log('  - staffRole: admin');
  } else {
    console.log('\n⚠️ No changes made (user may already have all badges)');
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
