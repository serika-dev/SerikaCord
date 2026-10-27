// Lazy schema ensure for the Social SDK lobby tables, app-scoped DM moderation
// metadata and invite target users (Discord parity, src/lib/api/botApi/social.ts).
// Mirrors drizzle/manual_social_parity.sql: new tables and indexes only, all
// IF NOT EXISTS, nothing on existing tables. Called before the first query
// that needs them (not at boot): nothing runs when they already exist
// (lib/db/schemaGuard), and a failure is retried on the next call.
import { sql } from 'drizzle-orm';
import { ensureSchema, withLockTimeout } from '@/lib/db/schemaGuard';

const g = globalThis as unknown as { __socialParitySchema?: Promise<void> | null };

export function ensureSocialParitySchema(): Promise<void> {
  if (g.__socialParitySchema) return g.__socialParitySchema;
  g.__socialParitySchema = ensureSchema(
    'social-parity',
    {
      tables: {
        lobbies: ['id', 'application_id', 'secret_hash', 'metadata', 'flags', 'idle_timeout_seconds', 'linked_channel_id', 'linked_by_id', 'last_activity_at', 'created_at', 'updated_at'],
        lobby_members: ['lobby_id', 'user_id', 'metadata', 'flags', 'additional_name', 'created_at'],
        lobby_messages: ['id', 'lobby_id', 'application_id', 'author_id', 'content', 'flags', 'additional_name', 'moderation_metadata', 'created_at'],
        app_message_moderation: ['application_id', 'message_id', 'metadata', 'updated_at'],
        invite_target_users: ['invite_id', 'user_id', 'created_at'],
      },
    },
    () => withLockTimeout([
      sql`CREATE TABLE IF NOT EXISTS lobbies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id uuid NOT NULL,
        secret_hash text,
        metadata jsonb,
        flags integer NOT NULL DEFAULT 0,
        idle_timeout_seconds integer NOT NULL DEFAULT 300,
        linked_channel_id uuid,
        linked_by_id uuid,
        last_activity_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      sql`CREATE INDEX IF NOT EXISTS lobbies_application_id_idx ON lobbies (application_id)`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS lobbies_application_id_secret_hash_unique ON lobbies (application_id, secret_hash)`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS lobbies_linked_channel_id_unique ON lobbies (linked_channel_id)`,
      sql`CREATE TABLE IF NOT EXISTS lobby_members (
        lobby_id uuid NOT NULL,
        user_id uuid NOT NULL,
        metadata jsonb,
        flags integer NOT NULL DEFAULT 0,
        additional_name text,
        created_at timestamp DEFAULT now(),
        PRIMARY KEY (lobby_id, user_id)
      )`,
      sql`CREATE INDEX IF NOT EXISTS lobby_members_user_id_idx ON lobby_members (user_id)`,
      sql`CREATE TABLE IF NOT EXISTS lobby_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lobby_id uuid NOT NULL,
        application_id uuid NOT NULL,
        author_id uuid NOT NULL,
        content text NOT NULL DEFAULT '',
        flags integer NOT NULL DEFAULT 0,
        additional_name text,
        moderation_metadata jsonb,
        created_at timestamp DEFAULT now()
      )`,
      sql`CREATE INDEX IF NOT EXISTS lobby_messages_lobby_id_created_at_idx ON lobby_messages (lobby_id, created_at)`,
      sql`CREATE TABLE IF NOT EXISTS app_message_moderation (
        application_id uuid NOT NULL,
        message_id uuid NOT NULL,
        metadata jsonb NOT NULL,
        updated_at timestamp DEFAULT now(),
        PRIMARY KEY (application_id, message_id)
      )`,
      sql`CREATE TABLE IF NOT EXISTS invite_target_users (
        invite_id uuid NOT NULL,
        user_id uuid NOT NULL,
        created_at timestamp DEFAULT now(),
        PRIMARY KEY (invite_id, user_id)
      )`,
    ]),
    { attempts: 3 },
  ).catch((err) => {
    g.__socialParitySchema = null; // retry on the next call
    throw err;
  });
  return g.__socialParitySchema;
}
