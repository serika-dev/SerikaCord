CREATE TABLE "discord_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"username" text,
	"display_name" text NOT NULL,
	"avatar" text,
	"is_bot" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "discord_users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "tts_sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_word" text NOT NULL,
	"path" text NOT NULL,
	"label" text,
	"enabled" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tts_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"reference_id" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "interaction" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emoji_favorites" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_users_discord_id_idx" ON "discord_users" USING btree ("discord_id");--> statement-breakpoint
CREATE INDEX "tts_sounds_trigger_word_idx" ON "tts_sounds" USING btree ("trigger_word");--> statement-breakpoint
CREATE INDEX "tts_voices_name_idx" ON "tts_voices" USING btree ("name");--> statement-breakpoint
CREATE INDEX "channels_recipient_ids_gin_idx" ON "channels" USING gin ("recipient_ids");--> statement-breakpoint
CREATE INDEX "messages_referenced_message_id_idx" ON "messages" USING btree ("referenced_message_id");