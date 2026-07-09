#!/usr/bin/env bun
/**
 * Seed / update the allowedFileTypes in the platform_settings table.
 * Usage: bun run scripts/seed-file-types.ts
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '../src/lib/db/postgres';
import { config } from '../src/lib/config';

const ALLOWED_FILE_TYPES: { type: string; safe: boolean }[] = [
  // Images
  ...config.ALLOWED_IMAGE_TYPES.map((type) => ({ type, safe: true })),
  // All other file types (deduplicated against image types)
  ...config.ALLOWED_FILE_TYPES
    .filter((type) => !config.ALLOWED_IMAGE_TYPES.includes(type as typeof config.ALLOWED_IMAGE_TYPES[number]))
    .map((type) => ({ type, safe: true })),
];

async function main() {
  console.log(`\n📦 Seeding ${ALLOWED_FILE_TYPES.length} allowed file types to DB...\n`);

  // Check if row exists
  const [existing] = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 'settings'))
    .limit(1);

  if (existing) {
    const before = (existing.allowedFileTypes as unknown[] | null)?.length ?? 0;
    await db
      .update(schema.platformSettings)
      .set({ allowedFileTypes: ALLOWED_FILE_TYPES, updatedAt: new Date() })
      .where(eq(schema.platformSettings.id, 'settings'));
    console.log(`✅ Updated existing platform_settings row (${before} → ${ALLOWED_FILE_TYPES.length} file types)`);
  } else {
    await db.insert(schema.platformSettings).values({
      id: 'settings',
      maintenanceMode: false,
      allowRegistration: true,
      encryptionKey: '',
      allowedFileTypes: ALLOWED_FILE_TYPES,
    });
    console.log(`✅ Created platform_settings row with ${ALLOWED_FILE_TYPES.length} file types`);
  }

  console.log('\nAllowed types:');
  for (const ft of ALLOWED_FILE_TYPES) {
    console.log(`  ${ft.safe ? '✅' : '⚠️'}  ${ft.type}`);
  }
  console.log('\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
