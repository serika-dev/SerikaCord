ALTER TABLE "servers" ADD COLUMN "tag_text" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "tag_icon" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "tag_allow_join" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "displayed_tag_server_id" uuid;
