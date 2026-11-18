ALTER TABLE "launch_candidates" ADD COLUMN "channel_message_id" integer;--> statement-breakpoint
ALTER TABLE "launch_candidates" ADD COLUMN "reported_multiple" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "launch_candidates" ADD COLUMN "peak_multiple" real DEFAULT 1 NOT NULL;