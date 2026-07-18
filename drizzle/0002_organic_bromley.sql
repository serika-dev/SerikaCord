CREATE TABLE "activity_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text DEFAULT 'game',
	"name" text NOT NULL,
	"image_url" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"kind" "bug_report_kind" DEFAULT 'bug',
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" "bug_report_category" DEFAULT 'other',
	"priority" "bug_report_priority" DEFAULT 'low',
	"status" "bug_report_status" DEFAULT 'open',
	"steps_to_reproduce" text,
	"expected_behavior" text,
	"actual_behavior" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"browser_info" text,
	"os_info" text,
	"app_version" text,
	"assigned_to" uuid,
	"admin_notes" text,
	"resolved_at" timestamp,
	"resolved_by" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "channel_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"igdb_id" integer,
	"steam_app_id" text,
	"name" text NOT NULL,
	"cover_url" text,
	"category" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "widget_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"surfaces" jsonb DEFAULT '{}'::jsonb,
	"resolved_assets" jsonb DEFAULT '[]'::jsonb,
	"sample_data" jsonb DEFAULT '{}'::jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "widget_user_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "consent_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "consent_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "last_consent_dm_at" timestamp;--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "last_timeout_at" timestamp;--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "restricted_guild_ids" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "rich_presence" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "rich_presence" ADD COLUMN "assets" jsonb;--> statement-breakpoint
ALTER TABLE "rich_presence" ADD COLUMN "buttons" jsonb;--> statement-breakpoint
ALTER TABLE "rich_presence" ADD COLUMN "party_id" text;--> statement-breakpoint
ALTER TABLE "rich_presence" ADD COLUMN "party_size" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_widgets" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX "activity_history_user_id_idx" ON "activity_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_history_last_seen_at_idx" ON "activity_history" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_history_user_type_name_unique" ON "activity_history" USING btree ("user_id","type","name");--> statement-breakpoint
CREATE INDEX "bug_reports_reporter_id_idx" ON "bug_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "bug_reports_kind_idx" ON "bug_reports" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "bug_reports_status_idx" ON "bug_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bug_reports_priority_idx" ON "bug_reports" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "bug_reports_category_idx" ON "bug_reports" USING btree ("category");--> statement-breakpoint
CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bug_reports_priority_created_at_idx" ON "bug_reports" USING btree ("priority","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_read_states_user_channel_unique" ON "channel_read_states" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "channel_read_states_user_id_idx" ON "channel_read_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_games_user_id_idx" ON "user_games" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_games_user_id_category_idx" ON "user_games" USING btree ("user_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "user_games_user_category_igdb_unique" ON "user_games" USING btree ("user_id","category","igdb_id");--> statement-breakpoint
CREATE UNIQUE INDEX "widget_configs_application_id_unique" ON "widget_configs" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "widget_user_data_application_user_unique" ON "widget_user_data" USING btree ("application_id","user_id");--> statement-breakpoint
CREATE INDEX "widget_user_data_user_id_idx" ON "widget_user_data" USING btree ("user_id");