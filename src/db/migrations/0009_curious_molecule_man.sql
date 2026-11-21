DROP INDEX "fees_user_idx";--> statement-breakpoint
DROP INDEX "fees_position_idx";--> statement-breakpoint
ALTER TABLE "fees" ALTER COLUMN "status" SET DEFAULT 'accrued';--> statement-breakpoint
ALTER TABLE "fees" ADD COLUMN "kind" varchar(16) DEFAULT 'performance' NOT NULL;--> statement-breakpoint
ALTER TABLE "fees" ADD COLUMN "basis_lamports" numeric(30, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "fees" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "fees_user_status_idx" ON "fees" USING btree ("telegram_user_id","status");--> statement-breakpoint
CREATE INDEX "fees_position_idx" ON "fees" USING btree ("position_id");